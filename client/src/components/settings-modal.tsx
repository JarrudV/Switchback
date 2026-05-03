import { Palette, Moon, Sun, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { PushSettingsPanel } from "@/components/push-settings-panel";
import type { ThemeAccent, ThemeMode } from "@/lib/theme";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ThemeMode;
  accent: ThemeAccent;
  onModeChange: (mode: ThemeMode) => void;
  onAccentChange: (accent: ThemeAccent) => void;
}

const ACCENT_OPTIONS: Array<{ value: ThemeAccent; label: string }> = [
  { value: "peakready", label: "PeakReady" },
  { value: "neon", label: "Neon Green" },
  { value: "sunset", label: "Sunset Orange" },
];

export function SettingsModal({
  open,
  onOpenChange,
  mode,
  accent,
  onModeChange,
  onAccentChange,
}: SettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-brand-bg border border-brand-border text-brand-text max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-brand-text">Settings</DialogTitle>
          <DialogDescription className="text-brand-muted">
            Theme, reminders, and notification preferences.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="glass-panel p-4 space-y-3" data-testid="theme-settings-panel">
            <div className="flex items-center gap-2">
              <Palette size={16} className="text-brand-primary" />
              <h3 className="text-sm font-bold uppercase tracking-wider">Theme</h3>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onModeChange("light")}
                className={cn(
                  "text-xs font-bold uppercase tracking-widest py-2 rounded-lg border transition-colors",
                  mode === "light"
                    ? "bg-brand-panel-2 border-brand-primary text-brand-text"
                    : "bg-brand-bg border-brand-border text-brand-muted",
                )}
                data-testid="button-theme-light"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Sun size={12} /> Light
                </span>
              </button>
              <button
                onClick={() => onModeChange("dark")}
                className={cn(
                  "text-xs font-bold uppercase tracking-widest py-2 rounded-lg border transition-colors",
                  mode === "dark"
                    ? "bg-brand-panel-2 border-brand-primary text-brand-text"
                    : "bg-brand-bg border-brand-border text-brand-muted",
                )}
                data-testid="button-theme-dark"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Moon size={12} /> Dark
                </span>
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-brand-muted font-bold flex items-center gap-1.5">
                <Sparkles size={12} /> Accent
              </p>
              <div className="grid grid-cols-3 gap-2">
                {ACCENT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onAccentChange(option.value)}
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-widest py-2 rounded-lg border transition-colors",
                      accent === option.value
                        ? "bg-brand-panel-2 border-brand-primary text-brand-text"
                        : "bg-brand-bg border-brand-border text-brand-muted",
                    )}
                    data-testid={`button-accent-${option.value}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-brand-muted">
                PWA browser chrome color updates where the browser supports dynamic `theme-color`.
              </p>
            </div>
          </div>

          <PushSettingsPanel />
        </div>
      </DialogContent>
    </Dialog>
  );
}
