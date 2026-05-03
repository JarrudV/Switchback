import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { storage } from "./storage";
import { db } from "./db";
import {
  sessions as sessionsTable,
  coachAdjustmentProposals,
  coachAdjustmentEvents,
  coachAdjustmentEventItems,
  rideInsights,
  planRealignEvents,
  insertMetricSchema,
  insertServiceItemSchema,
  insertGoalEventSchema,
  type CoachAdjustmentChange,
  type CoachAdjustmentProposal,
  type CoachAdjustmentProposalStatus,
  type Metric,
  type Session,
  type StravaActivity,
} from "@shared/schema";
import { getWorkoutDetails } from "./workout-library";
import {
  syncStravaActivities,
  isStravaConfigured,
  getStravaAuthUrl,
  exchangeCodeForToken,
  createStravaOAuthState,
  parseStravaOAuthState,
  type StravaSyncMatch,
} from "./strava";
import { generateAIPlan, type PlanRequest } from "./ai-plan-generator";
import { getGeminiClient, getGeminiModel } from "./gemini-client";
import { isAuthenticated } from "./auth";
import { authStorage } from "./auth-storage";
import { getPublicVapidKey, isPushConfigured } from "./push";
import { analyzeRideHistoryForPlan, type TrainingState } from "./ride-analysis";
import {
  buildTrainingPlanFromPreset,
  DEFAULT_TRAINING_PLAN_PRESET_ID,
  getTrainingPlanTemplateById,
  getTrainingPlanTemplates,
} from "./plan-presets";

const sessionUpdateSchema = z.object({
  completed: z.boolean().optional(),
  completedAt: z.string().nullable().optional(),
  completionSource: z.enum(["manual", "strava"]).nullable().optional(),
  type: z.enum(["Ride", "Long Ride", "Strength", "Rest"]).optional(),
  description: z.string().min(1).optional(),
  zone: z.string().nullable().optional(),
  strength: z.boolean().optional(),
  rpe: z.number().min(1).max(10).nullable().optional(),
  notes: z.string().nullable().optional(),
  minutes: z.number().positive().optional(),
});

const serviceItemUpdateSchema = z.object({
  status: z.string().optional(),
  date: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const settingValueSchema = z.object({
  value: z.string(),
});

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});

const reminderSettingsSchema = z.object({
  timezone: z.string().min(1),
  longRideEveningBeforeEnabled: z.boolean(),
  serviceDueDateEnabled: z.boolean(),
  goalOneWeekCountdownEnabled: z.boolean(),
});

const markNotificationReadSchema = z.object({
  id: z.string().optional(),
  all: z.boolean().optional(),
});

const loadDefaultPlanSchema = z.object({
  presetId: z.string().trim().min(1).optional(),
});

type BikeType = "mtb" | "gravel" | "road" | "other";

interface BikeProfileSetting {
  bikeName: string;
  make: string;
  model: string;
  bikeType: BikeType;
  carryOverKm: number;
}

interface BikeMaintenanceState {
  ruleProgressKm: Record<string, number>;
  lastGeneratedAt: string | null;
}

interface MaintenanceRule {
  id: string;
  task: string;
  intervalKm: number;
  details: string;
}

const MAINTENANCE_RULES: MaintenanceRule[] = [
  {
    id: "chain-lube",
    task: "Clean and lube chain",
    intervalKm: 100,
    details: "Wipe drivetrain, inspect chain wear, then lube for smooth shifting.",
  },
  {
    id: "brake-check",
    task: "Brake pad and rotor check",
    intervalKm: 150,
    details: "Inspect pad thickness, rotor rub, and lever feel before the next ride.",
  },
  {
    id: "bolt-check",
    task: "Critical bolt torque check",
    intervalKm: 200,
    details: "Check stem, bar, crank, and axle bolts to manufacturer torque specs.",
  },
  {
    id: "suspension-clean",
    task: "Fork/shock stanchion clean",
    intervalKm: 200,
    details: "Clean stanchions and seals to protect suspension performance.",
  },
];

const coachHistoryItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
});

const coachChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z.array(coachHistoryItemSchema).max(20).optional().default([]),
});

const metricUpdateSchema = insertMetricSchema
  .partial()
  .refine((payload) => Object.keys(payload).length > 0, "At least one field is required");

const FREE_COACH_MONTHLY_LIMIT = 5;
const COACH_STRAVA_SYNC_INTERVAL_HOURS = 6;
const COACH_ADJUSTMENTS_SAFE_MODE = process.env.COACH_ADJUSTMENTS_SAFE_MODE !== "false";
const COACH_RESPONSE_STRICT_JSON =
  process.env.COACH_RESPONSE_STRICT_JSON !== "false" &&
  process.env.coachResponseStrictJson !== "false";
const STRAVA_ADAPTIVE_MATCH_V1 =
  process.env.STRAVA_ADAPTIVE_MATCH_V1 !== "false" &&
  process.env.stravaAdaptiveMatchV1 !== "false";
const DASHBOARD_RIDE_INSIGHTS =
  process.env.DASHBOARD_RIDE_INSIGHTS !== "false" &&
  process.env.dashboardRideInsights !== "false";
const PLAN_DATE_REALIGN_PROMPT =
  process.env.PLAN_DATE_REALIGN_PROMPT !== "false" &&
  process.env.planDateRealignPrompt !== "false";
const COACH_PROPOSAL_TTL_HOURS = 24;
const COACH_PROPOSAL_MAX_CHANGES = 3;
const COACH_PROPOSAL_MIN_MINUTES = 20;
const COACH_PROPOSAL_MAX_MINUTES = 300;
const COACH_ZONE_PATTERN = /^[A-Za-z0-9+\-/ ]{1,24}$/;

interface CoachModelSuggestedChange {
  sessionId?: string;
  minutes?: number;
  zone?: string | null;
  reason?: string;
}

interface CoachModelPayload {
  reply?: string;
  changes?: CoachModelSuggestedChange[];
}

interface CoachProposalApiItem {
  sessionId: string;
  sessionLabel: string;
  before: {
    minutes: number;
    zone: string | null;
  };
  after: {
    minutes: number;
    zone: string | null;
  };
  reason: string;
}

interface CoachProposalApiResponse {
  id: string;
  activeWeek: number;
  status: CoachAdjustmentProposalStatus;
  createdAt: string;
  expiresAt: string;
  changes: CoachProposalApiItem[];
}

interface StravaAlignmentSuggestion {
  fromDate: string;
  toDate: string;
  deltaDays: number;
  reason: string;
}

interface RideInsightMetric {
  label: string;
  value: string;
}

interface RideInsightProposalSummary {
  id: string;
  status: CoachAdjustmentProposalStatus;
  activeWeek: number;
  changes: CoachProposalApiItem[];
}

interface LatestRideInsightResponse {
  insightId: string;
  activity: {
    id: string;
    name: string;
    startDate: string;
  };
  matchedSession: {
    id: string;
    label: string;
    completed: boolean;
  } | null;
  summary: {
    headline: string;
    text: string;
  };
  metrics: RideInsightMetric[];
  proposal: RideInsightProposalSummary | null;
}

interface RideInsightModelPayload {
  headline?: string;
  summary?: string;
  metrics?: Array<{ label?: string; value?: string }>;
  changes?: CoachModelSuggestedChange[];
}

function requireUserId(req: Request, res: Response): string | null {
  const userId = (req as any)?.user?.claims?.sub;
  if (!userId || typeof userId !== "string") {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

function sanitizeStravaErrorMessage(input: unknown): string {
  const raw = typeof input === "string" ? input : input instanceof Error ? input.message : "Unknown Strava error";

  // Remove sensitive token-like values from messages before storing/returning.
  let sanitized = raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(access_token|refresh_token|client_secret|authorization_code|code)=([^&\s]+)/gi, "$1=[redacted]");

  if (sanitized.length > 400) {
    sanitized = `${sanitized.slice(0, 400)}...`;
  }

  return sanitized;
}

async function setStravaLastError(userId: string, message: string | null): Promise<void> {
  await storage.setSetting(userId, "stravaLastError", message ?? "");
}

function getCurrentMonthKey(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getCoachUsageSettingKey(monthKey: string): string {
  return `coachUsage:${monthKey}`;
}

function normalizeSubscriptionTier(raw: string | null): "free" | "pro" {
  return raw === "pro" ? "pro" : "free";
}

function shouldSyncStravaForCoach(lastSyncAt: string | null, activityCount: number): boolean {
  if (activityCount === 0) return true;
  if (!lastSyncAt) return true;
  const parsed = safeDate(lastSyncAt);
  if (!parsed) return true;

  const elapsedMs = Date.now() - parsed.getTime();
  return elapsedMs >= COACH_STRAVA_SYNC_INTERVAL_HOURS * 60 * 60 * 1000;
}

function getDayOrder(day: string | null | undefined): number {
  const normalized = (day || "").slice(0, 3).toLowerCase();
  const idx = WEEKDAY_ORDER.indexOf(normalized);
  return idx >= 0 ? idx : 99;
}

function getTodayOrder(): number {
  const d = new Date().getDay();
  return d === 0 ? 6 : d - 1;
}

function normalizeZoneValue(zone: string | null | undefined): string | null {
  if (zone === undefined || zone === null) return null;
  const trimmed = zone.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, " ");
}

function isValidCoachZone(zone: string | null): boolean {
  if (zone === null) return true;
  return COACH_ZONE_PATTERN.test(zone);
}

function getSessionLabel(session: Session): string {
  return session.scheduledDate ? `${session.day} (${session.scheduledDate})` : session.day;
}

function isFutureSessionForCoach(session: Session, activeWeek: number, todayIso: string, todayOrder: number): boolean {
  if (session.week !== activeWeek) return false;
  if (session.completed) return false;
  if (session.scheduledDate) return session.scheduledDate >= todayIso;
  return getDayOrder(session.day) >= todayOrder;
}

function toCoachProposalApiResponse(proposal: CoachAdjustmentProposal): CoachProposalApiResponse {
  const changes = Array.isArray(proposal.changes) ? (proposal.changes as CoachProposalApiItem[]) : [];
  return {
    id: proposal.id,
    activeWeek: proposal.activeWeek,
    status: proposal.status,
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
    changes,
  };
}

function parseCoachModelPayload(raw: string): CoachModelPayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];

  const fencedMatches = Array.from(trimmed.matchAll(/```json\s*([\s\S]*?)```/gi));
  for (const match of fencedMatches) {
    if (match[1]) candidates.push(match[1].trim());
  }

  const taggedMatch = trimmed.match(/<coach_json>([\s\S]*?)<\/coach_json>/i);
  if (taggedMatch?.[1]) candidates.push(taggedMatch[1].trim());

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as CoachModelPayload;
      if (!parsed || typeof parsed !== "object") continue;
      if (typeof parsed.reply !== "string" && !Array.isArray(parsed.changes)) continue;
      return parsed;
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

function parseRideInsightModelPayload(raw: string): RideInsightModelPayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];
  const fencedMatches = Array.from(trimmed.matchAll(/```json\s*([\s\S]*?)```/gi));
  for (const match of fencedMatches) {
    if (match[1]) candidates.push(match[1].trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as RideInsightModelPayload;
      if (!parsed || typeof parsed !== "object") continue;
      return parsed;
    } catch {
      // Keep trying.
    }
  }

  return null;
}

