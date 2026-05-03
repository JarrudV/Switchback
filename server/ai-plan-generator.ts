import { getGeminiClient, getGeminiModel } from "./gemini-client";
import type { InsertSession } from "@shared/schema";

export interface PlanRequest {
  eventName: string;
  eventDate: string;
  eventDistance?: number;
  eventElevation?: number;
  age: number;
  fitnessLevel: "beginner" | "intermediate" | "advanced";
  goals: string[];
  currentWeight?: number;
  targetWeight?: number;
  daysPerWeek: number;
  hoursPerWeek: number;
  equipment: "gym" | "home_full" | "home_minimal" | "no_equipment";
  injuries?: string;
  additionalNotes?: string;
}

type RecoveryBand = "normal" | "moderate" | "extended";

interface AgeRecoveryProfile {
  band: RecoveryBand;
  minRestDaysPerWeek: number;
  weeklyRampCap: number;
  strengthMobilityFocus: boolean;
  highIntensityCapPerWeek: number;
  noExtremeIntensity: boolean;
}

const HIGH_INTENSITY_KEYWORDS = [
  "vo2",
  "threshold",
  "sprint",
  "anaerobic",
  "race pace",
  "max effort",
  "zone 4",
  "zone 5",
];

function getAgeRecoveryProfile(age: number, fitnessLevel: PlanRequest["fitnessLevel"]): AgeRecoveryProfile {
  if (age >= 46) {
    return {
      band: "extended",
      minRestDaysPerWeek: 2,
      weeklyRampCap: 0.05,
      strengthMobilityFocus: true,
      highIntensityCapPerWeek: 1,
      noExtremeIntensity: age >= 40 && fitnessLevel === "beginner",
    };
  }

  if (age >= 31) {
    return {
      band: "moderate",
      minRestDaysPerWeek: 1,
      weeklyRampCap: 0.08,
      strengthMobilityFocus: true,
      highIntensityCapPerWeek: 2,
      noExtremeIntensity: age >= 40 && fitnessLevel === "beginner",
    };
  }

  return {
    band: "normal",
    minRestDaysPerWeek: 1,
    weeklyRampCap: 0.12,
    strengthMobilityFocus: false,
    highIntensityCapPerWeek: 2,
    noExtremeIntensity: false,
  };
}

function getRecoveryBandLabel(band: RecoveryBand): string {
  if (band === "extended") return "longer recovery windows";
  if (band === "moderate") return "moderate recovery adjustment";
  return "normal recovery";
}

