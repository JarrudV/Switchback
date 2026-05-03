import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    RefreshCw,
    Bike,
    Clock,
    Mountain,
    Heart,
    Zap,
    AlertCircle,
    ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { StravaActivity } from "@shared/schema";

export function StravaDashboard() {
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
        return (
            <div className="flex flex-col items-center justify-center p-8 text-center min-h-[50vh]">
                <AlertCircle size={32} className="text-brand-muted mb-4" />
                <h2 className="text-xl font-bold mb-2">Strava Not Configured</h2>
                <p className="text-brand-muted text-sm max-w-xs">
                    The server is missing Strava API credentials in its environment variables.
                </p>
            </div>
        );
    }

    const showConnectButton = needsAuth || (!status.hasActivityScope && activities.length === 0);

    if (showConnectButton) {
        return (
            <div className="p-4" data-testid="strava-dashboard">
                <div className="glass-panel p-6 flex flex-col items-center text-center">
                    <div className="w-16 h-16 rounded-2xl bg-[#FC4C02]/10 flex items-center justify-center mb-4">
                        <Bike size={32} className="text-[#FC4C02]" />
                    </div>
                    <h2 className="text-xl font-bold text-brand-text mb-2 tracking-tight">
                        Connect Your Strava
                    </h2>
                    <p className="text-sm text-brand-muted mb-8 leading-relaxed max-w-sm">
                        Sync your rides automatically. We'll pull your distance, time, elevation, heart rate, and power data to give you better training insights.
                    </p>
                    <button
                        onClick={handleConnect}
                        className="w-full max-w-xs py-4 bg-[#FC4C02] text-white font-bold text-sm uppercase tracking-widest rounded-xl flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(252,76,2,0.4)] hover:bg-[#FC4C02]/90 transition-colors"
                        data-testid="button-strava-connect-large"
                    >
                        <ExternalLink size={18} />
                        Authorize with Strava
                    </button>
                </div>
            </div>
        );
    }

    const sorted = [...activities].sort(
        (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    );

    const totalDistance = activities.reduce((sum, a) => sum + (a.distance || 0), 0);
    const totalTime = activities.reduce((sum, a) => sum + (a.movingTime || 0), 0);
    const totalElev = activities.reduce((sum, a) => sum + (a.totalElevationGain || 0), 0);

    return (
        <div className="p-4 space-y-4" data-testid="strava-dashboard">
            <div className="glass-panel p-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#FC4C02]/10 blur-3xl rounded-full -mr-10 -mt-10 pointer-events-none" />

                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#FC4C02]/20 flex items-center justify-center shadow-inner">
                            <Bike size={20} className="text-[#FC4C02]" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-brand-text tracking-tight">Strava History</h1>
                            {status?.lastSync && (
                                <p className="text-[10px] text-brand-muted font-mono uppercase tracking-wider">
                                    Last synced: {new Date(status.lastSync).toLocaleString()}
                                </p>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={handleSync}
                        disabled={isSyncing}
                        className={cn(
                            "flex items-center gap-2 text-xs font-bold uppercase tracking-widest px-4 py-2.5 rounded-xl transition-all shadow-sm",
                            isSyncing
                                ? "text-brand-muted bg-brand-panel-2 cursor-wait"
                                : "text-white bg-[#FC4C02] hover:bg-[#E34402] shadow-[0_0_15px_rgba(252,76,2,0.3)]"
                        )}
                        data-testid="button-strava-sync-large"
                    >
                        <RefreshCw size={14} className={cn(isSyncing && "animate-spin")} />
                        {isSyncing ? "Syncing..." : "Sync Now"}
                    </button>
                </div>

                {activities.length > 0 && (
                    <div className="grid grid-cols-3 gap-3">
                        <div className="glass-panel bg-brand-bg/50 border-brand-border/30 rounded-xl p-3 text-center transition-transform hover:scale-[1.02]">
                            <div className="text-lg font-black text-brand-text mb-0.5 tracking-tight">
                                {(totalDistance / 1000).toFixed(0)} <span className="text-xs text-brand-muted font-normal">km</span>
                            </div>
                            <div className="text-[9px] text-brand-primary font-bold uppercase tracking-widest flex justify-center items-center gap-1"><Bike size={10} /> Distance</div>
                        </div>
                        <div className="glass-panel bg-brand-bg/50 border-brand-border/30 rounded-xl p-3 text-center transition-transform hover:scale-[1.02]">
                            <div className="text-lg font-black text-brand-text mb-0.5 tracking-tight">
                                {Math.floor(totalTime / 3600)}<span className="text-xs text-brand-muted font-normal">h</span> {Math.floor((totalTime % 3600) / 60)}<span className="text-xs text-brand-muted font-normal">m</span>
                            </div>
                            <div className="text-[9px] text-[#FC4C02] font-bold uppercase tracking-widest flex justify-center items-center gap-1"><Clock size={10} /> Duration</div>
                        </div>
                        <div className="glass-panel bg-brand-bg/50 border-brand-border/30 rounded-xl p-3 text-center transition-transform hover:scale-[1.02]">
                            <div className="text-lg font-black text-brand-text mb-0.5 tracking-tight">
                                {totalElev.toFixed(0)} <span className="text-xs text-brand-muted font-normal">m</span>
                            </div>
                            <div className="text-[9px] text-brand-secondary font-bold uppercase tracking-widest flex justify-center items-center gap-1"><Mountain size={10} /> Climbing</div>
                        </div>
                    </div>
                )}
            </div>

            <div className="space-y-3 pb-safe">
                <h3 className="text-xs font-bold text-brand-muted uppercase tracking-widest px-1 mt-6 mb-2">
                    All Synced Rides ({activities.length})
                </h3>

                {isLoading && (
                    <div className="text-center py-8 text-brand-muted text-sm font-mono animate-pulse">
                        Loading your ride history...
                    </div>
                )}

                {!isLoading && activities.length === 0 && (
                    <div className="glass-panel p-8 text-center rounded-2xl border-dashed">
                        <AlertCircle size={24} className="mx-auto text-brand-muted mb-3 opacity-50" />
                        <p className="text-sm text-brand-text font-medium mb-1">No rides found</p>
                        <p className="text-xs text-brand-muted max-w-[200px] mx-auto">
                            Tap the Sync button above to pull your latest activities from Strava.
                        </p>
                    </div>
                )}

                {sorted.map((ride) => (
                    <RideCard key={ride.id} ride={ride} />
                ))}
            </div>
        </div>
    );
}

function RideCard({ ride }: { ride: StravaActivity }) {
    const date = new Date(ride.startDate);
    const dateStr = date.toLocaleDateString("en-AU", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric"
    });
    const distKm = (ride.distance / 1000).toFixed(1);
    const hours = Math.floor(ride.movingTime / 3600);
    const mins = Math.floor((ride.movingTime % 3600) / 60);
    const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    const avgSpeed = ride.averageSpeed ? (ride.averageSpeed * 3.6).toFixed(1) : null;

    return (
        <a
            href={`https://www.strava.com/activities/${ride.stravaId}`}
            target="_blank"
            rel="noreferrer"
            className="block glass-panel rounded-xl p-4 border border-brand-border/40 hover:border-[#FC4C02]/50 hover:shadow-[0_4px_20px_rgba(252,76,2,0.1)] transition-all group"
            data-testid={`card-ride-${ride.id}`}
        >
            <div className="flex justify-between items-start mb-3">
                <div className="flex-1 min-w-0 mr-3">
                    <h4 className="text-base font-bold text-brand-text truncate group-hover:text-[#FC4C02] transition-colors">
                        {ride.name}
                    </h4>
                    <span className="text-[11px] text-brand-muted font-mono">{dateStr}</span>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                    <span className="text-[9px] uppercase font-black tracking-widest text-[#FC4C02]/90 bg-[#FC4C02]/15 px-2 py-1 rounded-md flex-shrink-0 border border-[#FC4C02]/20">
                        {ride.sportType || ride.type}
                    </span>
                    <ExternalLink size={14} className="text-brand-muted/50 group-hover:text-[#FC4C02] transition-colors" />
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-brand-bg/50 rounded-lg p-2.5 flex items-center gap-2">
                    <div className="bg-brand-primary/10 p-1.5 rounded-md"><Bike size={14} className="text-brand-primary" /></div>
                    <div>
                        <div className="text-sm font-bold text-brand-text">{distKm}<span className="text-[10px] text-brand-muted font-normal ml-0.5">km</span></div>
                    </div>
                </div>
                <div className="bg-brand-bg/50 rounded-lg p-2.5 flex items-center gap-2">
                    <div className="bg-[#FC4C02]/10 p-1.5 rounded-md"><Clock size={14} className="text-[#FC4C02]" /></div>
                    <div>
                        <div className="text-sm font-bold text-brand-text">{timeStr}</div>
                    </div>
                </div>
                {ride.totalElevationGain ? (
                    <div className="bg-brand-bg/50 rounded-lg p-2.5 flex items-center gap-2">
                        <div className="bg-brand-secondary/10 p-1.5 rounded-md"><Mountain size={14} className="text-brand-secondary" /></div>
                        <div>
                            <div className="text-sm font-bold text-brand-text">{ride.totalElevationGain.toFixed(0)}<span className="text-[10px] text-brand-muted font-normal ml-0.5">m</span></div>
                        </div>
                    </div>
                ) : null}
                {avgSpeed && (
                    <div className="bg-brand-bg/50 rounded-lg p-2.5 flex items-center gap-2">
                        <div className="bg-yellow-400/10 p-1.5 rounded-md"><Zap size={14} className="text-yellow-400" /></div>
                        <div>
                            <div className="text-sm font-bold text-brand-text">{avgSpeed}<span className="text-[10px] text-brand-muted font-normal ml-0.5">km/h</span></div>
                        </div>
                    </div>
                )}
            </div>
        </a>
    );
}
