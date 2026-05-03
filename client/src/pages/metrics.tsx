import { FormEvent, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Metric, Session, StravaActivity } from "@shared/schema";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO, subDays } from "date-fns";
import { HeartPulse, Pencil, Plus, Trash2, Weight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Props {
  metrics: Metric[];
  sessions: Session[];
}

type ZoneKey = "Z1" | "Z2" | "Z3" | "Z4" | "Z5";

const ZONE_KEYS: ZoneKey[] = ["Z1", "Z2", "Z3", "Z4", "Z5"];
const ZONE_COLORS: Record<ZoneKey, string> = {
  Z1: "#7dd3fc",
  Z2: "#34d399",
  Z3: "#facc15",
  Z4: "#fb923c",
  Z5: "#f87171",
};

function extractZones(zone: string | null): Array<{ zone: ZoneKey; weight: number }> {
  if (!zone) return [];
  const normalized = zone.toUpperCase().replace(/\s+/g, "");
  const rangeMatch = normalized.match(/Z([1-5])[-/]Z?([1-5])/);

  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (start <= end) {
      const span = end - start + 1;
      return Array.from({ length: span }, (_, idx) => {
        const zoneValue = `Z${start + idx}` as ZoneKey;
        return { zone: zoneValue, weight: 1 / span };
      });
    }
  }

  const matches = Array.from(new Set((normalized.match(/Z[1-5]/g) || []) as ZoneKey[]));
  if (matches.length === 0) return [];
  return matches.map((item) => ({ zone: item, weight: 1 / matches.length }));
}

function getRecentZoneTotals(sessions: Session[]) {
  const cutoff = subDays(new Date(), 27).toISOString().slice(0, 10);
  const totals: Record<ZoneKey, number> = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };

  for (const session of sessions) {
    if (!session.completed) continue;
    if (session.type !== "Ride" && session.type !== "Long Ride") continue;

    const sessionDate = session.completedAt?.slice(0, 10) || session.scheduledDate;
    if (!sessionDate || sessionDate < cutoff) continue;

    const buckets = extractZones(session.zone);
    const minutes = Math.max(session.minutes || 0, 0);
    if (minutes <= 0) continue;

    if (buckets.length === 0) {
      totals.Z2 += minutes;
      continue;
    }

    for (const bucket of buckets) {
      totals[bucket.zone] += minutes * bucket.weight;
    }
  }

  const totalMinutes = ZONE_KEYS.reduce((sum, zone) => sum + totals[zone], 0);
  return { totals, totalMinutes };
}

