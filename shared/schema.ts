import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, timestamp, index, uniqueIndex, primaryKey, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const sessions = pgTable("sessions", {
  userId: text("user_id").notNull().default("__legacy__"),
  id: varchar("id", { length: 64 }).notNull(),
  week: integer("week").notNull(),
  day: text("day").notNull(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  minutes: integer("minutes").notNull(),
  zone: text("zone"),
  elevation: text("elevation"),
  strength: boolean("strength").notNull().default(false),
  completed: boolean("completed").notNull().default(false),
  completionSource: text("completion_source"),
  completedStravaActivityId: varchar("completed_strava_activity_id", { length: 64 }),
  completionMatchScore: real("completion_match_score"),
  rpe: integer("rpe"),
  notes: text("notes"),
  scheduledDate: text("scheduled_date"),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  detailsMarkdown: text("details_markdown"),
  adjustedByCoach: boolean("adjusted_by_coach").notNull().default(false),
  adjustedByCoachAt: timestamp("adjusted_by_coach_at", { withTimezone: true, mode: "string" }),
  lastCoachAdjustmentEventId: varchar("last_coach_adjustment_event_id", { length: 64 }),
}, (table) => [
  primaryKey({ columns: [table.userId, table.id] }),
  index("sessions_user_id_idx").on(table.userId),
  index("sessions_adjusted_by_coach_idx").on(table.userId, table.adjustedByCoach),
  index("sessions_completed_strava_activity_idx").on(table.userId, table.completedStravaActivityId),
]);

export const metrics = pgTable("metrics", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull().default("__legacy__"),
  date: text("date").notNull(),
  weightKg: real("weight_kg"),
  restingHr: integer("resting_hr"),
  rideMinutes: integer("ride_minutes"),
  longRideKm: real("long_ride_km"),
  fatigue: integer("fatigue"),
  notes: text("notes"),
}, (table) => [
  index("metrics_user_id_idx").on(table.userId),
  uniqueIndex("metrics_user_id_date_unique_idx").on(table.userId, table.date),
]);

export const serviceItems = pgTable("service_items", {
  userId: text("user_id").notNull().default("__legacy__"),
  id: varchar("id", { length: 64 }).notNull(),
  date: text("date"),
  dueDate: text("due_date"),
  item: text("item").notNull(),
  shop: text("shop"),
  cost: real("cost"),
  status: text("status").notNull().default("Planned"),
  notes: text("notes"),
}, (table) => [
  primaryKey({ columns: [table.userId, table.id] }),
  index("service_items_user_id_idx").on(table.userId),
]);

export const goalEvents = pgTable("goal_events", {
  userId: text("user_id").notNull().default("__legacy__"),
  id: varchar("id", { length: 64 }).notNull(),
  name: text("name").notNull(),
  link: text("link"),
  startDate: text("start_date").notNull(),
  location: text("location"),
  distanceKm: real("distance_km"),
  elevationMeters: integer("elevation_meters"),
  notes: text("notes"),
  gpxUrl: text("gpx_url"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.id] }),
  index("goal_events_user_id_idx").on(table.userId),
]);

export const stravaActivities = pgTable("strava_activities", {
  userId: text("user_id").notNull().default("__legacy__"),
  id: varchar("id", { length: 64 }).notNull(),
  stravaId: text("strava_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  sportType: text("sport_type"),
  startDate: text("start_date").notNull(),
  movingTime: integer("moving_time").notNull(),
  elapsedTime: integer("elapsed_time"),
  distance: real("distance").notNull(),
  totalElevationGain: real("total_elevation_gain"),
  averageSpeed: real("average_speed"),
  maxSpeed: real("max_speed"),
  averageHeartrate: real("average_heartrate"),
  maxHeartrate: real("max_heartrate"),
  averageWatts: real("average_watts"),
  kilojoules: real("kilojoules"),
  sufferScore: integer("suffer_score"),
  syncedAt: text("synced_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.id] }),
  index("strava_activities_user_id_idx").on(table.userId),
]);

export const appSettings = pgTable("app_settings", {
  userId: text("user_id").notNull().default("__legacy__"),
  key: varchar("key", { length: 64 }).notNull(),
  value: text("value").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.key] }),
  index("app_settings_user_id_idx").on(table.userId),
]);

export type CoachAdjustmentProposalStatus = "pending" | "applied" | "cancelled" | "expired";
export type CoachAdjustmentEventItemStatus = "applied" | "skipped";

