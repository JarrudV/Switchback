import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Lock, RotateCcw, Send, Sparkles, User } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: "coach-welcome",
  role: "assistant",
  content: "I am your MTB endurance coach. Ask for simple, practical guidance to stay consistent this week.",
};

const QUICK_PROMPTS = ["I missed a ride", "I feel tired", "What should I focus on?"];
const COACH_MESSAGES_STORAGE_KEY = "peakready.coach.messages.v1";
const COACH_PENDING_PROPOSAL_STORAGE_KEY = "peakready.coach.pendingProposalId.v1";
const MAX_PERSISTED_MESSAGES = 30;

interface CoachStatus {
  tier: "free" | "pro";
  canUse: boolean;
  monthlyLimit: number | null;
  usedThisMonth: number;
  remainingThisMonth: number | null;
  period: string;
}

interface CoachContextSummary {
  activeWeek: number;
  weekSessionCount: number;
  hasStravaConnection: boolean;
  stravaSyncedRideCount: number;
  stravaRecentRideCount14: number;
  stravaLastRideDate: string | null;
  stravaLastSyncAt: string | null;
  metricsTotalCount: number;
  metricsRecentCount7: number;
}

interface CoachProposalChange {
  sessionId: string;
  sessionLabel: string;
  before: {
    minutes: number;
    zone: string | null;
  };
  after: {
    minutes: number;
    zone: string | null;
  };
  reason: string;
}

interface CoachProposal {
  id: string;
  activeWeek: number;
  status: "pending" | "applied" | "cancelled" | "expired";
  createdAt: string;
  expiresAt: string;
  changes: CoachProposalChange[];
}

interface CoachApplyResult {
  eventId: string;
  appliedCount: number;
  skippedCount: number;
  items: Array<{
    sessionId: string;
    status: "applied" | "skipped";
    skipReason?: string;
  }>;
}

interface Props {
  onUpgrade?: () => void;
}

function formatLocalDateTime(iso: string | null): string {
  if (!iso) return "Unknown";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString();
}

function parseStoredMessages(raw: string | null): ChatMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
      .slice(-MAX_PERSISTED_MESSAGES)
      .map((item, index) => ({
        id: typeof item.id === "string" && item.id.trim() ? item.id : `restored-${Date.now()}-${index}`,
        role: item.role as ChatRole,
        content: item.content.trim(),
      }))
      .filter((item) => item.content.length > 0);
  } catch {
    return [];
  }
}

function formatChangeSummary(change: CoachProposalChange): string {
  const beforeZone = change.before.zone ? ` ${change.before.zone}` : "";
  const afterZone = change.after.zone ? ` ${change.after.zone}` : "";
  return `${change.before.minutes}min${beforeZone} -> ${change.after.minutes}min${afterZone}`;
}

function normalizeAssistantContent(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return raw;

  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }

  for (const candidate of candidates) {
    if (!(candidate.startsWith("{") && candidate.endsWith("}"))) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate) as { reply?: unknown };
      if (typeof parsed.reply === "string" && parsed.reply.trim()) {
        return parsed.reply.trim();
      }
    } catch {
      // Keep original message if parsing fails.
    }
  }

  return raw;
}

