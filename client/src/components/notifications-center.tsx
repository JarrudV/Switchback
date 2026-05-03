import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellRing, CheckCheck, Trash2 } from "lucide-react";
import type { InAppNotification } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function NotificationsCenter() {
  const { toast } = useToast();
  const { data: notifications = [] } = useQuery<InAppNotification[]>({
    queryKey: ["/api/notifications"],
  });

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.readAt).length,
    [notifications],
  );

  const markAllRead = async () => {
    try {
      await apiRequest("POST", "/api/notifications/read", { all: true });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    } catch {
      toast({ title: "Failed to mark notifications read", variant: "destructive" });
    }
  };

  const clearAll = async () => {
    try {
      await apiRequest("POST", "/api/notifications/clear", {});
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    } catch {
      toast({ title: "Failed to clear notifications", variant: "destructive" });
    }
  };

  const markOneRead = async (id: string) => {
    try {
      await apiRequest("POST", "/api/notifications/read", { id });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    } catch {
      toast({ title: "Failed to mark notification read", variant: "destructive" });
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className="relative p-2 rounded-full bg-brand-panel-2 border border-brand-border text-brand-text hover:bg-brand-panel transition-colors"
          title="Notifications"
          data-testid="button-open-notifications"
        >
          {unreadCount > 0 ? <BellRing size={16} /> : <Bell size={16} />}
          {unreadCount > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full bg-brand-danger text-[10px] font-bold text-white px-1 flex items-center justify-center"
              data-testid="text-unread-count"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg bg-brand-bg border border-brand-border text-brand-text max-h-[85vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-brand-text">Notifications</DialogTitle>
          <DialogDescription className="text-brand-muted">
            In-app reminders shown when push delivery is unavailable.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end gap-2 -mt-1">
          <button
            onClick={markAllRead}
            className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-md border border-brand-border bg-brand-panel-2 text-brand-text"
            data-testid="button-mark-all-read"
          >
            <span className="inline-flex items-center gap-1">
              <CheckCheck size={12} /> Mark all read
            </span>
          </button>
          <button
            onClick={clearAll}
            className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-md border border-brand-border bg-brand-panel-2 text-brand-text"
            data-testid="button-clear-notifications"
          >
            <span className="inline-flex items-center gap-1">
              <Trash2 size={12} /> Clear
            </span>
          </button>
        </div>

        <div className="overflow-y-auto max-h-[60vh] pr-1 space-y-2">
          {notifications.length === 0 ? (
            <div className="text-center text-brand-muted text-sm py-8 border border-brand-border/50 rounded-lg">
              No notifications yet.
            </div>
          ) : (
            notifications.map((item) => (
              <div
                key={item.id}
                className="glass-panel p-3 border-brand-border/60"
                data-testid={`notification-${item.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-brand-text">{item.title}</h4>
                    <p className="text-xs text-brand-muted mt-1">{item.body}</p>
                    <p className="text-[10px] uppercase tracking-widest text-brand-muted mt-2">
                      {new Date(item.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {!item.readAt ? (
                    <button
                      onClick={() => markOneRead(item.id)}
                      className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-md border border-brand-border bg-brand-panel-2 text-brand-text"
                      data-testid={`button-read-${item.id}`}
                    >
                      Read
                    </button>
                  ) : (
                    <span className="text-[10px] uppercase tracking-widest text-brand-success font-bold">
                      Read
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
