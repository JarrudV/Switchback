import { users, type User, type UpsertUser } from "@shared/models/auth";
import { db } from "./db";
import { eq, sql } from "drizzle-orm";

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserProfile(id: string, updates: Pick<UpsertUser, "age" | "firstName" | "lastName">): Promise<User | undefined>;
}

import {
  sessions,
  metrics,
  serviceItems,
  goalEvents,
  stravaActivities,
  appSettings,
  pushSubscriptions,
  reminderSettings,
  inAppNotifications,
  notificationDispatches,
} from "@shared/schema";

class AuthStorage implements IAuthStorage {
  private ensureUsersAgeColumnPromise: Promise<void> | null = null;

  private async ensureUsersAgeColumn(): Promise<void> {
    if (!this.ensureUsersAgeColumnPromise) {
      this.ensureUsersAgeColumnPromise = (async () => {
        await db.execute(sql`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS age integer`);
      })();
    }

    await this.ensureUsersAgeColumnPromise;
  }

  async getUser(id: string): Promise<User | undefined> {
    await this.ensureUsersAgeColumn();
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  private stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
    const entries = Object.entries(obj).filter(([, value]) => value !== undefined);
    return Object.fromEntries(entries) as Partial<T>;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    await this.ensureUsersAgeColumn();

    if (userData.email) {
      const [existingUser] = await db.select().from(users).where(eq(users.email, userData.email));
      if (existingUser && existingUser.id !== userData.id) {
        const oldId = existingUser.id;
        const newId = userData.id as string;

        console.log(`[auth] Migrating data for ${userData.email} from old ID (${oldId}) to Firebase ID (${newId})`);

        await db.update(sessions).set({ userId: newId }).where(eq(sessions.userId, oldId));
        await db.update(metrics).set({ userId: newId }).where(eq(metrics.userId, oldId));
        await db.update(serviceItems).set({ userId: newId }).where(eq(serviceItems.userId, oldId));
        await db.update(goalEvents).set({ userId: newId }).where(eq(goalEvents.userId, oldId));
        await db.update(stravaActivities).set({ userId: newId }).where(eq(stravaActivities.userId, oldId));
        await db.update(appSettings).set({ userId: newId }).where(eq(appSettings.userId, oldId));
        await db.update(pushSubscriptions).set({ userId: newId }).where(eq(pushSubscriptions.userId, oldId));
        await db.update(reminderSettings).set({ userId: newId }).where(eq(reminderSettings.userId, oldId));
        await db.update(inAppNotifications).set({ userId: newId }).where(eq(inAppNotifications.userId, oldId));
        await db.update(notificationDispatches).set({ userId: newId }).where(eq(notificationDispatches.userId, oldId));

        await db.delete(users).where(eq(users.id, oldId));
      }
    }

    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...this.stripUndefined(userData),
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async updateUserProfile(
    id: string,
    updates: Pick<UpsertUser, "age" | "firstName" | "lastName">,
  ): Promise<User | undefined> {
    await this.ensureUsersAgeColumn();

    const safeUpdates = this.stripUndefined({
      ...updates,
      updatedAt: new Date(),
    });

    const [user] = await db
      .update(users)
      .set(safeUpdates)
      .where(eq(users.id, id))
      .returning();
    return user;
  }
}

export const authStorage = new AuthStorage();