function normalizeInsightMetrics(input: unknown): RideInsightMetric[] {
  if (!Array.isArray(input)) return [];

  const metrics: RideInsightMetric[] = [];
  for (const item of input) {
    const label = typeof item?.label === "string" ? item.label.trim() : "";
    const value = typeof item?.value === "string" ? item.value.trim() : "";
    if (!label || !value) continue;
    metrics.push({
      label: label.slice(0, 48),
      value: value.slice(0, 64),
    });
    if (metrics.length >= 8) break;
  }

  return metrics;
}

function extractCoachReplyText(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const looksLikeJson =
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("```");

  const parsedPayload = parseCoachModelPayload(trimmed);
  if (parsedPayload?.reply && typeof parsedPayload.reply === "string") {
    const reply = parsedPayload.reply.trim();
    return reply || null;
  }

  if (looksLikeJson) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed.reply === "string" && parsed.reply.trim()) {
        return parsed.reply.trim();
      }
    } catch {
      // Ignore parse failures and fall through.
    }
    return null;
  }

  return trimmed;
}

function buildDeterministicCoachFallback(params: {
  activeWeek: number;
  message: string;
  sessions: Session[];
  activities: StravaActivity[];
  metrics: Metric[];
}): string {
  const weekSessions = params.sessions.filter((session) => session.week === params.activeWeek);
  const pending = weekSessions.filter((session) => !session.completed).length;
  const recentRides = countRecentStravaRides(params.activities, 14);
  const recentMetrics = countRecentMetrics(params.metrics, 7);
  const question = params.message.trim().slice(0, 120);

  return [
    `I can help with Week ${params.activeWeek}.`,
    `You have ${pending} pending sessions, ${recentRides} rides synced in the last 14 days, and ${recentMetrics} recent metrics entries.`,
    `Based on your message "${question}", start with an easy Z1-Z2 day if fatigue is high, then resume the next planned session.`,
    "If you want plan edits, ask me which day to adjust and I will suggest specific minutes and zone changes.",
  ].join(" ");
}

const COACH_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          minutes: { type: "number" },
          zone: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
  required: ["reply", "changes"],
} as const;

const RIDE_INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    metrics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          value: { type: "string" },
        },
      },
    },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          minutes: { type: "number" },
          zone: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
  required: ["headline", "summary", "metrics", "changes"],
} as const;

async function generateCoachReplyWithGuardrails(params: {
  prompt: string;
  message: string;
  sessions: Session[];
  activities: StravaActivity[];
  metrics: Metric[];
  activeWeek: number;
}): Promise<{ reply: string; payload: CoachModelPayload | null }> {
  const ai = getGeminiClient();
  const model = getGeminiModel("gemini-2.5-flash");

  let payload: CoachModelPayload | null = null;
  let reply = "";

  try {
    const response = await ai.models.generateContent({
      model,
      contents: params.prompt,
      config: {
        temperature: 0.55,
        maxOutputTokens: 1200,
        ...(COACH_RESPONSE_STRICT_JSON
          ? {
              responseMimeType: "application/json",
              responseSchema: COACH_RESPONSE_SCHEMA as any,
            }
          : {}),
      },
    });

    const raw = response.text?.trim() || "";
    payload = parseCoachModelPayload(raw);
    reply = payload?.reply?.trim() || extractCoachReplyText(raw) || "";
    if (!payload && COACH_RESPONSE_STRICT_JSON) {
      console.warn("[coach] strict-json parse failed on primary response");
    }
  } catch (err: any) {
    console.warn("[coach] primary generation failed:", err?.message || err);
  }

  if (!reply) {
    try {
      const retry = await ai.models.generateContent({
        model,
        contents: `${params.prompt}\n\nRespond with plain text only. Do not return JSON, markdown, or code fences.`,
        config: {
          temperature: 0.45,
          maxOutputTokens: 800,
        },
      });
      const rawRetry = retry.text?.trim() || "";
      reply = extractCoachReplyText(rawRetry) || "";
    } catch (err: any) {
      console.warn("[coach] plain-text retry failed:", err?.message || err);
    }
  }

  if (!reply) {
    reply = buildDeterministicCoachFallback({
      activeWeek: params.activeWeek,
      message: params.message,
      sessions: params.sessions,
      activities: params.activities,
      metrics: params.metrics,
    });
  }

  return {
    reply,
    payload,
  };
}

function shiftIsoDateByDays(dateIso: string, deltaDays: number): string | null {
  const parsed = safeDate(`${dateIso}T00:00:00Z`);
  if (!parsed) return null;
  parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
  return parsed.toISOString().slice(0, 10);
}

function diffIsoDays(fromIso: string, toIso: string): number | null {
  const fromMs = safeDate(`${fromIso}T00:00:00Z`)?.getTime();
  const toMs = safeDate(`${toIso}T00:00:00Z`)?.getTime();
  if (fromMs === undefined || toMs === undefined) return null;
  return Math.round((toMs - fromMs) / 86_400_000);
}

function getCurrentWeekMondayIso(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() + mondayOffset);
  return monday.toISOString().slice(0, 10);
}

function getIsoForDayInCurrentWeek(dayName: string): string | null {
  const order = getDayOrder(dayName);
  if (order < 0 || order > 6) return null;
  const mondayIso = getCurrentWeekMondayIso();
  return shiftIsoDateByDays(mondayIso, order);
}

