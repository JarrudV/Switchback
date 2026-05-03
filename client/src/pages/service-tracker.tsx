import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ServiceItem, StravaActivity } from "@shared/schema";
import { Plus, X, Settings, CheckCircle2, Circle, Clock, Tag, CalendarDays, RefreshCw, Bike } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Props {
  serviceItems: ServiceItem[];
}

type BikeType = "mtb" | "gravel" | "road" | "other";

interface BikeProfile {
  bikeName: string;
  make: string;
  model: string;
  bikeType: BikeType;
  carryOverKm: number;
}

interface AutoChecksResponse {
  generatedCount: number;
  generatedItemIds: string[];
  stravaRideKm: number;
  carryOverKm: number;
  totalRideKm: number;
  hasStravaData: boolean;
}

const DEFAULT_BIKE_PROFILE: BikeProfile = {
  bikeName: "",
  make: "",
  model: "",
  bikeType: "mtb",
  carryOverKm: 0,
};

const AUTO_RULE_HINTS = [
  "Chain clean/lube every 100 km",
  "Brake check every 150 km",
  "Bolt torque + suspension clean every 200 km",
];

function parseBikeProfile(raw: string | null | undefined): BikeProfile {
  if (!raw) return DEFAULT_BIKE_PROFILE;

  try {
    const parsed = JSON.parse(raw) as Partial<BikeProfile>;
    const bikeType = parsed.bikeType;
    return {
      bikeName: typeof parsed.bikeName === "string" ? parsed.bikeName : "",
      make: typeof parsed.make === "string" ? parsed.make : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
      bikeType:
        bikeType === "mtb" || bikeType === "gravel" || bikeType === "road" || bikeType === "other"
          ? bikeType
          : "mtb",
      carryOverKm: normalizePositiveNumber(parsed.carryOverKm),
    };
  } catch {
    return DEFAULT_BIKE_PROFILE;
  }
}

function normalizePositiveNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * 10) / 10;
}

function isRideActivity(activity: StravaActivity): boolean {
  const type = (activity.type || "").toLowerCase();
  const sportType = (activity.sportType || "").toLowerCase();
  return (
    type === "ride" ||
    type === "mountainbikeride" ||
    type === "gravelride" ||
    type === "virtualride" ||
    type === "ebikeride" ||
    sportType === "ride" ||
    sportType === "mountainbikeride" ||
    sportType === "gravelride" ||
    sportType === "virtualride" ||
    sportType === "ebikeride"
  );
}

