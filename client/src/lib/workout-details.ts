import type { Session } from "@shared/schema";

export interface ExerciseRecommendation {
  key: string;
  name: string;
  whatItIs: string;
  whyItHelpsCycling: string;
  howToDoIt?: string[];
}

export interface StructuredWorkoutDetails {
  source: "library" | "fallback";
  key: string;
  title: string;
  purpose: string;
  warmUp: string[];
  mainSet: string[];
  coolDown: string[];
  equipment?: string[];
  exerciseRecommendations: ExerciseRecommendation[];
  timeEstimate: string;
  rpeGuidance: string;
  fallbackMessage?: string;
}

interface WorkoutTemplate {
  key: string;
  title: string;
  purpose: string;
  warmUp: string[];
  mainSet: string[];
  coolDown: string[];
  equipment?: string[];
  exerciseRecommendations: ExerciseRecommendation[];
  timeEstimate: string;
  rpeGuidance: string;
  match?: string[];
}

const NON_RIDE_WORKOUT_LIBRARY: Record<string, WorkoutTemplate[]> = {
  strength: [
    {
      key: "strength-core-basics",
      title: "Strength & Core Basics",
      purpose: "Build everyday trail strength so climbing and bike handling feel easier week by week.",
      warmUp: [
        "5-8 min easy movement: hip circles, glute bridges, and gentle back rotations",
        "2 rounds: chair squats x8 and step-back lunges x6 per side",
      ],
      mainSet: [
        "3 rounds: chair squat x10, backpack hip hinge x10, step-back lunge x8 per side",
        "3 rounds: glute bridge x12, front plank hold 30-40 sec, side plank hold 20-30 sec per side",
        "Rest 60-75 sec between movements and keep reps smooth",
      ],
      coolDown: [
        "2-3 min easy breathing to settle your heart rate",
        "Hip and hamstring stretch 45-60 sec per side",
      ],
      equipment: ["Sturdy chair or bench", "Light backpack (optional)", "Exercise mat (optional)"],
      exerciseRecommendations: [
        {
          key: "chair-squat",
          name: "Chair Squat (Sit-to-Stand)",
          whatItIs: "Sit down to a chair and stand back up with control.",
          whyItHelpsCycling: "Builds leg strength for steady climbing and better control when standing on the pedals.",
          howToDoIt: [
            "Stand in front of a chair with feet about hip-width apart.",
            "Push your hips back and lower until you lightly touch the chair.",
            "Press through your feet to stand tall again.",
          ],
        },
        {
          key: "step-back-lunge",
          name: "Step-Back Lunge",
          whatItIs: "Step one leg behind you, lower, then return to standing.",
          whyItHelpsCycling: "Improves single-leg balance and power for smoother pedaling on climbs.",
          howToDoIt: [
            "Stand tall and step one foot back.",
            "Bend both knees until the back knee is close to the floor.",
            "Push through the front foot to come back up and switch sides.",
          ],
        },
        {
          key: "backpack-hip-hinge",
          name: "Backpack Hip Hinge",
          whatItIs: "Hold a light backpack and bend at your hips with a flat back.",
          whyItHelpsCycling: "Strengthens your glutes and back side muscles that drive climbing and protect your low back.",
          howToDoIt: [
            "Hold a light backpack close to your body.",
            "Soften your knees and push your hips back.",
            "Stop when you feel your hamstrings engage, then stand tall again.",
          ],
        },
        {
          key: "front-plank",
          name: "Front Plank Hold",
          whatItIs: "Hold a steady straight-body position on forearms and toes.",
          whyItHelpsCycling: "Builds core stability so your upper body stays calmer on rough terrain.",
          howToDoIt: [
            "Place forearms on the floor with elbows under shoulders.",
            "Lift your body so head, hips, and heels stay in one line.",
            "Breathe steadily and hold without letting your hips sag.",
          ],
        },
      ],
      timeEstimate: "25-40 min",
      rpeGuidance: "Target RPE 5-7. Keep every rep smooth and stop before form breaks.",
      match: ["core", "stability", "foundational", "foundation", "strength", "posterior"],
    },
    {
      key: "strength-leg-stability",
      title: "Leg Strength & Stability",
      purpose: "Build confident pedal power and joint stability without high-impact work.",
      warmUp: [
        "6-8 min brisk walk, easy spin, or marching in place",
        "2 rounds: step-ups x6 per side and calf raises x10",
      ],
      mainSet: [
        "3 rounds: step-up x8 per side, split squat hold 20 sec per side, calf raise x12 per side",
        "2-3 rounds: wall push-up x10, back-lying arm-and-leg reach x8 per side",
        "Rest 75-90 sec between rounds and keep quality high",
      ],
      coolDown: [
        "3-5 min easy walk or spin",
        "Quad, calf, and glute stretch 45 sec per side",
      ],
      equipment: ["Step, stair, or sturdy low bench", "Wall or counter", "Exercise mat (optional)"],
      exerciseRecommendations: [
        {
          key: "step-up",
          name: "Step-Up",
          whatItIs: "Step onto a stair or sturdy platform, then step down with control.",
          whyItHelpsCycling: "Builds climbing strength one leg at a time and improves balance for uneven terrain.",
          howToDoIt: [
            "Place one full foot on a stable step.",
            "Drive through that foot to stand tall on top.",
            "Step back down slowly and repeat on both sides.",
          ],
        },
        {
          key: "split-squat-hold",
          name: "Split Squat Hold",
          whatItIs: "Hold a lunge position for time instead of fast reps.",
          whyItHelpsCycling: "Improves leg endurance for long climbs and supports knee control.",
          howToDoIt: [
            "Take a long split stance with one foot forward.",
            "Lower into a small lunge and hold with your chest up.",
            "Keep pressure through the front foot, then switch sides.",
          ],
        },
        {
          key: "single-leg-calf-raise",
          name: "Single-Leg Calf Raise",
          whatItIs: "Rise onto the ball of one foot and lower slowly.",
          whyItHelpsCycling: "Supports ankle strength for pedaling efficiency and better control on descents.",
          howToDoIt: [
            "Stand near a wall for balance if needed.",
            "Lift one heel up slowly, then lower with control.",
            "Complete reps on one side, then switch.",
          ],
        },
        {
          key: "arm-leg-reach",
          name: "Back-Lying Arm-and-Leg Reach",
          whatItIs: "Lie on your back and extend opposite arm and leg slowly.",
          whyItHelpsCycling: "Builds core control so your hips stay stable while your legs work.",
          howToDoIt: [
            "Lie on your back with knees bent and arms up.",
            "Extend one leg and the opposite arm without arching your back.",
            "Return to center and switch sides.",
          ],
        },
      ],
      timeEstimate: "25-40 min",
      rpeGuidance: "Target RPE 5-7. You should feel worked but still in control.",
      match: ["power", "explosive", "primer"],
    },
    {
      key: "strength-mobility",
      title: "Mobility & Core Activation",
      purpose: "Keep your body moving well so you recover faster and feel better on the bike.",
      warmUp: [
        "5 min gentle movement: cat-camel, hip openers, and shoulder circles",
        "2 rounds: glute bridge x8 and hands-and-knees arm/leg reach x6 per side",
      ],
      mainSet: [
        "2-3 rounds: slow air squat x8, controlled step-down x8 per side, side plank hold 20-30 sec per side",
        "2 rounds: band pull-apart x10 (or towel pull), back-lying arm-and-leg reach x8 per side",
      ],
      coolDown: [
        "90 sec diaphragmatic breathing",
        "Light lower back and hip mobility flow",
      ],
      equipment: ["Resistance band or small towel (optional)", "Exercise mat (optional)"],
      exerciseRecommendations: [
        {
          key: "glute-bridge",
          name: "Glute Bridge",
          whatItIs: "Lie on your back and lift your hips off the floor.",
          whyItHelpsCycling: "Wakes up your glutes so climbing and seated power feel stronger.",
          howToDoIt: [
            "Lie on your back with knees bent and feet flat.",
            "Press through your heels to lift your hips.",
            "Pause briefly at the top, then lower slowly.",
          ],
        },
        {
          key: "side-plank",
          name: "Side Plank Hold",
          whatItIs: "Hold your body in a straight side position using one forearm.",
          whyItHelpsCycling: "Improves side-to-side stability, which helps bike control on uneven trails.",
          howToDoIt: [
            "Lie on one side and place your elbow under your shoulder.",
            "Lift hips until body is in a straight line.",
            "Hold, breathe, and repeat on the other side.",
          ],
        },
        {
          key: "hands-knees-reach",
          name: "Hands-and-Knees Arm/Leg Reach",
          whatItIs: "From all fours, reach one arm and the opposite leg out.",
          whyItHelpsCycling: "Trains balance and core control for smoother pedaling and posture.",
          howToDoIt: [
            "Start on hands and knees with a neutral back.",
            "Reach one arm forward and opposite leg back.",
            "Return slowly and switch sides.",
          ],
        },
        {
          key: "hip-opener-flow",
          name: "Hip Opener Flow",
          whatItIs: "A short sequence of gentle hip mobility moves.",
          whyItHelpsCycling: "Reduces stiffness so long rides feel more comfortable.",
          howToDoIt: [
            "Move through hip circles and deep split-stance stretches.",
            "Keep movements slow and pain-free.",
            "Breathe steadily and switch sides evenly.",
          ],
        },
      ],
      timeEstimate: "20-30 min",
      rpeGuidance: "Target RPE 4-6. You should finish feeling better than when you started.",
      match: ["mobility", "activation", "tune-up", "reset"],
    },
  ],
  rest: [
    {
      key: "rest-day",
      title: "Rest Day",
      purpose: "Absorb training load so your fitness adapts and fatigue drops.",
      warmUp: ["Optional: 5-10 min gentle walk or mobility if you feel stiff."],
      mainSet: [
        "No structured training",
        "Prioritize sleep, hydration, and normal fueling",
      ],
      coolDown: ["Optional light stretching before bed."],
      equipment: [],
      exerciseRecommendations: [],
      timeEstimate: "0-15 min optional movement",
      rpeGuidance: "Target RPE 1-2 only. Keep today truly easy.",
    },
  ],
};

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function matchesTemplate(description: string, template: WorkoutTemplate): boolean {
  if (!template.match || template.match.length === 0) return false;
  return template.match.some((keyword) => description.includes(keyword));
}

