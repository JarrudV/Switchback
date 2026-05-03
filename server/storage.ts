import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import {
  sessions,
  metrics,
  serviceItems,
  goalEvents,
  appSettings,
  stravaActivities,
  pushSubscriptions,
  reminderSettings,
  inAppNotifications,
  notificationDispatches,
  type Session,
  type InsertSession,
  type Metric,
  type InsertMetric,
  type ServiceItem,
  type InsertServiceItem,
  type GoalEvent,
  type InsertGoalEvent,
  type StravaActivity,
  type InsertStravaActivity,
  type PushSubscriptionRecord,
  type ReminderSettings,
  type InAppNotification,
} from "@shared/schema";

const LEGACY_USER_ID = "__legacy__";

export interface IStorage {
  getSessions(userId: string): Promise<Session[]>;
  getSession(userId: string, id: string): Promise<Session | undefined>;
  upsertSession(userId: string, session: InsertSession): Promise<Session>;
  updateSession(userId: string, id: string, updates: Partial<Omit<Session, "userId">>): Promise<Session | undefined>;
  upsertManySessions(userId: string, sessionList: InsertSession[]): Promise<void>;
  deleteAllSessions(userId: string): Promise<void>;

  getMetrics(userId: string): Promise<Metric[]>;
  upsertMetric(userId: string, metric: InsertMetric): Promise<Metric>;
  updateMetric(userId: string, id: string, metric: Partial<InsertMetric>): Promise<Metric | undefined>;
  deleteMetric(userId: string, id: string): Promise<boolean>;

  getServiceItems(userId: string): Promise<ServiceItem[]>;
  upsertServiceItem(userId: string, item: InsertServiceItem): Promise<ServiceItem>;
  updateServiceItem(userId: string, id: string, updates: Partial<Omit<ServiceItem, "userId">>): Promise<ServiceItem | undefined>;

  getGoal(userId: string): Promise<GoalEvent | null>;
  upsertGoal(userId: string, goal: InsertGoalEvent): Promise<GoalEvent>;

  getSetting(userId: string, key: string): Promise<string | null>;
  setSetting(userId: string, key: string, value: string): Promise<void>;

  getStravaActivities(userId: string): Promise<StravaActivity[]>;
  upsertStravaActivity(userId: string, activity: InsertStravaActivity): Promise<StravaActivity>;
  deleteAllStravaActivities(userId: string): Promise<void>;

  listPushSubscriptions(userId: string): Promise<PushSubscriptionRecord[]>;
  upsertPushSubscription(userId: string, endpoint: string, subscription: unknown): Promise<void>;
  removePushSubscription(userId: string, endpoint?: string): Promise<void>;

  getReminderSettings(userId: string): Promise<ReminderSettings | null>;
  upsertReminderSettings(
    userId: string,
    settings: Pick<ReminderSettings, "timezone" | "longRideEveningBeforeEnabled" | "serviceDueDateEnabled" | "goalOneWeekCountdownEnabled">,
  ): Promise<ReminderSettings>;
  listReminderSettingsUsers(): Promise<ReminderSettings[]>;

  createInAppNotification(
    userId: string,
    notification: Pick<InAppNotification, "type" | "title" | "body" | "payload">,
  ): Promise<InAppNotification>;
  listInAppNotifications(userId: string): Promise<InAppNotification[]>;
  markInAppNotificationRead(userId: string, id: string): Promise<void>;
  clearInAppNotifications(userId: string): Promise<void>;

  createNotificationDispatch(userId: string, dedupeKey: string, channel: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  private readonly migratedUsers = new Set<string>();

  private async claimLegacyRowsForUser(userId: string): Promise<void> {
    if (!userId || userId === LEGACY_USER_ID || this.migratedUsers.has(userId)) {
      return;
    }

    const [hasSessions] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)).limit(1);
    if (!hasSessions) {
      await db.update(sessions).set({ userId }).where(eq(sessions.userId, LEGACY_USER_ID));
    }

    const [hasMetrics] = await db.select({ id: metrics.id }).from(metrics).where(eq(metrics.userId, userId)).limit(1);
    if (!hasMetrics) {
      await db.update(metrics).set({ userId }).where(eq(metrics.userId, LEGACY_USER_ID));
    }

