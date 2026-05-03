import { Wifi, WifiOff } from "lucide-react";
import { useOfflineSync } from "@/hooks/use-offline-sync";

export function OfflineIndicator() {
  const { isOnline, lastSyncedAt } = useOfflineSync();

  const syncText = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "--";

  return (
    <div
      className="rounded-full border border-brand-border/50 bg-brand-bg/50 px-2.5 py-1 text-[10px] uppercase tracking-widest text-brand-muted flex items-center gap-1.5"
      title={lastSyncedAt ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}` : "Not synced yet"}
      data-testid="offline-indicator"
    >
      {isOnline ? <Wifi size={12} className="text-brand-success" /> : <WifiOff size={12} className="text-brand-warning" />}
      <span>{isOnline ? "Online" : "Offline"}</span>
      <span className="text-brand-muted/70">|</span>
      <span>{syncText}</span>
    </div>
  );
}