function detectPlanDateAlignmentSuggestion(params: {
  sessions: Session[];
  activities: StravaActivity[];
  activeWeek: number;
}): StravaAlignmentSuggestion | null {
  if (params.activities.length === 0) return null;

  const hasRecentRide = countRecentStravaRides(params.activities, 14) > 0;
  if (!hasRecentRide) return null;

  const weekPending = params.sessions
    .filter((session) => session.week === params.activeWeek && !session.completed && !!session.scheduledDate)
    .sort((a, b) => (a.scheduledDate || "").localeCompare(b.scheduledDate || ""));
  if (weekPending.length === 0) return null;

  const earliest = weekPending[0];
  const fromDate = earliest.scheduledDate!;
  const toDate = getIsoForDayInCurrentWeek(earliest.day);
  if (!toDate) return null;

  const deltaDays = diffIsoDays(fromDate, toDate);
  if (deltaDays === null || Math.abs(deltaDays) < 3) return null;

  return {
    fromDate,
    toDate,
    deltaDays,
    reason: `Plan starts ${fromDate}, but current week should start around ${toDate}.`,
  };
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "n/a";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function buildFallbackRideInsight(activity: StravaActivity, matchedSession: Session | null): {
  headline: string;
  summary: string;
  metrics: RideInsightMetric[];
} {
  const metrics: RideInsightMetric[] = [
    { label: "Distance", value: `${((activity.distance || 0) / 1000).toFixed(1)} km` },
    { label: "Moving time", value: formatDuration(activity.movingTime) },
    { label: "Elevation", value: `${Math.round(activity.totalElevationGain || 0)} m` },
  ];
  if (activity.averageHeartrate) {
    metrics.push({ label: "Avg HR", value: `${Math.round(activity.averageHeartrate)} bpm` });
  }
  if (activity.maxHeartrate) {
    metrics.push({ label: "Max HR", value: `${Math.round(activity.maxHeartrate)} bpm` });
  }
  if (activity.averageWatts) {
    metrics.push({ label: "Avg Power", value: `${Math.round(activity.averageWatts)} W` });
  }
  if (activity.sufferScore) {
    metrics.push({ label: "Relative effort", value: String(activity.sufferScore) });
  }

  const matchedContext = matchedSession
    ? `Matched to planned session: ${matchedSession.description} (${matchedSession.minutes} min${matchedSession.zone ? ` ${matchedSession.zone}` : ""}).`
    : "No planned session match was found for this ride.";

  return {
    headline: "Latest synced ride insight",
    summary: `${matchedContext} Keep recovery proportional to effort and adjust only if fatigue remains elevated for 48 hours.`,
    metrics: metrics.slice(0, 8),
  };
}

async function createLatestRideInsightAfterSync(params: {
  userId: string;
  activeWeek: number;
  latestSyncedActivityId: string | null;
  matches: StravaSyncMatch[];
  sessions: Session[];
  activities: StravaActivity[];
  sourceUserMessage: string;
}): Promise<string | null> {
  if (!params.latestSyncedActivityId) return null;

  const activity = params.activities.find((item) => item.stravaId === params.latestSyncedActivityId);
  if (!activity) return null;

  const matching = params.matches.find((item) => item.stravaActivityId === activity.stravaId) || null;
  const matchedSession = matching
    ? params.sessions.find((session) => session.id === matching.sessionId) || null
    : null;

  const fallback = buildFallbackRideInsight(activity, matchedSession);
  let proposalId: string | null = null;
  let headline = fallback.headline;
  let summary = fallback.summary;
  let metrics = fallback.metrics;

  try {
    const ai = getGeminiClient();
    const model = getGeminiModel("gemini-2.5-flash");
    const ridePrompt = buildRideInsightPrompt({
      activity,
      matchedSession,
      activeWeek: params.activeWeek,
      sessions: params.sessions,
    });

    const response = await ai.models.generateContent({
      model,
      contents: ridePrompt,
      config: {
        temperature: 0.45,
        maxOutputTokens: 900,
        responseMimeType: "application/json",
        responseSchema: RIDE_INSIGHT_SCHEMA as any,
      },
    });

    const payload = parseRideInsightModelPayload(response.text || "");
    if (payload?.headline?.trim()) {
      headline = payload.headline.trim().slice(0, 120);
    }
    if (payload?.summary?.trim()) {
      summary = payload.summary.trim().slice(0, 500);
    }

    const normalizedMetrics = normalizeInsightMetrics(payload?.metrics);
    if (normalizedMetrics.length > 0) {
      metrics = normalizedMetrics;
    }

    if (
      COACH_ADJUSTMENTS_SAFE_MODE &&
      Array.isArray(payload?.changes) &&
      payload!.changes.length > 0
    ) {
      const todayIso = new Date().toISOString().slice(0, 10);
      const todayOrder = getTodayOrder();
      const eligibleSessions = params.sessions.filter((session) =>
        isFutureSessionForCoach(session, params.activeWeek, todayIso, todayOrder),
      );
      const validatedChanges = buildValidatedCoachProposalChanges(payload!.changes, eligibleSessions);
      if (validatedChanges.length > 0) {
        const expiresAt = new Date(
          Date.now() + COACH_PROPOSAL_TTL_HOURS * 60 * 60 * 1000,
        ).toISOString();
        const [proposal] = await db
          .insert(coachAdjustmentProposals)
          .values({
            userId: params.userId,
            activeWeek: params.activeWeek,
            status: "pending",
            changes: validatedChanges,
            sourceUserMessage: params.sourceUserMessage,
            coachReply: summary,
            expiresAt,
          })
          .returning();
        proposalId = proposal?.id ?? null;
      }
    }
  } catch (err: any) {
    console.warn("[insights] failed to generate AI ride insight:", err?.message || err);
  }

  const [inserted] = await db
    .insert(rideInsights)
    .values({
      userId: params.userId,
      stravaActivityId: activity.stravaId,
      sessionId: matchedSession?.id || null,
      proposalId,
      headline,
      summary,
      metrics,
    })
    .returning();

  return inserted?.id || null;
}

function buildValidatedCoachProposalChanges(
  suggestedChanges: CoachModelSuggestedChange[],
  eligibleSessions: Session[],
): CoachAdjustmentChange[] {
  const byId = new Map(eligibleSessions.map((session) => [session.id, session]));
  const accepted: CoachAdjustmentChange[] = [];
  const seenIds = new Set<string>();

  for (const item of suggestedChanges) {
    if (accepted.length >= COACH_PROPOSAL_MAX_CHANGES) break;
    if (!item || typeof item.sessionId !== "string") continue;
    const sessionId = item.sessionId.trim();
    if (!sessionId || seenIds.has(sessionId)) continue;

    const session = byId.get(sessionId);
    if (!session) continue;

    const minutesRaw = item.minutes;
    const zoneRaw = item.zone;
    const reason = typeof item.reason === "string" ? item.reason.trim() : "";
    if (!reason) continue;

    const resolvedMinutes =
      minutesRaw === undefined || minutesRaw === null ? session.minutes : Math.round(Number(minutesRaw));
    if (!Number.isFinite(resolvedMinutes)) continue;
    if (resolvedMinutes < COACH_PROPOSAL_MIN_MINUTES || resolvedMinutes > COACH_PROPOSAL_MAX_MINUTES) continue;

    const resolvedZone =
      zoneRaw === undefined ? normalizeZoneValue(session.zone) : normalizeZoneValue(zoneRaw);
    if (!isValidCoachZone(resolvedZone)) continue;

    const beforeZone = normalizeZoneValue(session.zone);
    const changed = resolvedMinutes !== session.minutes || resolvedZone !== beforeZone;
    if (!changed) continue;

    accepted.push({
      sessionId: session.id,
      sessionLabel: getSessionLabel(session),
      before: {
        minutes: session.minutes,
        zone: beforeZone,
      },
      after: {
        minutes: resolvedMinutes,
        zone: resolvedZone,
      },
      reason: reason.slice(0, 280),
    });
    seenIds.add(sessionId);
  }

  return accepted;
}

async function expirePendingProposalIfNeeded(
  userId: string,
  proposal: CoachAdjustmentProposal,
): Promise<CoachAdjustmentProposal> {
  if (proposal.status !== "pending") return proposal;
  if (new Date(proposal.expiresAt).getTime() > Date.now()) return proposal;

  const [expired] = await db
    .update(coachAdjustmentProposals)
    .set({ status: "expired" })
    .where(
      and(
        eq(coachAdjustmentProposals.userId, userId),
        eq(coachAdjustmentProposals.id, proposal.id),
        eq(coachAdjustmentProposals.status, "pending"),
      ),
    )
    .returning();

  return expired ?? { ...proposal, status: "expired" };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use("/api", (req, res, next) => {
    const path = req.path || "";
    if (
      path === "/login" ||
      path === "/logout" ||
      path === "/callback" ||
      path === "/strava/callback" ||
      path.startsWith("/auth/") ||
      path === "/vapid-public-key"
    ) {
      return next();
    }
    return isAuthenticated(req, res, next);
  });

  app.get("/api/vapid-public-key", (_req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
  });

  app.get("/api/sessions", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const sessions = await storage.getSessions(userId);
      res.json(sessions);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch sessions" });
    }
  });

  app.patch("/api/sessions/:id", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const parsed = sessionUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const session = await storage.updateSession(userId, req.params.id, parsed.data);
      if (!session) return res.status(404).json({ error: "Session not found" });
      res.json(session);
    } catch (err) {
      res.status(500).json({ error: "Failed to update session" });
    }
  });

  app.get("/api/metrics", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const metrics = await storage.getMetrics(userId);
      res.json(metrics);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch metrics" });
    }
  });

  app.post("/api/metrics", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const parsed = insertMetricSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const metric = await storage.upsertMetric(userId, parsed.data);
      res.json(metric);
    } catch (err: any) {
      if (err?.message?.includes("Metric date")) {
        return res.status(400).json({ error: err.message });
      }
      res.status(500).json({ error: "Failed to upsert metric" });
    }
  });

  app.patch("/api/metrics/:id", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const parsed = metricUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const metric = await storage.updateMetric(userId, req.params.id, parsed.data);
      if (!metric) return res.status(404).json({ error: "Metric not found" });
      res.json(metric);
    } catch (err: any) {
      if (err?.message?.includes("Metric date")) {
        return res.status(400).json({ error: err.message });
      }
      if (err?.code === "23505") {
        return res.status(409).json({
          error: "A metric already exists for that date. Choose another date or edit that entry.",
        });
      }
      res.status(500).json({ error: "Failed to update metric" });
    }
  });

  app.delete("/api/metrics/:id", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const deleted = await storage.deleteMetric(userId, req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Metric not found" });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete metric" });
    }
  });

  app.get("/api/service-items", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const items = await storage.getServiceItems(userId);
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch service items" });
    }
  });

  app.post("/api/service-items", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const parsed = insertServiceItemSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const item = await storage.upsertServiceItem(userId, parsed.data);
      res.json(item);
    } catch (err) {
      res.status(500).json({ error: "Failed to create service item" });
    }
  });

  app.patch("/api/service-items/:id", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const parsed = serviceItemUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const item = await storage.updateServiceItem(userId, req.params.id, parsed.data);
      if (!item) return res.status(404).json({ error: "Item not found" });
      res.json(item);
    } catch (err) {
      res.status(500).json({ error: "Failed to update service item" });
    }
  });

  app.post("/api/service-items/auto-checks", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const [activities, bikeProfileRaw, stateRaw] = await Promise.all([
        storage.getStravaActivities(userId),
        storage.getSetting(userId, "bikeProfileV1"),
        storage.getSetting(userId, "bikeMaintenanceStateV1"),
      ]);

      const profile = parseBikeProfileSetting(bikeProfileRaw);
      const state = parseBikeMaintenanceState(stateRaw);

      const stravaRideKm = roundToOne(
        activities
          .filter(isRideActivity)
          .reduce((sum, activity) => sum + (activity.distance || 0), 0) / 1000,
      );

      const totalRideKm = roundToOne(stravaRideKm + profile.carryOverKm);
      const generatedItemIds: string[] = [];

      for (const rule of MAINTENANCE_RULES) {
        const completedIntervals = Math.floor(totalRideKm / rule.intervalKm);
        if (completedIntervals <= 0) continue;

        const dueKm = completedIntervals * rule.intervalKm;
        const alreadyGeneratedKm = Math.max(0, state.ruleProgressKm[rule.id] || 0);
        if (dueKm <= alreadyGeneratedKm) continue;

        const nextDueKm = dueKm + rule.intervalKm;
        const itemId = `svc-auto-${rule.id}-${dueKm}`;

        await storage.upsertServiceItem(userId, {
          id: itemId,
          item: `${rule.task} (${dueKm} km milestone)`,
          status: "Planned",
          date: null,
          dueDate: null,
          shop: null,
          cost: null,
          notes: `${rule.details} Auto-generated from tracked distance (${totalRideKm.toFixed(1)} km). Next reminder at ${nextDueKm} km.`,
        });

        state.ruleProgressKm[rule.id] = dueKm;
        generatedItemIds.push(itemId);
      }

      state.lastGeneratedAt = new Date().toISOString();
      await storage.setSetting(
        userId,
        "bikeMaintenanceStateV1",
        JSON.stringify(state),
      );

      res.json({
        ok: true,
        generatedCount: generatedItemIds.length,
        generatedItemIds,
        stravaRideKm,
        carryOverKm: profile.carryOverKm,
        totalRideKm,
        hasStravaData: activities.length > 0,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to generate auto maintenance checks" });
    }
  });

  app.get("/api/goal", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const goal = await storage.getGoal(userId);
      res.json(goal);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch goal" });
    }
  });

  app.post("/api/goal", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const parsed = insertGoalEventSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const goal = await storage.upsertGoal(userId, parsed.data);
      res.json(goal);
    } catch (err) {
      res.status(500).json({ error: "Failed to create goal" });
    }
  });

  app.put("/api/goal", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const parsed = insertGoalEventSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const goal = await storage.upsertGoal(userId, parsed.data);
      res.json(goal);
    } catch (err) {
      res.status(500).json({ error: "Failed to update goal" });
    }
  });

  app.post("/api/scrape-event", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { url } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "URL is required" });
      }

      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.statusText}`);
      }

      const html = await response.text();
      const cheerio = await import("cheerio");
      const $ = cheerio.load(html);

      const title = $('meta[property="og:title"]').attr('content') || $('title').text() || "";
      const description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || "";

      // Clean body text for heuristic extraction
      const bodyText = $('body').text().replace(/\s+/g, ' ');

      // Extract Distance (look for numbers followed by km, k, miles, mi)
      let distanceKm: number | null = null;
      const distMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*(?:km|k|kilometer|kilometers)/i);
      if (distMatch) {
        distanceKm = parseFloat(distMatch[1]);
      } else {
        const miMatch = bodyText.match(/(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)/i);
        if (miMatch) distanceKm = parseFloat(miMatch[1]) * 1.60934;
      }

      // Extract Elevation (look for numbers followed by m, meters, ft, feet, vertical)
      let elevationMeters: number | null = null;
      const elevMatchM = bodyText.match(/(\d{3,4}(?:,\d{3})?)\s*(?:m|meter|meters|\vm|\+m)\b/i);
      if (elevMatchM) {
        elevationMeters = parseInt(elevMatchM[1].replace(/,/g, ''), 10);
      } else {
        const elevMatchFt = bodyText.match(/(\d{3,4}(?:,\d{3})?)\s*(?:ft|feet|vertical feet)\b/i);
        if (elevMatchFt) elevationMeters = Math.round(parseInt(elevMatchFt[1].replace(/,/g, ''), 10) * 0.3048);
      }

      // Extract Date (Look for common formats like DD MMM YYYY or YYYY-MM-DD)
      let dateStr: string | null = null;
      const dateRegexes = [
        /\b(202[4-9])-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/, // YYYY-MM-DD
        /\b(0[1-9]|[12]\d|3[01])\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(202[4-9])\b/i // DD MMM YYYY
      ];

      for (const rx of dateRegexes) {
        const match = bodyText.match(rx);
        if (match) {
          if (match[2].length >= 3 && isNaN(parseInt(match[2], 10))) {
            // Month text match (DD MMM YYYY) -> convert to Date Object then to ISO String
            try {
              const d = new Date(`${match[1]} ${match[2]} ${match[3]}`);
              if (!isNaN(d.getTime())) dateStr = d.toISOString().split('T')[0];
            } catch { }
          } else {
            // Exact match format (YYYY-MM-DD)
            dateStr = match[0];
          }
          break;
        }
      }

      res.json({
        title: title.trim(),
        description: description.trim(),
        distanceKm: distanceKm ? Math.round(distanceKm) : null,
        elevationMeters: elevationMeters || null,
        date: dateStr || null
      });
    } catch (err: any) {
      console.error("Scrape error:", err.message);
      res.status(500).json({ error: "Failed to scrape event website" });
    }
  });

  app.get("/api/settings/:key", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const value = await storage.getSetting(userId, req.params.key);
      res.json({ value });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch setting" });
    }
  });

  app.put("/api/settings/:key", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const parsed = settingValueSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      await storage.setSetting(userId, req.params.key, parsed.data.value);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to save setting" });
    }
  });

  app.get("/api/push/status", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const subscriptions = await storage.listPushSubscriptions(userId);
      res.json({
        configured: isPushConfigured(),
        vapidPublicKey: getPublicVapidKey(),
        subscribed: subscriptions.length > 0,
        subscriptionCount: subscriptions.length,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch push status" });
    }
  });

  app.post("/api/push/subscribe", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const parsed = pushSubscriptionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

      await storage.upsertPushSubscription(userId, parsed.data.endpoint, parsed.data);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to save push subscription" });
    }
  });

  app.post("/api/push/unsubscribe", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : undefined;
      await storage.removePushSubscription(userId, endpoint);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to unsubscribe push" });
    }
  });

  app.get("/api/reminders/settings", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const settings = await storage.getReminderSettings(userId);
      res.json(
        settings ?? {
          timezone: "UTC",
          longRideEveningBeforeEnabled: false,
          serviceDueDateEnabled: false,
          goalOneWeekCountdownEnabled: false,
        },
      );
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch reminder settings" });
    }
  });

  app.post("/api/reminders/settings", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const parsed = reminderSettingsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const saved = await storage.upsertReminderSettings(userId, parsed.data);
      res.json(saved);
    } catch (err) {
      res.status(500).json({ error: "Failed to save reminder settings" });
    }
  });

  app.get("/api/notifications", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const notifications = await storage.listInAppNotifications(userId);
      res.json(notifications);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  app.post("/api/notifications/read", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const parsed = markNotificationReadSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

      if (parsed.data.all) {
        const notifications = await storage.listInAppNotifications(userId);
        await Promise.all(notifications.map((item) => storage.markInAppNotificationRead(userId, item.id)));
      } else if (parsed.data.id) {
        await storage.markInAppNotificationRead(userId, parsed.data.id);
      } else {
        return res.status(400).json({ error: "Notification id or all=true is required" });
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to mark notifications read" });
    }
  });

  app.post("/api/notifications/clear", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await storage.clearInAppNotifications(userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to clear notifications" });
    }
  });

  app.post("/api/seed", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await seedTrainingPlan(userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to seed data" });
    }
  });

  app.post("/api/plan/load-default", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const parsedBody = loadDefaultPlanSchema.safeParse(req.body ?? {});
      if (!parsedBody.success) return res.status(400).json({ error: parsedBody.error.message });

      const presetId = parsedBody.data.presetId ?? DEFAULT_TRAINING_PLAN_PRESET_ID;
      const selectedTemplate = getTrainingPlanTemplateById(presetId);
      if (!selectedTemplate) {
        return res.status(400).json({ error: `Unknown training plan preset: ${presetId}` });
      }

      await storage.deleteAllSessions(userId);
      const goal = await storage.getGoal(userId);
      const targetDate = goal?.startDate || getDefaultTargetDate(selectedTemplate.weeks);
      const raceDate = new Date(targetDate);
      const planStart = new Date(raceDate);
      planStart.setDate(planStart.getDate() - selectedTemplate.weeks * 7);

      const plan = buildTrainingPlanFromPreset(selectedTemplate.id, planStart);
      if (!plan) {
        return res.status(500).json({ error: "Failed to build selected training plan" });
      }

      await storage.upsertManySessions(userId, plan);
      res.json({ success: true, count: plan.length, presetId: selectedTemplate.id });
    } catch (err) {
      res.status(500).json({ error: "Failed to load default plan" });
    }
  });

  app.post("/api/plan/upload-csv", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { csv } = req.body;
      if (!csv || typeof csv !== "string") {
        return res.status(400).json({ error: "CSV data required" });
      }
      const sessions = parseCsvPlan(csv);
      if (sessions.length === 0) {
        return res.status(400).json({ error: "No valid sessions found in CSV" });
      }
      await storage.deleteAllSessions(userId);
      await storage.upsertManySessions(userId, sessions);
      res.json({ success: true, count: sessions.length });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to parse CSV" });
    }
  });

  app.get("/api/strava/status", async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const lastSyncAt = await storage.getSetting(userId, "stravaLastSync");
    const hasScope = await storage.getSetting(userId, "stravaHasActivityScope");
    const refreshToken = await storage.getSetting(userId, "stravaRefreshToken");
    const lastErrorRaw = await storage.getSetting(userId, "stravaLastError");
    const connected = !!refreshToken;
    const lastError = lastErrorRaw?.trim() ? sanitizeStravaErrorMessage(lastErrorRaw) : null;

    res.json({
      configured: isStravaConfigured(),
      connected,
      lastSyncAt: lastSyncAt || null,
      lastError,
      // Backwards-compatible fields currently used by frontend components.
      isConnected: connected,
      lastSync: lastSyncAt || null,
      hasActivityScope: hasScope === "true",
    });
  });

  app.get("/api/strava/auth-url", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const forwardedProtoRaw = req.headers["x-forwarded-proto"];
      const forwardedHostRaw = req.headers["x-forwarded-host"];
      const forwardedProto = Array.isArray(forwardedProtoRaw)
        ? forwardedProtoRaw[0]
        : forwardedProtoRaw?.split(",")[0]?.trim();
      const forwardedHost = Array.isArray(forwardedHostRaw)
        ? forwardedHostRaw[0]
        : forwardedHostRaw?.split(",")[0]?.trim();

      let protocol = forwardedProto || (req.secure ? "https" : "http");
      const host = forwardedHost || req.get("host") || "localhost:5000";

      // In production behind a proxy/custom domain, non-local hosts should be HTTPS.
      const isLocalHost = /^localhost(?::\d+)?$/i.test(host) || /^127\.0\.0\.1(?::\d+)?$/i.test(host);
      if (process.env.NODE_ENV === "production" && !isLocalHost) {
        protocol = "https";
      }

      const redirectUri = `${protocol}://${host}/api/strava/callback`;
      console.log(`[strava] auth-url protocol=${protocol} host=${host} redirectUri=${redirectUri}`);
      const state = createStravaOAuthState(userId);
      const url = getStravaAuthUrl(redirectUri, state);
      res.json({ url });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/strava/callback", async (req, res) => {
    const state = req.query.state as string;
    const code = req.query.code as string;
    const error = req.query.error as string;

    if (error) {
      return res.redirect("/?strava=denied");
    }

    if (!code || !state) {
      return res.status(400).send("Missing authorization code");
    }

    try {
      const userId = parseStravaOAuthState(state);
      const tokenData = await exchangeCodeForToken(code);
      await storage.setSetting(userId, "stravaRefreshToken", tokenData.refresh_token);
      await storage.setSetting(userId, "stravaHasActivityScope", "true");
      res.redirect("/?strava=connected");
    } catch (err: any) {
      console.error("Strava callback error:", err.message);
      res.redirect("/?strava=error");
    }
  });

  app.get("/api/strava/activities", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const activities = await storage.getStravaActivities(userId);
      res.json(activities);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch activities" });
    }
  });

  app.post("/api/strava/sync", async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) return;
    if (!isStravaConfigured()) {
      const message = "Missing STRAVA_CLIENT_ID and/or STRAVA_CLIENT_SECRET on server.";
      await setStravaLastError(userId, message);
      return res.status(500).json({ error: message });
    }
    const savedRefresh = await storage.getSetting(userId, "stravaRefreshToken");
    if (!savedRefresh) {
      const message = "No Strava refresh token for this user. Reconnect your Strava account.";
      await setStravaLastError(userId, message);
      return res.status(400).json({ error: message });
    }
    try {
      const [sessions, savedActiveWeek] = await Promise.all([
        storage.getSessions(userId),
        storage.getSetting(userId, "activeWeek"),
      ]);
      const activeWeek = resolveCurrentWeek(savedActiveWeek, sessions);

      const result = await syncStravaActivities(userId, savedRefresh, {
        activeWeek,
        adaptiveMatchV1: STRAVA_ADAPTIVE_MATCH_V1,
      });
      await storage.setSetting(userId, "stravaLastSync", new Date().toISOString());
      await setStravaLastError(userId, null);

      const [sessionsAfterSync, activitiesAfterSync] = await Promise.all([
        storage.getSessions(userId),
        storage.getStravaActivities(userId),
      ]);

      const alignmentSuggestion = PLAN_DATE_REALIGN_PROMPT
        ? detectPlanDateAlignmentSuggestion({
            sessions: sessionsAfterSync,
            activities: activitiesAfterSync,
            activeWeek,
          })
        : null;

      const latestInsightId = DASHBOARD_RIDE_INSIGHTS
        ? await createLatestRideInsightAfterSync({
            userId,
            activeWeek,
            latestSyncedActivityId: result.latestSyncedActivityId,
            matches: result.matches,
            sessions: sessionsAfterSync,
            activities: activitiesAfterSync,
            sourceUserMessage: "Automatic insight after Strava sync",
          })
        : null;

      console.log(
        `[strava-match] user=${userId} matched=${result.matchedCount} unmatched=${result.unmatchedCount} autoCompleted=${result.autoCompleted}`,
      );
      if (alignmentSuggestion) {
        console.log(
          `[plan-realign] suggestion user=${userId} from=${alignmentSuggestion.fromDate} to=${alignmentSuggestion.toDate} deltaDays=${alignmentSuggestion.deltaDays}`,
        );
      }

      res.json({
        synced: result.synced,
        total: result.total,
        autoCompleted: result.autoCompleted,
        matchedCount: result.matchedCount,
        unmatchedCount: result.unmatchedCount,
        matches: result.matches,
        alignmentSuggestion,
        latestInsightId,
      });
    } catch (err: any) {
      const rawMessage = err?.message || "Strava sync failed";
      const sanitizedRaw = sanitizeStravaErrorMessage(rawMessage);

      let clientMessage = sanitizedRaw;
      let status = 500;
      if (/Strava API error:\s*429\b/i.test(sanitizedRaw) || /rate limit/i.test(sanitizedRaw)) {
        status = 429;
        clientMessage = "Strava API rate limit reached. Please wait a few minutes and sync again.";
      } else if (sanitizedRaw.includes("Strava API error:")) {
        status = 502;
        clientMessage = `Strava API error while fetching activities. ${sanitizedRaw}`;
      } else if (sanitizedRaw.includes("Strava token refresh failed:")) {
        status = 502;
        clientMessage = "Strava token refresh failed. Reconnect your Strava account and try again.";
      } else if (sanitizedRaw.includes("Strava credentials not configured")) {
        status = 500;
        clientMessage = "Missing STRAVA_CLIENT_ID and/or STRAVA_CLIENT_SECRET on server.";
      }

      await setStravaLastError(userId, clientMessage);
      console.error("Strava sync error:", sanitizedRaw);
      res.status(status).json({ error: clientMessage });
    }
  });

  const aiPlanSchema = z.object({
    eventName: z.string().min(1),
    eventDate: z.string().min(1),
    eventDistance: z.number().positive().optional(),
    eventElevation: z.number().positive().optional(),
    age: z.number().int().min(13).max(100).optional(),
    fitnessLevel: z.enum(["beginner", "intermediate", "advanced"]),
    goals: z.array(z.string()).min(1),
    currentWeight: z.number().positive().optional(),
    targetWeight: z.number().positive().optional(),
    daysPerWeek: z.number().int().min(2).max(7).default(4),
    hoursPerWeek: z.number().min(2).max(30).default(8),
    equipment: z.enum(["gym", "home_full", "home_minimal", "no_equipment"]).default("home_minimal"),
    injuries: z.string().optional(),
    additionalNotes: z.string().optional(),
  });

  app.post("/api/plan/generate-ai", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const subscriptionTier = normalizeSubscriptionTier(
        await storage.getSetting(userId, "subscriptionTier"),
      );
      if (subscriptionTier !== "pro") {
        return res.status(403).json({
          error: "AI plan generation is available on Pro. Upgrade to unlock it.",
          code: "PRO_REQUIRED",
          feature: "ai_plan_generation",
        });
      }
      const parsed = aiPlanSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Event name, date, fitness level, and at least one goal are required" });
      }
      const [activities, profile] = await Promise.all([
        storage.getStravaActivities(userId),
        authStorage.getUser(userId),
      ]);
      const resolvedAge = parsed.data.age ?? profile?.age ?? null;
      if (!resolvedAge) {
        return res.status(400).json({ error: "Age is required for plan generation. Add age in profile or plan form." });
      }
      const rideAnalysis = analyzeRideHistoryForPlan(activities);

      console.log(
        `[ai-plan] ridesUsed=${rideAnalysis.ridesUsedCount} range=${rideAnalysis.rangeStartDate}..${rideAnalysis.rangeEndDate} window=${rideAnalysis.windowDaysUsed}d state=${rideAnalysis.trainingState}`,
      );

      if (rideAnalysis.excludedOlderThanYearCount > 0) {
        console.log(
          `[ai-plan] excluded ${rideAnalysis.excludedOlderThanYearCount} rides older than 1 year from baseline calculations`,
        );
      }

      const gapDays = rideAnalysis.gapSinceLastRideDays;
      const shouldApplyRampPhase = gapDays !== null && gapDays > 60;
      const adjustedFitnessLevel = getAdjustedFitnessLevelForTrainingState(
        parsed.data.fitnessLevel,
        rideAnalysis.trainingState,
      );

      const analysisNotes = [
        `Strava baseline uses only recent rides and excludes rides older than 1 year.`,
        `Rides used for analysis: ${rideAnalysis.ridesUsedCount} in last ${rideAnalysis.windowDaysUsed} days (${rideAnalysis.rangeStartDate} to ${rideAnalysis.rangeEndDate}).`,
        `Detected training state: ${rideAnalysis.trainingState}.`,
        `Average ride duration: ${rideAnalysis.averageRideDurationMinutes} minutes.`,
        `Average weekly frequency: ${rideAnalysis.averageWeeklyFrequency} rides/week.`,
        rideAnalysis.recentLongestRideKm !== null
          ? `Recent longest ride: ${rideAnalysis.recentLongestRideKm} km on ${rideAnalysis.recentLongestRideDate}.`
          : "No recent longest ride available from recent activity.",
        gapDays !== null
          ? `Gap since last ride: ${gapDays} days.`
          : "No rides in the last year.",
      ];

      if (shouldApplyRampPhase) {
        analysisNotes.push(
          `Training gap is > 60 days. Automatically reduce initial intensity and include a 2-3 week return-to-riding ramp phase before harder sessions.`,
        );
      }

      if (rideAnalysis.trainingState === "Beginner") {
        analysisNotes.push(
          `No rides found in the last 180 days. Treat athlete as deconditioned/beginner and prioritize safe progression.`,
        );
      }

      const planReq: PlanRequest = {
        ...parsed.data,
        age: resolvedAge,
        fitnessLevel: adjustedFitnessLevel,
        additionalNotes: [parsed.data.additionalNotes, analysisNotes.join(" ")].filter(Boolean).join("\n"),
      };

      const sessions = await generateAIPlan(planReq);
      await authStorage.updateUserProfile(userId, { age: resolvedAge });

      await storage.deleteAllSessions(userId);
      await storage.upsertManySessions(userId, sessions);

      res.json({ success: true, count: sessions.length });
    } catch (err: any) {
      console.error("AI plan generation error:", err.message);
      res.status(500).json({ error: err.message || "Failed to generate AI plan" });
    }
  });

  app.get("/api/coach/context", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const [sessions, metrics, activities, savedActiveWeek, refreshToken, stravaLastSyncAt] =
        await Promise.all([
          storage.getSessions(userId),
          storage.getMetrics(userId),
          storage.getStravaActivities(userId),
          storage.getSetting(userId, "activeWeek"),
          storage.getSetting(userId, "stravaRefreshToken"),
          storage.getSetting(userId, "stravaLastSync"),
        ]);

      const activeWeek = resolveCurrentWeek(savedActiveWeek, sessions);
      const lastRide = [...activities]
        .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];

      res.json({
        activeWeek,
        weekSessionCount: sessions.filter((session) => session.week === activeWeek).length,
        hasStravaConnection: Boolean(refreshToken),
        stravaSyncedRideCount: activities.length,
        stravaRecentRideCount14: countRecentStravaRides(activities, 14),
        stravaLastRideDate: lastRide ? formatDate(lastRide.startDate) : null,
        stravaLastSyncAt: stravaLastSyncAt || null,
        metricsTotalCount: metrics.length,
        metricsRecentCount7: countRecentMetrics(metrics, 7),
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch coach context" });
    }
  });

  app.get("/api/insights/latest-ride", async (req, res) => {
    try {
      if (!DASHBOARD_RIDE_INSIGHTS) {
        return res.json(null);
      }
      const userId = requireUserId(req, res);
      if (!userId) return;

      const [latestInsight] = await db
        .select()
        .from(rideInsights)
        .where(eq(rideInsights.userId, userId))
        .orderBy(desc(rideInsights.createdAt))
        .limit(1);

      if (!latestInsight) {
        return res.json(null);
      }

      const [activity, matchedSession, linkedProposal] = await Promise.all([
        storage.getStravaActivities(userId).then((activities) =>
          activities.find((item) => item.stravaId === latestInsight.stravaActivityId) || null,
        ),
        latestInsight.sessionId
          ? storage.getSession(userId, latestInsight.sessionId)
          : Promise.resolve(null),
        latestInsight.proposalId
          ? db
              .select()
              .from(coachAdjustmentProposals)
              .where(
                and(
                  eq(coachAdjustmentProposals.userId, userId),
                  eq(coachAdjustmentProposals.id, latestInsight.proposalId),
                ),
              )
              .limit(1)
              .then((rows) => rows[0] || null)
          : Promise.resolve(null),
      ]);

      if (!activity) {
        return res.json(null);
      }

      const payload: LatestRideInsightResponse = {
        insightId: latestInsight.id,
        activity: {
          id: activity.stravaId,
          name: activity.name,
          startDate: activity.startDate,
        },
        matchedSession: matchedSession
          ? {
              id: matchedSession.id,
              label: getSessionLabel(matchedSession),
              completed: matchedSession.completed,
            }
          : null,
        summary: {
          headline: latestInsight.headline,
          text: latestInsight.summary,
        },
        metrics: normalizeInsightMetrics(latestInsight.metrics),
        proposal: linkedProposal
          ? {
              id: linkedProposal.id,
              status: linkedProposal.status,
              activeWeek: linkedProposal.activeWeek,
              changes: Array.isArray(linkedProposal.changes)
                ? (linkedProposal.changes as CoachProposalApiItem[])
                : [],
            }
          : null,
      };

      res.json(payload);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load latest ride insight" });
    }
  });

  app.post("/api/plan/realign-current-week", async (req, res) => {
    try {
      if (!PLAN_DATE_REALIGN_PROMPT) {
        return res.status(404).json({ error: "Plan date realign is disabled" });
      }
      const userId = requireUserId(req, res);
      if (!userId) return;

      const [sessions, savedActiveWeek, activities] = await Promise.all([
        storage.getSessions(userId),
        storage.getSetting(userId, "activeWeek"),
        storage.getStravaActivities(userId),
      ]);

      const activeWeek = resolveCurrentWeek(savedActiveWeek, sessions);
      const suggestion = detectPlanDateAlignmentSuggestion({
        sessions,
        activities,
        activeWeek,
      });
      if (!suggestion) {
        return res.status(400).json({ error: "No date realignment needed right now" });
      }

      const pendingTargetSessions = sessions.filter(
        (session) =>
          session.week >= activeWeek &&
          !session.completed &&
          !!session.scheduledDate,
      );

      const updatedRows: Session[] = [];
      let realignEventId = "";
      await db.transaction(async (tx) => {
        for (const session of pendingTargetSessions) {
          const shiftedDate = shiftIsoDateByDays(session.scheduledDate!, suggestion.deltaDays);
          if (!shiftedDate) continue;

          const [updated] = await tx
            .update(sessionsTable)
            .set({ scheduledDate: shiftedDate })
            .where(
              and(
                eq(sessionsTable.userId, userId),
                eq(sessionsTable.id, session.id),
              ),
            )
            .returning();
          if (updated) {
            updatedRows.push(updated);
          }
        }

        const [eventRow] = await tx
          .insert(planRealignEvents)
          .values({
            userId,
            fromDate: suggestion.fromDate,
            toDate: suggestion.toDate,
            deltaDays: suggestion.deltaDays,
            affectedCount: updatedRows.length,
          })
          .returning();
        realignEventId = eventRow?.id || "";
      });

      res.json({
        eventId: realignEventId,
        deltaDays: suggestion.deltaDays,
        affectedCount: updatedRows.length,
        fromDate: suggestion.fromDate,
        toDate: suggestion.toDate,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to realign plan dates" });
    }
  });

  app.get("/api/coach/proposals/:id", async (req, res) => {
    try {
      if (!COACH_ADJUSTMENTS_SAFE_MODE) {
        return res.status(404).json({ error: "Coach proposals are disabled" });
      }
      const userId = requireUserId(req, res);
      if (!userId) return;

      const [proposal] = await db
        .select()
        .from(coachAdjustmentProposals)
        .where(
          and(
            eq(coachAdjustmentProposals.userId, userId),
            eq(coachAdjustmentProposals.id, req.params.id),
          ),
        )
        .limit(1);

      if (!proposal) {
        return res.status(404).json({ error: "Proposal not found" });
      }

      const normalized = await expirePendingProposalIfNeeded(userId, proposal);
      res.json(toCoachProposalApiResponse(normalized));
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch coach proposal" });
    }
  });

  app.post("/api/coach/proposals/:id/cancel", async (req, res) => {
    try {
      if (!COACH_ADJUSTMENTS_SAFE_MODE) {
        return res.status(404).json({ error: "Coach proposals are disabled" });
      }
      const userId = requireUserId(req, res);
      if (!userId) return;

      const [proposal] = await db
        .select()
        .from(coachAdjustmentProposals)
        .where(
          and(
            eq(coachAdjustmentProposals.userId, userId),
            eq(coachAdjustmentProposals.id, req.params.id),
          ),
        )
        .limit(1);

      if (!proposal) {
        return res.status(404).json({ error: "Proposal not found" });
      }

      const normalized = await expirePendingProposalIfNeeded(userId, proposal);
      if (normalized.status !== "pending") {
        return res.status(409).json({
          error: `Proposal is already ${normalized.status}`,
          proposal: toCoachProposalApiResponse(normalized),
        });
      }

      const [cancelled] = await db
        .update(coachAdjustmentProposals)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(coachAdjustmentProposals.userId, userId),
            eq(coachAdjustmentProposals.id, normalized.id),
            eq(coachAdjustmentProposals.status, "pending"),
          ),
        )
        .returning();

      if (!cancelled) {
        return res.status(409).json({ error: "Proposal status changed. Please refresh and retry." });
      }

      res.json({ proposal: toCoachProposalApiResponse(cancelled) });
    } catch (err) {
      res.status(500).json({ error: "Failed to cancel coach proposal" });
    }
  });

  app.post("/api/coach/proposals/:id/apply", async (req, res) => {
    try {
      if (!COACH_ADJUSTMENTS_SAFE_MODE) {
        return res.status(404).json({ error: "Coach proposals are disabled" });
      }
      const userId = requireUserId(req, res);
      if (!userId) return;

      const [proposal] = await db
        .select()
        .from(coachAdjustmentProposals)
        .where(
          and(
            eq(coachAdjustmentProposals.userId, userId),
            eq(coachAdjustmentProposals.id, req.params.id),
          ),
        )
        .limit(1);

      if (!proposal) {
        return res.status(404).json({ error: "Proposal not found" });
      }

      const normalized = await expirePendingProposalIfNeeded(userId, proposal);
      if (normalized.status !== "pending") {
        return res.status(409).json({
          error: `Proposal is already ${normalized.status}`,
          proposal: toCoachProposalApiResponse(normalized),
        });
      }

      const proposalChanges = Array.isArray(normalized.changes)
        ? (normalized.changes as CoachProposalApiItem[])
        : [];
      if (proposalChanges.length === 0) {
        return res.status(400).json({ error: "Proposal has no changes to apply" });
      }

      const sessionIds = Array.from(new Set(proposalChanges.map((item) => item.sessionId)));
      const targetedSessions = sessionIds.length
        ? await db
            .select()
            .from(sessionsTable)
            .where(
              and(
                eq(sessionsTable.userId, userId),
                inArray(sessionsTable.id, sessionIds),
              ),
            )
        : [];
      const sessionsById = new Map(targetedSessions.map((session) => [session.id, session]));
      const nowIso = new Date().toISOString();
      const todayIso = nowIso.slice(0, 10);
      const todayOrder = getTodayOrder();

      const result = await db.transaction(async (tx) => {
        const [event] = await tx
          .insert(coachAdjustmentEvents)
          .values({
            userId,
            proposalId: normalized.id,
            activeWeek: normalized.activeWeek,
            appliedCount: 0,
            skippedCount: 0,
          })
          .returning();

        const eventItems: Array<typeof coachAdjustmentEventItems.$inferInsert> = [];
        let appliedCount = 0;
        let skippedCount = 0;
        const responseItems: Array<{ sessionId: string; status: "applied" | "skipped"; skipReason?: string }> = [];

        for (const change of proposalChanges) {
          const session = sessionsById.get(change.sessionId);
          if (!session) {
            skippedCount += 1;
            responseItems.push({
              sessionId: change.sessionId,
              status: "skipped",
              skipReason: "Session no longer exists",
            });
            eventItems.push({
              userId,
              eventId: event.id,
              sessionId: change.sessionId,
              status: "skipped",
              skipReason: "Session no longer exists",
              beforeMinutes: change.before?.minutes ?? null,
              afterMinutes: change.after?.minutes ?? null,
              beforeZone: normalizeZoneValue(change.before?.zone ?? null),
              afterZone: normalizeZoneValue(change.after?.zone ?? null),
              reason: change.reason || "No reason provided",
            });
            continue;
          }

          if (!isFutureSessionForCoach(session, normalized.activeWeek, todayIso, todayOrder)) {
            const skipReason = session.completed
              ? "Session already completed"
              : session.week !== normalized.activeWeek
                ? "Session is not in the active week"
                : "Session is no longer in the future";
            skippedCount += 1;
            responseItems.push({ sessionId: session.id, status: "skipped", skipReason });
            eventItems.push({
              userId,
              eventId: event.id,
              sessionId: session.id,
              status: "skipped",
              skipReason,
              beforeMinutes: session.minutes,
              afterMinutes: change.after?.minutes ?? null,
              beforeZone: normalizeZoneValue(session.zone),
              afterZone: normalizeZoneValue(change.after?.zone ?? null),
              reason: change.reason || "No reason provided",
            });
            continue;
          }

          const targetMinutes = Number(change.after?.minutes);
          const targetZone = normalizeZoneValue(change.after?.zone ?? null);
          if (
            !Number.isFinite(targetMinutes) ||
            targetMinutes < COACH_PROPOSAL_MIN_MINUTES ||
            targetMinutes > COACH_PROPOSAL_MAX_MINUTES ||
            !isValidCoachZone(targetZone)
          ) {
            skippedCount += 1;
            responseItems.push({
              sessionId: session.id,
              status: "skipped",
              skipReason: "Invalid proposal values",
            });
            eventItems.push({
              userId,
              eventId: event.id,
              sessionId: session.id,
              status: "skipped",
              skipReason: "Invalid proposal values",
              beforeMinutes: session.minutes,
              afterMinutes: Number.isFinite(targetMinutes) ? Math.round(targetMinutes) : null,
              beforeZone: normalizeZoneValue(session.zone),
              afterZone: targetZone,
              reason: change.reason || "No reason provided",
            });
            continue;
          }

          const roundedMinutes = Math.round(targetMinutes);
          const currentZone = normalizeZoneValue(session.zone);
          if (roundedMinutes === session.minutes && targetZone === currentZone) {
            skippedCount += 1;
            responseItems.push({
              sessionId: session.id,
              status: "skipped",
              skipReason: "No effective change",
            });
            eventItems.push({
              userId,
              eventId: event.id,
              sessionId: session.id,
              status: "skipped",
              skipReason: "No effective change",
              beforeMinutes: session.minutes,
              afterMinutes: roundedMinutes,
              beforeZone: currentZone,
              afterZone: targetZone,
              reason: change.reason || "No reason provided",
            });
            continue;
          }

          await tx
            .update(sessionsTable)
            .set({
              minutes: roundedMinutes,
              zone: targetZone,
              adjustedByCoach: true,
              adjustedByCoachAt: nowIso,
              lastCoachAdjustmentEventId: event.id,
            })
            .where(
              and(
                eq(sessionsTable.userId, userId),
                eq(sessionsTable.id, session.id),
              ),
            );

          appliedCount += 1;
          responseItems.push({ sessionId: session.id, status: "applied" });
          eventItems.push({
            userId,
            eventId: event.id,
            sessionId: session.id,
            status: "applied",
            skipReason: null,
            beforeMinutes: session.minutes,
            afterMinutes: roundedMinutes,
            beforeZone: currentZone,
            afterZone: targetZone,
            reason: change.reason || "No reason provided",
          });
        }

        if (eventItems.length > 0) {
          await tx.insert(coachAdjustmentEventItems).values(eventItems);
        }

        await tx
          .update(coachAdjustmentEvents)
          .set({ appliedCount, skippedCount })
          .where(
            and(
              eq(coachAdjustmentEvents.userId, userId),
              eq(coachAdjustmentEvents.id, event.id),
            ),
          );

        await tx
          .update(coachAdjustmentProposals)
          .set({ status: "applied" })
          .where(
            and(
              eq(coachAdjustmentProposals.userId, userId),
              eq(coachAdjustmentProposals.id, normalized.id),
              eq(coachAdjustmentProposals.status, "pending"),
            ),
          );

        return { eventId: event.id, appliedCount, skippedCount, items: responseItems };
      });

      console.log(
        `[coach-adjust] apply proposal=${normalized.id} user=${userId} applied=${result.appliedCount} skipped=${result.skippedCount}`,
      );

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to apply coach proposal" });
    }
  });

  app.get("/api/coach/status", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const monthKey = getCurrentMonthKey();
      const usageKey = getCoachUsageSettingKey(monthKey);
      const [subscriptionTierRaw, usageRaw] = await Promise.all([
        storage.getSetting(userId, "subscriptionTier"),
        storage.getSetting(userId, usageKey),
      ]);

      const subscriptionTier = normalizeSubscriptionTier(subscriptionTierRaw);
      const usedThisMonth = Math.max(0, Number.parseInt(usageRaw || "0", 10) || 0);
      const monthlyLimit = subscriptionTier === "pro" ? null : FREE_COACH_MONTHLY_LIMIT;
      const remainingThisMonth =
        subscriptionTier === "pro"
          ? null
          : Math.max(0, FREE_COACH_MONTHLY_LIMIT - usedThisMonth);

      res.json({
        tier: subscriptionTier,
        canUse: subscriptionTier === "pro" || usedThisMonth < FREE_COACH_MONTHLY_LIMIT,
        monthlyLimit,
        usedThisMonth,
        remainingThisMonth,
        period: monthKey,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch coach status" });
    }
  });

  app.post("/api/coach/chat", async (req, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const parsed = coachChatSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "message is required" });
      }

      const monthKey = getCurrentMonthKey();
      const usageKey = getCoachUsageSettingKey(monthKey);
      const [
        sessions,
        metrics,
        savedActiveWeek,
        refreshToken,
        stravaLastSyncAt,
        subscriptionTierRaw,
        usageRaw,
      ] = await Promise.all([
        storage.getSessions(userId),
        storage.getMetrics(userId),
        storage.getSetting(userId, "activeWeek"),
        storage.getSetting(userId, "stravaRefreshToken"),
        storage.getSetting(userId, "stravaLastSync"),
        storage.getSetting(userId, "subscriptionTier"),
        storage.getSetting(userId, usageKey),
      ]);

      const activeWeek = resolveCurrentWeek(savedActiveWeek, sessions);
      let activities = await storage.getStravaActivities(userId);

      if (refreshToken && shouldSyncStravaForCoach(stravaLastSyncAt, activities.length)) {
        try {
          await syncStravaActivities(userId, refreshToken, {
            activeWeek,
            adaptiveMatchV1: STRAVA_ADAPTIVE_MATCH_V1,
          });
          await storage.setSetting(userId, "stravaLastSync", new Date().toISOString());
          await setStravaLastError(userId, null);
          activities = await storage.getStravaActivities(userId);
        } catch (err: any) {
          const syncError = sanitizeStravaErrorMessage(err?.message || "Coach Strava sync failed");
          await setStravaLastError(userId, syncError);
          console.warn("[coach] Strava refresh skipped due to sync error:", syncError);
        }
      }

      const subscriptionTier = normalizeSubscriptionTier(subscriptionTierRaw);
      const usedThisMonth = Math.max(0, Number.parseInt(usageRaw || "0", 10) || 0);
      if (subscriptionTier !== "pro" && usedThisMonth >= FREE_COACH_MONTHLY_LIMIT) {
        return res.status(403).json({
          error: `AI Coach is available on Pro. Free includes ${FREE_COACH_MONTHLY_LIMIT} coach replies per month.`,
          code: "PRO_REQUIRED",
          feature: "coach_chat",
          monthlyLimit: FREE_COACH_MONTHLY_LIMIT,
          usedThisMonth,
          remainingThisMonth: 0,
          period: monthKey,
        });
      }

      const context = buildCoachContext({
        sessions,
        metrics,
        activities,
        activeWeek,
        stravaConnected: Boolean(refreshToken),
        stravaLastSyncAt,
      });

      const prompt = buildCoachPrompt({
        message: parsed.data.message,
        history: parsed.data.history,
        context,
        coachAdjustmentsEnabled: COACH_ADJUSTMENTS_SAFE_MODE,
      });

      const coachModelResult = await generateCoachReplyWithGuardrails({
        prompt,
        message: parsed.data.message,
        sessions,
        activities,
        metrics,
        activeWeek,
      });
      const parsedPayload = coachModelResult.payload;
      const reply = coachModelResult.reply;
      if (!reply) {
        return res.status(502).json({ error: "Coach response was empty. Please retry." });
      }

      let proposal: CoachProposalApiResponse | null = null;
      if (COACH_ADJUSTMENTS_SAFE_MODE && Array.isArray(parsedPayload?.changes) && parsedPayload!.changes.length > 0) {
        const todayIso = new Date().toISOString().slice(0, 10);
        const todayOrder = getTodayOrder();
        const eligibleSessions = sessions.filter((session) =>
          isFutureSessionForCoach(session, activeWeek, todayIso, todayOrder),
        );
        const validatedChanges = buildValidatedCoachProposalChanges(parsedPayload!.changes, eligibleSessions);

        if (validatedChanges.length > 0) {
          const expiresAt = new Date(
            Date.now() + COACH_PROPOSAL_TTL_HOURS * 60 * 60 * 1000,
          ).toISOString();

          const [createdProposal] = await db
            .insert(coachAdjustmentProposals)
            .values({
              userId,
              activeWeek,
              status: "pending",
              changes: validatedChanges,
              sourceUserMessage: parsed.data.message,
              coachReply: reply,
              expiresAt,
            })
            .returning();

          proposal = toCoachProposalApiResponse(createdProposal);
          console.log(
            `[coach-adjust] proposal created id=${createdProposal.id} user=${userId} changes=${validatedChanges.length}`,
          );
        } else {
          console.warn("[coach-adjust] structured changes returned but none passed validation");
        }
      }

      let nextUsedThisMonth = usedThisMonth;
      if (subscriptionTier !== "pro") {
        nextUsedThisMonth = usedThisMonth + 1;
        await storage.setSetting(userId, usageKey, String(nextUsedThisMonth));
      }

      res.json({
        reply,
        proposal,
        context: {
          activeWeek,
          planSessionCount: sessions.filter((session) => session.week === activeWeek).length,
          hasStravaConnection: Boolean(refreshToken),
          stravaSyncedRideCount: activities.length,
          stravaRecentRideCount: countRecentStravaRides(activities, 14),
          stravaLastSyncAt,
          metricsRecentCount: countRecentMetrics(metrics, 7),
          tier: subscriptionTier,
          coachRemainingThisMonth:
            subscriptionTier === "pro"
              ? null
              : Math.max(0, FREE_COACH_MONTHLY_LIMIT - nextUsedThisMonth),
          coachAdjustmentsEnabled: COACH_ADJUSTMENTS_SAFE_MODE,
        },
      });
    } catch (err: any) {
      console.error("Coach chat error:", err?.message || err);
      res.status(500).json({ error: err?.message || "Failed to generate coach response" });
    }
  });

  app.get("/api/plan/templates", async (_req, res) => {
    res.json(getTrainingPlanTemplates());
  });

  return httpServer;
}