    const [hasServiceItems] = await db
      .select({ id: serviceItems.id })
      .from(serviceItems)
      .where(eq(serviceItems.userId, userId))
      .limit(1);
    if (!hasServiceItems) {
      await db.update(serviceItems).set({ userId }).where(eq(serviceItems.userId, LEGACY_USER_ID));
    }

    const [hasGoal] = await db.select({ id: goalEvents.id }).from(goalEvents).where(eq(goalEvents.userId, userId)).limit(1);
    if (!hasGoal) {
      await db.update(goalEvents).set({ userId }).where(eq(goalEvents.userId, LEGACY_USER_ID));
    }

    const [hasStrava] = await db
      .select({ id: stravaActivities.id })
      .from(stravaActivities)
      .where(eq(stravaActivities.userId, userId))
      .limit(1);
    if (!hasStrava) {
      await db.update(stravaActivities).set({ userId }).where(eq(stravaActivities.userId, LEGACY_USER_ID));
    }

    const [hasSettings] = await db
      .select({ key: appSettings.key })
      .from(appSettings)
      .where(eq(appSettings.userId, userId))
      .limit(1);
    if (!hasSettings) {
      await db.update(appSettings).set({ userId }).where(eq(appSettings.userId, LEGACY_USER_ID));
    }

    const [hasPushSubscriptions] = await db
      .select({ endpoint: pushSubscriptions.endpoint })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .limit(1);
    if (!hasPushSubscriptions) {
      await db.update(pushSubscriptions).set({ userId }).where(eq(pushSubscriptions.userId, LEGACY_USER_ID));
    }

    const [hasReminderSettings] = await db
      .select({ userId: reminderSettings.userId })
      .from(reminderSettings)
      .where(eq(reminderSettings.userId, userId))
      .limit(1);
    if (!hasReminderSettings) {
      await db.update(reminderSettings).set({ userId }).where(eq(reminderSettings.userId, LEGACY_USER_ID));
    }

    const [hasInAppNotifications] = await db
      .select({ id: inAppNotifications.id })
      .from(inAppNotifications)
      .where(eq(inAppNotifications.userId, userId))
      .limit(1);
    if (!hasInAppNotifications) {
      await db.update(inAppNotifications).set({ userId }).where(eq(inAppNotifications.userId, LEGACY_USER_ID));
    }

    const [hasNotificationDispatches] = await db
      .select({ dedupeKey: notificationDispatches.dedupeKey })
      .from(notificationDispatches)
      .where(eq(notificationDispatches.userId, userId))
      .limit(1);
    if (!hasNotificationDispatches) {
      await db.update(notificationDispatches).set({ userId }).where(eq(notificationDispatches.userId, LEGACY_USER_ID));
    }