export interface CoachAdjustmentChange {
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

export const coachAdjustmentProposals = pgTable("coach_adjustment_proposals", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull().default("__legacy__"),
  activeWeek: integer("active_week").notNull(),
  status: text("status").notNull().$type<CoachAdjustmentProposalStatus>().default("pending"),
  changes: jsonb("changes").$type<CoachAdjustmentChange[]>().notNull(),
  sourceUserMessage: text("source_user_message").notNull(),
  coachReply: text("coach_reply").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("coach_adjustment_proposals_user_id_created_idx").on(table.userId, table.createdAt),
  index("coach_adjustment_proposals_user_id_status_idx").on(table.userId, table.status),
]);

export const coachAdjustmentEvents = pgTable("coach_adjustment_events", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull().default("__legacy__"),
  proposalId: varchar("proposal_id", { length: 64 }).notNull(),
  activeWeek: integer("active_week").notNull(),
  appliedCount: integer("applied_count").notNull(),
  skippedCount: integer("skipped_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  index("coach_adjustment_events_user_id_created_idx").on(table.userId, table.createdAt),
  index("coach_adjustment_events_user_id_proposal_idx").on(table.userId, table.proposalId),
]);

export const coachAdjustmentEventItems = pgTable("coach_adjustment_event_items", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull().default("__legacy__"),
  eventId: varchar("event_id", { length: 64 }).notNull(),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  status: text("status").notNull().$type<CoachAdjustmentEventItemStatus>(),
  skipReason: text("skip_reason"),
  beforeMinutes: integer("before_minutes"),
  afterMinutes: integer("after_minutes"),
  beforeZone: text("before_zone"),
  afterZone: text("after_zone"),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  index("coach_adjustment_event_items_user_id_event_idx").on(table.userId, table.eventId),
  index("coach_adjustment_event_items_user_id_session_idx").on(table.userId, table.sessionId),
]);

export type StravaSessionLinkConfidence = "high" | "medium";

export const stravaSessionLinks = pgTable("strava_session_links", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull().default("__legacy__"),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  stravaActivityId: varchar("strava_activity_id", { length: 64 }).notNull(),
  dateDeltaDays: integer("date_delta_days").notNull(),
  durationDeltaPct: real("duration_delta_pct").notNull(),
  confidence: text("confidence").notNull().$type<StravaSessionLinkConfidence>(),
  matchedAt: timestamp("matched_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("strava_session_links_user_session_unique_idx").on(table.userId, table.sessionId),
  uniqueIndex("strava_session_links_user_activity_unique_idx").on(table.userId, table.stravaActivityId),
  index("strava_session_links_user_matched_idx").on(table.userId, table.matchedAt),
]);

export const rideInsights = pgTable("ride_insights", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull().default("__legacy__"),
  stravaActivityId: varchar("strava_activity_id", { length: 64 }).notNull(),
  sessionId: varchar("session_id", { length: 64 }),
  proposalId: varchar("proposal_id", { length: 64 }),
  headline: text("headline").notNull(),
  summary: text("summary").notNull(),
  metrics: jsonb("metrics").notNull().$type<Array<{ label: string; value: string }>>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  index("ride_insights_user_created_idx").on(table.userId, table.createdAt),
  index("ride_insights_user_activity_idx").on(table.userId, table.stravaActivityId),
]);

export const planRealignEvents = pgTable("plan_realign_events", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull().default("__legacy__"),
  fromDate: text("from_date").notNull(),
  toDate: text("to_date").notNull(),
  deltaDays: integer("delta_days").notNull(),
  affectedCount: integer("affected_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  index("plan_realign_events_user_created_idx").on(table.userId, table.createdAt),
]);

export const pushSubscriptions = pgTable("push_subscriptions", {
  userId: text("user_id").notNull().default("__legacy__"),
  endpoint: text("endpoint").notNull(),
  subscription: jsonb("subscription").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.endpoint] }),
  index("push_subscriptions_user_id_idx").on(table.userId),
]);

export const reminderSettings = pgTable("reminder_settings", {
  userId: text("user_id").notNull().default("__legacy__"),
  timezone: text("timezone").notNull().default("UTC"),
  longRideEveningBeforeEnabled: boolean("long_ride_evening_before_enabled").notNull().default(false),
  serviceDueDateEnabled: boolean("service_due_date_enabled").notNull().default(false),
  goalOneWeekCountdownEnabled: boolean("goal_one_week_countdown_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId] }),
  index("reminder_settings_user_id_idx").on(table.userId),
]);

export const inAppNotifications = pgTable("in_app_notifications", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull().default("__legacy__"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  payload: jsonb("payload"),
  readAt: timestamp("read_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  index("in_app_notifications_user_id_idx").on(table.userId),
]);

export const notificationDispatches = pgTable("notification_dispatches", {
  userId: text("user_id").notNull().default("__legacy__"),
  dedupeKey: text("dedupe_key").notNull(),
  channel: text("channel").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.dedupeKey] }),
  index("notification_dispatches_user_id_idx").on(table.userId),
]);

