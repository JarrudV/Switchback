import { useEffect, useState } from "react";
import {
  Sparkles,
  X,
  Dumbbell,
  Home,
  Target,
  Calendar,
  Weight,
  Clock,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { GoalEvent } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

interface Props {
  onClose: () => void;
  goal?: GoalEvent;
}

const GOAL_OPTIONS = [
  { id: "endurance", label: "Build Endurance" },
  { id: "speed", label: "Improve Speed" },
  { id: "climbing", label: "Better Climbing" },
  { id: "weight_loss", label: "Lose Weight" },
  { id: "race_prep", label: "Race Preparation" },
  { id: "general_fitness", label: "General Fitness" },
  { id: "strength", label: "Build Strength" },
  { id: "recovery", label: "Return from Injury" },
];

export function AIPlanBuilder({ onClose, goal }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);
  const [step, setStep] = useState(1);

  const [eventName, setEventName] = useState(goal?.name || "");
  const [eventDate, setEventDate] = useState(goal?.startDate || "");
  const [eventDistance, setEventDistance] = useState(goal?.distanceKm?.toString() || "");
  const [eventElevation, setEventElevation] = useState(goal?.elevationMeters?.toString() || "");
  const [fitnessLevel, setFitnessLevel] = useState<"beginner" | "intermediate" | "advanced">("intermediate");
  const [age, setAge] = useState("");
  const [selectedGoals, setSelectedGoals] = useState<string[]>(["endurance"]);
  const [currentWeight, setCurrentWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [hoursPerWeek, setHoursPerWeek] = useState(8);
  const [equipment, setEquipment] = useState<"gym" | "home_full" | "home_minimal" | "no_equipment">("home_minimal");
  const [injuries, setInjuries] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");

  useEffect(() => {
    if (user?.age && !age) {
      setAge(String(user.age));
    }
  }, [user?.age, age]);

  const toggleGoal = (id: string) => {
    setSelectedGoals((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  };

  const handleGenerate = async () => {
    if (!eventName || !eventDate) {
      toast({ title: "Please fill in event name and date", variant: "destructive" });
      return;
    }
    if (selectedGoals.length === 0) {
      toast({ title: "Select at least one goal", variant: "destructive" });
      return;
    }
    if (!age || Number(age) < 13 || Number(age) > 100) {
      toast({ title: "Please enter a valid age (13-100)", variant: "destructive" });
      return;
    }

    setIsGenerating(true);
    try {
      await apiRequest("PUT", "/api/auth/profile", {
        age: Number(age),
      });
      const res = await apiRequest("POST", "/api/plan/generate-ai", {
        eventName,
        eventDate,
        eventDistance: eventDistance ? Number(eventDistance) : undefined,
        eventElevation: eventElevation ? Number(eventElevation) : undefined,
        age: Number(age),
        fitnessLevel,
        goals: selectedGoals,
        currentWeight: currentWeight ? Number(currentWeight) : undefined,
        targetWeight: targetWeight ? Number(targetWeight) : undefined,
        daysPerWeek,
        hoursPerWeek,
        equipment,
        injuries: injuries || undefined,
        additionalNotes: additionalNotes || undefined,
      });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      toast({ title: `AI generated ${data.count} training sessions!` });
      onClose();
    } catch (err: any) {
      toast({
        title: "Plan generation failed",
        description: err.message || "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" data-testid="ai-plan-builder">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-brand-panel rounded-t-2xl sm:rounded-2xl border border-brand-border shadow-[0_0_40px_rgba(189,52,254,0.2)]">
        <div className="sticky top-0 bg-brand-panel/95 backdrop-blur-md p-4 border-b border-brand-border z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-primary flex items-center justify-center">
                <Sparkles size={16} className="text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-brand-text">AI Plan Builder</h2>
                <p className="text-[10px] text-brand-muted uppercase tracking-widest">
                  Step {step} of 3 — {step === 1 ? "Event & Goals" : step === 2 ? "Your Profile" : "Preferences"}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-brand-muted hover:text-brand-text transition-colors"
              data-testid="button-close-ai-builder"
            >
              <X size={20} />
            </button>
          </div>
          <div className="flex gap-1 mt-3">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={cn(
                  "flex-1 h-1 rounded-full transition-all",
                  s <= step ? "bg-gradient-primary" : "bg-brand-border"
                )}
              />
            ))}
          </div>
        </div>

        <div className="p-4 space-y-4">
          {step === 1 && (
            <>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-brand-muted block mb-1.5">
                  <Calendar size={10} className="inline mr-1" /> Event Name
                </label>
                <input
                  type="text"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="e.g. Mt Buller Epic"
                  className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2.5 text-sm text-brand-text placeholder-brand-muted/50 focus:outline-none focus:ring-1 focus:ring-brand-primary"
                  data-testid="input-event-name"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-brand-muted block mb-1.5">
                  <Calendar size={10} className="inline mr-1" /> Event Date
                </label>
                <input
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:ring-1 focus:ring-brand-primary"
                  data-testid="input-event-date"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-brand-muted block mb-1.5">
                    Distance (km)
                  </label>
                  <input
                    type="number"
                    value={eventDistance}
                    onChange={(e) => setEventDistance(e.target.value)}
                    placeholder="Optional"
                    className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2.5 text-sm text-brand-text placeholder-brand-muted/50 focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    data-testid="input-event-distance"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-brand-muted block mb-1.5">
                    Elevation (m)
                  </label>
                  <input
                    type="number"
                    value={eventElevation}
                    onChange={(e) => setEventElevation(e.target.value)}
                    placeholder="Optional"
                    className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2.5 text-sm text-brand-text placeholder-brand-muted/50 focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    data-testid="input-event-elevation"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-brand-muted block mb-2">
                  <Target size={10} className="inline mr-1" /> Your Goals (select all that apply)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {GOAL_OPTIONS.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => toggleGoal(g.id)}
                      className={cn(
                        "px-3 py-2 text-xs font-bold rounded-lg border transition-all text-left",
                        selectedGoals.includes(g.id)
                          ? "bg-brand-primary/20 border-brand-primary text-brand-primary shadow-[0_0_10px_rgba(65,209,255,0.2)]"
                          : "bg-brand-bg border-brand-border text-brand-muted hover:border-brand-primary/50"
                      )}
                      data-testid={`button-goal-${g.id}`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-brand-muted block mb-2">
                  Fitness Level
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(["beginner", "intermediate", "advanced"] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => setFitnessLevel(level)}
                      className={cn(
                        "px-3 py-2.5 text-xs font-bold rounded-lg border transition-all capitalize",
                        fitnessLevel === level
                          ? "bg-brand-primary/20 border-brand-primary text-brand-primary"
                          : "bg-brand-bg border-brand-border text-brand-muted hover:border-brand-primary/50"
                      )}
                      data-testid={`button-fitness-${level}`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-brand-muted block mb-1.5">
                    Age
                  </label>
                  <input
                    type="number"
                    min={13}
                    max={100}
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder="Required"
                    className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2.5 text-sm text-brand-text placeholder-brand-muted/50 focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    data-testid="input-age"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-brand-muted block mb-1.5">
                    <Weight size={10} className="inline mr-1" /> Current Weight (kg)
                  </label>
                  <input
                    type="number"
                    value={currentWeight}
                    onChange={(e) => setCurrentWeight(e.target.value)}
                    placeholder="Optional"
                    className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2.5 text-sm text-brand-text placeholder-brand-muted/50 focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    data-testid="input-current-weight"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-brand-muted block mb-1.5">
                    <Target size={10} className="inline mr-1" /> Target Weight (kg)
                  </label>
                  <input
                    type="number"
                    value={targetWeight}
                    onChange={(e) => setTargetWeight(e.target.value)}
                    placeholder="Optional"
                    className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2.5 text-sm text-brand-text placeholder-brand-muted/50 focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    data-testid="input-target-weight"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-brand-muted block mb-1.5">
                  Any Injuries or Limitations?
                </label>
                <input
                  type="text"
                  value={injuries}
                  onChange={(e) => setInjuries(e.target.value)}
                  placeholder="e.g. Bad knee, lower back issues"
                  className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2.5 text-sm text-brand-text placeholder-brand-muted/50 focus:outline-none focus:ring-1 focus:ring-brand-primary"
                  data-testid="input-injuries"
                />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-brand-muted block mb-2">
                  <Dumbbell size={10} className="inline mr-1" /> Equipment Access
                </label>
                <div className="space-y-2">
                  {[
                    { value: "gym" as const, label: "Full Gym", desc: "Barbells, machines, cables" },
                    { value: "home_full" as const, label: "Home Gym", desc: "Dumbbells, bands, bench, pull-up bar" },
                    { value: "home_minimal" as const, label: "Minimal Equipment", desc: "Resistance bands, bodyweight" },
                    { value: "no_equipment" as const, label: "No Equipment", desc: "Bodyweight exercises only" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setEquipment(opt.value)}
                      className={cn(
                        "w-full px-3 py-2.5 rounded-lg border text-left transition-all",
                        equipment === opt.value
                          ? "bg-brand-primary/20 border-brand-primary"
                          : "bg-brand-bg border-brand-border hover:border-brand-primary/50"
                      )}
                      data-testid={`button-equipment-${opt.value}`}
                    >
                      <span className={cn(
                        "text-xs font-bold block",
                        equipment === opt.value ? "text-brand-primary" : "text-brand-text"
                      )}>
                        {opt.label}
                      </span>
                      <span className="text-[10px] text-brand-muted">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-brand-muted block mb-1.5">
                    <Calendar size={10} className="inline mr-1" /> Days Per Week
                  </label>
                  <div className="flex items-center gap-2">
                    {[3, 4, 5, 6].map((d) => (
                      <button
                        key={d}
                        onClick={() => setDaysPerWeek(d)}
                        className={cn(
                          "flex-1 py-2 text-sm font-bold rounded-lg border transition-all",
                          daysPerWeek === d
                            ? "bg-brand-primary/20 border-brand-primary text-brand-primary"
                            : "bg-brand-bg border-brand-border text-brand-muted hover:border-brand-primary/50"
                        )}
                        data-testid={`button-days-${d}`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-brand-muted block mb-1.5">
                    <Clock size={10} className="inline mr-1" /> Hours Per Week
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={3}
                      max={20}
                      value={hoursPerWeek}
                      onChange={(e) => setHoursPerWeek(Number(e.target.value))}
                      className="flex-1 accent-brand-primary"
                      data-testid="input-hours-per-week"
                    />
                    <span className="text-sm font-bold font-mono text-brand-text w-8 text-right">
                      {hoursPerWeek}h
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-brand-muted block mb-1.5">
                  Additional Notes
                </label>
                <textarea
                  value={additionalNotes}
                  onChange={(e) => setAdditionalNotes(e.target.value)}
                  placeholder="Anything else the AI should know..."
                  rows={2}
                  className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2.5 text-sm text-brand-text placeholder-brand-muted/50 focus:outline-none focus:ring-1 focus:ring-brand-primary resize-none"
                  data-testid="input-additional-notes"
                />
              </div>
            </>
          )}
        </div>

        <div className="sticky bottom-0 bg-brand-panel/95 backdrop-blur-md p-4 border-t border-brand-border">
          <div className="flex gap-2">
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="px-4 py-3 rounded-lg border border-brand-border text-brand-muted text-xs font-bold uppercase tracking-widest hover:border-brand-primary/50 transition-colors"
                data-testid="button-ai-back"
              >
                Back
              </button>
            )}
            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                className="flex-1 py-3 rounded-lg bg-gradient-primary text-white text-xs font-bold uppercase tracking-widest shadow-[0_0_15px_rgba(65,209,255,0.3)] hover:shadow-[0_0_25px_rgba(65,209,255,0.5)] transition-all"
                data-testid="button-ai-next"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className={cn(
                  "flex-1 py-3 rounded-lg text-white text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all",
                  isGenerating
                    ? "bg-brand-panel-2 text-brand-muted"
                    : "bg-gradient-primary shadow-[0_0_15px_rgba(65,209,255,0.3)] hover:shadow-[0_0_25px_rgba(65,209,255,0.5)]"
                )}
                data-testid="button-ai-generate"
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Building Your Plan...
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    Generate Plan
                  </>
                )}
              </button>
            )}
          </div>
          {step === 3 && (
            <p className="text-[9px] text-brand-muted text-center mt-2 leading-relaxed">
              This will replace your current training plan. AI uses Google Gemini via Replit — charges are minimal and billed to your credits.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