    this.migratedUsers.add(userId);
  }

  async getSessions(userId: string): Promise<Session[]> {
    await this.claimLegacyRowsForUser(userId);
    return db.select().from(sessions).where(eq(sessions.userId, userId));
  }

  async getSession(userId: string, id: string): Promise<Session | undefined> {
    await this.claimLegacyRowsForUser(userId);
    const [session] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.id, id)));
    return session;
  }

  async upsertSession(userId: string, session: InsertSession): Promise<Session> {
    await this.claimLegacyRowsForUser(userId);
    const row = { ...session, userId };
    const [result] = await db
      .insert(sessions)
      .values(row)
      .onConflictDoUpdate({
        target: [sessions.userId, sessions.id],
        set: row,
      })
      .returning();
    return result;
  }

  async updateSession(userId: string, id: string, updates: Partial<Omit<Session, "userId">>): Promise<Session | undefined> {
    await this.claimLegacyRowsForUser(userId);
    const [result] = await db
      .update(sessions)
      .set(updates)
      .where(and(eq(sessions.userId, userId), eq(sessions.id, id)))
      .returning();
    return result;
  }

  async upsertManySessions(userId: string, sessionList: InsertSession[]): Promise<void> {
    await this.claimLegacyRowsForUser(userId);
    for (const session of sessionList) {
      await this.upsertSession(userId, session);
    }
  }

  async deleteAllSessions(userId: string): Promise<void> {
    await this.claimLegacyRowsForUser(userId);
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async getMetrics(userId: string): Promise<Metric[]> {
    await this.claimLegacyRowsForUser(userId);
    return db.select().from(metrics).where(eq(metrics.userId, userId));
  }

  async upsertMetric(userId: string, metric: InsertMetric): Promise<Metric> {
    await this.claimLegacyRowsForUser(userId);

    const normalizedDate = normalizeMetricDate(metric.date);
    const row = {
      ...metric,
      date: normalizedDate,
      userId,
    };

    const [result] = await db
      .insert(metrics)
      .values(row)
      .onConflictDoUpdate({
        target: [metrics.userId, metrics.date],
        set: {
          weightKg: row.weightKg ?? null,
          restingHr: row.restingHr ?? null,
          rideMinutes: row.rideMinutes ?? null,
          longRideKm: row.longRideKm ?? null,
          fatigue: row.fatigue ?? null,
          notes: row.notes ?? null,
        },
      })
      .returning();

    return result;
  }

  async updateMetric(userId: string, id: string, metric: Partial<InsertMetric>): Promise<Metric | undefined> {
    await this.claimLegacyRowsForUser(userId);

    const updates: Partial<Metric> = {};
    if (metric.date !== undefined) updates.date = normalizeMetricDate(metric.date);
    if (metric.weightKg !== undefined) updates.weightKg = metric.weightKg;
    if (metric.restingHr !== undefined) updates.restingHr = metric.restingHr;
    if (metric.rideMinutes !== undefined) updates.rideMinutes = metric.rideMinutes;
    if (metric.longRideKm !== undefined) updates.longRideKm = metric.longRideKm;
    if (metric.fatigue !== undefined) updates.fatigue = metric.fatigue;
    if (metric.notes !== undefined) updates.notes = metric.notes;

    if (Object.keys(updates).length === 0) {
      return this.getMetrics(userId).then((all) => all.find((item) => item.id === id));
    }

    const [result] = await db
      .update(metrics)
      .set(updates)
      .where(and(eq(metrics.userId, userId), eq(metrics.id, id)))
      .returning();

    return result;
  }

  async deleteMetric(userId: string, id: string): Promise<boolean> {
    await this.claimLegacyRowsForUser(userId);
    const deleted = await db
      .delete(metrics)
      .where(and(eq(metrics.userId, userId), eq(metrics.id, id)))
      .returning({ id: metrics.id });

    return deleted.length > 0;
  }

  async getServiceItems(userId: string): Promise<ServiceItem[]> {
    await this.claimLegacyRowsForUser(userId);
    return db.select().from(serviceItems).where(eq(serviceItems.userId, userId));
  }

  async upsertServiceItem(userId: string, item: InsertServiceItem): Promise<ServiceItem> {
    await this.claimLegacyRowsForUser(userId);
    const row = { ...item, userId };
    const [result] = await db
      .insert(serviceItems)
      .values(row)
      .onConflictDoUpdate({
        target: [serviceItems.userId, serviceItems.id],
        set: row,
      })
      .returning();
    return result;
  }

  async updateServiceItem(
    userId: string,
    id: string,
    updates: Partial<Omit<ServiceItem, "userId">>,
  ): Promise<ServiceItem | undefined> {
    await this.claimLegacyRowsForUser(userId);
    const [result] = await db
      .update(serviceItems)
      .set(updates)
      .where(and(eq(serviceItems.userId, userId), eq(serviceItems.id, id)))
      .returning();
    return result;
  }

  async getGoal(userId: string): Promise<GoalEvent | null> {
    await this.claimLegacyRowsForUser(userId);
    const goals = await db.select().from(goalEvents).where(eq(goalEvents.userId, userId));
    return goals[0] ?? null;
  }

  async upsertGoal(userId: string, goal: InsertGoalEvent): Promise<GoalEvent> {
    await this.claimLegacyRowsForUser(userId);
    const existing = await this.getGoal(userId);
    if (existing) {
      await db.delete(goalEvents).where(and(eq(goalEvents.userId, userId), eq(goalEvents.id, existing.id)));
    }
    const [result] = await db.insert(goalEvents).values({ ...goal, userId }).returning();
    return result;
  }

  async getSetting(userId: string, key: string): Promise<string | null> {
    await this.claimLegacyRowsForUser(userId);
    const [row] = await db
      .select()
      .from(appSettings)
      .where(and(eq(appSettings.userId, userId), eq(appSettings.key, key)));
    return row?.value ?? null;
  }

  async setSetting(userId: string, key: string, value: string): Promise<void> {
    await this.claimLegacyRowsForUser(userId);
    await db
      .insert(appSettings)
      .values({ userId, key, value })
      .onConflictDoUpdate({
        target: [appSettings.userId, appSettings.key],
        set: { value },
      });
  }

  async getStravaActivities(userId: string): Promise<StravaActivity[]> {
    await this.claimLegacyRowsForUser(userId);
    return db.select().from(stravaActivities).where(eq(stravaActivities.userId, userId));
  }

  async upsertStravaActivity(userId: string, activity: InsertStravaActivity): Promise<StravaActivity> {
    await this.claimLegacyRowsForUser(userId);
    const row = { ...activity, userId };
    const [result] = await db
      .insert(stravaActivities)
      .values(row)
      .onConflictDoUpdate({
        target: [stravaActivities.userId, stravaActivities.id],
        set: row,
      })
      .returning();
    return result;
  }

  async deleteAllStravaActivities(userId: string): Promise<void> {
    await this.claimLegacyRowsForUser(userId);
    await db.delete(stravaActivities).where(eq(stravaActivities.userId, userId));
  }

  async listPushSubscriptions(userId: string): Promise<PushSubscriptionRecord[]> {
    await this.claimLegacyRowsForUser(userId);
    return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  }

  async upsertPushSubscription(userId: string, endpoint: string, subscription: unknown): Promise<void> {
    await this.claimLegacyRowsForUser(userId);
    await db
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint,
        subscription,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
        set: {
          subscription,
          updatedAt: new Date().toISOString(),
        },
      });
  }

  async removePushSubscription(userId: string, endpoint?: string): Promise<void> {
    await this.claimLegacyRowsForUser(userId);
    if (endpoint) {
      await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
      return;
    }
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  }

  async getReminderSettings(userId: string): Promise<ReminderSettings | null> {
    await this.claimLegacyRowsForUser(userId);
    const [settings] = await db.select().from(reminderSettings).where(eq(reminderSettings.userId, userId)).limit(1);
    return settings ?? null;
  }

  async upsertReminderSettings(
    userId: string,
    settings: Pick<ReminderSettings, "timezone" | "longRideEveningBeforeEnabled" | "serviceDueDateEnabled" | "goalOneWeekCountdownEnabled">,
  ): Promise<ReminderSettings> {
    await this.claimLegacyRowsForUser(userId);
    const [result] = await db
      .insert(reminderSettings)
      .values({
        userId,
        ...settings,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [reminderSettings.userId],
        set: {
          ...settings,
          updatedAt: new Date().toISOString(),
        },
      })
      .returning();
    return result;
  }

  async listReminderSettingsUsers(): Promise<ReminderSettings[]> {
    return db.select().from(reminderSettings);
  }

  async createInAppNotification(
    userId: string,
    notification: Pick<InAppNotification, "type" | "title" | "body" | "payload">,
  ): Promise<InAppNotification> {
    await this.claimLegacyRowsForUser(userId);
    const [row] = await db
      .insert(inAppNotifications)
      .values({
        userId,
        ...notification,
      })
      .returning();
    return row;
  }

  async listInAppNotifications(userId: string): Promise<InAppNotification[]> {
    await this.claimLegacyRowsForUser(userId);
    return db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.userId, userId))
      .orderBy(desc(inAppNotifications.createdAt));
  }

  async markInAppNotificationRead(userId: string, id: string): Promise<void> {
    await this.claimLegacyRowsForUser(userId);
    await db
      .update(inAppNotifications)
      .set({ readAt: new Date().toISOString() })
      .where(and(eq(inAppNotifications.userId, userId), eq(inAppNotifications.id, id)));
  }

  async clearInAppNotifications(userId: string): Promise<void> {
    await this.claimLegacyRowsForUser(userId);
    await db.delete(inAppNotifications).where(eq(inAppNotifications.userId, userId));
  }

  async createNotificationDispatch(userId: string, dedupeKey: string, channel: string): Promise<boolean> {
    await this.claimLegacyRowsForUser(userId);
    const inserted = await db
      .insert(notificationDispatches)
      .values({
        userId,
        dedupeKey,
        channel,
      })
      .onConflictDoNothing()
      .returning();
    return inserted.length > 0;
  }
}

export const storage = new DatabaseStorage();

function normalizeMetricDate(rawDate: string): string {
  const trimmed = rawDate?.trim();
  if (!trimmed) {
    throw new Error("Metric date is required");
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Metric date must be a valid date string");
  }

  return parsed.toISOString().split("T")[0];
}
