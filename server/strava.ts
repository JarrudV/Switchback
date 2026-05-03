import { storage } from "./storage";
import { createHmac, timingSafeEqual } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { sessions as sessionsTable, stravaSessionLinks, type InsertStravaActivity, type Session } from "@shared/schema";

const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_API_BASE = "https://www.strava.com/api/v3";
const SAME_DAY_DURATION_DELTA_MAX = 0.45;
const ADJACENT_DAY_DURATION_DELTA_MAX = 0.25;
const LEGACY_SAME_DAY_DURATION_DELTA_MAX = 0.2;
const STRAVA_STATE_TTL_MS = 10 * 60 * 1000;

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

interface StravaStatePayload {
  userId: string;
  exp: number;
}

interface StravaApiActivity {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  start_date: string;
  moving_time: number;
  elapsed_time: number;
  distance: number;
  total_elevation_gain: number;
  average_speed: number;
  max_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_watts?: number;
  kilojoules?: number;
  suffer_score?: number;
}

export interface StravaSyncMatch {
  sessionId: string;
  stravaActivityId: string;
  dateDeltaDays: number;
  durationDeltaPct: number;
  confidence: "high" | "medium";
}

interface MatchedPair {
  session: Session;
  activity: StravaApiActivity;
  dateDeltaDays: number;
  durationDeltaPct: number;
  confidence: "high" | "medium";
}

interface AutoCompleteSummary {
  autoCompleted: number;
  matchedCount: number;
  unmatchedCount: number;
  matches: StravaSyncMatch[];
}

export interface SyncStravaOptions {
  activeWeek?: number | null;
  adaptiveMatchV1?: boolean;
}

export interface SyncStravaActivitiesResult extends AutoCompleteSummary {
  synced: number;
  total: number;
  latestSyncedActivityId: string | null;
}

function getStateSecret(): string {
  const secret = process.env.STRAVA_STATE_SECRET || process.env.SESSION_SECRET || process.env.STRAVA_CLIENT_SECRET;
  if (!secret) {
    throw new Error("Missing STRAVA_STATE_SECRET or SESSION_SECRET for Strava OAuth state");
  }
  return secret;
}

function signStatePayload(payloadBase64: string): string {
  return createHmac("sha256", getStateSecret())
    .update(payloadBase64)
    .digest("base64url");
}

