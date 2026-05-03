import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CircleHelp, CreditCard, LogOut, Settings, Sparkles, UserRound } from "lucide-react";

type SubscriptionTier = "free" | "pro";
type BillingCycle = "monthly" | "annual";

interface AccountCenterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  email: string;
  profileImageUrl?: string | null;
  subscriptionTier: SubscriptionTier;
  billingCycle: BillingCycle;
  isSavingPlan?: boolean;
  onSelectPlan: (tier: SubscriptionTier, cycle: BillingCycle) => void;
  onOpenSettings: () => void;
  onOpenGuide: () => void;
  onLogout: () => void;
}

export function AccountCenterModal({
  open,
  onOpenChange,
  name,
  email,
  profileImageUrl,
  subscriptionTier,
  billingCycle,
  isSavingPlan = false,
  onSelectPlan,
  onOpenSettings,
  onOpenGuide,
  onLogout,
}: AccountCenterModalProps) {
  const isPro = subscriptionTier === "pro";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-brand-bg border border-brand-border text-brand-text max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-brand-text">Account</DialogTitle>
          <DialogDescription className="text-brand-muted">
            Manage your profile, plan, help, and app actions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="glass-panel p-4 flex items-center gap-3">
            <div className="w-12 h-12 rounded-full overflow-hidden border border-brand-border bg-brand-panel-2 flex items-center justify-center">
              {profileImageUrl ? (
                <img src={profileImageUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <UserRound size={20} className="text-brand-muted" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{name}</p>
              <p className="text-xs text-brand-muted truncate">{email}</p>
            </div>
            <span
              className={cn(
                "ml-auto px-2 py-1 rounded-full text-[10px] uppercase tracking-widest font-bold border",
                isPro
                  ? "bg-brand-success/20 border-brand-success/30 text-brand-success"
                  : "bg-brand-panel-2 border-brand-border text-brand-muted",
              )}
            >
              {isPro ? "Pro" : "Free"}
            </span>
          </div>

          <div className="glass-panel p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CreditCard size={15} className="text-brand-primary" />
              <p className="text-xs font-bold uppercase tracking-widest text-brand-muted">
                Subscription
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isSavingPlan}
                onClick={() => onSelectPlan("free", billingCycle)}
                className={cn(
                  "rounded-lg border p-3 text-left",
                  subscriptionTier === "free"
                    ? "border-brand-primary bg-brand-panel-2"
                    : "border-brand-border bg-brand-bg",
                )}
                data-testid="button-plan-free"
              >
                <p className="text-xs font-bold uppercase tracking-widest">Free</p>
                <p className="text-[11px] text-brand-muted mt-1">Core plan, manual flow, no AI coach.</p>
              </button>
              <button
                type="button"
                disabled={isSavingPlan}
                onClick={() => onSelectPlan("pro", billingCycle)}
                className={cn(
                  "rounded-lg border p-3 text-left",
                  subscriptionTier === "pro"
                    ? "border-brand-primary bg-brand-panel-2"
                    : "border-brand-border bg-brand-bg",
                )}
                data-testid="button-plan-pro"
              >
                <p className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5">
                  Pro <Sparkles size={12} className="text-brand-warning" />
                </p>
                <p className="text-[11px] text-brand-muted mt-1">AI coach + deeper sync insights.</p>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isSavingPlan}
                onClick={() => onSelectPlan(subscriptionTier, "monthly")}
                className={cn(
                  "rounded-lg border py-2 text-[10px] uppercase tracking-widest font-bold",
                  billingCycle === "monthly"
                    ? "border-brand-primary bg-brand-panel-2 text-brand-text"
                    : "border-brand-border text-brand-muted",
                )}
                data-testid="button-billing-monthly"
              >
                Monthly
              </button>
              <button
                type="button"
                disabled={isSavingPlan}
                onClick={() => onSelectPlan(subscriptionTier, "annual")}
                className={cn(
                  "rounded-lg border py-2 text-[10px] uppercase tracking-widest font-bold",
                  billingCycle === "annual"
                    ? "border-brand-primary bg-brand-panel-2 text-brand-text"
                    : "border-brand-border text-brand-muted",
                )}
                data-testid="button-billing-annual"
              >
                Annual
              </button>
            </div>

            <p className="text-[11px] text-brand-muted">
              Current app behavior: this stores your plan preference and feature tier. Full payment checkout can be connected next.
            </p>

            <div className="grid grid-cols-2 gap-3 text-[11px]">
              <div className="rounded-lg border border-brand-border/60 p-2.5">
                <p className="text-[10px] uppercase tracking-widest font-bold text-brand-muted mb-1">Free limits</p>
                <p className="text-brand-muted">No AI coach and fewer premium sync insights.</p>
              </div>
              <div className="rounded-lg border border-brand-border/60 p-2.5">
                <p className="text-[10px] uppercase tracking-widest font-bold text-brand-muted mb-1">Pro unlocks</p>
                <p className="text-brand-muted">AI coaching, advanced analysis, and premium features.</p>
              </div>
            </div>
          </div>

          <div className="glass-panel p-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-muted">App Actions</p>
            <button
              type="button"
              onClick={onOpenSettings}
              className="w-full rounded-lg border border-brand-border bg-brand-panel-2 px-3 py-2 text-left text-sm flex items-center gap-2"
              data-testid="button-account-open-settings"
            >
              <Settings size={15} /> Settings
            </button>
            <button
              type="button"
              onClick={onOpenGuide}
              className="w-full rounded-lg border border-brand-border bg-brand-panel-2 px-3 py-2 text-left text-sm flex items-center gap-2"
              data-testid="button-account-open-guide"
            >
              <CircleHelp size={15} /> Help and onboarding
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="w-full rounded-lg border border-brand-danger/40 bg-brand-danger/10 px-3 py-2 text-left text-sm text-brand-danger font-semibold flex items-center gap-2"
              data-testid="button-logout"
            >
              <LogOut size={15} /> Logout / change account
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
