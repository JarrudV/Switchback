import { useState, useEffect } from "react";
import type { GoalEvent } from "@shared/schema";
import {
  Settings,
  ExternalLink,
  Mountain,
  MapPin,
  Map,
  Check,
  Flame,
  BatteryCharging,
  DownloadCloud,
  Route,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Props {
  goal?: GoalEvent;
}

export function EventTracker({ goal }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const { toast } = useToast();

  const [name, setName] = useState(goal?.name || "");
  const [date, setDate] = useState(goal?.startDate || "");
  const [distance, setDistance] = useState(
    goal?.distanceKm?.toString() || ""
  );
  const [elevation, setElevation] = useState(
    goal?.elevationMeters?.toString() || ""
  );
  const [location, setLocation] = useState(goal?.location || "");
  const [link, setLink] = useState(goal?.link || "");
  const [gpxUrl, setGpxUrl] = useState(goal?.gpxUrl || "");
  const [scrapeUrl, setScrapeUrl] = useState("");

  useEffect(() => {
    if (goal) {
      setName(goal.name);
      setDate(goal.startDate);
      setDistance(goal.distanceKm?.toString() || "");
      setElevation(goal.elevationMeters?.toString() || "");
      setLocation(goal.location || "");
      setLink(goal.link || "");
      setGpxUrl(goal.gpxUrl || "");
    }
  }, [goal]);

  const [timeLeft, setTimeLeft] = useState(() =>
    calculateTimeLeft(goal?.startDate)
  );

  const { days, hours, mins } = timeLeft;

  let smartLabel = null;
  let SmartIcon: typeof Flame | null = null;
  const peakWeekStarts = days - 14;
  const taperBegins = days - 7;

  if (days > 14) {
    smartLabel = `Peak Week Starts In: ${peakWeekStarts} Days`;
    SmartIcon = Flame;
  } else if (days > 7 && days <= 14) {
    smartLabel = `Taper Begins In: ${taperBegins} Days`;
    SmartIcon = BatteryCharging;
  } else if (days > 0 && days <= 7) {
    smartLabel = "Race Week! Tapering...";
    SmartIcon = BatteryCharging;
  } else if (days === 0 && (hours > 0 || mins > 0)) {
    smartLabel = "Race Day!";
    SmartIcon = Flame;
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft(goal?.startDate));
    }, 60000);
    return () => clearInterval(timer);
  }, [goal?.startDate]);

  const [isScraping, setIsScraping] = useState(false);

  const handleScrape = async () => {
    if (!scrapeUrl) return;
    setIsScraping(true);
    try {
      const res = await apiRequest("POST", `/api/scrape-event`, { url: scrapeUrl });
      const data = await res.json();

      if (data.title) setName(data.title);
      if (data.distanceKm) setDistance(data.distanceKm.toString());
      if (data.elevationMeters) setElevation(data.elevationMeters.toString());
      if (data.date) setDate(data.date);

      if (!link) setLink(scrapeUrl);

      toast({ title: "Event details imported successfully!" });
    } catch {
      toast({ title: "Failed to scrape URL", variant: "destructive" });
    } finally {
      setIsScraping(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const goalData = {
        id: goal?.id || `evt-${Date.now()}`,
        name,
        startDate: date,
        distanceKm: distance ? parseFloat(distance) : null,
        elevationMeters: elevation ? parseInt(elevation, 10) : null,
        location: location || null,
        link: link || null,
        gpxUrl: gpxUrl || null,
        notes: goal?.notes || null,
        createdAt: goal?.createdAt || new Date().toISOString(),
      };

      if (goal) {
        await apiRequest("PUT", `/api/goal`, goalData);
      } else {
        await apiRequest("POST", `/api/goal`, goalData);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/goal"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      setIsEditing(false);
      toast({ title: "Goal event saved" });
    } catch {
      toast({ title: "Failed to save goal", variant: "destructive" });
    }
  };

  return (
    <div className="p-4 space-y-6" data-testid="event-tracker-view">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-2xl font-bold text-brand-text" data-testid="text-event-title">Goal Event</h2>
        <button
          onClick={() => setIsEditing(!isEditing)}
          className={cn(
            "p-2 rounded-full transition-all",
            isEditing
              ? "bg-brand-panel-2 text-brand-text"
              : "bg-gradient-primary text-brand-bg shadow-[0_0_10px_rgba(65,209,255,0.4)]"
          )}
          data-testid="button-toggle-edit-event"
        >
          <Settings size={20} />
        </button>
      </div>

      {!isEditing && goal && (
        <>
          <div className="glass-panel relative overflow-hidden p-6 mb-8 mt-4 border border-brand-primary/30 shadow-[0_0_20px_rgba(65,209,255,0.1)]">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-primary opacity-20 blur-3xl rounded-full -mr-10 -mt-10 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-40 h-40 bg-gradient-secondary opacity-10 blur-3xl rounded-full -ml-10 -mb-10 pointer-events-none" />

            <h3
              className="text-2xl font-bold text-center tracking-tight text-white mb-2"
              data-testid="text-goal-name"
            >
              {goal.name}
            </h3>
            {goal.location && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(goal.location)}`}
                target="_blank"
                rel="noreferrer"
                className="text-center text-brand-primary font-medium text-sm mb-6 flex items-center justify-center gap-1 hover:underline decoration-brand-primary underline-offset-4"
              >
                <MapPin size={14} /> {goal.location}
              </a>
            )}

            <div className="flex justify-center gap-3 mt-4">
              <CountdownBox value={days} label="Days" />
              <div className="text-2xl font-bold text-brand-muted self-center mb-5">
                :
              </div>
              <CountdownBox value={hours} label="Hours" />
              <div className="text-2xl font-bold text-brand-muted self-center mb-5">
                :
              </div>
              <CountdownBox value={mins} label="Mins" />
            </div>

            <p className="text-center text-brand-muted text-[10px] mt-6 font-mono tracking-widest uppercase mb-4">
              {new Date(goal.startDate).toLocaleDateString("en-US", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>

            {smartLabel && SmartIcon && (
              <div className="flex items-center justify-center gap-2 mt-2 py-2 px-4 rounded-full bg-brand-panel-2 border border-brand-border/50 text-xs font-bold font-mono text-brand-text shadow-inner w-max mx-auto">
                <SmartIcon
                  size={14}
                  className={
                    days > 14 ? "text-brand-warning" : "text-brand-success"
                  }
                />
                {smartLabel}
              </div>
            )}
          </div>

          <h4 className="text-xs font-bold text-brand-muted uppercase tracking-widest pl-1 mb-3">
            Event Intel
          </h4>
          <div className="grid grid-cols-2 gap-3 mb-6">
            <StatCard
              icon={<Map size={18} className="text-brand-primary" />}
              label="Distance"
              value={goal.distanceKm ? `${goal.distanceKm}km` : "TBD"}
            />
            <StatCard
              icon={<Mountain size={18} className="text-brand-secondary" />}
              label="Elevation"
              value={
                goal.elevationMeters ? `${goal.elevationMeters}m` : "TBD"
              }
            />
          </div>

          {goal.gpxUrl && (
            <a
              href={goal.gpxUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full py-4 mb-3 rounded-xl glass-panel text-brand-success font-bold uppercase tracking-wider border border-brand-border"
              data-testid="link-event-gpx"
            >
              GPS Route File{" "}
              <Route size={18} className="text-brand-success" />
            </a>
          )}

          {goal.link && (
            <a
              href={goal.link}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full py-4 rounded-xl glass-panel text-brand-text font-bold uppercase tracking-wider border border-brand-border"
              data-testid="link-event-website"
            >
              Event Website{" "}
              <ExternalLink size={18} className="text-brand-primary" />
            </a>
          )}
        </>
      )}

      {(!goal || isEditing) && (
        <form
          onSubmit={handleSave}
          className="glass-panel p-5 relative overflow-hidden shadow-[0_0_20px_rgba(189,52,254,0.1)]"
          data-testid="form-edit-event"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-primary opacity-20 blur-3xl rounded-full -mr-10 -mt-10 pointer-events-none" />
          <h3 className="text-lg font-bold mb-4 text-brand-text">
            Configure Target Event
          </h3>
          <div className="space-y-4">

            <div className="p-3 bg-brand-bg border border-brand-border/50 rounded-lg flex gap-2">
              <input
                type="url"
                value={scrapeUrl}
                onChange={(e) => setScrapeUrl(e.target.value)}
                className="flex-1 bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                placeholder="Auto-fill from URL..."
                data-testid="input-scrape-url"
              />
              <button
                type="button"
                onClick={handleScrape}
                disabled={!scrapeUrl || isScraping}
                className="bg-brand-panel-2 border border-brand-border text-brand-text px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-brand-primary/20 disabled:opacity-50 transition-all font-mono"
              >
                <DownloadCloud size={16} />
                {isScraping ? "..." : "Fetch"}
              </button>
            </div>

            <div>
              <label className="text-xs text-brand-muted font-medium block mb-1">
                Event Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                placeholder="e.g. GravDuro 2026"
                data-testid="input-event-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-brand-muted font-medium block mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                  data-testid="input-event-date"
                />
              </div>
              <div>
                <label className="text-xs text-brand-muted font-medium block mb-1">
                  Location
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                  placeholder="e.g. Grabouw"
                  data-testid="input-event-location"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-brand-muted font-medium block mb-1">
                  Distance (km)
                </label>
                <input
                  type="number"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                  className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                  placeholder="e.g. 86"
                  data-testid="input-event-distance"
                />
              </div>
              <div>
                <label className="text-xs text-brand-muted font-medium block mb-1">
                  Elevation (m)
                </label>
                <input
                  type="number"
                  value={elevation}
                  onChange={(e) => setElevation(e.target.value)}
                  className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                  placeholder="e.g. 1200"
                  data-testid="input-event-elevation"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-brand-muted font-medium block mb-1">
                Website Link
              </label>
              <input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                placeholder="https://..."
                data-testid="input-event-link"
              />
            </div>
            <div>
              <label className="text-xs text-brand-muted font-medium block mb-1">
                GPS Route File Link (Strava/Komoot/GPX)
              </label>
              <input
                type="url"
                value={gpxUrl}
                onChange={(e) => setGpxUrl(e.target.value)}
                className="w-full bg-brand-bg text-brand-text border border-brand-border rounded-lg px-3 py-2 text-sm focus:border-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                placeholder="https://strava.com/routes/..."
                data-testid="input-event-gpx-url"
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 mt-2 bg-gradient-primary rounded-xl font-bold text-brand-bg flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(65,209,255,0.3)]"
              data-testid="button-save-event"
            >
              <Check size={20} /> Save Target Event
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function CountdownBox({
  value,
  label,
}: {
  value: string | number;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center glass-panel w-20 h-24 border-brand-border/50 shadow-inner">
      <span className="text-3xl font-bold font-mono text-gradient-primary mb-1">
        {value}
      </span>
      <span className="text-[10px] uppercase font-bold tracking-widest text-brand-muted">
        {label}
      </span>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="glass-panel p-4 flex flex-col justify-center items-start border-brand-border/50">
      <div className="flex items-center gap-2 text-brand-muted mb-2">
        {icon}{" "}
        <span className="text-[10px] uppercase font-bold tracking-widest">
          {label}
        </span>
      </div>
      <span className="text-xl font-bold font-mono pl-1">{value}</span>
    </div>
  );
}

function calculateTimeLeft(targetDate?: string | null) {
  if (!targetDate) return { days: 0, hours: 0, mins: 0 };
  const difference = +new Date(targetDate) - +new Date();
  if (difference > 0) {
    return {
      days: Math.floor(difference / (1000 * 60 * 60 * 24)),
      hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
      mins: Math.floor((difference / 1000 / 60) % 60),
    };
  }
  return { days: 0, hours: 0, mins: 0 };
}