function buildPrompt(req: PlanRequest, recoveryProfile: AgeRecoveryProfile): string {
  const now = new Date();
  const eventDate = new Date(req.eventDate);
  const weeksUntilEvent = Math.max(1, Math.round((eventDate.getTime() - now.getTime()) / (7 * 24 * 60 * 60 * 1000)));
  const totalWeeks = Math.min(weeksUntilEvent, 16);

  const equipmentDesc: Record<string, string> = {
    gym: "Gym access, but keep strength work simple and beginner-friendly",
    home_full: "Home setup with basic equipment (dumbbells, resistance bands, bench)",
    home_minimal: "Minimal home equipment (resistance bands, bodyweight exercises)",
    no_equipment: "No equipment at all (bodyweight only)",
  };

  const exerciseExamples =
    req.equipment === "no_equipment" || req.equipment === "home_minimal"
      ? "chair squats, step-back lunges, glute bridges, step-ups, calf raises, front planks, side planks, easy mountain climbers"
      : req.equipment === "home_full"
        ? "chair squats, backpack hip hinges, step-ups, split squat holds, wall push-ups, resistance-band rows, glute bridges"
        : "chair squats, step-ups, split squat holds, backpack hip hinges, calf raises, front planks, side planks";

  return `You are an expert cycling coach. Create a ${totalWeeks}-week training plan.

EVENT: ${req.eventName} on ${req.eventDate} (${weeksUntilEvent} weeks away)
${req.eventDistance ? `Distance: ${req.eventDistance}km` : ""}
${req.eventElevation ? `Elevation: ${req.eventElevation}m` : ""}

ATHLETE: ${req.fitnessLevel} level, age ${req.age}, ${req.daysPerWeek} days/week, ${req.hoursPerWeek} hours/week
Recovery profile: ${getRecoveryBandLabel(recoveryProfile.band)}
Equipment: ${equipmentDesc[req.equipment]}
Goals: ${req.goals.join(", ")}
${req.currentWeight ? `Weight: ${req.currentWeight}kg` : ""}${req.targetWeight ? ` -> ${req.targetWeight}kg target` : ""}
${req.injuries ? `Limitations: ${req.injuries}` : ""}
${req.additionalNotes ? `Notes: ${req.additionalNotes}` : ""}

Return a JSON array of sessions. Each object must have:
- "weekNumber": number (1-${totalWeeks})
- "type": "Ride" | "Long Ride" | "Strength" | "Rest"
- "description": short title (e.g. "Zone 2 Base Ride")
- "minutes": duration number
- "zone": "Zone 1" | "Zone 2" | "Zone 3" | "Zone 4" | "Zone 5" | "N/A"
- "details": brief workout instructions (2-4 sentences, no markdown)

Rules:
- ${req.daysPerWeek} sessions per week, within ${req.hoursPerWeek} total hours
- Periodization: base -> intensity -> taper
- Recovery and sustainability are mandatory.
- Minimum rest days per week: ${recoveryProfile.minRestDaysPerWeek}
- Weekly training load increases must stay conservative (max ${Math.round(recoveryProfile.weeklyRampCap * 100)}%).
- Strength exercises only with available equipment (${exerciseExamples})
- Use plain-language exercise names with a short explanation of what the movement is and why it helps cycling.
- Avoid jargon terms like "VO2max", "sweet spot", or "threshold" in session names; use plain labels like "Short Hard Intervals" or "Steady Climb Repeats".
- Tone for strength sessions should be encouraging and non-intimidating for everyday riders.
- No Olympic lifts, no advanced-only movements, and no equipment-heavy requirements.
- Include mobility/core emphasis in strength sessions${recoveryProfile.strengthMobilityFocus ? " (important for this athlete)." : "."}
- Keep "details" concise: warmup, main set, cooldown in plain text
- Progressive overload across weeks
${recoveryProfile.noExtremeIntensity ? "- This athlete is 40+ and beginner: avoid extreme high-intensity work (no all-out VO2/sprint blocks)." : ""}

Return ONLY a JSON array, no other text.`;
}

function isStrengthSession(session: InsertSession): boolean {
  return session.type === "Strength" || session.strength === true;
}

function intensityScore(session: InsertSession): number {
  if (session.type === "Rest") return 0;
  const zone = (session.zone || "").toLowerCase();
  const description = `${session.description || ""} ${session.detailsMarkdown || ""}`.toLowerCase();

  let score = 0;
  if (zone.includes("zone 5")) score += 3;
  else if (zone.includes("zone 4")) score += 2;
  else if (zone.includes("zone 3")) score += 1;

  if (HIGH_INTENSITY_KEYWORDS.some((keyword) => description.includes(keyword))) {
    score += 2;
  }

  if (session.type === "Long Ride" && score >= 1) {
    score += 1;
  }

  return score;
}

function toRecoveryRide(session: InsertSession, reason: string): InsertSession {
  return {
    ...session,
    type: "Ride",
    description: "Recovery Endurance Ride",
    zone: "Zone 2",
    strength: false,
    minutes: Math.max(30, Math.round((session.minutes || 60) * 0.85)),
    detailsMarkdown: `${session.detailsMarkdown || "Easy endurance spin."} ${reason}`.trim(),
  };
}

function toRestDay(session: InsertSession, reason: string): InsertSession {
  return {
    ...session,
    type: "Rest",
    description: "Rest and Recovery Day",
    zone: "N/A",
    strength: false,
    minutes: 0,
    detailsMarkdown: `Full recovery day. ${reason}`.trim(),
  };
}