export function createStravaOAuthState(userId: string): string {
  const payload: StravaStatePayload = {
    userId,
    exp: Date.now() + STRAVA_STATE_TTL_MS,
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signStatePayload(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

export function parseStravaOAuthState(state: string): string {
  const [payloadBase64, signature] = state.split(".", 2);
  if (!payloadBase64 || !signature) {
    throw new Error("Invalid Strava OAuth state");
  }

  const expectedSignature = signStatePayload(payloadBase64);
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new Error("Invalid Strava OAuth signature");
  }

  const raw = Buffer.from(payloadBase64, "base64url").toString("utf8");
  const payload = JSON.parse(raw) as Partial<StravaStatePayload>;

  if (!payload.userId || typeof payload.userId !== "string" || !payload.exp || typeof payload.exp !== "number") {
    throw new Error("Invalid Strava OAuth state payload");
  }

  if (Date.now() > payload.exp) {
    throw new Error("Strava OAuth state expired");
  }

  return payload.userId;
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cached = tokenCache.get(refreshToken);

  if (cached && cached.expiresAt > now + 60) {
    return cached.accessToken;
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Strava credentials not configured");
  }

  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  tokenCache.set(refreshToken, {
    accessToken: data.access_token,
    expiresAt: data.expires_at,
  });

  return data.access_token;
}

async function fetchActivities(refreshToken: string, page = 1, perPage = 50): Promise<StravaApiActivity[]> {
  const token = await getAccessToken(refreshToken);

  const url = new URL(`${STRAVA_API_BASE}/athlete/activities`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava API error: ${res.status} ${text}`);
  }

  return res.json();
}

function mapActivity(a: StravaApiActivity): InsertStravaActivity {
  return {
    id: `strava-${a.id}`,
    stravaId: String(a.id),
    name: a.name,
    type: a.type,
    sportType: a.sport_type || null,
    startDate: a.start_date,
    movingTime: a.moving_time,
    elapsedTime: a.elapsed_time,
    distance: a.distance,
    totalElevationGain: a.total_elevation_gain,
    averageSpeed: a.average_speed,
    maxSpeed: a.max_speed,
    averageHeartrate: a.average_heartrate ?? null,
    maxHeartrate: a.max_heartrate ?? null,
    averageWatts: a.average_watts ?? null,
    kilojoules: a.kilojoules ?? null,
    sufferScore: a.suffer_score ?? null,
    syncedAt: new Date().toISOString(),
  };
}

export async function syncStravaActivities(
  userId: string,
  refreshToken: string,
  options: SyncStravaOptions = {},
): Promise<SyncStravaActivitiesResult> {
  let allActivities: StravaApiActivity[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const batch = await fetchActivities(refreshToken, page, perPage);
    if (batch.length === 0) break;
    allActivities = allActivities.concat(batch);
    if (batch.length < perPage) break;
    page += 1;
    if (page > 5) break;
  }

  const rideTypes = new Set(["Ride", "VirtualRide", "MountainBikeRide", "GravelRide", "EBikeRide"]);
  const rides = allActivities.filter((a) => rideTypes.has(a.type));

  let synced = 0;
  for (const ride of rides) {
    await storage.upsertStravaActivity(userId, mapActivity(ride));
    synced += 1;
  }

  const latestSyncedActivityId = rides
    .slice()
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0]?.id;

  const autoComplete = await autoCompleteSessionsFromActivities(userId, rides, {
    activeWeek: options.activeWeek,
    adaptiveMatchV1: options.adaptiveMatchV1 !== false,
  });

  return {
    synced,
    total: allActivities.length,
    latestSyncedActivityId: latestSyncedActivityId ? String(latestSyncedActivityId) : null,
    ...autoComplete,
  };
}

export function isStravaConfigured(): boolean {
  return !!(
    process.env.STRAVA_CLIENT_ID &&
    process.env.STRAVA_CLIENT_SECRET
  );
}

function toDateOnly(isoString: string): string {
  return isoString.slice(0, 10);
}

function toUtcMidnightMs(dateOnly: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  const parsed = Date.parse(`${dateOnly}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function getDateDeltaDays(sessionDate: string, activityStartDate: string): number | null {
  const sessionMs = toUtcMidnightMs(sessionDate);
  const activityMs = toUtcMidnightMs(toDateOnly(activityStartDate));
  if (sessionMs === null || activityMs === null) return null;
  return Math.round((activityMs - sessionMs) / 86_400_000);
}

function getActivityDurationSeconds(activity: StravaApiActivity): number {
  return activity.moving_time || activity.elapsed_time || 0;
}

function resolveActiveWeek(sessions: Session[], preferredWeek: number | null | undefined): number {
  const weeks = Array.from(new Set(sessions.map((session) => session.week))).sort((a, b) => a - b);
  if (weeks.length === 0) return 1;

  if (
    typeof preferredWeek === "number" &&
    Number.isFinite(preferredWeek) &&
    preferredWeek > 0 &&
    weeks.includes(preferredWeek)
  ) {
    return preferredWeek;
  }

  for (const week of weeks) {
    const weekSessions = sessions.filter((session) => session.week === week);
    if (weekSessions.some((session) => !session.completed)) {
      return week;
    }
  }

  return weeks[0];
}

function buildMatchCandidates(params: {
  sessions: Session[];
  activities: StravaApiActivity[];
  activeWeek: number;
  adaptiveMatchV1: boolean;
  blockedActivityIds: Set<string>;
}): MatchedPair[] {
  const pairs: MatchedPair[] = [];

  const candidateSessions = params.sessions.filter(
    (session) =>
      !session.completed &&
      !session.completedStravaActivityId &&
      session.week === params.activeWeek &&
      !!session.scheduledDate &&
      (session.type === "Ride" || session.type === "Long Ride") &&
      session.minutes > 0,
  );

  for (const session of candidateSessions) {
    const plannedSeconds = session.minutes * 60;
    if (!plannedSeconds) continue;

    for (const activity of params.activities) {
      const activityId = String(activity.id);
      if (params.blockedActivityIds.has(activityId)) {
        continue;
      }

      const activitySeconds = getActivityDurationSeconds(activity);
      if (!activitySeconds) {
        continue;
      }

      const dateDeltaDays = getDateDeltaDays(session.scheduledDate!, activity.start_date);
      if (dateDeltaDays === null) continue;

      const absDateDelta = Math.abs(dateDeltaDays);
      let allowedDurationDelta: number | null = null;
      let confidence: "high" | "medium" = "high";

      if (params.adaptiveMatchV1) {
        if (absDateDelta === 0) {
          allowedDurationDelta = SAME_DAY_DURATION_DELTA_MAX;
          confidence = "high";
        } else if (absDateDelta === 1) {
          allowedDurationDelta = ADJACENT_DAY_DURATION_DELTA_MAX;
          confidence = "medium";
        }
      } else if (absDateDelta === 0) {
        allowedDurationDelta = LEGACY_SAME_DAY_DURATION_DELTA_MAX;
        confidence = "high";
      }

      if (allowedDurationDelta === null) continue;

      const durationDeltaPct = Math.abs(activitySeconds - plannedSeconds) / plannedSeconds;
      if (durationDeltaPct > allowedDurationDelta) continue;

      pairs.push({
        session,
        activity,
        dateDeltaDays,
        durationDeltaPct,
        confidence,
      });
    }
  }

  return pairs;
}

async function autoCompleteSessionsFromActivities(
  userId: string,
  activities: StravaApiActivity[],
  options: { activeWeek?: number | null; adaptiveMatchV1: boolean },
): Promise<AutoCompleteSummary> {
  if (activities.length === 0) {
    return {
      autoCompleted: 0,
      matchedCount: 0,
      unmatchedCount: 0,
      matches: [],
    };
  }

  const sessions = await storage.getSessions(userId);
  const activeWeek = resolveActiveWeek(sessions, options.activeWeek);
  const activityIds = activities.map((activity) => String(activity.id));

  const existingLinks = activityIds.length
    ? await db
        .select({
          sessionId: stravaSessionLinks.sessionId,
          stravaActivityId: stravaSessionLinks.stravaActivityId,
        })
        .from(stravaSessionLinks)
        .where(
          and(
            eq(stravaSessionLinks.userId, userId),
            inArray(stravaSessionLinks.stravaActivityId, activityIds),
          ),
        )
    : [];
  const blockedActivityIds = new Set(existingLinks.map((row) => row.stravaActivityId));

  const pairs = buildMatchCandidates({
    sessions,
    activities,
    activeWeek,
    adaptiveMatchV1: options.adaptiveMatchV1,
    blockedActivityIds,
  });

  if (pairs.length === 0) {
    return {
      autoCompleted: 0,
      matchedCount: 0,
      unmatchedCount: Math.max(0, activities.length - blockedActivityIds.size),
      matches: [],
    };
  }

  // Deterministic ordering: closest date, then closest duration, then stable ids.
  pairs.sort((a, b) => {
    const aDate = Math.abs(a.dateDeltaDays);
    const bDate = Math.abs(b.dateDeltaDays);
    if (aDate !== bDate) {
      return aDate - bDate;
    }
    if (a.durationDeltaPct !== b.durationDeltaPct) {
      return a.durationDeltaPct - b.durationDeltaPct;
    }
    if (a.session.id !== b.session.id) {
      return a.session.id.localeCompare(b.session.id);
    }
    return String(a.activity.id).localeCompare(String(b.activity.id));
  });

  const usedSessionIds = new Set<string>();
  const usedActivityIds = new Set<string>(blockedActivityIds);
  const selected: MatchedPair[] = [];

  for (const pair of pairs) {
    const activityId = String(pair.activity.id);
    if (usedSessionIds.has(pair.session.id) || usedActivityIds.has(activityId)) {
      continue;
    }
    usedSessionIds.add(pair.session.id);
    usedActivityIds.add(activityId);
    selected.push(pair);
  }

  if (selected.length === 0) {
    return {
      autoCompleted: 0,
      matchedCount: 0,
      unmatchedCount: Math.max(0, activities.length - blockedActivityIds.size),
      matches: [],
    };
  }

  await db.transaction(async (tx) => {
    for (const pair of selected) {
      const stravaActivityId = String(pair.activity.id);
      const matchScore = Math.max(0, Math.min(1, 1 - pair.durationDeltaPct));
      const completedAt = pair.activity.start_date;

      await tx
        .update(sessionsTable)
        .set({
          completed: true,
          completedAt,
          completionSource: "strava",
          completedStravaActivityId: stravaActivityId,
          completionMatchScore: matchScore,
        })
        .where(and(eq(sessionsTable.userId, userId), eq(sessionsTable.id, pair.session.id)));

      await tx
        .insert(stravaSessionLinks)
        .values({
          userId,
          sessionId: pair.session.id,
          stravaActivityId,
          dateDeltaDays: pair.dateDeltaDays,
          durationDeltaPct: pair.durationDeltaPct,
          confidence: pair.confidence,
        })
        .onConflictDoNothing();
    }
  });

  const matches = selected.map((pair) => ({
    sessionId: pair.session.id,
    stravaActivityId: String(pair.activity.id),
    dateDeltaDays: pair.dateDeltaDays,
    durationDeltaPct: Number(pair.durationDeltaPct.toFixed(4)),
    confidence: pair.confidence,
  }));

  return {
    autoCompleted: selected.length,
    matchedCount: selected.length,
    unmatchedCount: Math.max(0, activities.length - selected.length - blockedActivityIds.size),
    matches,
  };
}

export function getStravaAuthUrl(redirectUri: string, state?: string): string {
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) throw new Error("STRAVA_CLIENT_ID not set");

  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "read,activity:read_all");
  url.searchParams.set("approval_prompt", "force");
  if (state) {
    url.searchParams.set("state", state);
  }

  return url.toString();
}

export async function exchangeCodeForToken(code: string): Promise<{ refresh_token: string; access_token: string; expires_at: number }> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) throw new Error("Strava credentials not configured");

  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  if (data.refresh_token) {
    tokenCache.set(data.refresh_token, {
      accessToken: data.access_token,
      expiresAt: data.expires_at,
    });
  }

  return data;
}