function parseCsvRecords(csv: string): string[][] {
  const normalized = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const records: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        current.push(field);
        field = "";
      } else if (char === "\n") {
        current.push(field);
        field = "";
        if (current.some((c) => c.trim())) {
          records.push(current);
        }
        current = [];
      } else {
        field += char;
      }
    }
  }

  current.push(field);
  if (current.some((c) => c.trim())) {
    records.push(current);
  }

  return records;
}

function parseCsvPlan(csv: string) {
  const records = parseCsvRecords(csv);
  if (records.length < 2) throw new Error("CSV must have a header row and at least one data row");

  const header = records[0].map((h) => h.trim().toLowerCase());

  const weekIdx = header.indexOf("week");
  const dayIdx = header.indexOf("day");
  const typeIdx = header.indexOf("type");
  const descIdx = header.findIndex((h) => h === "description" || h === "desc");
  const minsIdx = header.findIndex((h) => h === "minutes" || h === "mins" || h === "duration");
  const zoneIdx = header.indexOf("zone");
  const elevIdx = header.findIndex((h) => h === "elevation" || h === "elev");
  const detailsIdx = header.findIndex((h) => h === "details" || h === "detailsmarkdown" || h === "details_markdown");

  if (weekIdx === -1 || dayIdx === -1 || typeIdx === -1 || descIdx === -1 || minsIdx === -1) {
    throw new Error("CSV must have columns: week, day, type, description, minutes");
  }

  const sessions: any[] = [];

  for (let i = 1; i < records.length; i++) {
    const cols = records[i];
    const week = parseInt(cols[weekIdx]?.trim(), 10);
    const day = cols[dayIdx]?.trim();
    const type = cols[typeIdx]?.trim();
    const description = cols[descIdx]?.trim();
    const minutes = parseInt(cols[minsIdx]?.trim(), 10);

    if (!week || !day || !type || !description || !minutes) continue;

    const zone = zoneIdx >= 0 ? cols[zoneIdx]?.trim() || null : null;
    const elevation = elevIdx >= 0 ? cols[elevIdx]?.trim() || null : null;
    const details = detailsIdx >= 0 ? cols[detailsIdx]?.trim() || null : null;

    const isStrength = type.toLowerCase().includes("strength");

    sessions.push({
      id: `csv-w${week}-${day.toLowerCase()}-${i}`,
      week,
      day,
      type,
      description,
      minutes,
      zone,
      elevation,
      strength: isStrength,
      completed: false,
      rpe: null,
      notes: null,
      scheduledDate: null,
      completedAt: null,
      detailsMarkdown: details || getWorkoutDetails(type, description, week),
    });
  }

  return sessions;
}