export function CoachPage({ onUpgrade }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [proposal, setProposal] = useState<CoachProposal | null>(null);
  const [proposalActionLoading, setProposalActionLoading] = useState(false);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { data: coachStatus, isLoading: coachStatusLoading, refetch: refetchCoachStatus } =
    useQuery<CoachStatus>({
      queryKey: ["/api/coach/status"],
    });
  const { data: coachContext, isLoading: coachContextLoading, refetch: refetchCoachContext } =
    useQuery<CoachContextSummary>({
      queryKey: ["/api/coach/context"],
    });

  useEffect(() => {
    const restored = parseStoredMessages(window.localStorage.getItem(COACH_MESSAGES_STORAGE_KEY));
    if (restored.length === 0) return;
    setMessages([WELCOME_MESSAGE, ...restored]);
  }, []);

  useEffect(() => {
    const pendingProposalId = window.localStorage.getItem(COACH_PENDING_PROPOSAL_STORAGE_KEY);
    if (!pendingProposalId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/coach/proposals/${pendingProposalId}`);
        const data: CoachProposal = await res.json();
        if (cancelled) return;
        if (data.status === "pending") {
          setProposal(data);
        } else {
          window.localStorage.removeItem(COACH_PENDING_PROPOSAL_STORAGE_KEY);
        }
      } catch {
        if (!cancelled) {
          window.localStorage.removeItem(COACH_PENDING_PROPOSAL_STORAGE_KEY);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const toPersist = messages
      .filter((item) => item.id !== WELCOME_MESSAGE.id)
      .slice(-MAX_PERSISTED_MESSAGES)
      .map((item) => ({ id: item.id, role: item.role, content: item.content }));

    try {
      if (toPersist.length === 0) {
        window.localStorage.removeItem(COACH_MESSAGES_STORAGE_KEY);
      } else {
        window.localStorage.setItem(COACH_MESSAGES_STORAGE_KEY, JSON.stringify(toPersist));
      }
    } catch {
      // Ignore storage failures and keep in-memory chat state.
    }
  }, [messages]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isSending]);

  const canUseCoach = coachStatus?.canUse ?? true;
  const isPro = coachStatus?.tier === "pro";
  const freeRemaining = coachStatus?.remainingThisMonth;
  const canSend = useMemo(
    () => input.trim().length > 0 && !isSending && canUseCoach,
    [input, isSending, canUseCoach],
  );

  const resetChat = () => {
    setMessages([WELCOME_MESSAGE]);
    setProposal(null);
    setInput("");
    try {
      window.localStorage.removeItem(COACH_MESSAGES_STORAGE_KEY);
      window.localStorage.removeItem(COACH_PENDING_PROPOSAL_STORAGE_KEY);
    } catch {
      // Ignore storage failures and keep in-memory chat state.
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || isSending) return;
    if (!canUseCoach) {
      onUpgrade?.();
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: message,
    };

    const historyForApi = messages.slice(-12).map((item) => ({
      role: item.role,
      content: item.content,
    }));

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      const res = await apiRequest("POST", "/api/coach/chat", {
        message,
        history: historyForApi,
      });
      const data = await res.json() as { reply?: string; proposal?: CoachProposal | null };
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: normalizeAssistantContent(data.reply || "I could not generate a response. Please try again."),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      if (data.proposal && data.proposal.status === "pending") {
        setProposal(data.proposal);
        try {
          window.localStorage.setItem(COACH_PENDING_PROPOSAL_STORAGE_KEY, data.proposal.id);
        } catch {
          // Ignore storage failures and keep in-memory proposal state.
        }
      }

      await Promise.all([refetchCoachStatus(), refetchCoachContext()]);
    } catch (err: any) {
      await Promise.all([refetchCoachStatus(), refetchCoachContext()]);
      toast({
        title: "Coach reply failed",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content: "I could not respond right now. Retry in a moment.",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleApplyProposal = async () => {
    if (!proposal || proposal.status !== "pending" || proposalActionLoading) return;
    setProposalActionLoading(true);
    try {
      const res = await apiRequest("POST", `/api/coach/proposals/${proposal.id}/apply`);
      const data = await res.json() as CoachApplyResult;
      setProposal((prev) => (prev ? { ...prev, status: "applied" } : prev));
      try {
        window.localStorage.removeItem(COACH_PENDING_PROPOSAL_STORAGE_KEY);
      } catch {
        // Ignore storage failures and keep in-memory proposal state.
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/sessions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/coach/context"] }),
      ]);
      toast({
        title: "Coach changes applied",
        description: `${data.appliedCount} applied, ${data.skippedCount} skipped.`,
      });
    } catch (err: any) {
      toast({
        title: "Failed to apply coach changes",
        description: err?.message || "Please refresh and try again.",
        variant: "destructive",
      });
    } finally {
      setProposalActionLoading(false);
    }
  };

  const handleCancelProposal = async () => {
    if (!proposal || proposal.status !== "pending" || proposalActionLoading) return;
    setProposalActionLoading(true);
    try {
      await apiRequest("POST", `/api/coach/proposals/${proposal.id}/cancel`);
      setProposal((prev) => (prev ? { ...prev, status: "cancelled" } : prev));
      try {
        window.localStorage.removeItem(COACH_PENDING_PROPOSAL_STORAGE_KEY);
      } catch {
        // Ignore storage failures and keep in-memory proposal state.
      }
      toast({ title: "Coach changes cancelled" });
    } catch (err: any) {
      toast({
        title: "Failed to cancel coach changes",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setProposalActionLoading(false);
    }
  };

  return (
    <div
      className="px-1 py-2 flex h-[calc(100dvh-12.5rem)] min-h-[520px] flex-col gap-3 overflow-hidden"
      data-testid="coach-page"
    >
      <div className="flex-none">
        <h2 className="text-base font-semibold text-brand-text" data-testid="text-coach-title">
          Ask your coach
        </h2>
        <p className="text-sm text-brand-muted mt-1 leading-relaxed">
          Quick guidance for this week.
        </p>
        {coachStatusLoading ? (
          <p className="text-xs text-brand-muted mt-1.5">Checking access...</p>
        ) : isPro ? (
          <p className="mt-1.5 text-xs text-brand-success flex items-center gap-1.5">
            <Sparkles size={13} />
            Pro active. AI Coach is fully available.
          </p>
        ) : canUseCoach ? (
          <p className="mt-1.5 text-xs text-brand-warning">
            Free plan: {freeRemaining ?? 0} AI coach {freeRemaining === 1 ? "reply" : "replies"} left this month.
          </p>
        ) : (
          <div className="mt-2 rounded-lg border border-brand-warning/35 bg-brand-warning/8 p-2.5">
            <p className="text-xs text-brand-warning font-medium flex items-center gap-1.5">
              <Lock size={12} />
              Available in Pro
            </p>
            <p className="text-xs text-brand-muted mt-1 leading-relaxed">
              Your free monthly coach replies have been used. Upgrade to keep coaching anytime.
            </p>
            <button
              type="button"
              onClick={() => onUpgrade?.()}
              className="mt-2 min-h-[36px] rounded-md px-0 text-xs font-medium text-brand-primary underline underline-offset-2"
              data-testid="button-upgrade-from-coach"
            >
              Upgrade to Pro
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 flex-none" data-testid="coach-quick-prompts">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => (canUseCoach ? setInput(prompt) : onUpgrade?.())}
            className="min-h-[34px] rounded-full border border-brand-border/45 bg-brand-panel-2/15 px-3 text-xs font-medium text-brand-text disabled:opacity-50"
            disabled={!canUseCoach}
          >
            {prompt}
          </button>
        ))}
        <button
          type="button"
          onClick={resetChat}
          className="min-h-[34px] rounded-full border border-brand-border/45 bg-brand-panel-2/15 px-3 text-xs font-medium text-brand-muted flex items-center gap-1.5"
          data-testid="button-reset-coach-chat"
        >
          <RotateCcw size={12} />
          New chat
        </button>
      </div>

      <div className="glass-panel p-2.5 border-brand-border/45 text-xs text-brand-muted leading-relaxed flex-none" data-testid="coach-context-summary">
        {coachContextLoading || !coachContext ? (
          <p>Loading data available to coach...</p>
        ) : (
          <>
            <p className="text-brand-text font-medium">Coach data now</p>
            <p className="mt-1">
              Week {coachContext.activeWeek}: {coachContext.weekSessionCount} planned sessions. Metrics:{" "}
              {coachContext.metricsRecentCount7} in last 7 days ({coachContext.metricsTotalCount} total).
            </p>
            <p className="mt-0.5">
              Strava:{" "}
              {coachContext.hasStravaConnection
                ? `${coachContext.stravaRecentRideCount14} rides in last 14 days (${coachContext.stravaSyncedRideCount} synced total${coachContext.stravaLastRideDate ? `, latest ${coachContext.stravaLastRideDate}` : ""}).`
                : "Not connected."}
            </p>
            {coachContext.stravaLastSyncAt && (
              <p className="mt-0.5">Last Strava sync: {formatLocalDateTime(coachContext.stravaLastSyncAt)}</p>
            )}
          </>
        )}
      </div>

      {proposal && (
        <div className="glass-panel p-2.5 border-brand-border/45 text-xs text-brand-muted leading-relaxed flex-none" data-testid="coach-proposal-card">
          <p className="text-brand-text font-medium">Suggested plan adjustments</p>
          <p className="mt-1">Apply changes to this week?</p>
          <div className="mt-2 space-y-2">
            {proposal.changes.map((change) => (
              <div key={`${proposal.id}-${change.sessionId}`} className="rounded-lg border border-brand-border/35 bg-brand-panel-2/20 px-2.5 py-2">
                <p><span className="text-brand-text font-medium">Session:</span> {change.sessionLabel}</p>
                <p className="mt-0.5"><span className="text-brand-text font-medium">Change:</span> {formatChangeSummary(change)}</p>
                <p className="mt-0.5"><span className="text-brand-text font-medium">Reason:</span> {change.reason}</p>
              </div>
            ))}
          </div>
          {proposal.status === "pending" ? (
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={handleApplyProposal}
                disabled={proposalActionLoading}
                className="flex-1 min-h-[36px] rounded-md bg-brand-success/15 border border-brand-success/30 text-brand-success font-medium disabled:opacity-60"
                data-testid="button-apply-coach-proposal"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={handleCancelProposal}
                disabled={proposalActionLoading}
                className="flex-1 min-h-[36px] rounded-md bg-brand-danger/12 border border-brand-danger/30 text-brand-danger font-medium disabled:opacity-60"
                data-testid="button-cancel-coach-proposal"
              >
                Cancel
              </button>
            </div>
          ) : (
            <p className="mt-2 text-brand-text">
              {proposal.status === "applied" && "Applied"}
              {proposal.status === "cancelled" && "Cancelled"}
              {proposal.status === "expired" && "Expired"}
            </p>
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        className="glass-panel p-2.5 flex-1 min-h-0 overflow-y-auto overscroll-y-contain space-y-2.5 border-brand-border/45"
        data-testid="coach-message-list"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "max-w-[90%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words leading-relaxed border",
              message.role === "assistant"
                ? "mr-auto bg-brand-panel-2/45 border-brand-border/45 text-brand-text"
                : "ml-auto bg-brand-primary/12 border-brand-primary/25 text-brand-text",
            )}
          >
            <div className="text-[10px] font-medium mb-1 text-brand-muted flex items-center gap-1">
              {message.role === "assistant" ? <Bot size={11} /> : <User size={11} />}
              {message.role === "assistant" ? "Coach" : "You"}
            </div>
            {message.role === "assistant" ? normalizeAssistantContent(message.content) : message.content}
          </div>
        ))}
        {isSending && (
          <div className="max-w-[88%] mr-auto rounded-xl px-3 py-2 text-sm border bg-brand-panel-2/45 border-brand-border/45 text-brand-muted">
            Coach is thinking...
          </div>
        )}
      </div>

      <form
        onSubmit={sendMessage}
        className="glass-panel p-2.5 border-brand-border/45 flex-none pb-[max(env(safe-area-inset-bottom),0px)]"
        data-testid="coach-chat-form"
      >
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              canUseCoach
                ? "Ask about this week, recovery, or what to do next..."
                : "AI Coach is available on Pro. Upgrade to continue."
            }
            className="flex-1 min-h-[44px] max-h-32 rounded-lg bg-brand-bg border border-brand-border/50 px-3 py-2 text-sm text-brand-text placeholder:text-brand-muted resize-none focus:outline-none focus:border-brand-primary"
            data-testid="coach-input"
            disabled={!canUseCoach}
            rows={2}
          />
          <button
            type="submit"
            disabled={!canSend}
            className="min-h-[44px] px-4 rounded-lg bg-brand-primary text-brand-bg text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
            data-testid="coach-send"
          >
            <Send size={14} />
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