function getFallbackDetails(session: Pick<Session, "type" | "description" | "minutes">): StructuredWorkoutDetails {
  return {
    source: "fallback",
    key: "fallback-non-ride",
    title: session.description || session.type,
    purpose: "Use this non-ride session to build consistency while keeping movement quality high.",
    warmUp: ["Start with 5-8 minutes of easy mobility and activation."],
    mainSet: [
      "Follow your coach plan or preferred routine for the scheduled duration.",
      "Keep technique strict and avoid pushing through poor form.",
    ],
    coolDown: ["Finish with 3-5 minutes of breathing and mobility."],
    equipment: [],
    exerciseRecommendations: [],
    timeEstimate: `${Math.max(session.minutes || 0, 10)} min planned`,
    rpeGuidance: "Use RPE 5-7 unless your plan explicitly calls for easier or harder work.",
    fallbackMessage: "No preset library entry was found for this session yet. Add your own notes below to customize it.",
  };
}

export function resolveNonRideWorkoutDetails(
  session: Pick<Session, "type" | "description" | "minutes">,
): StructuredWorkoutDetails | null {
  const type = normalize(session.type);
  if (type.includes("ride")) {
    return null;
  }

  const templates = NON_RIDE_WORKOUT_LIBRARY[type];
  if (!templates || templates.length === 0) {
    return getFallbackDetails(session);
  }

  const description = normalize(session.description || "");
  const matched = templates.find((template) => matchesTemplate(description, template)) ?? templates[0];

  return {
    source: "library",
    key: matched.key,
    title: matched.title,
    purpose: matched.purpose,
    warmUp: matched.warmUp,
    mainSet: matched.mainSet,
    coolDown: matched.coolDown,
    equipment: matched.equipment,
    exerciseRecommendations: matched.exerciseRecommendations,
    timeEstimate: matched.timeEstimate,
    rpeGuidance: matched.rpeGuidance,
  };
}