async function seedTrainingPlan(userId: string) {
  const existingSessions = await storage.getSessions(userId);
  if (existingSessions.length > 0) return;

  const defaultTemplate = getTrainingPlanTemplateById(DEFAULT_TRAINING_PLAN_PRESET_ID);
  if (!defaultTemplate) throw new Error("Default training plan preset not found");

  const goal = await storage.getGoal(userId);
  const targetDate = goal?.startDate || getDefaultTargetDate(defaultTemplate.weeks);

  const raceDate = new Date(targetDate);
  const planStart = new Date(raceDate);
  planStart.setDate(planStart.getDate() - defaultTemplate.weeks * 7);

  const plan = buildTrainingPlanFromPreset(defaultTemplate.id, planStart);
  if (!plan) throw new Error("Failed to build default training plan preset");

  await storage.upsertManySessions(userId, plan);
}

function getDefaultTargetDate(weeksAhead = 12): string {
  const d = new Date();
  d.setDate(d.getDate() + weeksAhead * 7);
  return d.toISOString().split("T")[0];
}

function parseBikeProfileSetting(raw: string | null): BikeProfileSetting {
  const fallback: BikeProfileSetting = {
    bikeName: "",
    make: "",
    model: "",
    bikeType: "mtb",
    carryOverKm: 0,
  };

  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as Partial<BikeProfileSetting>;
    const bikeType = parsed.bikeType;
    return {
      bikeName: typeof parsed.bikeName === "string" ? parsed.bikeName.trim() : "",
      make: typeof parsed.make === "string" ? parsed.make.trim() : "",
      model: typeof parsed.model === "string" ? parsed.model.trim() : "",
      bikeType:
        bikeType === "mtb" || bikeType === "gravel" || bikeType === "road" || bikeType === "other"
          ? bikeType
          : "mtb",
      carryOverKm: normalizeDistanceValue(parsed.carryOverKm),
    };
  } catch {
    return fallback;
  }
}