function toStrengthMobility(session: InsertSession, reason: string): InsertSession {
  return {
    ...session,
    type: "Strength",
    description: "Strength & Mobility Session",
    strength: true,
    zone: "N/A",
    minutes: Math.max(25, Math.min(45, Math.round((session.minutes || 45) * 0.75))),
    detailsMarkdown:
      `Mobility and durability focus: hips, core, glutes, trunk stability, and controlled movement quality. ${reason}`.trim(),
  };
}

function applyAgeRecoveryScaling(
  sessions: InsertSession[],
  recoveryProfile: AgeRecoveryProfile,
): InsertSession[] {
  const byWeek = new Map<number, InsertSession[]>();
  for (const session of sessions) {
    const list = byWeek.get(session.week) || [];
    list.push(session);
    byWeek.set(session.week, list);
  }

  const weeks = Array.from(byWeek.keys()).sort((a, b) => a - b);

  for (const week of weeks) {
    const weekSessions = byWeek.get(week) || [];

    // 40+ beginners should avoid extreme intensity entirely.
    if (recoveryProfile.noExtremeIntensity) {
      for (let i = 0; i < weekSessions.length; i++) {
        if (intensityScore(weekSessions[i]) >= 2) {
          weekSessions[i] = toRecoveryRide(
            weekSessions[i],
            "Adjusted for 40+ beginner safety and long-term sustainability.",
          );
        }
      }
    }

    const highIntensityIndices = weekSessions
      .map((session, idx) => ({ idx, score: intensityScore(session) }))
      .filter((entry) => entry.score >= 2)
      .sort((a, b) => b.score - a.score);

    // Cap high-intensity frequency by age profile.
    for (const entry of highIntensityIndices.slice(recoveryProfile.highIntensityCapPerWeek)) {
      weekSessions[entry.idx] = toRecoveryRide(
        weekSessions[entry.idx],
        "Intensity capped for age-appropriate recovery.",
      );
    }

    // Ensure minimum rest days for older riders.
    const restCount = weekSessions.filter((session) => session.type === "Rest").length;
    let restsToAdd = Math.max(0, recoveryProfile.minRestDaysPerWeek - restCount);
    if (restsToAdd > 0) {
      const rideCandidates = weekSessions
        .map((session, idx) => ({ idx, score: intensityScore(session), minutes: session.minutes || 0 }))
        .filter((entry) => weekSessions[entry.idx].type !== "Rest" && !isStrengthSession(weekSessions[entry.idx]))
        .sort((a, b) => b.score - a.score || b.minutes - a.minutes);

      for (const candidate of rideCandidates) {
        if (restsToAdd <= 0) break;
        weekSessions[candidate.idx] = toRestDay(
          weekSessions[candidate.idx],
          "Extra recovery inserted for age-adjusted sustainability.",
        );
        restsToAdd--;
      }
    }

    // Increase mobility/strength focus for 31+.
    if (recoveryProfile.strengthMobilityFocus) {
      const strengthIndices = weekSessions
        .map((session, idx) => ({ idx, isStrength: isStrengthSession(session) }))
        .filter((entry) => entry.isStrength)
        .map((entry) => entry.idx);

      if (strengthIndices.length === 0) {
        const candidate = weekSessions
          .map((session, idx) => ({ idx, score: intensityScore(session), minutes: session.minutes || 0 }))
          .filter((entry) => weekSessions[entry.idx].type !== "Rest")
          .sort((a, b) => a.score - b.score || a.minutes - b.minutes)[0];

        if (candidate) {
          weekSessions[candidate.idx] = toStrengthMobility(
            weekSessions[candidate.idx],
            "Added to support mobility, durability, and injury prevention.",
          );
        }
      } else {
        for (const idx of strengthIndices) {
          const details = weekSessions[idx].detailsMarkdown || "";
          if (!details.toLowerCase().includes("mobility")) {
            weekSessions[idx] = {
              ...weekSessions[idx],
              detailsMarkdown: `${details} Prioritize mobility, core stability, and controlled movement quality.`.trim(),
            };
          }
        }
      }
    }

    byWeek.set(week, weekSessions);
  }

  // Apply conservative week-to-week load ramp cap.
  let prevLoad: number | null = null;
  for (const week of weeks) {
    const weekSessions = byWeek.get(week) || [];
    const activeIndices = weekSessions
      .map((session, idx) => ({ idx, session }))
      .filter((entry) => entry.session.type !== "Rest");
    const currentLoad = activeIndices.reduce((sum, entry) => sum + (entry.session.minutes || 0), 0);

    if (prevLoad !== null && prevLoad > 0) {
      const maxAllowed = Math.round(prevLoad * (1 + recoveryProfile.weeklyRampCap));
      if (currentLoad > maxAllowed) {
        const scale = maxAllowed / currentLoad;
        for (const { idx, session } of activeIndices) {
          const minMinutes = isStrengthSession(session) ? 20 : 30;
          weekSessions[idx] = {
            ...session,
            minutes: Math.max(minMinutes, Math.round((session.minutes || minMinutes) * scale)),
          };
        }
      }
    }

    const adjustedLoad = weekSessions
      .filter((session) => session.type !== "Rest")
      .reduce((sum, session) => sum + (session.minutes || 0), 0);
    prevLoad = adjustedLoad;
    byWeek.set(week, weekSessions);
  }

  return weeks.flatMap((week) => byWeek.get(week) || []);
}