export function ServiceTracker({ serviceItems }: Props) {
  const [isAdding, setIsAdding] = useState(false);
  const [isSavingBike, setIsSavingBike] = useState(false);
  const [isRunningAutoChecks, setIsRunningAutoChecks] = useState(false);
  const [autoSummary, setAutoSummary] = useState<AutoChecksResponse | null>(null);
  const { toast } = useToast();
  const autoRanRef = useRef(false);

  const { data: bikeProfileSetting } = useQuery<{ value: string | null }>({
    queryKey: ["/api/settings", "bikeProfileV1"],
  });
  const { data: stravaActivities = [] } = useQuery<StravaActivity[]>({
    queryKey: ["/api/strava/activities"],
  });

  const parsedProfile = useMemo(
    () => parseBikeProfile(bikeProfileSetting?.value),
    [bikeProfileSetting?.value],
  );

  const [bikeProfileDraft, setBikeProfileDraft] = useState<BikeProfile>(parsedProfile);

  useEffect(() => {
    setBikeProfileDraft(parsedProfile);
  }, [parsedProfile.bikeName, parsedProfile.make, parsedProfile.model, parsedProfile.bikeType, parsedProfile.carryOverKm]);

  const estimatedStravaKm = useMemo(() => {
    const totalMeters = stravaActivities
      .filter(isRideActivity)
      .reduce((sum, activity) => sum + (activity.distance || 0), 0);
    return Math.round((totalMeters / 1000) * 10) / 10;
  }, [stravaActivities]);

  const displayedTotalKm =
    autoSummary?.totalRideKm ?? Math.round((estimatedStravaKm + parsedProfile.carryOverKm) * 10) / 10;

  const runAutoChecks = async (opts?: { silent?: boolean }) => {
    setIsRunningAutoChecks(true);
    try {
      const res = await apiRequest("POST", "/api/service-items/auto-checks");
      const data = (await res.json()) as AutoChecksResponse;
      setAutoSummary(data);
      await queryClient.invalidateQueries({ queryKey: ["/api/service-items"] });

      if (!opts?.silent) {
        if (data.generatedCount > 0) {
          toast({
            title: `${data.generatedCount} bike checks added`,
            description: `Triggered at ${data.totalRideKm.toFixed(1)} km tracked.`,
          });
        } else {
          toast({
            title: "No new checks yet",
            description: `Current tracked distance: ${data.totalRideKm.toFixed(1)} km.`,
          });
        }
      }
    } catch {
      if (!opts?.silent) {
        toast({ title: "Failed to run auto-checks", variant: "destructive" });
      }
    } finally {
      setIsRunningAutoChecks(false);
    }
  };

  useEffect(() => {
    if (autoRanRef.current) return;
    autoRanRef.current = true;
    runAutoChecks({ silent: true });
  }, []);

  const handleSaveBikeProfile = async () => {
    setIsSavingBike(true);
    try {
      const normalized: BikeProfile = {
        bikeName: bikeProfileDraft.bikeName.trim(),
        make: bikeProfileDraft.make.trim(),
        model: bikeProfileDraft.model.trim(),
        bikeType: bikeProfileDraft.bikeType,
        carryOverKm: normalizePositiveNumber(bikeProfileDraft.carryOverKm),
      };

      await apiRequest("PUT", "/api/settings/bikeProfileV1", {
        value: JSON.stringify(normalized),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/settings", "bikeProfileV1"] });
      toast({ title: "Bike profile saved" });
    } catch {
      toast({ title: "Failed to save bike profile", variant: "destructive" });
    } finally {
      setIsSavingBike(false);
    }
  };

  const handleUpdateStatus = async (
    item: ServiceItem,
    newStatus: string
  ) => {
    try {
      await apiRequest("PATCH", `/api/service-items/${item.id}`, {
        status: newStatus,
        date: newStatus === "Done" ? new Date().toISOString().split("T")[0] : item.date,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/service-items"] });
    } catch {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  const handleAddItem = async (newItem: {
    item: string;
    shop?: string;
    cost?: number;
    notes?: string;
    dueDate?: string;
  }) => {
    try {
      await apiRequest("POST", "/api/service-items", {
        id: `svc-${Date.now()}`,
        ...newItem,
        status: "Planned",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/service-items"] });
      setIsAdding(false);
      toast({ title: "Task added" });
    } catch {
      toast({ title: "Failed to add task", variant: "destructive" });
    }
  };

  const sortedItems = [...serviceItems].sort((a, b) => {
    const statusWeight: Record<string, number> = {
      "In Progress": 0,
      Planned: 1,
      Done: 2,
    };
    return (statusWeight[a.status] ?? 1) - (statusWeight[b.status] ?? 1);
  });

  return (
    <div className="p-4 space-y-6" data-testid="service-tracker-view">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-brand-text" data-testid="text-service-title">
          Bike Maintenance
        </h2>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className={cn(
            "p-2 rounded-full transition-all shadow-lg",
            isAdding
              ? "bg-brand-panel-2 text-brand-text"
              : "bg-gradient-primary text-brand-bg shadow-[0_0_15px_rgba(65,209,255,0.4)]"
          )}
          data-testid="button-toggle-add-service"
        >
          {isAdding ? <X size={20} /> : <Plus size={20} />}
        </button>
      </div>

      <div className="glass-panel p-4 space-y-4 border border-brand-border/60">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[10px] uppercase tracking-widest font-bold text-brand-muted flex items-center gap-1.5">
            <Bike size={13} className="text-brand-primary" />
            Bike Setup and Auto Checks
          </h3>
          <button
            type="button"
            onClick={() => runAutoChecks()}
            disabled={isRunningAutoChecks}
            className="px-3 py-2 rounded-lg bg-brand-panel-2 border border-brand-border text-[10px] uppercase tracking-widest font-bold text-brand-text flex items-center gap-1.5 disabled:opacity-60"
            data-testid="button-run-bike-auto-checks"
          >
            <RefreshCw size={12} className={cn(isRunningAutoChecks && "animate-spin")} />
            {isRunningAutoChecks ? "Checking..." : "Run Distance Check"}
          </button>
        </div>

        <p className="text-xs text-brand-muted leading-relaxed">
          Add your bike details, then PeakReady auto-creates maintenance tasks when distance milestones are reached.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-brand-muted font-medium block mb-1">
              Bike Nickname
            </label>
            <input
              type="text"
              value={bikeProfileDraft.bikeName}
              onChange={(e) =>
                setBikeProfileDraft((prev) => ({ ...prev, bikeName: e.target.value }))
              }
              className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-brand-primary outline-none"
              placeholder="e.g. Trail Beast"
              data-testid="input-bike-name"
            />
          </div>

          <div>
            <label className="text-xs text-brand-muted font-medium block mb-1">
              Make
            </label>
            <input
              type="text"
              value={bikeProfileDraft.make}
              onChange={(e) =>
                setBikeProfileDraft((prev) => ({ ...prev, make: e.target.value }))
              }
              className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-brand-primary outline-none"
              placeholder="e.g. Trek"
              data-testid="input-bike-make"
            />
          </div>

          <div>
            <label className="text-xs text-brand-muted font-medium block mb-1">
              Model
            </label>
            <input
              type="text"
              value={bikeProfileDraft.model}
              onChange={(e) =>
                setBikeProfileDraft((prev) => ({ ...prev, model: e.target.value }))
              }
              className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-brand-primary outline-none"
              placeholder="e.g. Fuel EX"
              data-testid="input-bike-model"
            />
          </div>

          <div>
            <label className="text-xs text-brand-muted font-medium block mb-1">
              Bike Type
            </label>
            <select
              value={bikeProfileDraft.bikeType}
              onChange={(e) =>
                setBikeProfileDraft((prev) => ({ ...prev, bikeType: e.target.value as BikeType }))
              }
              className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-brand-primary outline-none"
              data-testid="select-bike-type"
            >
              <option value="mtb">MTB</option>
              <option value="gravel">Gravel</option>
              <option value="road">Road</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-brand-muted font-medium block mb-1">
              Carry-over KM
            </label>
            <input
              type="number"
              min={0}
              step={0.1}
              value={bikeProfileDraft.carryOverKm}
              onChange={(e) =>
                setBikeProfileDraft((prev) => ({
                  ...prev,
                  carryOverKm: normalizePositiveNumber(e.target.value),
                }))
              }
              className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-brand-primary outline-none"
              placeholder="KM already on this bike"
              data-testid="input-bike-carryover-km"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-muted">
          {AUTO_RULE_HINTS.map((hint) => (
            <span
              key={hint}
              className="px-2 py-1 rounded-full bg-brand-panel-2 border border-brand-border/50"
            >
              {hint}
            </span>
          ))}
        </div>

        <div className="flex justify-between items-center gap-3">
          <div className="text-xs text-brand-muted">
            <div>Tracked distance: <span className="text-brand-text font-semibold">{displayedTotalKm.toFixed(1)} km</span></div>
            <div>{estimatedStravaKm > 0 ? "Includes synced Strava rides." : "No Strava rides synced yet. Use carry-over KM."}</div>
          </div>
          <button
            type="button"
            onClick={handleSaveBikeProfile}
            disabled={isSavingBike}
            className="px-3 py-2 rounded-lg bg-gradient-primary text-brand-bg text-[10px] uppercase tracking-widest font-black disabled:opacity-60"
            data-testid="button-save-bike-profile"
          >
            {isSavingBike ? "Saving..." : "Save Bike"}
          </button>
        </div>
      </div>

      {isAdding && (
        <AddServiceForm
          onAdd={handleAddItem}
          onCancel={() => setIsAdding(false)}
        />
      )}

      {!isAdding && (
        <div className="space-y-4">
          <div className="flex justify-between text-xs font-bold text-brand-muted uppercase tracking-widest px-2">
            <span>Tasks</span>
            <span>Status</span>
          </div>
          <div className="flex flex-col gap-3">
            {sortedItems.map((item) => (
              <ServiceItemCard
                key={item.id}
                item={item}
                onStatusChange={(status) => handleUpdateStatus(item, status)}
              />
            ))}
            {sortedItems.length === 0 && (
              <p className="text-brand-muted text-[10px] uppercase font-bold tracking-widest text-center py-8 glass-panel border border-brand-border/50" data-testid="text-no-service">
                Bike is in perfect condition!
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceItemCard({
  item,
  onStatusChange,
}: {
  item: ServiceItem;
  onStatusChange: (status: string) => void;
}) {
  const isDone = item.status === "Done";

  return (
    <div
      className={cn(
        "p-4 rounded-xl border transition-all duration-300 relative overflow-hidden",
        isDone
          ? "bg-brand-bg opacity-70 border-brand-border"
          : item.status === "In Progress"
            ? "glass-panel border-brand-primary/50 shadow-[0_0_15px_rgba(65,209,255,0.1)]"
            : "glass-panel border-brand-border/50"
      )}
      data-testid={`card-service-${item.id}`}
    >
      {item.status === "In Progress" && (
        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-primary opacity-10 blur-2xl rounded-full pointer-events-none" />
      )}
      <div className="flex justify-between items-start relative z-10">
        <div className="flex-1">
          <h3
            className={cn(
              "text-lg font-bold leading-tight mb-1",
              isDone && "line-through text-brand-muted"
            )}
          >
            {item.item}
          </h3>
          {(item.shop || item.cost != null) && (
            <div className="flex gap-3 text-[10px] uppercase font-bold tracking-widest text-brand-muted mb-2 flex-wrap">
              {item.shop && (
                <span className="flex items-center">
                  <Settings size={12} className="mr-1 text-brand-primary" />{" "}
                  {item.shop}
                </span>
              )}
              {item.cost != null && (
                <span className="flex items-center">
                  <Tag size={12} className="mr-1 text-brand-secondary" /> $
                  {item.cost}
                </span>
              )}
            </div>
          )}
          {item.dueDate && (
            <div className="text-[10px] uppercase tracking-widest font-bold text-brand-muted mb-2">
              <span className="inline-flex items-center gap-1">
                <CalendarDays size={12} className="text-brand-primary" /> Due {item.dueDate}
              </span>
            </div>
          )}
          {item.notes && (
            <p className="text-sm text-brand-muted italic">
              &ldquo;{item.notes}&rdquo;
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 ml-4">
          <button
            onClick={() =>
              onStatusChange(isDone ? "Planned" : "Done")
            }
            className={cn(
              "flex items-center justify-center p-2 rounded-full transition-all",
              isDone
                ? "bg-brand-success/20 text-brand-success"
                : "bg-brand-panel-2 text-brand-muted"
            )}
            data-testid={`button-done-${item.id}`}
          >
            {isDone ? <CheckCircle2 size={20} /> : <Circle size={20} />}
          </button>
          {!isDone && (
            <button
              onClick={() =>
                onStatusChange(
                  item.status === "In Progress" ? "Planned" : "In Progress"
                )
              }
              className={cn(
                "flex items-center justify-center p-2 rounded-full transition-all",
                item.status === "In Progress"
                  ? "bg-brand-primary/20 text-brand-primary"
                  : "bg-brand-panel-2 text-brand-muted"
              )}
              data-testid={`button-progress-${item.id}`}
            >
              <Clock size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AddServiceForm({
  onAdd,
  onCancel,
}: {
  onAdd: (item: {
    item: string;
    shop?: string;
    cost?: number;
    notes?: string;
    dueDate?: string;
  }) => void;
  onCancel: () => void;
}) {
  const [item, setItem] = useState("");
  const [shop, setShop] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [dueDate, setDueDate] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!item.trim()) return;
    onAdd({
      item: item.trim(),
      shop: shop.trim() || undefined,
      cost: cost ? parseFloat(cost) : undefined,
      notes: notes.trim() || undefined,
      dueDate: dueDate || undefined,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-panel p-5 border-brand-warning/30 shadow-[0_0_20px_rgba(255,168,0,0.1)] mb-6 relative overflow-hidden"
      data-testid="form-add-service"
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-secondary opacity-15 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />
      <h3 className="text-lg font-bold mb-4 relative z-10 text-brand-text">
        Add Maintenance Task
      </h3>
      <div className="space-y-4 relative z-10">
        <div>
          <label className="text-xs text-brand-muted font-medium block mb-1">
            Task Name
          </label>
          <input
            type="text"
            required
            value={item}
            onChange={(e) => setItem(e.target.value)}
            className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-brand-primary outline-none"
            placeholder="e.g. Replace seal kit"
            data-testid="input-service-name"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-brand-muted font-medium block mb-1">
              Shop / Mechanic
            </label>
            <input
              type="text"
              value={shop}
              onChange={(e) => setShop(e.target.value)}
              className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-brand-primary outline-none"
              placeholder="e.g. LBS"
              data-testid="input-service-shop"
            />
          </div>
          <div>
            <label className="text-xs text-brand-muted font-medium block mb-1">
              Estimated Cost ($)
            </label>
            <input
              type="number"
              step="1"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-brand-primary outline-none"
              data-testid="input-service-cost"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-brand-muted font-medium block mb-1">
            Due Date
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-brand-primary outline-none"
            data-testid="input-service-due-date"
          />
        </div>
        <div>
          <label className="text-xs text-brand-muted font-medium block mb-1">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm min-h-[60px] resize-none focus:ring-1 focus:ring-brand-primary outline-none"
            placeholder="Parts are ordered..."
            data-testid="input-service-notes"
          />
        </div>
        <div className="flex gap-3 pt-3 text-[10px] tracking-widest uppercase font-bold">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 bg-brand-bg border border-brand-border/60 text-brand-text rounded-lg transition-colors"
            data-testid="button-cancel-service"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 py-3 bg-gradient-secondary border border-brand-warning/50 text-brand-bg rounded-lg transition-all shadow-[0_0_15px_rgba(255,168,0,0.4)] flex items-center justify-center gap-2"
            data-testid="button-save-service"
          >
            Add Task
          </button>
        </div>
      </div>
    </form>
  );
}
