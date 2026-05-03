import type { Session, Metric, GoalEvent } from "@shared/schema";
import { parseISODate } from "./dates";

export function weekStats(sessions: Session[], activeWeek: number) {
  const weekSessions = sessions.filter((s) => s.week === activeWeek);
  const targetMins = weekSessions.reduce((a, s) => a + (s.minutes || 0), 0);
  const completedMins = weekSessions
    .filter((s) => s.completed)
    .reduce((a, s) => a + (s.minutes || 0), 0);

  const completionPct = weekSessions.length
    ? weekSessions.filter((s) => s.completed).length / weekSessions.length
    : 0;

  return {
    targetMinutes: targetMins,
    completedMinutes: completedMins,
    completionPct: Math.round(completionPct * 100),
    completedCount: weekSessions.filter((s) => s.completed).length,
    totalCount: weekSessions.length,
  };
}

export function totalCompletedSessions(sessions: Session[]) {
  return sessions.filter((s) => s.completed).length;
}

export function latestMetric(metrics: Metric[], key: keyof Metric) {
  const sorted = [...metrics]
    .filter((m) => m[key] !== undefined && m[key] !== null)
    .sort((a, b) => (a.date > b.date ? 1 : -1));
  return sorted.at(-1)?.[key] ?? undefined;
}

export function planStatus(sessions: Session[], goal?: GoalEvent) {
  if (!sessions.length || !goal) {
    return {
      planProgress: 0,
      sessionProgress: 0,
      status: "Unknown",
      behindCount: 0,
    };
  }

  const firstSession = sessions.reduce((earliest, s) => {
    if (!s.scheduledDate) return earliest;
    if (!earliest) return s.scheduledDate;
    return s.scheduledDate < earliest ? s.scheduledDate : earliest;
  }, "" as string);

  if (!firstSession)
    return {
      planProgress: 0,
      sessionProgress: 0,
      status: "Unknown",
      behindCount: 0,
    };

  const startDate = parseISODate(firstSession);
  const raceDate = parseISODate(goal.startDate);
  const today = new Date();

  const totalDays = Math.max(
    1,
    (raceDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24)
  );
  const elapsedDays = Math.max(
    0,
    (today.getTime() - startDate.getTime()) / (1000 * 3600 * 24)
  );

  const planProgress = Math.min(
    100,
    Math.round((elapsedDays / totalDays) * 100)
  );

  const totalSessions = sessions.length;
  const completedSessionsCount = sessions.filter((s) => s.completed).length;
  const sessionProgress = Math.round(
    (completedSessionsCount / totalSessions) * 100
  );

  const expectedSessionsToDate = Math.round(
    (planProgress / 100) * totalSessions
  );
  const behindCount = Math.max(0, expectedSessionsToDate - completedSessionsCount);

  let status = "On Track";
  if (behindCount > 0 && behindCount <= 2) {
    status = "Slightly Behind";
  } else if (behindCount > 2) {
    status = `Behind by ${behindCount}`;
  }

  return { planProgress, sessionProgress, status, behindCount };
}

export function calculateReadinessScore(
  sessions: Session[],
  metrics: Metric[],
  activeWeek: number
) {
  return calculateReadinessDetails(metrics).score;
}

export function calculateReadinessDetails(metrics: Metric[]) {
  const sortedByDate = [...metrics].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const fatigueEntries = sortedByDate.filter(
    (m) => m.fatigue !== undefined && m.fatigue !== null
  );
  const latestFatigue = fatigueEntries.at(-1)?.fatigue;

  // Primary driver: fatigue (1 = fresh, 10 = exhausted).
  const fatigueValue =
    latestFatigue === undefined || latestFatigue === null
      ? 5
      : Math.min(10, Math.max(1, Number(latestFatigue)));
  const fatigueScore = Math.round(100 - ((fatigueValue - 1) / 9) * 90); // 1->100, 10->10

  const rhrEntries = sortedByDate.filter(
    (m) => m.restingHr !== undefined && m.restingHr !== null
  );
  const latestRhr = rhrEntries.at(-1)?.restingHr ?? null;
  const baselineCandidates = rhrEntries.slice(0, -1).map((m) => Number(m.restingHr));
  const baselineRhr =
    baselineCandidates.length >= 3
      ? Math.round(
          baselineCandidates.reduce((sum, value) => sum + value, 0) /
            baselineCandidates.length
        )
      : null;

  if (!baselineRhr || latestRhr === null) {
    return {
      score: fatigueScore,
      fatigueScore,
      latestFatigue: fatigueValue,
      latestRhr,
      baselineRhr: null,
      usesRhrBaseline: false,
    };
  }

  const deviationPct = ((Number(latestRhr) - baselineRhr) / baselineRhr) * 100;
  // Resting HR above baseline reduces readiness; below baseline gives a small boost.
  const rhrAdjustment =
    deviationPct > 0
      ? Math.max(-25, -Math.round(deviationPct * 4))
      : Math.min(8, Math.round(Math.abs(deviationPct) * 2));
  const rhrAdjustedScore = Math.max(0, Math.min(100, fatigueScore + rhrAdjustment));

  const score = Math.round(
    Math.max(0, Math.min(100, fatigueScore * 0.85 + rhrAdjustedScore * 0.15))
  );

  return {
    score,
    fatigueScore,
    latestFatigue: fatigueValue,
    latestRhr,
    baselineRhr,
    usesRhrBaseline: true,
  };
}
