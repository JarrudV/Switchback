import { useState, useEffect, type ReactNode } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Home,
  CalendarDays,
  Activity,
  MessageSquare,
  Wrench,
  MountainSnow,
  User,
  Settings,
  Bike,
  Bell,
  MoreHorizontal,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { Dashboard } from "@/pages/dashboard";
import { TrainingPlan } from "@/pages/training-plan";
import { Metrics } from "@/pages/metrics";
import { ServiceTracker } from "@/pages/service-tracker";
import { EventTracker } from "@/pages/event-tracker";
import { StravaDashboard } from "@/pages/strava-dashboard";
import { CoachPage } from "@/pages/coach";
import { LoginPage } from "@/pages/login";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type { Session, Metric, ServiceItem, GoalEvent } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { NotificationsCenter } from "@/components/notifications-center";
import { SettingsModal } from "@/components/settings-modal";
import { NewRiderOnboarding } from "@/components/new-rider-onboarding";
import { AccountCenterModal } from "@/components/account-center-modal";
import { useToast } from "@/hooks/use-toast";
import { PlanManager } from "@/components/plan-manager";
import { AIPlanBuilder } from "@/components/ai-plan-builder";
import {
  applyTheme,
  isThemeAccent,
  isThemeMode,
  persistThemeLocally,
  readStoredTheme,
  type ThemeAccent,
  type ThemeMode,
} from "@/lib/theme";

type Tab =
  | "dashboard"
  | "plan"
  | "coach"
  | "metrics"
  | "service"
  | "events"
  | "strava"
  | "more";

