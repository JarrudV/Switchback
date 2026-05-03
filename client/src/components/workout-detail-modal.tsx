import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Clock, Mountain, CheckCircle2, Share2 } from "lucide-react";
import type { Session, StravaActivity } from "@shared/schema";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { generateWorkoutShareCard } from "@/lib/share-card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { resolveNonRideWorkoutDetails, type ExerciseRecommendation } from "@/lib/workout-details";

interface Props {
  session: Session;
  onClose: () => void;
  onToggleComplete?: () => void | Promise<void>;
  isCompleted?: boolean;
  completionActionLabel?: string;
}

function getBestMatchingActivity(session: Session, activities: StravaActivity[]) {
  if (!session.scheduledDate) return null;

  const sameDay = activities.filter((activity) => activity.startDate.slice(0, 10) === session.scheduledDate);
  if (sameDay.length === 0) return null;

  const targetSeconds = session.minutes * 60;
  return sameDay
    .slice()
    .sort((a, b) => {
      const aSeconds = a.movingTime || a.elapsedTime || 0;
      const bSeconds = b.movingTime || b.elapsedTime || 0;
      return Math.abs(aSeconds - targetSeconds) - Math.abs(bSeconds - targetSeconds);
    })[0];
}

function getSessionPurpose(session: Session): string {
  if (session.type === "Rest") return "Prioritize recovery so your next ride feels better and more sustainable.";
  if (session.type === "Strength") return "Build durable strength and stability to support riding posture and control.";
  if (session.type === "Long Ride") return "Build steady endurance and confidence for longer trail days.";
  return "Build consistent ride fitness with manageable effort.";
}

function getTargetZone(session: Session): string {
  if (session.zone) return session.zone;
  if (session.type === "Rest") return "Recovery";
  if (session.type === "Strength") return "RPE 4-6";
  if (session.type === "Long Ride") return "Z2";
  return "Z2";
}