export async function generateAIPlan(req: PlanRequest): Promise<InsertSession[]> {
  const ai = getGeminiClient();
  const model = getGeminiModel("gemini-2.5-flash");
  const recoveryProfile = getAgeRecoveryProfile(req.age, req.fitnessLevel);
  const prompt = buildPrompt(req, recoveryProfile);

  let response: { text?: string };
  try {
    response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        maxOutputTokens: 16384,
        temperature: 0.7,
        responseMimeType: "application/json",
      },
    });
  } catch (err: any) {
    const message = err?.message || "Unknown Gemini error";
    throw new Error(`Gemini request failed (${model}). ${message}`);
  }

  const text = response.text || "";
  console.log("AI response length:", text.length, "chars");

  let cleaned = text.trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error("AI response (first 500 chars):", text.substring(0, 500));
    throw new Error("AI did not return a valid training plan. Please try again.");
  }

  let parsed: any[];
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e: any) {
    console.error("JSON parse error:", e.message);
    console.error("Attempted to parse (first 500 chars):", jsonMatch[0].substring(0, 500));
    throw new Error("Failed to parse AI response. Please try again.");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("AI returned an empty plan. Please try again.");
  }

  const validTypes = ["Ride", "Long Ride", "Strength", "Rest"];
  const validZones = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5", "N/A"];
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  const sessions: InsertSession[] = parsed.map((s: any, i: number) => {
    const weekNum = Number(s.weekNumber || s.week) || 1;
    const sessionInWeek = parsed.filter((x: any) => (Number(x.weekNumber || x.week) || 1) === weekNum).indexOf(s);

    return {
      id: s.id || `ai-w${weekNum}-s${i + 1}`,
      week: weekNum,
      day: s.day || dayNames[Math.min(sessionInWeek, 6)] || "Monday",
      type: validTypes.includes(s.type) ? s.type : "Ride",
      description: String(s.description || "Training Session"),
      minutes: Number(s.scheduledMinutes || s.minutes) || 60,
      zone: validZones.includes(s.zone) ? s.zone : null,
      elevation: null,
      strength: s.type === "Strength",
      completed: false,
      completedAt: null,
      rpe: null,
      notes: null,
      detailsMarkdown: String(s.detailsMarkdown || s.details || ""),
      scheduledDate: null,
    };
  });

  const adjustedSessions = applyAgeRecoveryScaling(sessions, recoveryProfile);
  return adjustedSessions;
}
