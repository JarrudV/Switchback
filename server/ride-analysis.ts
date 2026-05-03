import type { StravaActivity } from "@shared/schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const ONE_YEAR_DAYS = 365;

export type TrainingState = "Active" | "Returning" | "Beginner";

export interface RideAnalysisSummary {
  trainingState: TrainingState;
  ridesUsed: StravaActivity[];
  ridesUsedCount: number;
  windowDaysUsed: 90 | 180;
  rangeStartDate: string;
  rangeEndDate: string;
  averageRideDurationMinutes: number;
  averageWeeklyFrequency: number;
  recentLongestRideKm: number | null;
  recentLongestRideDate: string | null;
  gapSinceLastRideDays: number | null;
  excludedOlderThanYearCount: number;
}

export function filterActivitiesWithinDays(
  activities: StravaActivity[],
  lookbackDays: number,
  referenceDate: Date = new Date(),
): StravaActivity[] {
  const cutoff = referenceDate.getTime() - lookbackDays * DAY_MS;

  return activities
    .filter((activity) => {
      if (!isRideActivity(activity)) return false;
      const startedAt = safeDate(activity.startDate);
      if (!startedAt) return false;
      const timestamp = startedAt.getTime();
      return timestamp >= cutoff && timestamp <= referenceDate.getTime();
    })
    .sort(
      (a, b) =>
        new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );
}

export function analyzeRideHistoryForPlan(
  activities: StravaActivity[],
  referenceDate: Date = new Date(),
): RideAnalysisSummary {
  const rideLikeActivities = activities.filter(isRideActivity);
  const ridesLastYear = filterActivitiesWithinDays(
    rideLikeActivities,
    ONE_YEAR_DAYS,
    referenceDate,
  );
  const excludedOlderThanYearCount = Math.max(
    0,
    rideLikeActivities.length - ridesLastYear.length,
  );

  const rides90 = filterActivitiesWithinDays(ridesLastYear, 90, referenceDate);
  const useNinetyDayWindow = rides90.length >= 3;
  const windowDaysUsed: 90 | 180 = useNinetyDayWindow ? 90 : 180;
  const ridesUsed = useNinetyDayWindow
    ? rides90
    : filterActivitiesWithinDays(ridesLastYear, 180, referenceDate);

  const rangeEndDate = formatDate(referenceDate);
  const rangeStartDate = formatDate(
    new Date(referenceDate.getTime() - windowDaysUsed * DAY_MS),
  );

  const lastRide = ridesLastYear[0] ?? null;
  const gapSinceLastRideDays = lastRide
    ? Math.floor(
        (referenceDate.getTime() - new Date(lastRide.startDate).getTime()) /
          DAY_MS,
      )
    : null;

  const averageRideDurationMinutes = ridesUsed.length
    ? roundToOne(
        ridesUsed.reduce(
          (sum, ride) => sum + Math.max(0, ride.movingTime || 0) / 60,
          0,
        ) / ridesUsed.length,
      )
    : 0;

  const averageWeeklyFrequency = ridesUsed.length
    ? roundToOne(
        ridesUsed.length /
          (Math.max(7, windowDaysUsed) / 7),
      )
    : 0;

  const longestRide = ridesUsed.reduce<StravaActivity | null>((longest, ride) => {
    if (!longest) return ride;
    return (ride.distance || 0) > (longest.distance || 0) ? ride : longest;
  }, null);

  let trainingState: TrainingState = "Active";
  if (ridesUsed.length === 0) {
    trainingState = "Beginner";
  } else if ((gapSinceLastRideDays ?? 0) > 60) {
    trainingState = "Returning";
  }

  return {
    trainingState,
    ridesUsed,
    ridesUsedCount: ridesUsed.length,
    windowDaysUsed,
    rangeStartDate,
    rangeEndDate,
    averageRideDurationMinutes,
    averageWeeklyFrequency,
    recentLongestRideKm: longestRide
      ? roundToOne((longestRide.distance || 0) / 1000)
      : null,
    recentLongestRideDate: longestRide ? formatDate(longestRide.startDate) : null,
    gapSinceLastRideDays,
    excludedOlderThanYearCount,
  };
}

function safeDate(input: string): Date | null {
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(input: string | Date): string {
  const date = typeof input === "string" ? safeDate(input) : input;
  if (!date) return String(input);
  return date.toISOString().slice(0, 10);
}

function roundToOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function isRideActivity(activity: StravaActivity): boolean {
  const type = (activity.type || "").toLowerCase();
  const sportType = (activity.sportType || "").toLowerCase();
  const values = [type, sportType];

  return values.some((value) =>
    value === "ride" ||
    value === "virtualride" ||
    value === "mountainbikeride" ||
    value === "gravelride" ||
    value === "ebikeride",
  );
}