export function Metrics({ metrics, sessions }: Props) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingMetric, setEditingMetric] = useState<Metric | null>(null);
  const { toast } = useToast();
  const { data: stravaActivities = [] } = useQuery<StravaActivity[]>({
    queryKey: ["/api/strava/activities"],
  });

  const sortedMetrics = useMemo(
    () => [...metrics].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [metrics],
  );

  const chartData = useMemo(
    () =>
      [...sortedMetrics]
        .reverse()
        .filter((item) => item.weightKg != null)
        .map((item) => ({
          ...item,
          dateFormatted: format(parseISO(item.date), "MMM d"),
        })),
    [sortedMetrics],
  );

  const plannedVsActualData = useMemo(
    () => buildPlannedVsActualSeries(sessions, stravaActivities),
    [sessions, stravaActivities],
  );
  const { totals: zoneTotals, totalMinutes: zoneTotalMinutes } = useMemo(
    () => getRecentZoneTotals(sessions),
    [sessions],
  );

  const latestWeight = sortedMetrics.find((item) => item.weightKg != null)?.weightKg ?? null;
  const latestFatigue = sortedMetrics.find((item) => item.fatigue != null)?.fatigue ?? null;
  const completedSessions = sessions.filter((session) => session.completed).length;
  const dominantZone = ZONE_KEYS.reduce((best, current) =>
    zoneTotals[current] > zoneTotals[best] ? current : best,
  );

  const handleAddEntry = async (entry: {
    date: string;
    weightKg?: number;
    restingHr?: number;
    fatigue?: number;
    notes?: string;
  }) => {
    try {
      await apiRequest("POST", "/api/metrics", entry);
      await queryClient.invalidateQueries({ queryKey: ["/api/metrics"] });
      setIsAdding(false);
      setEditingMetric(null);
      toast({ title: "Metrics saved" });
    } catch (err: any) {
      toast({
        title: "Failed to save metrics",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleEditEntry = async (
    metricId: string,
    entry: {
      date: string;
      weightKg?: number;
      restingHr?: number;
      fatigue?: number;
      notes?: string;
    },
  ) => {
    try {
      await apiRequest("PATCH", `/api/metrics/${metricId}`, entry);
      await queryClient.invalidateQueries({ queryKey: ["/api/metrics"] });
      setEditingMetric(null);
      setIsAdding(false);
      toast({ title: "Metric updated" });
    } catch (err: any) {
      toast({
        title: "Failed to update metric",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteEntry = async (metricId: string) => {
    if (!window.confirm("Delete this metric entry?")) return;

    try {
      await apiRequest("DELETE", `/api/metrics/${metricId}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/metrics"] });
      toast({ title: "Metric deleted" });
    } catch {
      toast({ title: "Failed to delete metric", variant: "destructive" });
    }
  };

  return (
    <div className="px-1 py-2 space-y-4" data-testid="metrics-view">
      <div className="flex justify-between items-center">
        <h2 className="text-base font-semibold text-brand-text" data-testid="text-metrics-title">
          Stats
        </h2>
        <button
          onClick={() => {
            if (isAdding || editingMetric) {
              setIsAdding(false);
              setEditingMetric(null);
              return;
            }
            setEditingMetric(null);
            setIsAdding(true);
          }}
          className={cn(
            "min-h-[40px] rounded-lg border border-brand-border/45 px-3 text-xs font-medium transition-colors",
            isAdding || editingMetric
              ? "bg-brand-panel-2/35 text-brand-text"
              : "bg-brand-panel/35 text-brand-primary",
          )}
          data-testid="button-toggle-add-metric"
        >
          <span className="inline-flex items-center gap-1.5">
            {isAdding || editingMetric ? <X size={15} /> : <Plus size={15} />}
            {isAdding || editingMetric ? "Close" : "Add"}
          </span>
        </button>
      </div>

      {(isAdding || editingMetric) && (
        <AddMetricForm
          key={editingMetric ? editingMetric.id : "new"}
          initialMetric={editingMetric || undefined}
          title={editingMetric ? "Edit metric entry" : "Log daily metrics"}
          submitLabel={editingMetric ? "Save changes" : "Save metrics"}
          onAdd={(entry) => {
            if (editingMetric) {
              return handleEditEntry(editingMetric.id, entry);
            }
            return handleAddEntry(entry);
          }}
          onCancel={() => {
            setIsAdding(false);
            setEditingMetric(null);
          }}
        />
      )}

      {!isAdding && !editingMetric && (
        <>
          <section className="grid grid-cols-2 gap-2" data-testid="stats-summary">
            <SummaryCard
              label="Latest fatigue"
              value={latestFatigue != null ? `${latestFatigue}/10` : "No data"}
              helper="How hard your body feels right now."
            />
            <SummaryCard
              label="Latest weight"
              value={latestWeight != null ? `${latestWeight.toFixed(1)} kg` : "No data"}
              helper="Long-term trend matters more than daily swings."
            />
            <SummaryCard
              label="Completed sessions"
              value={String(completedSessions)}
              helper="Total sessions completed in your plan."
              className="col-span-2"
            />
          </section>

          <section
            className="rounded-xl border border-brand-border/35 bg-brand-panel/35 p-3.5"
            data-testid="zone-distribution"
          >
            <h3 className="text-sm font-semibold text-brand-text">Ride intensity (last 28 days)</h3>
            {zoneTotalMinutes <= 0 ? (
              <p className="text-sm text-brand-muted mt-2 leading-relaxed">
                No completed rides in the last 28 days yet.
              </p>
            ) : (
              <>
                <div className="mt-2.5 h-3 w-full rounded-full overflow-hidden bg-brand-bg/45 border border-brand-border/40 flex">
                  {ZONE_KEYS.map((zone) => {
                    const minutes = zoneTotals[zone];
                    const widthPct = (minutes / zoneTotalMinutes) * 100;
                    if (widthPct <= 0) return null;
                    return (
                      <div
                        key={zone}
                        style={{ width: `${widthPct}%`, backgroundColor: ZONE_COLORS[zone] }}
                        aria-label={`${zone} ${Math.round(minutes)} minutes`}
                      />
                    );
                  })}
                </div>
                <p className="text-xs text-brand-muted mt-2 leading-relaxed">
                  Most of your recent riding time is in {dominantZone}. Keep most sessions easy to stay consistent.
                </p>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {ZONE_KEYS.map((zone) => (
                    <div key={zone} className="flex items-center gap-2 text-xs text-brand-muted">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: ZONE_COLORS[zone] }}
                      />
                      <span>
                        {zone}: {Math.round(zoneTotals[zone])} min
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {chartData.length > 0 && (
            <section className="rounded-xl border border-brand-border/35 bg-brand-panel/35 p-3.5" data-testid="weight-trend-card">
              <h3 className="text-sm font-semibold text-brand-text mb-2.5">Weight trend</h3>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="dateFormatted" stroke="rgba(255,255,255,0.5)" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis domain={["dataMin - 2", "dataMax + 2"]} stroke="rgba(255,255,255,0.5)" fontSize={12} tickLine={false} axisLine={false} width={34} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "rgba(15,12,41,0.95)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: "8px",
                        color: "#fff",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="weightKg"
                      stroke="#41D1FF"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: "#41D1FF", strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: "#fff", stroke: "#41D1FF", strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          <section className="rounded-xl border border-brand-border/35 bg-brand-panel/35 p-3.5" data-testid="planned-actual-card">
            <h3 className="text-sm font-semibold text-brand-text mb-2.5">Planned vs actual (last 14 days)</h3>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={plannedVsActualData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="dateFormatted" stroke="rgba(255,255,255,0.5)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="rgba(255,255,255,0.5)" fontSize={12} tickLine={false} axisLine={false} width={38} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(15,12,41,0.95)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: "8px",
                      color: "#fff",
                    }}
                    formatter={(value: number, name: string) => [`${Number(value || 0).toFixed(0)} min`, name]}
                  />
                  <Line type="monotone" dataKey="plannedMinutes" name="Planned" stroke="#41D1FF" strokeWidth={2.3} dot={false} />
                  <Line type="monotone" dataKey="actualMinutes" name="Actual (Strava)" stroke="#FFA800" strokeWidth={2.3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-brand-muted mt-2">Days with no Strava activity show 0 minutes.</p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-brand-text">Metrics history</h3>
            {sortedMetrics.length === 0 ? (
              <p
                className="text-brand-muted text-center py-6 rounded-xl border border-brand-border/35 bg-brand-panel/30"
                data-testid="text-no-metrics"
              >
                No metrics recorded yet.
              </p>
            ) : (
              sortedMetrics.map((metric) => (
                <div
                  key={metric.id}
                  className="rounded-xl border border-brand-border/35 bg-brand-panel/30 p-3.5"
                  data-testid={`card-metric-${metric.id}`}
                >
                  <div className="flex justify-between items-center mb-2 pb-2 border-b border-brand-border/35">
                    <span className="font-medium text-sm text-brand-text">
                      {format(parseISO(metric.date), "MMM d, yyyy")}
                    </span>
                    <div className="flex items-center gap-2">
                      {metric.fatigue && (
                        <span
                          className={cn(
                            "text-xs px-2 py-0.5 rounded-md border",
                            metric.fatigue >= 8
                              ? "bg-brand-danger/10 text-brand-danger border-brand-danger/30"
                              : metric.fatigue >= 5
                                ? "bg-brand-warning/10 text-brand-warning border-brand-warning/30"
                              : "bg-brand-success/10 text-brand-success border-brand-success/30",
                          )}
                        >
                          {metric.fatigue}/10
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setIsAdding(false);
                          setEditingMetric(metric);
                        }}
                        className="p-1.5 rounded-md text-brand-muted hover:text-brand-primary hover:bg-brand-primary/10 transition-colors"
                        aria-label={`Edit metric for ${format(parseISO(metric.date), "MMM d, yyyy")}`}
                        data-testid={`button-edit-metric-${metric.id}`}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteEntry(metric.id)}
                        className="p-1.5 rounded-md text-brand-muted hover:text-brand-danger hover:bg-brand-danger/10 transition-colors"
                        aria-label={`Delete metric for ${format(parseISO(metric.date), "MMM d, yyyy")}`}
                        data-testid={`button-delete-metric-${metric.id}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm mt-3">
                    {metric.weightKg && (
                      <div className="flex items-center text-brand-text">
                        <Weight size={16} className="text-brand-muted mr-2" />
                        <span className="font-medium">{metric.weightKg} kg</span>
                      </div>
                    )}
                    {metric.restingHr && (
                      <div className="flex items-center text-brand-text">
                        <HeartPulse size={16} className="text-brand-danger/85 mr-2" />
                        <span className="font-medium">{metric.restingHr} bpm</span>
                      </div>
                    )}
                  </div>
                  {metric.notes && (
                    <p className="mt-3 text-sm text-brand-muted italic bg-brand-bg/50 p-2 rounded-lg">
                      &ldquo;{metric.notes}&rdquo;
                    </p>
                  )}
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  helper,
  className,
}: {
  label: string;
  value: string;
  helper: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-brand-border/35 bg-brand-panel/30 p-2.5", className)}>
      <p className="text-xs text-brand-muted">{label}</p>
      <p className="text-lg font-semibold text-brand-text mt-0.5">{value}</p>
      <p className="text-[11px] text-brand-muted mt-0.5 leading-relaxed">{helper}</p>
    </div>
  );
}

function buildPlannedVsActualSeries(sessions: Session[], activities: StravaActivity[]) {
  const days: Array<{ key: string; dateFormatted: string; plannedMinutes: number; actualMinutes: number }> = [];
  const now = new Date();

  for (let i = 13; i >= 0; i--) {
    const day = new Date(now);
    day.setDate(now.getDate() - i);
    const key = day.toISOString().slice(0, 10);
    days.push({
      key,
      dateFormatted: format(day, "MMM d"),
      plannedMinutes: 0,
      actualMinutes: 0,
    });
  }

  const indexByDate = new Map(days.map((day, idx) => [day.key, idx]));

  for (const session of sessions) {
    if (!session.scheduledDate) continue;
    const index = indexByDate.get(session.scheduledDate);
    if (index === undefined) continue;
    if (session.type !== "Ride" && session.type !== "Long Ride") continue;
    days[index].plannedMinutes += session.minutes || 0;
  }

  for (const activity of activities) {
    const dateKey = activity.startDate.slice(0, 10);
    const index = indexByDate.get(dateKey);
    if (index === undefined) continue;
    const seconds = activity.movingTime || activity.elapsedTime || 0;
    days[index].actualMinutes += Math.round(seconds / 60);
  }

  return days;
}

function AddMetricForm({
  initialMetric,
  title,
  submitLabel,
  onAdd,
  onCancel,
}: {
  initialMetric?: Metric;
  title?: string;
  submitLabel?: string;
  onAdd: (entry: {
    date: string;
    weightKg?: number;
    restingHr?: number;
    fatigue?: number;
    notes?: string;
  }) => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(initialMetric?.date || today);
  const [weightKg, setWeightKg] = useState(
    initialMetric?.weightKg != null ? String(initialMetric.weightKg) : "",
  );
  const [restingHr, setRestingHr] = useState(
    initialMetric?.restingHr != null ? String(initialMetric.restingHr) : "",
  );
  const [fatigue, setFatigue] = useState(
    initialMetric?.fatigue != null ? String(initialMetric.fatigue) : "5",
  );
  const [notes, setNotes] = useState(initialMetric?.notes || "");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onAdd({
      date,
      weightKg: weightKg ? parseFloat(weightKg) : undefined,
      restingHr: restingHr ? parseInt(restingHr, 10) : undefined,
      fatigue: fatigue ? parseInt(fatigue, 10) : undefined,
      notes: notes || undefined,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-brand-border/35 bg-brand-panel/35 p-4"
      data-testid="form-add-metric"
    >
      <h3 className="text-base font-semibold mb-3 text-brand-text">{title || "Log daily metrics"}</h3>
      <div className="space-y-3.5">
        <div>
          <label className="text-xs text-brand-muted font-medium block mb-1">Date</label>
          <input
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-full bg-brand-bg text-brand-text border border-brand-border/50 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-brand-primary outline-none"
            data-testid="input-metric-date"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-brand-muted font-medium block mb-1">Weight (kg)</label>
            <input
              type="number"
              step="0.1"
              value={weightKg}
              onChange={(event) => setWeightKg(event.target.value)}
              className="w-full bg-brand-bg text-brand-text border border-brand-border/50 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-brand-primary outline-none"
              placeholder="e.g. 75.5"
              data-testid="input-metric-weight"
            />
            <p className="text-xs text-brand-muted mt-1 leading-relaxed">
              Track trend over time and power-to-weight direction.
            </p>
          </div>

          <div>
            <label className="text-xs text-brand-muted font-medium block mb-1">Resting HR</label>
            <input
              type="number"
              value={restingHr}
              onChange={(event) => setRestingHr(event.target.value)}
              className="w-full bg-brand-bg text-brand-text border border-brand-border/50 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-brand-primary outline-none"
              placeholder="bpm"
              data-testid="input-metric-hr"
            />
            <p className="text-xs text-brand-muted mt-1 leading-relaxed">
              Compare against your usual baseline to spot recovery changes.
            </p>
          </div>
        </div>

        <div>
          <label className="text-xs text-brand-muted font-medium block mb-1">
            <span className="flex justify-between">
              <span>Fatigue score</span>
              <span
                className={cn(
                  "font-semibold",
                  parseInt(fatigue, 10) >= 8
                    ? "text-brand-danger"
                    : parseInt(fatigue, 10) >= 5
                      ? "text-brand-warning"
                      : "text-brand-success",
                )}
              >
                {fatigue}/10
              </span>
            </span>
          </label>
          <input
            type="range"
            min="1"
            max="10"
            value={fatigue}
            onChange={(event) => setFatigue(event.target.value)}
            className="w-full accent-[#41D1FF]"
            data-testid="input-metric-fatigue"
          />
          <div className="flex justify-between text-xs text-brand-muted mt-1">
            <span>1 (Fresh)</span>
            <span>10 (Exhausted)</span>
          </div>
          <p className="text-xs text-brand-muted mt-1 leading-relaxed">
            Rate overall body feel: 1 is fresh, 10 is exhausted.
          </p>
        </div>

        <div>
          <label className="text-xs text-brand-muted font-medium block mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="w-full bg-brand-bg text-brand-text border border-brand-border/50 rounded-lg px-3 py-2 text-sm min-h-[80px] resize-none focus:ring-1 focus:ring-brand-primary outline-none"
            placeholder="Sleep, stress, soreness, anything useful."
            data-testid="input-metric-notes"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg text-brand-primary text-sm font-medium underline underline-offset-2"
            data-testid="button-cancel-metric"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 py-2.5 bg-brand-primary text-brand-bg rounded-lg font-semibold"
            data-testid="button-save-metric"
          >
            {submitLabel || "Save metrics"}
          </button>
        </div>
      </div>
    </form>
  );
}