function parseBikeMaintenanceState(raw: string | null): BikeMaintenanceState {
  if (!raw) {
    return { ruleProgressKm: {}, lastGeneratedAt: null };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<BikeMaintenanceState>;
    const ruleProgressKm = parsed.ruleProgressKm && typeof parsed.ruleProgressKm === "object"
      ? Object.fromEntries(
          Object.entries(parsed.ruleProgressKm).map(([key, value]) => [
            key,
            normalizeDistanceValue(value),
          ]),
        )
      : {};

    return {
      ruleProgressKm,
      lastGeneratedAt:
        typeof parsed.lastGeneratedAt === "string" ? parsed.lastGeneratedAt : null,
    };
  } catch {
    return { ruleProgressKm: {}, lastGeneratedAt: null };
  }
}

function normalizeDistanceValue(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.round(numeric * 10) / 10;
}

function roundToOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function isRideActivity(activity: StravaActivity): boolean {
  const type = (activity.type || "").toLowerCase();
  const sportType = (activity.sportType || "").toLowerCase();
  const candidates = [type, sportType];

  return candidates.some((item) =>
    item === "ride" ||
    item === "virtualride" ||
    item === "mountainbikeride" ||
    item === "gravelride" ||
    item === "ebikeride",
  );
}

function getAdjustedFitnessLevelForTrainingState(
  current: PlanRequest["fitnessLevel"],
  trainingState: TrainingState,
): PlanRequest["fitnessLevel"] {
  if (trainingState === "Beginner") {
    return "beginner";
  }

  if (trainingState === "Returning") {
    if (current === "advanced") return "intermediate";
    if (current === "intermediate") return "beginner";
    return "beginner";
  }

  return current;
}