function MainApp() {
  const { user, isLoading: authLoading, isAuthenticated, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [activeWeek, setActiveWeek] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [onboardingInitialized, setOnboardingInitialized] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredTheme().mode);
  const [themeAccent, setThemeAccent] = useState<ThemeAccent>(() => readStoredTheme().accent);
  const { toast } = useToast();

  const { data: savedWeek } = useQuery<{ value: string | null }>({
    queryKey: ["/api/settings", "activeWeek"],
    enabled: isAuthenticated,
  });
  const { data: savedThemeMode } = useQuery<{ value: string | null }>({
    queryKey: ["/api/settings", "themeMode"],
    enabled: isAuthenticated,
  });
  const { data: savedThemeAccent } = useQuery<{ value: string | null }>({
    queryKey: ["/api/settings", "themeAccent"],
    enabled: isAuthenticated,
  });
  const { data: onboardingSeenSetting } = useQuery<{ value: string | null }>({
    queryKey: ["/api/settings", "onboardingSeenV1"],
    enabled: isAuthenticated,
  });
  const { data: subscriptionTierSetting } = useQuery<{ value: string | null }>({
    queryKey: ["/api/settings", "subscriptionTier"],
    enabled: isAuthenticated,
  });
  const { data: subscriptionBillingSetting } = useQuery<{ value: string | null }>({
    queryKey: ["/api/settings", "subscriptionBillingCycle"],
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (savedWeek?.value) {
      const parsed = parseInt(savedWeek.value, 10);
      if (parsed >= 1) setActiveWeek(parsed);
    }
  }, [savedWeek]);

  useEffect(() => {
    if (isThemeMode(savedThemeMode?.value)) {
      setThemeMode(savedThemeMode.value);
    }
  }, [savedThemeMode?.value]);

  useEffect(() => {
    if (isThemeAccent(savedThemeAccent?.value)) {
      setThemeAccent(savedThemeAccent.value);
    }
  }, [savedThemeAccent?.value]);

  useEffect(() => {
    applyTheme(themeMode, themeAccent);
    persistThemeLocally(themeMode, themeAccent);
  }, [themeMode, themeAccent]);

  useEffect(() => {
    if (!isAuthenticated) {
      setOnboardingOpen(false);
      setOnboardingInitialized(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || onboardingInitialized) return;
    if (onboardingSeenSetting === undefined) return;

    const seen = onboardingSeenSetting?.value === "true";
    if (!seen) setOnboardingOpen(true);
    setOnboardingInitialized(true);
  }, [isAuthenticated, onboardingInitialized, onboardingSeenSetting]);

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<Session[]>({
    queryKey: ["/api/sessions"],
    enabled: isAuthenticated,
  });
  const maxWeek = sessions.length > 0 ? Math.max(...sessions.map((session) => session.week), 1) : 12;

  const { data: metrics = [], isLoading: metricsLoading } = useQuery<Metric[]>({
    queryKey: ["/api/metrics"],
    enabled: isAuthenticated,
  });

  const { data: serviceItems = [], isLoading: serviceLoading } = useQuery<ServiceItem[]>({
    queryKey: ["/api/service-items"],
    enabled: isAuthenticated,
  });

  const { data: goal, isLoading: goalLoading } = useQuery<GoalEvent | null>({
    queryKey: ["/api/goal"],
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (activeWeek > maxWeek) {
      setActiveWeek(maxWeek);
    }
  }, [activeWeek, maxWeek]);

  const handleWeekChange = async (week: number) => {
    const boundedWeek = Math.min(Math.max(week, 1), maxWeek);
    setActiveWeek(boundedWeek);
    try {
      await apiRequest("PUT", "/api/settings/activeWeek", { value: boundedWeek.toString() });
      await queryClient.invalidateQueries({ queryKey: ["/api/settings", "activeWeek"] });
    } catch {
      toast({ title: "Failed to switch week", variant: "destructive" });
    }
  };

  const handleThemeModeChange = async (mode: ThemeMode) => {
    setThemeMode(mode);
    try {
      await apiRequest("PUT", "/api/settings/themeMode", { value: mode });
    } catch {}
  };

  const handleThemeAccentChange = async (accent: ThemeAccent) => {
    setThemeAccent(accent);
    try {
      await apiRequest("PUT", "/api/settings/themeAccent", { value: accent });
    } catch {}
  };

  const handleCompleteOnboarding = async () => {
    setOnboardingSaving(true);
    try {
      await apiRequest("PUT", "/api/settings/onboardingSeenV1", {
        value: "true",
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/settings", "onboardingSeenV1"],
      });
      setOnboardingOpen(false);
    } catch {
      toast({
        title: "Failed to save onboarding status",
        variant: "destructive",
      });
    } finally {
      setOnboardingSaving(false);
    }
  };

  const subscriptionTier = subscriptionTierSetting?.value === "pro" ? "pro" : "free";
  const billingCycle = subscriptionBillingSetting?.value === "annual" ? "annual" : "monthly";
  const riderDisplayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "Rider";
  const isMoreActive =
    activeTab === "more" ||
    activeTab === "events" ||
    activeTab === "service" ||
    activeTab === "strava";
  const titleByTab: Record<Tab, string> = {
    dashboard: "Dash",
    plan: "Plan",
    coach: "Coach",
    metrics: "Stats",
    more: "More",
    events: "Events",
    service: "Bike",
    strava: "Strava",
  };
  const headerTitle = titleByTab[activeTab];

  const handleSelectPlan = async (tier: "free" | "pro", cycle: "monthly" | "annual") => {
    setPlanSaving(true);
    try {
      await Promise.all([
        apiRequest("PUT", "/api/settings/subscriptionTier", { value: tier }),
        apiRequest("PUT", "/api/settings/subscriptionBillingCycle", { value: cycle }),
      ]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/settings", "subscriptionTier"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/settings", "subscriptionBillingCycle"] }),
      ]);
      toast({
        title: tier === "pro" ? "Pro preference saved" : "Free plan selected",
        description: `Billing preference: ${cycle}.`,
      });
    } catch {
      toast({
        title: "Failed to save subscription preference",
        variant: "destructive",
      });
    } finally {
      setPlanSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gradient-primary animate-pulse" />
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight text-brand-text">Peak</span>
            <span className="text-xl font-bold text-gradient-primary">Ready</span>
          </div>
          <div className="text-brand-muted text-xs uppercase tracking-widest font-bold">Loading...</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const isLoading = sessionsLoading || metricsLoading || serviceLoading || goalLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gradient-primary animate-pulse" />
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight text-brand-text">Peak</span>
            <span className="text-xl font-bold text-gradient-primary">Ready</span>
          </div>
          <div className="text-brand-muted text-xs uppercase tracking-widest font-bold">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-brand-text font-sans overflow-x-hidden pb-[calc(env(safe-area-inset-bottom,0px)+6.75rem)]">
      <header className="pt-safe-top px-safe pb-1.5">
        <div className="mobile-shell flex items-center justify-between gap-3">
          <h1 className="text-base font-semibold tracking-tight text-brand-text">{headerTitle}</h1>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAccountOpen(true)}
              className="h-9 w-9 rounded-full border border-brand-border/45 bg-brand-panel-2/45 text-brand-muted flex items-center justify-center hover:text-brand-text"
              aria-label="Open profile and account"
              data-testid="button-open-account-header"
            >
              <User size={17} />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="h-9 w-9 rounded-full border border-brand-border/45 bg-brand-panel-2/45 text-brand-muted flex items-center justify-center hover:text-brand-text"
              aria-label="Open settings"
              data-testid="button-open-settings-header"
            >
              <Settings size={17} />
            </button>
          </div>
        </div>
      </header>

      <main className="mobile-shell w-full px-safe sm:px-4 pb-3 pt-1 relative">
        {activeTab === "dashboard" && (
          <Dashboard
            sessions={sessions}
            activeWeek={activeWeek}
            maxWeek={maxWeek}
            onOpenPlan={() => setActiveTab("plan")}
            onOpenCoach={() => setActiveTab("coach")}
          />
        )}
        {activeTab === "plan" && (
          <TrainingPlan
            sessions={sessions}
            activeWeek={activeWeek}
            maxWeek={maxWeek}
            onWeekChange={handleWeekChange}
          />
        )}
        {activeTab === "coach" && <CoachPage onUpgrade={() => setAccountOpen(true)} />}
        {activeTab === "metrics" && <Metrics metrics={metrics} sessions={sessions} />}
        {activeTab === "service" && <ServiceTracker serviceItems={serviceItems} />}
        {activeTab === "events" && <EventTracker goal={goal || undefined} />}
        {activeTab === "strava" && <StravaDashboard />}
        {activeTab === "more" && (
          <MoreHub
            sessionCount={sessions.length}
            goal={goal || undefined}
            subscriptionTier={subscriptionTier}
            onOpenEvents={() => setActiveTab("events")}
            onOpenBike={() => setActiveTab("service")}
            onOpenStrava={() => setActiveTab("strava")}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenAccount={() => setAccountOpen(true)}
          />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-brand-border/35 bg-brand-bg/88 backdrop-blur-md">
        <div className="mobile-shell grid w-full grid-cols-5 gap-1 px-safe pb-[calc(env(safe-area-inset-bottom,0px)+8px)] pt-1.5">
          <NavItem
            icon={<CalendarDays size={24} />}
            label="Plan"
            isActive={activeTab === "plan"}
            onClick={() => setActiveTab("plan")}
            testId="nav-plan"
          />
          <NavItem
            icon={<MessageSquare size={24} />}
            label="Coach"
            isActive={activeTab === "coach"}
            onClick={() => setActiveTab("coach")}
            testId="nav-coach"
          />
          <NavItem
            icon={<Home size={26} />}
            label="Dash"
            isActive={activeTab === "dashboard"}
            onClick={() => setActiveTab("dashboard")}
            testId="nav-dashboard"
            isCenter
          />
          <NavItem
            icon={<Activity size={24} />}
            label="Stats"
            isActive={activeTab === "metrics"}
            onClick={() => setActiveTab("metrics")}
            testId="nav-metrics"
          />
          <NavItem
            icon={<MoreHorizontal size={24} />}
            label="More"
            isActive={isMoreActive}
            onClick={() => setActiveTab("more")}
            testId="nav-more"
          />
        </div>
      </nav>

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        mode={themeMode}
        accent={themeAccent}
        onModeChange={handleThemeModeChange}
        onAccentChange={handleThemeAccentChange}
      />
      <NewRiderOnboarding
        open={onboardingOpen}
        saving={onboardingSaving}
        onOpenChange={setOnboardingOpen}
        onComplete={handleCompleteOnboarding}
      />
      <AccountCenterModal
        open={accountOpen}
        onOpenChange={setAccountOpen}
        name={riderDisplayName}
        email={user?.email || "No email available"}
        profileImageUrl={user?.profileImageUrl}
        subscriptionTier={subscriptionTier}
        billingCycle={billingCycle}
        isSavingPlan={planSaving}
        onSelectPlan={handleSelectPlan}
        onOpenSettings={() => {
          setAccountOpen(false);
          setSettingsOpen(true);
        }}
        onOpenGuide={() => {
          setAccountOpen(false);
          setOnboardingOpen(true);
        }}
        onLogout={() => {
          setAccountOpen(false);
          logout();
        }}
      />
    </div>
  );
}

