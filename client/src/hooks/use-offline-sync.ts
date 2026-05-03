import { useEffect, useState } from "react";

const LAST_SYNC_KEY = "peakready:last-synced-at";

export function clearOfflineSyncStorage() {
  localStorage.removeItem(LAST_SYNC_KEY);
}

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => localStorage.getItem(LAST_SYNC_KEY));

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<{ type?: string; timestamp?: string }>) => {
      if (event.data?.type !== "SYNC_UPDATE" || !event.data.timestamp) {
        return;
      }
      setLastSyncedAt(event.data.timestamp);
      localStorage.setItem(LAST_SYNC_KEY, event.data.timestamp);
    };

    navigator.serviceWorker?.addEventListener("message", onMessage as EventListener);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", onMessage as EventListener);
    };
  }, []);

  return {
    isOnline,
    lastSyncedAt,
  };
}
