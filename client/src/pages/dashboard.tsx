import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Session } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { WorkoutDetailModal } from "@/components/workout-detail-modal";

const WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

interface Props {
  sessions: Session[];
  activeWeek: number;
  maxWeek: number;
  onOpenPlan: () => void;
  onOpenCoach: () => void;
}

interface CoachProposalChange {
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

interface LatestRideInsight {
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
  metrics: Array<{ label: string; value: string }>;
  proposal: {
    id: string;
    status: "pending" | "applied" | "cancelled" | "expired";
    activeWeek: number;
    changes: CoachProposalChange[];
  } | null;
}

function dayOrder(day: string): number {
  const idx = WEEKDAY_ORDER.indexOf((day || "").slice(0, 3).toLowerCase());
  return idx >= 0 ? idx : 99;
}

function getTodayOrder(): number {
  const day = new Date().getDay();
  return day === 0 ? 6 : day - 1;
}

function isRideSession(session: Session): boolean {
  return session.type === "Ride" || session.type === "Long Ride";
}

function isPastDueRide(session: Session, todayIso: string, todayOrder: number): boolean {
  if (session.completed || !isRideSession(session)) return false;
  if (session.scheduledDate) return session.scheduledDate < todayIso;
  return dayOrder(session.day) < todayOrder;
}

function effortTypeForSession(session: Session): string {
  if (session.type === "Strength") return "Strength";
  if (session.type === "Rest") return "Recovery";
  if (session.zone) return session.zone;

  const description = (session.description || "").toLowerCase();
  if (description.includes("skill") || description.includes("trail")) return "Skills";
  if (session.type === "Long Ride") return "Endurance";
  return "Ride";
}

function shiftIsoDateByDays(isoDate: string, deltaDays: number): string | null {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
  return parsed.toISOString().slice(0, 10);
}

function getCurrentWeekMondayIso(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() + mondayOffset);
  return monday.toISOString().slice(0, 10);
}

function getExpectedDateForCurrentWeek(day: string): string | null {
  const order = dayOrder(day);
  if (order < 0 || order > 6) return null;
  return shiftIsoDateByDays(getCurrentWeekMondayIso(), order);
}