type CoachHistoryItem = z.infer<typeof coachHistoryItemSchema>;

const WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function safeDate(input: string): Date | null {
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(input: string): string {
  const parsed = safeDate(input);
  if (!parsed) return input;
  return parsed.toISOString().slice(0, 10);
}

function getDaysAgoDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function resolveCurrentWeek(savedActiveWeek: string | null, sessions: Session[]): number {
  if (sessions.length === 0) return 1;
  const weeks = Array.from(new Set(sessions.map((session) => session.week))).sort((a, b) => a - b);

  const parsedActiveWeek = savedActiveWeek ? Number.parseInt(savedActiveWeek, 10) : NaN;
  if (Number.isFinite(parsedActiveWeek) && weeks.includes(parsedActiveWeek)) {
    return parsedActiveWeek;
  }

  for (const week of weeks) {
    const weekSessions = sessions.filter((session) => session.week === week);
    if (weekSessions.some((session) => !session.completed)) {
      return week;
    }
  }

  return weeks[0];
}

function getWeekSessionSummary(sessions: Session[], activeWeek: number): string {
  const weekSessions = sessions
    .filter((session) => session.week === activeWeek)
    .sort((a, b) => {
      if (a.scheduledDate && b.scheduledDate) return a.scheduledDate.localeCompare(b.scheduledDate);
      const dayIndexA = WEEKDAY_ORDER.indexOf((a.day || "").slice(0, 3).toLowerCase());
      const dayIndexB = WEEKDAY_ORDER.indexOf((b.day || "").slice(0, 3).toLowerCase());
      return dayIndexA - dayIndexB;
    });

  if (weekSessions.length === 0) {
    return "No sessions found for the selected week.";
  }

  const completed = weekSessions.filter((session) => session.completed).length;
  const totalMinutes = weekSessions.reduce((sum, session) => sum + (session.minutes || 0), 0);
  const detailLines = weekSessions
    .map((session) => {
      const datePart = session.scheduledDate ? `${session.scheduledDate} ` : "";
      const status = session.completed ? "done" : "planned";
      const zone = session.zone ? ` ${session.zone}` : "";
      return `- [id=${session.id}] ${datePart}${session.day}: ${session.description} (${session.type}, ${session.minutes} min${zone}) [${status}]`;
    })
    .join("\n");

  return `Week ${activeWeek}: ${completed}/${weekSessions.length} sessions completed, ${totalMinutes} total planned minutes.\n${detailLines}`;
}

function countRecentStravaRides(activities: StravaActivity[], days: number): number {
  const threshold = getDaysAgoDate(days).getTime();
  return activities.filter((activity) => {
    const startedAt = safeDate(activity.startDate);
    return startedAt ? startedAt.getTime() >= threshold : false;
  }).length;
}

function getStravaSummary(
  activities: StravaActivity[],
  connected: boolean,
  stravaLastSyncAt: string | null,
): string {
  if (!connected) {
    return "Not connected to Strava (no refresh token).";
  }

  const threshold = getDaysAgoDate(14).getTime();
  const sortedByDate = [...activities].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const latestRide = sortedByDate[0] || null;
  const totalRides = activities.length;
  const lastSyncPart = stravaLastSyncAt ? ` Last sync: ${formatDate(stravaLastSyncAt)}.` : "";
  const recentRides = activities
    .filter((activity) => {
      const startedAt = safeDate(activity.startDate);
      return startedAt ? startedAt.getTime() >= threshold : false;
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  if (recentRides.length === 0) {
    if (!latestRide) {
      return `Connected to Strava, but no rides have been synced yet.${lastSyncPart}`;
    }
    return `Connected to Strava with ${totalRides} synced rides. Most recent ride: ${formatDate(latestRide.startDate)} (${latestRide.name}). No rides in the last 14 days.${lastSyncPart}`;
  }

  const totalDistanceKm = recentRides.reduce((sum, activity) => sum + (activity.distance || 0), 0) / 1000;
  const totalElevation = recentRides.reduce((sum, activity) => sum + (activity.totalElevationGain || 0), 0);
  const totalMovingHours = recentRides.reduce((sum, activity) => sum + (activity.movingTime || 0), 0) / 3600;

  const hrValues = recentRides
    .map((activity) => activity.averageHeartrate)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const averageHr =
    hrValues.length > 0
      ? (hrValues.reduce((sum, value) => sum + value, 0) / hrValues.length).toFixed(0)
      : null;

  const topRides = recentRides
    .slice(0, 5)
    .map((activity) => {
      const distanceKm = ((activity.distance || 0) / 1000).toFixed(1);
      const climbM = (activity.totalElevationGain || 0).toFixed(0);
      return `- ${formatDate(activity.startDate)}: ${activity.name} (${distanceKm} km, ${climbM} m climb)`;
    })
    .join("\n");

  return `Synced rides total: ${totalRides}. Rides in last 14 days: ${recentRides.length}; distance ${totalDistanceKm.toFixed(1)} km; moving time ${totalMovingHours.toFixed(1)} h; elevation ${totalElevation.toFixed(0)} m${averageHr ? `; avg HR ${averageHr} bpm` : ""}.${lastSyncPart}\nRecent rides:\n${topRides}`;
}

function countRecentMetrics(metrics: Metric[], days: number): number {
  const threshold = getDaysAgoDate(days).getTime();
  return metrics.filter((metric) => {
    const metricDate = safeDate(metric.date);
    return metricDate ? metricDate.getTime() >= threshold : false;
  }).length;
}

function getMetricsSummary(metrics: Metric[]): string {
  const threshold = getDaysAgoDate(7).getTime();
  const recent = metrics
    .filter((metric) => {
      const metricDate = safeDate(metric.date);
      return metricDate ? metricDate.getTime() >= threshold : false;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  if (recent.length === 0) {
    return "No metrics logged in the last 7 days.";
  }

  const latest = recent[recent.length - 1];
  const fatigueValues = recent
    .map((metric) => metric.fatigue)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const avgFatigue =
    fatigueValues.length > 0
      ? (fatigueValues.reduce((sum, value) => sum + value, 0) / fatigueValues.length).toFixed(1)
      : null;

  const lines = recent.map((metric) => {
    const parts: string[] = [];
    if (metric.fatigue !== null && metric.fatigue !== undefined) parts.push(`fatigue ${metric.fatigue}/10`);
    if (metric.restingHr !== null && metric.restingHr !== undefined) parts.push(`RHR ${metric.restingHr} bpm`);
    if (metric.weightKg !== null && metric.weightKg !== undefined) parts.push(`weight ${metric.weightKg.toFixed(1)} kg`);
    if (metric.rideMinutes !== null && metric.rideMinutes !== undefined) parts.push(`ride ${metric.rideMinutes} min`);
    if (metric.longRideKm !== null && metric.longRideKm !== undefined) parts.push(`long ride ${metric.longRideKm.toFixed(1)} km`);
    return `- ${metric.date}: ${parts.join(", ") || "no values"}`;
  });

  const latestParts: string[] = [];
  if (latest.fatigue !== null && latest.fatigue !== undefined) latestParts.push(`fatigue ${latest.fatigue}/10`);
  if (latest.restingHr !== null && latest.restingHr !== undefined) latestParts.push(`RHR ${latest.restingHr} bpm`);
  if (latest.weightKg !== null && latest.weightKg !== undefined) latestParts.push(`weight ${latest.weightKg.toFixed(1)} kg`);

  return `Metrics entries in last 7 days: ${recent.length}. Latest (${latest.date}): ${latestParts.join(", ") || "no values"}${avgFatigue ? `; avg fatigue ${avgFatigue}/10` : ""}.\nRecent metrics:\n${lines.join("\n")}`;
}

function buildCoachContext(params: {
  sessions: Session[];
  metrics: Metric[];
  activities: StravaActivity[];
  activeWeek: number;
  stravaConnected: boolean;
  stravaLastSyncAt: string | null;
}): string {
  const weekSummary = getWeekSessionSummary(params.sessions, params.activeWeek);
  const stravaSummary = getStravaSummary(
    params.activities,
    params.stravaConnected,
    params.stravaLastSyncAt,
  );
  const metricsSummary = getMetricsSummary(params.metrics);
  const today = new Date().toISOString().slice(0, 10);

  return [
    `Today: ${today}`,
    `Current week in app: ${params.activeWeek}`,
    "Current week plan:",
    weekSummary,
    "Strava last 14 days:",
    stravaSummary,
    "Latest metrics (last 7 days):",
    metricsSummary,
  ].join("\n");
}

function buildCoachPrompt(params: {
  message: string;
  history: CoachHistoryItem[];
  context: string;
  coachAdjustmentsEnabled: boolean;
}): string {
  const historyText = params.history
    .slice(-12)
    .map((item) => `${item.role === "assistant" ? "Coach" : "Athlete"}: ${item.content}`)
    .join("\n");
  const basePrompt = `You are PeakReady Coach, an MTB endurance coach.
Style and behavior rules:
- Be practical, direct, and supportive.
- Give specific actions (durations, intensity zones, recovery suggestions) when useful.
- Use the provided training context and do not invent data.
- If the athlete asks to update this week's plan, suggest exact edits by day/session from the current week plan.
- If information is missing, say what is missing and ask 1 clarifying question.
- If the athlete reports severe pain, dizziness, or red-flag symptoms, advise them to stop training and seek medical care.
- Keep responses concise (roughly 80-180 words) and structured with short bullets when helpful.

Training context:
${params.context}

Recent conversation:
${historyText || "No prior messages."}

Athlete message:
${params.message}`;

  if (!params.coachAdjustmentsEnabled) {
    return `${basePrompt}

Respond as the MTB endurance coach only.`;
  }

  return `${basePrompt}

If plan adjustments are appropriate, suggest at most ${COACH_PROPOSAL_MAX_CHANGES} changes and only for session IDs from the current active week that were provided in context.
Allowed fields to change are minutes and zone only.
Minutes must be between ${COACH_PROPOSAL_MIN_MINUTES} and ${COACH_PROPOSAL_MAX_MINUTES}.
Do not suggest changes for completed sessions.

Return valid JSON only (no markdown, no code fences) with this exact shape:
{
  "reply": "string",
  "changes": [
    {
      "sessionId": "string",
      "minutes": 90,
      "zone": "Z2",
      "reason": "string"
    }
  ]
}

If no safe changes are needed, return an empty array for changes.
Reply must still be concise and actionable.`;
}

function buildRideInsightPrompt(params: {
  activity: StravaActivity;
  matchedSession: Session | null;
  activeWeek: number;
  sessions: Session[];
}): string {
  const a = params.activity;
  const matched = params.matchedSession
    ? `Matched planned session [id=${params.matchedSession.id}] ${params.matchedSession.day}: ${params.matchedSession.description} (${params.matchedSession.minutes} min${params.matchedSession.zone ? ` ${params.matchedSession.zone}` : ""}).`
    : "No planned session match found.";

  const activeWeekSessions = params.sessions
    .filter((session) => session.week === params.activeWeek)
    .map((session) => {
      const status = session.completed ? "done" : "planned";
      const datePart = session.scheduledDate ? `${session.scheduledDate} ` : "";
      const zone = session.zone ? ` ${session.zone}` : "";
      return `- [id=${session.id}] ${datePart}${session.day}: ${session.description} (${session.minutes} min${zone}) [${status}]`;
    })
    .join("\n");

  return `You are PeakReady ride analyst.
Create a short, practical post-ride insight for dashboard display using ONLY provided fields.

Ride data:
- name: ${a.name}
- startDate: ${a.startDate}
- distanceMeters: ${a.distance ?? 0}
- movingTimeSeconds: ${a.movingTime ?? 0}
- elevationGainMeters: ${a.totalElevationGain ?? 0}
- avgHeartRate: ${a.averageHeartrate ?? "n/a"}
- maxHeartRate: ${a.maxHeartrate ?? "n/a"}
- avgWatts: ${a.averageWatts ?? "n/a"}
- sufferScore: ${a.sufferScore ?? "n/a"}

Matched session context:
${matched}

Current active week (${params.activeWeek}) sessions:
${activeWeekSessions || "No active-week sessions available."}

Output strict JSON:
{
  "headline": "short string <= 120 chars",
  "summary": "2-4 concise sentences",
  "metrics": [{ "label": "Distance", "value": "12.1 km" }],
  "changes": [
    {
      "sessionId": "active-week-session-id",
      "minutes": 90,
      "zone": "Z2",
      "reason": "short reason"
    }
  ]
}

Rules:
- Metrics: 4-8 chips, compact and readable.
- Changes are optional. Use only active-week session ids shown above.
- Allowed change fields: minutes and zone only.
- Minutes must be between ${COACH_PROPOSAL_MIN_MINUTES} and ${COACH_PROPOSAL_MAX_MINUTES}.
- If no safe change needed, return empty changes array.`;
}