export function WorkoutDetailModal({
  session,
  onClose,
  onToggleComplete,
  isCompleted,
  completionActionLabel,
}: Props) {
  const { toast } = useToast();
  const [isSharing, setIsSharing] = useState(false);
  const [notesDraft, setNotesDraft] = useState(session.notes ?? "");
  const [savedNotes, setSavedNotes] = useState(session.notes ?? "");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const { data: stravaActivities = [] } = useQuery<StravaActivity[]>({
    queryKey: ["/api/strava/activities"],
    enabled: session.completed,
  });

  const matchedActivity = getBestMatchingActivity(session, stravaActivities);
  const nonRideDetails = useMemo(() => resolveNonRideWorkoutDetails(session), [session]);
  const hasUnsavedNotes = notesDraft.trim() !== savedNotes.trim();
  const completionState = isCompleted ?? session.completed;
  const completionLabel = completionActionLabel ?? (completionState ? "Mark Incomplete" : "Mark Complete");
  const quickBreakdown = nonRideDetails
    ? [
        `Warm-up: ${nonRideDetails.warmUp[0] || "Easy movement and prep."}`,
        `Main set: ${nonRideDetails.mainSet[0] || session.description}`,
        `Cool-down: ${nonRideDetails.coolDown[0] || "Easy movement to recover."}`,
      ]
    : [
        "Warm-up: 10 minutes easy effort.",
        `Main set: ${session.description}`,
        "Cool-down: 5-10 minutes easy effort and mobility.",
      ];

  useEffect(() => {
    const nextNotes = session.notes ?? "";
    setNotesDraft(nextNotes);
    setSavedNotes(nextNotes);
  }, [session.id, session.notes]);

  const handleShare = async () => {
    try {
      setIsSharing(true);
      const blob = await generateWorkoutShareCard({
        session,
        stravaActivity: matchedActivity,
      });

      const fileName = `peakready-${session.id}.png`;
      const pngFile = new File([blob], fileName, { type: "image/png" });
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
      };

      if (nav.share && nav.canShare?.({ files: [pngFile] })) {
        await nav.share({
          title: "PeakReady Workout",
          text: `${session.description} completed`,
          files: [pngFile],
        });
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: "Workout card downloaded" });
    } catch {
      toast({ title: "Failed to share workout card", variant: "destructive" });
    } finally {
      setIsSharing(false);
    }
  };

  const handleSaveNotes = async () => {
    setIsSavingNotes(true);
    const normalizedNotes = notesDraft.trim();
    try {
      await apiRequest("PATCH", `/api/sessions/${session.id}`, {
        notes: normalizedNotes.length > 0 ? normalizedNotes : null,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      setSavedNotes(normalizedNotes);
      toast({ title: "Session notes saved" });
    } catch {
      toast({ title: "Failed to save notes", variant: "destructive" });
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleCompletionAction = async () => {
    if (!onToggleComplete) return;
    try {
      await Promise.resolve(onToggleComplete());
      onClose();
    } catch {
      // Parent handlers already report errors.
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      data-testid="modal-workout-detail"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-lg max-h-[88vh] bg-brand-bg border border-brand-border/45 rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col shadow-2xl shadow-black/40">
        <div className="sticky top-0 z-20 flex items-start justify-between p-4 border-b border-brand-border/35 bg-brand-bg/95 backdrop-blur-sm">
          <div className="flex-1 pr-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className={cn(
                  "text-[11px] font-medium px-2 py-0.5 rounded-full",
                  session.type === "Long Ride"
                    ? "text-brand-primary bg-brand-primary/10 border border-brand-primary/25"
                    : session.type === "Ride"
                      ? "text-brand-text bg-brand-panel-2/40 border border-brand-border/40"
                      : session.type === "Strength"
                        ? "text-brand-warning bg-brand-warning/10 border border-brand-warning/20"
                        : "text-brand-muted bg-brand-panel-2/35 border border-brand-border/30"
                )}
              >
                {session.type}
              </span>
              {session.completed && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={15} className="text-brand-success" />
                  <span className="text-[11px] text-brand-success/90">Completed</span>
                </div>
              )}
              {session.adjustedByCoach && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] px-2 py-0.5 rounded-full border border-brand-primary/35 bg-brand-primary/12 text-brand-primary">
                    Adjusted by Coach
                  </span>
                </div>
              )}
            </div>
            <h2 className="text-lg font-semibold text-brand-text leading-snug">
              {session.description}
            </h2>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onClose}
              className="h-9 w-9 rounded-full bg-brand-panel-2/45 text-brand-text hover:bg-brand-panel transition-colors flex items-center justify-center"
              data-testid="button-close-detail"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 px-4 py-2.5 border-b border-brand-border/30 bg-brand-bg/45">
          <span className="inline-flex items-center rounded-full border border-brand-border/40 bg-brand-panel-2/20 px-2.5 py-1 text-[11px] text-brand-muted">
            <Clock size={13} className="mr-1 text-brand-primary" />
            {session.minutes} min
          </span>
          <span className="inline-flex items-center rounded-full border border-brand-border/40 bg-brand-panel-2/20 px-2.5 py-1 text-[11px] text-brand-muted">
            Target {getTargetZone(session)}
          </span>
          {session.elevation && (
            <span className="inline-flex items-center rounded-full border border-brand-border/40 bg-brand-panel-2/20 px-2.5 py-1 text-[11px] text-brand-muted">
              <Mountain size={13} className="mr-1 text-brand-primary" />
              {session.elevation}
            </span>
          )}
          <span className="inline-flex items-center text-[11px] text-brand-muted ml-auto">
            Week {session.week}, {session.day}
          </span>
        </div>

        <div
          className="flex-1 overflow-y-auto p-4 workout-markdown"
          data-testid="text-workout-details"
        >
          <div className="rounded-xl border border-brand-border/35 bg-brand-panel/30 p-3.5 mb-4">
            <h3 className="text-sm font-semibold text-brand-text mb-1.5">Purpose</h3>
            <p className="text-sm text-brand-muted leading-relaxed">{getSessionPurpose(session)}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="rounded-full border border-brand-border/35 bg-brand-panel-2/15 px-2.5 py-1 text-[11px] text-brand-muted">
                Duration: {session.minutes} min
              </span>
              <span className="rounded-full border border-brand-border/35 bg-brand-panel-2/15 px-2.5 py-1 text-[11px] text-brand-muted">
                Target: {getTargetZone(session)}
              </span>
            </div>
            <ul className="space-y-2 mt-3">
              {quickBreakdown.map((item, idx) => (
                <li key={`quick-breakdown-${idx}`} className="text-sm text-brand-muted flex items-start gap-2">
                  <span className="text-brand-primary mt-1.5 text-[7px]">*</span>
                  <span className="flex-1">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {(nonRideDetails || session.detailsMarkdown) && (
            <details className="rounded-xl border border-brand-border/30 bg-brand-panel/25 p-3.5">
              <summary className="text-sm text-brand-primary font-medium cursor-pointer select-none">
                See full details (optional)
              </summary>
              <div className="mt-3 space-y-4">
                {nonRideDetails ? (
                  <>
                    {nonRideDetails.exerciseRecommendations.length > 0 && (
                      <ExerciseRecommendationsSection exercises={nonRideDetails.exerciseRecommendations} />
                    )}
                    <StructuredSection title="Warm-up" items={nonRideDetails.warmUp} />
                    <StructuredSection title="Main set" items={nonRideDetails.mainSet} />
                    <StructuredSection title="Cool-down" items={nonRideDetails.coolDown} />
                    {nonRideDetails.equipment && nonRideDetails.equipment.length > 0 && (
                      <StructuredSection title="Equipment" items={nonRideDetails.equipment} />
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="rounded-lg border border-brand-border/35 bg-brand-panel/25 p-3">
                        <p className="text-xs text-brand-muted mb-1">Time estimate</p>
                        <p className="text-sm font-semibold text-brand-text">{nonRideDetails.timeEstimate}</p>
                      </div>
                      <div className="rounded-lg border border-brand-border/35 bg-brand-panel/25 p-3">
                        <p className="text-xs text-brand-muted mb-1">RPE guidance</p>
                        <p className="text-sm font-semibold text-brand-text">{nonRideDetails.rpeGuidance}</p>
                      </div>
                    </div>
                    {nonRideDetails.fallbackMessage && (
                      <p className="text-xs text-brand-secondary leading-relaxed">{nonRideDetails.fallbackMessage}</p>
                    )}
                  </>
                ) : (
                  <ReactMarkdown
                    components={{
                      h2: ({ children }) => (
                        <h2 className="text-base font-semibold text-brand-text mb-2 mt-1 first:mt-0">{children}</h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-sm font-semibold text-brand-text mt-4 mb-1.5">{children}</h3>
                      ),
                      p: ({ children }) => (
                        <p className="text-sm text-brand-muted leading-relaxed mb-2">{children}</p>
                      ),
                      strong: ({ children }) => (
                        <strong className="text-brand-text font-semibold">{children}</strong>
                      ),
                      ul: ({ children }) => <ul className="space-y-1.5 mb-3 ml-1">{children}</ul>,
                      li: ({ children }) => (
                        <li className="text-sm text-brand-muted flex items-start gap-2">
                          <span className="text-brand-primary mt-1.5 text-[7px]">*</span>
                          <span className="flex-1">{children}</span>
                        </li>
                      ),
                      hr: () => <hr className="border-brand-border/40 my-4" />,
                    }}
                  >
                    {session.detailsMarkdown || ""}
                  </ReactMarkdown>
                )}
              </div>
            </details>
          )}

          {!nonRideDetails && !session.detailsMarkdown && (
            <div className="text-center py-8 text-brand-muted">
              <p className="text-sm">No detailed workout instructions available for this session.</p>
              <p className="text-xs mt-2">Check back after loading a training plan with workout details.</p>
            </div>
          )}
        </div>

        <div className="border-t border-brand-border/35 p-4 bg-brand-bg/45 space-y-3">
          {onToggleComplete && (
            <button
              type="button"
              onClick={handleCompletionAction}
              className="w-full min-h-[48px] rounded-lg text-sm font-semibold bg-[#22c55e] text-white"
              data-testid="button-workout-mark-complete"
            >
              {completionLabel}
            </button>
          )}

          {session.completed && (
            <button
              type="button"
              onClick={handleShare}
              disabled={isSharing}
              className="text-sm text-brand-primary underline underline-offset-2 inline-flex items-center gap-1.5"
              data-testid="button-share-workout"
            >
              <Share2 size={14} />
              {isSharing ? "Preparing share..." : "Share workout card"}
            </button>
          )}

          {session.rpe && (
            <div className="flex items-center text-sm">
              <span className="text-brand-muted w-12">RPE:</span>
              <span className="font-semibold text-brand-text">
                {session.rpe}/10
              </span>
            </div>
          )}

          <div>
            <label className="text-xs text-brand-muted font-medium block mb-1.5">
              Session notes
            </label>
            <textarea
              value={notesDraft}
              onChange={(event) => setNotesDraft(event.target.value)}
              className="w-full bg-brand-bg text-brand-text border border-brand-border/45 rounded-lg px-3 py-2 text-sm min-h-[72px] resize-none focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary"
              placeholder="Add your own cues, substitutions, or post-workout observations..."
              data-testid="input-workout-detail-notes"
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={handleSaveNotes}
                disabled={isSavingNotes || !hasUnsavedNotes}
                className="px-1 py-1 text-xs text-brand-primary font-medium underline underline-offset-2 disabled:opacity-50"
                data-testid="button-save-workout-detail-notes"
              >
                {isSavingNotes ? "Saving..." : "Save notes"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExerciseRecommendationsSection({ exercises }: { exercises: ExerciseRecommendation[] }) {
  return (
    <div className="rounded-lg border border-brand-border/35 bg-brand-panel/25 p-3.5">
      <h3 className="text-sm font-semibold text-brand-text mb-2">Exercises</h3>
      <p className="text-xs text-brand-muted leading-relaxed mb-3">
        Simple movements for everyday riders. Pick options that feel smooth and pain-free.
      </p>
      <div className="space-y-3">
        {exercises.map((exercise) => (
          <div
            key={exercise.key}
            className="rounded-lg border border-brand-border/35 bg-brand-panel/20 p-3"
          >
            <p className="text-sm font-semibold text-brand-text">{exercise.name}</p>
            <p className="text-xs text-brand-muted mt-1">
              <span className="text-brand-text font-semibold">What it is:</span> {exercise.whatItIs}
            </p>
            <p className="text-xs text-brand-muted mt-1">
              <span className="text-brand-text font-semibold">Why it helps cycling:</span> {exercise.whyItHelpsCycling}
            </p>
            {exercise.howToDoIt && exercise.howToDoIt.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs font-medium text-brand-primary cursor-pointer select-none">
                  How to do it (optional)
                </summary>
                <ol className="mt-2 space-y-1 list-decimal list-inside">
                  {exercise.howToDoIt.map((step, idx) => (
                    <li key={`${exercise.key}-${idx}`} className="text-xs text-brand-muted leading-relaxed">
                      {step}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StructuredSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-brand-border/35 bg-brand-panel/25 p-3.5">
      <h3 className="text-sm font-semibold text-brand-text mb-2">{title}</h3>
      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li key={`${title}-${idx}`} className="text-sm text-brand-muted flex items-start gap-2">
            <span className="text-brand-primary mt-1.5 text-[7px]">*</span>
            <span className="flex-1">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