function diffIsoDays(fromIso: string, toIso: string): number | null {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function formatDateLong(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatChangeSummary(change: CoachProposalChange): string {
  const beforeZone = change.before.zone ? ` ${change.before.zone}` : "";
  const afterZone = change.after.zone ? ` ${change.after.zone}` : "";
  return `${change.before.minutes}min${beforeZone} -> ${change.after.minutes}min${afterZone}`;
}

export function Dashboard({ sessions, activeWeek, maxWeek, onOpenPlan, onOpenCoach }: Props) {
  const [viewingSession, setViewingSession] = useState<Session | null>(null);
  const [proposalActionLoading, setProposalActionLoading] = useState(false);
  const [realignLoading, setRealignLoading] = useState(false);
  const [dismissedAlignment, setDismissedAlignment] = useState(false);
  const { toast } = useToast();

  const { data: latestInsight } = useQuery<LatestRideInsight | null>({
    queryKey: ["/api/insights/latest-ride"],
  });

  const weeklySessions = useMemo(
    () =>
      sessions
        .filter((session) => session.week === activeWeek)
        .sort((a, b) => {
          if (a.scheduledDate && b.scheduledDate) {
            return a.scheduledDate.localeCompare(b.scheduledDate);
          }
          return dayOrder(a.day) - dayOrder(b.day);
        }),
    [sessions, activeWeek],
  );

  const alignmentSuggestion = useMemo(() => {
    const pending = weeklySessions
      .filter((session) => !session.completed && !!session.scheduledDate)
      .sort((a, b) => (a.scheduledDate || "").localeCompare(b.scheduledDate || ""));
    const firstPending = pending[0];
    if (!firstPending?.scheduledDate) return null;

    const expected = getExpectedDateForCurrentWeek(firstPending.day);
    if (!expected) return null;

    const deltaDays = diffIsoDays(firstPending.scheduledDate, expected);
    if (deltaDays === null || Math.abs(deltaDays) < 3) return null;

    return {
      fromDate: firstPending.scheduledDate,
      toDate: expected,
      deltaDays,
    };
  }, [weeklySessions]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayOrder = getTodayOrder();

  const plannedRideSessions = weeklySessions.filter(isRideSession);
  const completedRideCount = plannedRideSessions.filter((session) => session.completed).length;
  const hasMissedRide = plannedRideSessions.some((session) =>
    isPastDueRide(session, todayIso, todayOrder),
  );
  const statusLabel = hasMissedRide ? "Needs Adjustment" : "On Track";
  const rideCompletionText = `${completedRideCount} of ${plannedRideSessions.length} rides completed`;
  const rideCompletionPct = plannedRideSessions.length
    ? Math.round((completedRideCount / plannedRideSessions.length) * 100)
    : 0;

  const incompleteRideSessions = plannedRideSessions.filter((session) => !session.completed);
  const nextUpcomingRide = incompleteRideSessions.find(
    (session) => !isPastDueRide(session, todayIso, todayOrder),
  );
  const nextRide = nextUpcomingRide || incompleteRideSessions[0] || null;

  const plannedHours = weeklySessions.reduce((sum, session) => sum + (session.minutes || 0), 0) / 60;
  const completedHours =
    weeklySessions
      .filter((session) => session.completed)
      .reduce((sum, session) => sum + (session.minutes || 0), 0) / 60;
  const consistencyScore = plannedRideSessions.length
    ? Math.max(0, Math.min(10, Math.round((completedRideCount / plannedRideSessions.length) * 10)))
    : 0;

  const handleToggleComplete = async (session: Session) => {
    try {
      await apiRequest("PATCH", `/api/sessions/${session.id}`, {
        completed: !session.completed,
        completedAt: !session.completed ? new Date().toISOString() : null,
        completionSource: !session.completed ? "manual" : null,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/metrics"] });
    } catch {
      toast({ title: "Failed to update session", variant: "destructive" });
    }
  };

  const handleApplyProposal = async (proposalId: string) => {
    if (proposalActionLoading) return;
    setProposalActionLoading(true);
    try {
      const res = await apiRequest("POST", `/api/coach/proposals/${proposalId}/apply`);
      const data = await res.json() as { appliedCount: number; skippedCount: number };
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/coach/context"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/insights/latest-ride"] }),
      ]);
      toast({
        title: "Coach changes applied",
        description: `${data.appliedCount} applied, ${data.skippedCount} skipped.`,
      });
    } catch (err: any) {
      toast({
        title: "Failed to apply coach changes",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setProposalActionLoading(false);
    }
  };

  const handleCancelProposal = async (proposalId: string) => {
    if (proposalActionLoading) return;
    setProposalActionLoading(true);
    try {
      await apiRequest("POST", `/api/coach/proposals/${proposalId}/cancel`);
      await queryClient.invalidateQueries({ queryKey: ["/api/insights/latest-ride"] });
      toast({ title: "Coach changes cancelled" });
    } catch (err: any) {
      toast({
        title: "Failed to cancel coach changes",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setProposalActionLoading(false);
    }
  };

  const handleShiftPendingSessions = async () => {
    if (realignLoading) return;
    setRealignLoading(true);
    try {
      const res = await apiRequest("POST", "/api/plan/realign-current-week");
      const data = await res.json() as { affectedCount: number; fromDate: string; toDate: string };
      await queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      toast({
        title: "Plan dates shifted",
        description: `${data.affectedCount} pending sessions moved from ${data.fromDate} to ${data.toDate}.`,
      });
      setDismissedAlignment(true);
    } catch (err: any) {
      toast({
        title: "Failed to shift pending sessions",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRealignLoading(false);
    }
  };

  return (
    <div className="px-1 py-2 space-y-5" data-testid="dashboard-view">
      <section className="glass-panel p-3.5 space-y-2.5" data-testid="dash-status-section">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-brand-text">Week {activeWeek} of {maxWeek}</h2>
          <span
            className={
              hasMissedRide
                ? "rounded-md bg-brand-warning/14 text-brand-warning px-2 py-0.5 text-[11px] font-medium"
                : "rounded-md bg-brand-success/14 text-brand-success px-2 py-0.5 text-[11px] font-medium"
            }
            data-testid="dash-status-badge"
          >
            {statusLabel}
          </span>
        </div>
        <p className="text-sm text-brand-muted" data-testid="dash-ride-progress-text">
          {rideCompletionText}
        </p>
        <div className="h-1.5 rounded-full bg-brand-bg/45 overflow-hidden">
          <div
            className="h-1.5 rounded-full bg-brand-primary transition-all duration-300"
            style={{ width: `${Math.max(0, Math.min(100, rideCompletionPct))}%` }}
            data-testid="dash-ride-progress-bar"
          />
        </div>
      </section>

      {alignmentSuggestion && !dismissedAlignment && (
        <section
          className="glass-panel p-3 border border-brand-warning/35 bg-brand-warning/8 space-y-2"
          data-testid="dash-alignment-banner"
        >
          <p className="text-sm font-medium text-brand-warning">
            Plan starts {formatDateLong(alignmentSuggestion.fromDate)}, today is {formatDateLong(todayIso)}.
          </p>
          <p className="text-xs text-brand-muted">
            Shift pending sessions to align current week dates?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleShiftPendingSessions}
              disabled={realignLoading}
              className="min-h-[36px] rounded-md border border-brand-warning/35 bg-brand-warning/15 px-3 text-xs font-medium text-brand-warning disabled:opacity-60"
              data-testid="button-shift-pending-sessions"
            >
              {realignLoading ? "Shifting..." : "Shift Pending Sessions"}
            </button>
            <button
              type="button"
              onClick={() => setDismissedAlignment(true)}
              className="min-h-[36px] rounded-md border border-brand-border/40 px-3 text-xs text-brand-muted"
              data-testid="button-dismiss-alignment-banner"
            >
              Dismiss
            </button>
          </div>
        </section>
      )}

      {latestInsight && (
        <section className="glass-panel p-3.5 space-y-3" data-testid="dash-latest-ride-insight">
          <div>
            <p className="text-xs uppercase tracking-wider text-brand-muted">Latest Synced Ride Insight</p>
            <h3 className="text-base font-semibold text-brand-text mt-1">{latestInsight.summary.headline}</h3>
            <p className="text-xs text-brand-muted mt-1">
              {latestInsight.activity.name} - {new Date(latestInsight.activity.startDate).toLocaleString()}
            </p>
            {latestInsight.matchedSession && (
              <p className="text-xs text-brand-primary mt-1">
                Matched session: {latestInsight.matchedSession.label}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {latestInsight.metrics.map((metric) => (
              <span
                key={`${latestInsight.insightId}-${metric.label}`}
                className="rounded-full border border-brand-border/40 bg-brand-panel-2/20 px-2 py-0.5 text-[11px] text-brand-muted"
              >
                {metric.label}: {metric.value}
              </span>
            ))}
          </div>

          <p className="text-sm text-brand-muted leading-relaxed">{latestInsight.summary.text}</p>

          {latestInsight.proposal && (
            <div className="rounded-lg border border-brand-border/35 bg-brand-panel-2/18 p-2.5 space-y-2">
              <p className="text-xs font-medium text-brand-text">Apply coach changes to this week?</p>
              <div className="space-y-1.5">
                {latestInsight.proposal.changes.map((change) => (
                  <div
                    key={`${latestInsight.proposal!.id}-${change.sessionId}`}
                    className="rounded-md border border-brand-border/30 bg-brand-panel/25 px-2 py-1.5"
                  >
                    <p className="text-xs text-brand-muted">
                      <span className="text-brand-text font-medium">Session:</span> {change.sessionLabel}
                    </p>
                    <p className="text-xs text-brand-muted">
                      <span className="text-brand-text font-medium">Change:</span> {formatChangeSummary(change)}
                    </p>
                    <p className="text-xs text-brand-muted">
                      <span className="text-brand-text font-medium">Reason:</span> {change.reason}
                    </p>
                  </div>
                ))}
              </div>
              {latestInsight.proposal.status === "pending" ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleApplyProposal(latestInsight.proposal!.id)}
                    disabled={proposalActionLoading}
                    className="flex-1 min-h-[36px] rounded-md bg-brand-success/15 border border-brand-success/30 text-brand-success text-xs font-medium disabled:opacity-60"
                    data-testid="button-dash-apply-proposal"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCancelProposal(latestInsight.proposal!.id)}
                    disabled={proposalActionLoading}
                    className="flex-1 min-h-[36px] rounded-md bg-brand-danger/12 border border-brand-danger/30 text-brand-danger text-xs font-medium disabled:opacity-60"
                    data-testid="button-dash-cancel-proposal"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <p className="text-xs text-brand-muted capitalize">Proposal {latestInsight.proposal.status}</p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={onOpenCoach}
            className="text-xs font-medium text-brand-primary underline underline-offset-2"
            data-testid="button-open-coach-from-insight"
          >
            Ask follow-up in Coach
          </button>
        </section>
      )}

      <section
        className="glass-panel p-4 space-y-3.5 border border-brand-primary/25 shadow-[0_8px_20px_rgba(0,0,0,0.14)]"
        data-testid="dash-next-ride-section"
      >
        <h3 className="text-lg font-semibold text-brand-text">Next ride</h3>
        {nextRide ? (
          <>
            <div className="space-y-1">
              <p className="text-sm text-brand-muted">
                {nextRide.day}
                {nextRide.scheduledDate ? ` - ${nextRide.scheduledDate}` : ""}
              </p>
              <p className="text-lg font-semibold text-brand-text leading-snug">{nextRide.description}</p>
              <p className="text-sm text-brand-muted">
                {nextRide.minutes} min - {effortTypeForSession(nextRide)}
              </p>
              {nextRide.adjustedByCoach && (
                <p className="inline-flex items-center mt-1 rounded-full border border-brand-primary/35 bg-brand-primary/12 px-2 py-0.5 text-[11px] text-brand-primary">
                  Adjusted by Coach
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setViewingSession(nextRide)}
              className="w-full min-h-[48px] rounded-lg bg-[#22c55e] text-white font-semibold text-sm"
              data-testid="button-view-next-session"
            >
              View Session
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-brand-muted">
              No upcoming ride for this week. Open your week plan to review or adjust sessions.
            </p>
            <button
              type="button"
              onClick={onOpenPlan}
              className="w-full min-h-[44px] rounded-lg text-brand-primary text-sm font-medium underline-offset-2 hover:underline"
              data-testid="button-open-plan-from-dash"
            >
              Open Week Plan
            </button>
          </>
        )}
      </section>

      <section className="pt-1" data-testid="dash-weekly-snapshot">
        <h3 className="text-sm font-medium text-brand-muted mb-2">Weekly snapshot</h3>
        <div className="glass-panel p-3.5 space-y-2">
          <div className="flex items-baseline justify-between border-b border-brand-border/30 pb-2">
            <span className="text-xs text-brand-muted">Planned time</span>
            <span className="text-base font-semibold text-brand-text">{plannedHours.toFixed(1)} hrs</span>
          </div>
          <div className="flex items-baseline justify-between border-b border-brand-border/30 pb-2">
            <span className="text-xs text-brand-muted">Completed time</span>
            <span className="text-base font-semibold text-brand-text">{completedHours.toFixed(1)} hrs</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-brand-muted">Consistency</span>
            <span className="text-base font-semibold text-brand-text">{consistencyScore}/10</span>
          </div>
        </div>
      </section>

      {viewingSession && (
        <WorkoutDetailModal
          session={viewingSession}
          onClose={() => setViewingSession(null)}
          onToggleComplete={() => handleToggleComplete(viewingSession)}
        />
      )}
    </div>
  );
}
