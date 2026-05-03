import type { InsertSession } from "@shared/schema";
import { getWorkoutDetails } from "./workout-library";

type DayName = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
type PlanLevelTag = "beginner" | "intermediate" | "advanced";
type PlanDisciplineTag = "mtb" | "gravel" | "trail";

export type TrainingPlanTag = PlanLevelTag | PlanDisciplineTag;

export interface TrainingPlanTemplate {
  id: string;
  name: string;
  description: string;
  weeks: number;
  sessionsPerWeek: string;
  tags: TrainingPlanTag[];
}

interface SessionBlueprint {
  day: DayName;
  type: string;
  description: string;
  minutes: number;
  zone?: string;
  elevation?: string;
  strength?: boolean;
}

interface TrainingPlanPreset extends TrainingPlanTemplate {
  buildSessions: (startDate: Date) => InsertSession[];
}

const DAY_NAMES: DayName[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const DEFAULT_TRAINING_PLAN_PRESET_ID = "mtb-marathon-12week";

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function buildScheduledSessions(config: {
  presetId: string;
  startDate: Date;
  weeks: number;
  buildWeekSessions: (week: number) => SessionBlueprint[];
}): InsertSession[] {
  const sessions: InsertSession[] = [];

  for (let week = 1; week <= config.weeks; week++) {
    const weekStart = new Date(config.startDate);
    weekStart.setDate(weekStart.getDate() + (week - 1) * 7);
    const weekSessions = config.buildWeekSessions(week);

    for (let index = 0; index < weekSessions.length; index++) {
      const session = weekSessions[index];
      const dayOffset = DAY_NAMES.indexOf(session.day);
      if (dayOffset < 0) continue;

      const sessionDate = new Date(weekStart);
      sessionDate.setDate(sessionDate.getDate() + dayOffset);
      const scheduledDate = sessionDate.toISOString().split("T")[0];

      sessions.push({
        id: `${config.presetId}-w${week}-${session.day.toLowerCase()}-${slugify(session.type)}-${index + 1}`,
        week,
        day: session.day,
        type: session.type,
        description: session.description,
        minutes: session.minutes,
        zone: session.zone ?? null,
        elevation: session.elevation ?? null,
        strength: session.strength ?? false,
        completed: false,
        rpe: null,
        notes: null,
        scheduledDate,
        completedAt: null,
        detailsMarkdown: getWorkoutDetails(session.type, session.description, week),
      });
    }
  }

  return sessions;
}

function buildBeginnerMtbPlan(startDate: Date): InsertSession[] {
  return buildScheduledSessions({
    presetId: "beginner-mtb-8week",
    startDate,
    weeks: 8,
    buildWeekSessions: (week) => {
      const isRecovery = week === 4;
      const isTaper = week === 8;

      if (isTaper) {
        return [
          { day: "Mon", type: "Strength", description: "Mobility + Core Activation", minutes: 20, strength: true },
          { day: "Wed", type: "Ride", description: "Leg Opener Ride", minutes: 35, zone: "Z2" },
          { day: "Sat", type: "Long Ride", description: "Confidence Trail Ride", minutes: 75, zone: "Z2", elevation: "300m" },
        ];
      }

      if (isRecovery) {
        return [
          { day: "Tue", type: "Ride", description: "Easy Endurance Ride", minutes: 45, zone: "Z1-Z2" },
          { day: "Thu", type: "Ride", description: "Bike Handling Skills", minutes: 40, zone: "Z1-Z2" },
          { day: "Sat", type: "Long Ride", description: "Steady Trail Cruise", minutes: 90, zone: "Z2", elevation: "350m" },
        ];
      }

      return [
        { day: "Mon", type: "Strength", description: "Core + Stability", minutes: 25, strength: true },
        { day: "Tue", type: "Ride", description: "Endurance Ride", minutes: 45 + week * 5, zone: "Z2" },
        { day: "Thu", type: "Ride", description: "Cadence + Skills", minutes: 40 + week * 5, zone: "Z2-Z3" },
        { day: "Sat", type: "Long Ride", description: "Trail Endurance Ride", minutes: 85 + week * 10, zone: "Z2", elevation: `${300 + week * 75}m` },
      ];
    },
  });
}

function buildMarathonPlan(startDate: Date): InsertSession[] {
  return buildScheduledSessions({
    presetId: "mtb-marathon-12week",
    startDate,
    weeks: 12,
    buildWeekSessions: (week) => {
      const isRecovery = week % 4 === 0;
      const isTaper = week >= 11;
      const isBase = week <= 4;
      const isBuild = week >= 5 && week <= 8;

      if (isRecovery) {
        return [
          { day: "Mon", type: "Ride", description: "Recovery Spin", minutes: 30, zone: "Z1" },
          { day: "Wed", type: "Ride", description: "Easy Ride", minutes: 45, zone: "Z2" },
          { day: "Sat", type: "Long Ride", description: "Easy Long Ride", minutes: 60 + week * 3, zone: "Z2", elevation: "Low" },
        ];
      }

      if (isTaper) {
        return [
          { day: "Mon", type: "Ride", description: "Short Opener", minutes: 25, zone: "Z2-Z3" },
          { day: "Wed", type: "Ride", description: "Light Intervals", minutes: 30, zone: "Z3" },
          { day: "Fri", type: "Ride", description: "Shakeout Ride", minutes: 20, zone: "Z1" },
        ];
      }

      if (isBase) {
        return [
          { day: "Mon", type: "Strength", description: "Core & Stability", minutes: 30, strength: true },
          { day: "Tue", type: "Ride", description: "Endurance Ride", minutes: 45 + week * 5, zone: "Z2" },
          { day: "Thu", type: "Ride", description: "Steady Effort Ride", minutes: 40 + week * 5, zone: "Z3" },
          { day: "Sat", type: "Long Ride", description: "Weekend Long Ride", minutes: 90 + week * 15, zone: "Z2", elevation: `${600 + week * 100}m` },
        ];
      }

      if (isBuild) {
        return [
          { day: "Mon", type: "Strength", description: "Strength + Stability", minutes: 35, strength: true },
          { day: "Tue", type: "Ride", description: "Steady Hard Intervals", minutes: 60 + (week - 4) * 5, zone: "Z3-Z4" },
          { day: "Thu", type: "Ride", description: "Hard Climb Repeats", minutes: 50 + (week - 4) * 5, zone: "Z4", elevation: `${800 + (week - 4) * 150}m` },
          { day: "Sat", type: "Long Ride", description: "Endurance + Climbs", minutes: 120 + (week - 4) * 15, zone: "Z2-Z3", elevation: `${1000 + (week - 4) * 200}m` },
        ];
      }

      return [
        { day: "Mon", type: "Strength", description: "Strength + Bike Power", minutes: 40, strength: true },
        { day: "Tue", type: "Ride", description: "Short Hard Intervals", minutes: 60, zone: "Z4-Z5" },
        { day: "Thu", type: "Ride", description: "Event Practice Ride", minutes: 70, zone: "Z3-Z5", elevation: "1500m+" },
        { day: "Sat", type: "Long Ride", description: "Long Event Practice Ride", minutes: 180, zone: "Z2-Z4", elevation: "1800m+" },
      ];
    },
  });
}

function buildStageRacePlan(startDate: Date): InsertSession[] {
  return buildScheduledSessions({
    presetId: "stage-race-16week",
    startDate,
    weeks: 16,
    buildWeekSessions: (week) => {
      const recoveryWeeks = new Set([5, 10, 14]);
      const isRecovery = recoveryWeeks.has(week);
      const isTaper = week >= 15;
      const isPeakBlock = week >= 11 && week <= 13;

      if (isTaper) {
        return [
          { day: "Mon", type: "Strength", description: "Mobility + Core Tune-up", minutes: 20, strength: true },
          { day: "Tue", type: "Ride", description: "Leg Wake-Up Ride", minutes: 35, zone: "Z2-Z3" },
          { day: "Thu", type: "Ride", description: "Short Event Prep Ride", minutes: 40, zone: "Z3-Z4" },
          { day: "Sat", type: "Long Ride", description: "Back-to-Back Event Practice", minutes: 120, zone: "Z2-Z3", elevation: "900m" },
        ];
      }

      if (isRecovery) {
        return [
          { day: "Tue", type: "Ride", description: "Recovery Endurance", minutes: 50, zone: "Z1-Z2" },
          { day: "Thu", type: "Ride", description: "Skills + Cadence", minutes: 45, zone: "Z2" },
          { day: "Sat", type: "Long Ride", description: "Easy Long Ride", minutes: 105, zone: "Z2", elevation: "500m" },
        ];
      }

      if (isPeakBlock) {
        return [
          { day: "Mon", type: "Strength", description: "Strength + Stability", minutes: 35, strength: true },
          { day: "Tue", type: "Ride", description: "Short Hard Hill Repeats", minutes: 75, zone: "Z4-Z5", elevation: "900m" },
          { day: "Wed", type: "Ride", description: "Steady Endurance Ride", minutes: 60, zone: "Z3" },
          { day: "Thu", type: "Ride", description: "Hard Climb Repeats", minutes: 80, zone: "Z4", elevation: "1200m" },
          { day: "Sat", type: "Long Ride", description: "Event Practice Day 1", minutes: 180, zone: "Z2-Z4", elevation: "1700m+" },
          { day: "Sun", type: "Long Ride", description: "Event Practice Day 2", minutes: 150, zone: "Z2-Z3", elevation: "1300m+" },
        ];
      }

      return [
        { day: "Mon", type: "Strength", description: "Core + Hip Support", minutes: 35, strength: true },
        { day: "Tue", type: "Ride", description: "Steady Hard Intervals", minutes: 60 + week * 2, zone: "Z3-Z4" },
        { day: "Wed", type: "Ride", description: "Aerobic Endurance", minutes: 50 + week * 2, zone: "Z2" },
        { day: "Thu", type: "Ride", description: "Steady Climbing Ride", minutes: 65 + week * 2, zone: "Z3-Z4", elevation: `${700 + week * 60}m` },
        { day: "Sat", type: "Long Ride", description: "Event Practice Day 1", minutes: 130 + week * 5, zone: "Z2-Z3", elevation: `${900 + week * 80}m` },
        { day: "Sun", type: "Long Ride", description: "Event Practice Day 2", minutes: 95 + week * 4, zone: "Z2", elevation: `${700 + week * 60}m` },
      ];
    },
  });
}

function buildBaseResetPlan(startDate: Date): InsertSession[] {
  return buildScheduledSessions({
    presetId: "base-reset-6week",
    startDate,
    weeks: 6,
    buildWeekSessions: (week) => {
      const isRecovery = week === 4;
      const isConsolidation = week === 6;

      if (isConsolidation) {
        return [
          { day: "Mon", type: "Strength", description: "Mobility + Core", minutes: 20, strength: true },
          { day: "Tue", type: "Ride", description: "Steady Endurance Ride", minutes: 55, zone: "Z2" },
          { day: "Thu", type: "Ride", description: "Progressive Steady Ride", minutes: 50, zone: "Z2-Z3" },
          { day: "Sat", type: "Long Ride", description: "Confidence Long Ride", minutes: 120, zone: "Z2", elevation: "600m" },
        ];
      }

      if (isRecovery) {
        return [
          { day: "Tue", type: "Ride", description: "Easy Spin", minutes: 40, zone: "Z1-Z2" },
          { day: "Thu", type: "Ride", description: "Technique + Cadence", minutes: 40, zone: "Z2" },
          { day: "Sat", type: "Long Ride", description: "Short Endurance Ride", minutes: 85, zone: "Z2", elevation: "350m" },
        ];
      }

      return [
        { day: "Mon", type: "Strength", description: "Strength Basics", minutes: 25, strength: true },
        { day: "Tue", type: "Ride", description: "Aerobic Endurance", minutes: 45 + week * 4, zone: "Z2" },
        { day: "Thu", type: "Ride", description: "Steady Ride Intro", minutes: 40 + week * 4, zone: "Z2-Z3" },
        { day: "Sat", type: "Long Ride", description: "Low-Intensity Long Ride", minutes: 85 + week * 8, zone: "Z2", elevation: `${350 + week * 60}m` },
      ];
    },
  });
}

const TRAINING_PLAN_PRESETS: TrainingPlanPreset[] = [
  {
    id: "beginner-mtb-8week",
    name: "8-Week Beginner MTB",
    description: "Entry-level mountain bike build with skills, steady endurance, and low-risk progression into trail-ready long rides.",
    weeks: 8,
    sessionsPerWeek: "3-4",
    tags: ["beginner", "mtb", "trail"],
    buildSessions: buildBeginnerMtbPlan,
  },
  {
    id: "mtb-marathon-12week",
    name: "12-Week MTB Marathon Build",
    description: "Progressive MTB marathon plan moving through base, build, peak, and taper with climbing and interval focus.",
    weeks: 12,
    sessionsPerWeek: "4",
    tags: ["intermediate", "mtb", "gravel"],
    buildSessions: buildMarathonPlan,
  },
  {
    id: "stage-race-16week",
    name: "16-Week Stage Race Build",
    description: "High-volume stage race progression with back-to-back long rides, recovery blocks, and a controlled taper.",
    weeks: 16,
    sessionsPerWeek: "5-6",
    tags: ["advanced", "mtb", "gravel"],
    buildSessions: buildStageRacePlan,
  },
  {
    id: "base-reset-6week",
    name: "6-Week Base Reset",
    description: "Short aerobic reset block to restore consistency, rebuild endurance, and prepare for the next training phase.",
    weeks: 6,
    sessionsPerWeek: "3-4",
    tags: ["beginner", "gravel", "trail"],
    buildSessions: buildBaseResetPlan,
  },
];

const presetById = new Map(TRAINING_PLAN_PRESETS.map((preset) => [preset.id, preset]));

export function getTrainingPlanTemplates(): TrainingPlanTemplate[] {
  return TRAINING_PLAN_PRESETS.map(({ buildSessions: _buildSessions, ...template }) => template);
}

export function getTrainingPlanTemplateById(id: string): TrainingPlanTemplate | null {
  const preset = presetById.get(id);
  if (!preset) return null;
  const { buildSessions: _buildSessions, ...template } = preset;
  return template;
}

export function buildTrainingPlanFromPreset(id: string, startDate: Date): InsertSession[] | null {
  const preset = presetById.get(id);
  if (!preset) return null;
  return preset.buildSessions(startDate);
}