export const insertSessionSchema = createInsertSchema(sessions).omit({ userId: true });
export const insertMetricSchema = createInsertSchema(metrics).omit({ id: true, userId: true });
export const insertServiceItemSchema = createInsertSchema(serviceItems).omit({ userId: true });
export const insertGoalEventSchema = createInsertSchema(goalEvents).omit({ userId: true });
export const insertStravaActivitySchema = createInsertSchema(stravaActivities).omit({ userId: true });
export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ userId: true, createdAt: true, updatedAt: true });
export const insertReminderSettingsSchema = createInsertSchema(reminderSettings).omit({ userId: true, createdAt: true, updatedAt: true });
export const insertInAppNotificationSchema = createInsertSchema(inAppNotifications).omit({ id: true, userId: true, createdAt: true, readAt: true });
export const insertCoachAdjustmentProposalSchema = createInsertSchema(coachAdjustmentProposals).omit({ userId: true, createdAt: true });
export const insertCoachAdjustmentEventSchema = createInsertSchema(coachAdjustmentEvents).omit({ userId: true, createdAt: true });
export const insertCoachAdjustmentEventItemSchema = createInsertSchema(coachAdjustmentEventItems).omit({ userId: true, createdAt: true });
export const insertStravaSessionLinkSchema = createInsertSchema(stravaSessionLinks).omit({ userId: true, matchedAt: true });
export const insertRideInsightSchema = createInsertSchema(rideInsights).omit({ userId: true, createdAt: true });
export const insertPlanRealignEventSchema = createInsertSchema(planRealignEvents).omit({ userId: true, createdAt: true });

export type Session = typeof sessions.$inferSelect;
export type SessionCompletionSource = "manual" | "strava" | null;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Metric = typeof metrics.$inferSelect;
export type InsertMetric = z.infer<typeof insertMetricSchema>;
export type ServiceItem = typeof serviceItems.$inferSelect;
export type InsertServiceItem = z.infer<typeof insertServiceItemSchema>;
export type GoalEvent = typeof goalEvents.$inferSelect;
export type InsertGoalEvent = z.infer<typeof insertGoalEventSchema>;
export type StravaActivity = typeof stravaActivities.$inferSelect;
export type InsertStravaActivity = z.infer<typeof insertStravaActivitySchema>;
export type PushSubscriptionRecord = typeof pushSubscriptions.$inferSelect;
export type ReminderSettings = typeof reminderSettings.$inferSelect;
export type InAppNotification = typeof inAppNotifications.$inferSelect;
export type NotificationDispatch = typeof notificationDispatches.$inferSelect;
export type CoachAdjustmentProposal = typeof coachAdjustmentProposals.$inferSelect;
export type InsertCoachAdjustmentProposal = z.infer<typeof insertCoachAdjustmentProposalSchema>;
export type CoachAdjustmentEvent = typeof coachAdjustmentEvents.$inferSelect;
export type InsertCoachAdjustmentEvent = z.infer<typeof insertCoachAdjustmentEventSchema>;
export type CoachAdjustmentEventItem = typeof coachAdjustmentEventItems.$inferSelect;
export type InsertCoachAdjustmentEventItem = z.infer<typeof insertCoachAdjustmentEventItemSchema>;
export type StravaSessionLink = typeof stravaSessionLinks.$inferSelect;
export type InsertStravaSessionLink = z.infer<typeof insertStravaSessionLinkSchema>;
export type RideInsight = typeof rideInsights.$inferSelect;
export type InsertRideInsight = z.infer<typeof insertRideInsightSchema>;
export type PlanRealignEvent = typeof planRealignEvents.$inferSelect;
export type InsertPlanRealignEvent = z.infer<typeof insertPlanRealignEventSchema>;

export * from "./models/chat";
export * from "./models/auth";

export type SessionType = "Ride" | "Long Ride" | "Strength" | "Rest";

export interface AppData {
  sessions: Session[];
  metrics: Metric[];
  serviceItems: ServiceItem[];
  activeWeek: number;
  goal?: GoalEvent;
}