function NavItem({
  icon,
  label,
  isActive,
  isCenter,
  onClick,
  testId,
}: {
  icon: ReactNode;
  label: string;
  isActive: boolean;
  isCenter?: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative min-h-[54px] w-full min-w-0 rounded-2xl px-1 py-1.5 transition-colors duration-200 flex flex-col items-center justify-center gap-0.5 border",
        isActive
          ? "text-brand-text bg-brand-panel-2/45 border-brand-primary/35"
          : "text-brand-muted border-transparent hover:text-brand-text",
        isCenter && "font-semibold",
      )}
      data-testid={testId}
    >
      <div className={cn("h-6 w-6 flex items-center justify-center", isCenter && isActive && "text-brand-primary")}>
        {icon}
      </div>
      <span className="text-[11px] leading-none text-center">{label}</span>
    </button>
  );
}

function MoreHub({
  sessionCount,
  goal,
  subscriptionTier,
  onOpenEvents,
  onOpenBike,
  onOpenStrava,
  onOpenSettings,
  onOpenAccount,
}: {
  sessionCount: number;
  goal?: GoalEvent;
  subscriptionTier: "free" | "pro";
  onOpenEvents: () => void;
  onOpenBike: () => void;
  onOpenStrava: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
}) {
  const [showAIBuilder, setShowAIBuilder] = useState(false);

  return (
    <div className="p-3.5 space-y-5" data-testid="more-view">
      <section className="space-y-2">
        <h3 className="text-xs font-medium text-brand-muted">Planning</h3>
        <div className="glass-panel overflow-hidden divide-y divide-brand-border/35">
          <MoreAction
            icon={<MountainSnow size={17} className="text-brand-primary" />}
            title="Events"
            description="Goal event and countdown"
            onClick={onOpenEvents}
            testId="button-more-events"
          />
          <MoreAction
            icon={<Wrench size={17} className="text-brand-primary" />}
            title="Bike"
            description="Maintenance and distance checks"
            onClick={onOpenBike}
            testId="button-more-bike"
          />
          <button
            type="button"
            onClick={() => {
              if (subscriptionTier === "pro") {
                setShowAIBuilder(true);
                return;
              }
              onOpenAccount();
            }}
            className="w-full min-h-[52px] px-3 py-2.5 flex items-center gap-3 text-left hover:bg-brand-panel-2/20 transition-colors"
            data-testid="button-more-open-ai-builder"
          >
            <span className="w-7 h-7 rounded-lg bg-brand-panel-2/35 border border-brand-border/40 flex items-center justify-center shrink-0">
              <Sparkles size={15} className="text-brand-primary" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-brand-text truncate">
                {subscriptionTier === "pro" ? "Rebuild plan with AI" : "Rebuild plan with AI (Pro)"}
              </span>
              <span className="block text-xs text-brand-muted leading-snug">
                Refresh weekly structure with guided prompts
              </span>
            </span>
            <ChevronRight size={16} className="text-brand-muted shrink-0" />
          </button>
        </div>
        <div className="pt-2">
          {subscriptionTier !== "pro" && (
            <p className="text-xs text-brand-muted">Available on Pro. Upgrade from Profile and account.</p>
          )}
          <PlanManager sessionCount={sessionCount} />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-brand-muted">Integrations</h3>
        <div className="glass-panel overflow-hidden divide-y divide-brand-border/35">
          <MoreAction
            icon={<Bike size={17} className="text-[#FC4C02]" />}
            title="Strava"
            description="Connect and sync rides"
            onClick={onOpenStrava}
            testId="button-more-strava"
          />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-brand-muted">Account</h3>
        <div className="glass-panel overflow-hidden divide-y divide-brand-border/35">
          <MoreAction
            icon={<User size={17} className="text-brand-primary" />}
            title="Profile and account"
            description="Subscription, help, logout"
            onClick={onOpenAccount}
            testId="button-more-account"
          />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-brand-muted">App</h3>
        <div className="glass-panel overflow-hidden divide-y divide-brand-border/35">
          <MoreAction
            icon={<Settings size={17} className="text-brand-primary" />}
            title="Settings"
            description="Theme and notifications"
            onClick={onOpenSettings}
            testId="button-more-settings"
          />
          <div className="min-h-[52px] px-3 py-2.5 flex items-center justify-between">
            <span className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-lg bg-brand-panel-2/35 border border-brand-border/40 flex items-center justify-center shrink-0">
                <Bell size={15} className="text-brand-primary" />
              </span>
              <span>
                <span className="block text-sm font-medium text-brand-text">Notifications</span>
                <span className="block text-xs text-brand-muted leading-snug">Reminders and alerts</span>
              </span>
            </span>
            <NotificationsCenter />
          </div>
        </div>
      </section>

      {showAIBuilder && <AIPlanBuilder onClose={() => setShowAIBuilder(false)} goal={goal} />}
    </div>
  );
}

function MoreAction({
  icon,
  title,
  description,
  onClick,
  testId,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full min-h-[52px] px-3 py-2.5 flex items-center gap-3 text-left hover:bg-brand-panel-2/20 transition-colors"
      data-testid={testId}
    >
      <span className="w-7 h-7 rounded-lg bg-brand-panel-2/35 border border-brand-border/40 flex items-center justify-center shrink-0">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-brand-text truncate">{title}</span>
        <span className="block text-xs text-brand-muted leading-snug">{description}</span>
      </span>
      <ChevronRight size={16} className="text-brand-muted shrink-0" />
    </button>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <MainApp />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
