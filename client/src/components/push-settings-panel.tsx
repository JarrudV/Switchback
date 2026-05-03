import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellOff, Smartphone } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { isPushSupported, subscribeToPush, unsubscribeFromPush } from "@/lib/push";

type ReminderSettings = {
  timezone: string;
  longRideEveningBeforeEnabled: boolean;
  serviceDueDateEnabled: boolean;
  goalOneWeekCountdownEnabled: boolean;
};

type PushStatus = {
  configured: boolean;
  vapidPublicKey: string | null;
  subscribed: boolean;
  subscriptionCount: number;
};

export function PushSettingsPanel() {
  const { toast } = useToast();
  const pushSupported = useMemo(() => isPushSupported(), []);
  const [permission, setPermission] = useState<NotificationPermission>(
    pushSupported ? Notification.permission : "denied",
  );
  const [settings, setSettings] = useState<ReminderSettings>({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    longRideEveningBeforeEnabled: false,
    serviceDueDateEnabled: false,
    goalOneWeekCountdownEnabled: false,
  });

  const { data: pushStatus } = useQuery<PushStatus>({
    queryKey: ["/api/push/status"],
  });

  const { data: reminderSettings } = useQuery<ReminderSettings>({
    queryKey: ["/api/reminders/settings"],
  });

  useEffect(() => {
    if (!reminderSettings) return;
    setSettings(reminderSettings);
  }, [reminderSettings]);

  const saveSettings = async (next: ReminderSettings) => {
    try {
      setSettings(next);
      await apiRequest("POST", "/api/reminders/settings", next);
      queryClient.invalidateQueries({ queryKey: ["/api/reminders/settings"] });
    } catch {
      toast({ title: "Failed to save reminder settings", variant: "destructive" });
    }
  };

  const requestPermission = async () => {
    if (!pushSupported) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      toast({ title: "Notifications enabled" });
    } else {
      toast({ title: "Notifications blocked. In-app reminders will still appear." });
    }
  };

  const subscribe = async () => {
    try {
      if (!pushSupported || !pushStatus?.vapidPublicKey) {
        toast({ title: "Push is unavailable. Using in-app reminders only." });
        return;
      }
      const subscription = await subscribeToPush(pushStatus.vapidPublicKey);
      await apiRequest("POST", "/api/push/subscribe", subscription.toJSON());
      queryClient.invalidateQueries({ queryKey: ["/api/push/status"] });
      toast({ title: "Push subscription active" });
    } catch {
      toast({ title: "Failed to subscribe for push", variant: "destructive" });
    }
  };

  const unsubscribe = async () => {
    try {
      const endpoint = await unsubscribeFromPush();
      await apiRequest("POST", "/api/push/unsubscribe", { endpoint });
      queryClient.invalidateQueries({ queryKey: ["/api/push/status"] });
      toast({ title: "Push subscription removed" });
    } catch {
      toast({ title: "Failed to unsubscribe push", variant: "destructive" });
    }
  };

  return (
    <div className="glass-panel p-4 space-y-4" data-testid="push-settings-panel">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-brand-text uppercase tracking-wider">Reminders</h3>
          <p className="text-[10px] uppercase tracking-widest text-brand-muted">
            Push + in-app fallback
          </p>
        </div>
        {pushStatus?.subscribed ? (
          <Bell size={18} className="text-brand-success" />
        ) : (
          <BellOff size={18} className="text-brand-muted" />
        )}
      </div>

      <div className="space-y-2">
        <button
          onClick={requestPermission}
          className="w-full text-xs font-bold uppercase tracking-widest py-2 rounded-lg bg-brand-panel-2 border border-brand-border text-brand-text"
          data-testid="button-request-permission"
        >
          Notification Permission: {permission}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={subscribe}
            className="text-xs font-bold uppercase tracking-widest py-2 rounded-lg bg-gradient-primary text-brand-bg"
            data-testid="button-push-subscribe"
          >
            Subscribe
          </button>
          <button
            onClick={unsubscribe}
            className="text-xs font-bold uppercase tracking-widest py-2 rounded-lg bg-brand-panel-2 border border-brand-border text-brand-text"
            data-testid="button-push-unsubscribe"
          >
            Unsubscribe
          </button>
        </div>
        <p className="text-[10px] uppercase tracking-widest text-brand-muted flex items-center gap-1.5">
          <Smartphone size={12} />
          {pushSupported && pushStatus?.configured
            ? `Push ${pushStatus.subscribed ? "active" : "available"}`
            : "Push unavailable, in-app reminders only"}
        </p>
      </div>

      <div className="space-y-3 border-t border-brand-border/50 pt-3">
        <ReminderToggle
          label="Long ride reminder (evening before)"
          checked={settings.longRideEveningBeforeEnabled}
          onCheckedChange={(checked) =>
            saveSettings({
              ...settings,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || settings.timezone || "UTC",
              longRideEveningBeforeEnabled: checked,
            })
          }
        />
        <ReminderToggle
          label="Service due date reminder"
          checked={settings.serviceDueDateEnabled}
          onCheckedChange={(checked) =>
            saveSettings({
              ...settings,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || settings.timezone || "UTC",
              serviceDueDateEnabled: checked,
            })
          }
        />
        <ReminderToggle
          label="Goal event one-week reminder"
          checked={settings.goalOneWeekCountdownEnabled}
          onCheckedChange={(checked) =>
            saveSettings({
              ...settings,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || settings.timezone || "UTC",
              goalOneWeekCountdownEnabled: checked,
            })
          }
        />
      </div>
    </div>
  );
}

function ReminderToggle({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-brand-text">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
