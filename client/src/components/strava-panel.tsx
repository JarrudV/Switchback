import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw,
  Bike,
  Clock,
  Mountain,
  Heart,
  Zap,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { StravaActivity } from "@shared/schema";

export function StravaPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const { toast } = useToast();

  const { data: status } = useQuery<{ configured: boolean; lastSync: string | null; hasActivityScope: boolean }>({
    queryKey: ["/api/strava/status"],
  });

  const { data: activities = [], isLoading } = useQuery<StravaActivity[]>({
    queryKey: ["/api/strava/activities"],
    enabled: status?.configured === true,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stravaStatus = params.get("strava");
    if (stravaStatus === "connected") {
      toast({ title: "Strava connected! Tap Sync to pull your rides." });
      queryClient.invalidateQueries({ queryKey: ["/api/strava/status"] });
      window.history.replaceState({}, "", "/");
    } else if (stravaStatus === "denied") {
      toast({ title: "Strava authorization was denied", variant: "destructive" });
      window.history.replaceState({}, "", "/");
    } else if (stravaStatus === "error") {
      toast({ title: "Strava connection failed", variant: "destructive" });
      window.history.replaceState({}, "", "/");
    }
  }, []);

  const handleSync = async () => {
    setIsSyncing(true);
    setNeedsAuth(false);
    try {
      const res = await apiRequest("POST", "/api/strava/sync");
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/strava/activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strava/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/coach/context"] });
      queryClient.invalidateQueries({ queryKey: ["/api/insights/latest-ride"] });
      toast({
        title: `Synced ${data.synced} rides from Strava`,
        description: data.autoCompleted ? `${data.autoCompleted} sessions auto-completed` : undefined,
      });
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("401") || msg.includes("Authorization") || msg.includes("permission")) {
        setNeedsAuth(true);
      }
      toast({
        title: "Strava sync failed",
        description: msg.includes("permission") ? "Need to connect Strava with ride permissions" : "Check your credentials",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleConnect = async () => {
    try {
      const res = await apiRequest("GET", "/api/strava/auth-url");
      const data = await res.json();
      window.location.href = data.url;
    } catch {
      toast({ title: "Failed to generate auth URL", variant: "destructive" });
    }
  };

  if (!status?.configured) {
    return null;
  }

  const showConnectButton = needsAuth || (!status.hasActivityScope && activities.length === 0);

  if (showConnectButton) {
    return (
      <div className="glass-panel p-4 mb-4" data-testid="strava-panel">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-[#FC4C02]/20 flex items-center justify-center">
            <Bike size={16} className="text-[#FC4C02]" />
          </div>
          <h3 className="text-sm font-bold text-brand-text uppercase tracking-wider">
            Strava
          </h3>
        </div>
        <p className="text-xs text-brand-muted mb-3 leading-relaxed">
          Connect your Strava account to sync your training rides and see distance, time, elevation, heart rate and power data.
        </p>
        <button
          onClick={handleConnect}
          className="w-full py-3 bg-[#FC4C02] text-white font-bold text-xs uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(252,76,2,0.3)]"
          data-testid="button-strava-connect"
        >
          <ExternalLink size={14} />
          Connect Strava
        </button>
      </div>
    );
  }

  const sorted = [...activities].sort(
    (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
  );

  const recentRides = sorted.slice(0, isOpen ? 20 : 3);

  const totalDistance = activities.reduce((sum, a) => sum + (a.distance || 0), 0);
  const totalTime = activities.reduce((sum, a) => sum + (a.movingTime || 0), 0);
  const totalElev = activities.reduce((sum, a) => sum + (a.totalElevationGain || 0), 0);

  return (
    <div className="glass-panel p-4 mb-4" data-testid="strava-panel">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#FC4C02]/20 flex items-center justify-center">
            <Bike size={16} className="text-[#FC4C02]" />
          </div>
          <h3 className="text-sm font-bold text-brand-text uppercase tracking-wider">
            Strava Rides
          </h3>
          {activities.length > 0 && (
            <span className="text-[10px] font-mono text-brand-muted">
              ({activities.length})
            </span>
          )}
          {status?.lastSync && (
            <span className="text-[9px] text-brand-muted font-mono hidden sm:inline">
              - {new Date(status.lastSync).toLocaleDateString()}
            </span>
          )}
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className={cn(
            "flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg transition-all",
            isSyncing
              ? "text-brand-muted bg-brand-panel-2"
              : "text-[#FC4C02] bg-[#FC4C02]/10 hover:bg-[#FC4C02]/20 border border-[#FC4C02]/20"
          )}
          data-testid="button-strava-sync"
        >
          <RefreshCw size={12} className={cn(isSyncing && "animate-spin")} />
          {isSyncing ? "Syncing..." : "Sync"}
        </button>
      </div>

      {activities.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-brand-bg rounded-lg p-2 text-center">
            <div className="text-xs font-bold text-brand-text">
              {(totalDistance / 1000).toFixed(0)} km
            </div>
            <div className="text-[9px] text-brand-muted uppercase tracking-widest">Distance</div>
          </div>
          <div className="bg-brand-bg rounded-lg p-2 text-center">
            <div className="text-xs font-bold text-brand-text">
              {Math.floor(totalTime / 3600)}h {Math.floor((totalTime % 3600) / 60)}m
            </div>
            <div className="text-[9px] text-brand-muted uppercase tracking-widest">Time</div>
          </div>
          <div className="bg-brand-bg rounded-lg p-2 text-center">
            <div className="text-xs font-bold text-brand-text">
              {totalElev.toFixed(0)}m
            </div>
            <div className="text-[9px] text-brand-muted uppercase tracking-widest">Elevation</div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="text-center py-4 text-brand-muted text-xs">Loading rides...</div>
      )}

      {!isLoading && activities.length === 0 && (
        <div className="text-center py-4">
          <AlertCircle size={20} className="mx-auto text-brand-muted mb-2" />
          <p className="text-xs text-brand-muted">No rides synced yet. Tap Sync to pull from Strava.</p>
        </div>
      )}

      {recentRides.length > 0 && (
        <div className="space-y-2">
          {recentRides.map((ride) => (
            <RideCard key={ride.id} ride={ride} />
          ))}
        </div>
      )}

      {activities.length > 3 && (
        <button
          onClick={() => {
            const navBtn = document.querySelector('[data-testid="nav-strava"]') as HTMLButtonElement;
            if (navBtn) navBtn.click();
          }}
          className="w-full mt-2 py-2 text-[10px] font-bold uppercase tracking-widest text-brand-text hover:text-[#FC4C02] transition-colors flex items-center justify-center gap-1 bg-brand-bg rounded-lg border border-brand-border/50"
          data-testid="button-strava-view-full"
        >
          View Full Ride History <ExternalLink size={12} />
        </button>
      )}
    </div>
  );
}

function RideCard({ ride }: { ride: StravaActivity }) {
  const date = new Date(ride.startDate);
  const dateStr = date.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const distKm = (ride.distance / 1000).toFixed(1);
  const hours = Math.floor(ride.movingTime / 3600);
  const mins = Math.floor((ride.movingTime % 3600) / 60);
  const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const avgSpeed = ride.averageSpeed ? (ride.averageSpeed * 3.6).toFixed(1) : null;

  return (
    <div
      className="bg-brand-bg rounded-lg p-3 border border-brand-border/30 hover:border-brand-border/60 transition-colors"
      data-testid={`card-ride-${ride.id}`}
    >
      <div className="flex justify-between items-start mb-1.5">
        <div className="flex-1 min-w-0 mr-2">
          <h4 className="text-sm font-bold text-brand-text truncate">{ride.name}</h4>
          <span className="text-[10px] text-brand-muted font-mono">{dateStr}</span>
        </div>
        <span className="text-[9px] uppercase font-bold tracking-widest text-[#FC4C02]/80 bg-[#FC4C02]/10 px-1.5 py-0.5 rounded flex-shrink-0">
          {ride.sportType || ride.type}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-brand-muted">
        <span className="flex items-center gap-1">
          <Bike size={10} className="text-brand-primary" /> {distKm} km
        </span>
        <span className="flex items-center gap-1">
          <Clock size={10} className="text-brand-primary" /> {timeStr}
        </span>
        {ride.totalElevationGain ? (
          <span className="flex items-center gap-1">
            <Mountain size={10} className="text-brand-primary" /> {ride.totalElevationGain.toFixed(0)}m
          </span>
        ) : null}
        {avgSpeed && (
          <span className="flex items-center gap-1">
            <Zap size={10} className="text-brand-secondary" /> {avgSpeed} km/h
          </span>
        )}
        {ride.averageHeartrate ? (
          <span className="flex items-center gap-1">
            <Heart size={10} className="text-red-400" /> {Math.round(ride.averageHeartrate)} bpm
          </span>
        ) : null}
        {ride.averageWatts ? (
          <span className="flex items-center gap-1">
            <Zap size={10} className="text-yellow-400" /> {Math.round(ride.averageWatts)}w
          </span>
        ) : null}
      </div>
    </div>
  );
}

