import { db } from "../../db";
import { conversations, messages } from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";

const LEGACY_USER_ID = "__legacy__";
const migratedUsers = new Set<string>();

export interface IChatStorage {
  getConversation(userId: string, id: number): Promise<typeof conversations.$inferSelect | undefined>;
  getAllConversations(userId: string): Promise<(typeof conversations.$inferSelect)[]>;
  createConversation(userId: string, title: string): Promise<typeof conversations.$inferSelect>;
  deleteConversation(userId: string, id: number): Promise<void>;
  getMessagesByConversation(userId: string, conversationId: number): Promise<(typeof messages.$inferSelect)[]>;
  createMessage(userId: string, conversationId: number, role: string, content: string): Promise<typeof messages.$inferSelect>;
}

async function claimLegacyConversationsForUser(userId: string): Promise<void> {
  if (!userId || userId === LEGACY_USER_ID || migratedUsers.has(userId)) {
    return;
  }

  const [hasConversations] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .limit(1);

  if (!hasConversations) {
    await db.update(conversations).set({ userId }).where(eq(conversations.userId, LEGACY_USER_ID));
    await db.update(messages).set({ userId }).where(eq(messages.userId, LEGACY_USER_ID));
  }

  migratedUsers.add(userId);
}

export const chatStorage: IChatStorage = {
  async getConversation(userId: string, id: number) {
    await claimLegacyConversationsForUser(userId);
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userId, userId), eq(conversations.id, id)));
    return conversation;
  },

  async getAllConversations(userId: string) {
    await claimLegacyConversationsForUser(userId);
    return db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.createdAt));
  },

  async createConversation(userId: string, title: string) {
    await claimLegacyConversationsForUser(userId);
    const [conversation] = await db.insert(conversations).values({ userId, title }).returning();
    return conversation;
  },

  async deleteConversation(userId: string, id: number) {
    await claimLegacyConversationsForUser(userId);
    await db.delete(messages).where(and(eq(messages.userId, userId), eq(messages.conversationId, id)));
    await db.delete(conversations).where(and(eq(conversations.userId, userId), eq(conversations.id, id)));
  },

  async getMessagesByConversation(userId: string, conversationId: number) {
    await claimLegacyConversationsForUser(userId);
    return db
      .select()
      .from(messages)
      .where(and(eq(messages.userId, userId), eq(messages.conversationId, conversationId)))
      .orderBy(messages.createdAt);
  },

  async createMessage(userId: string, conversationId: number, role: string, content: string) {
    await claimLegacyConversationsForUser(userId);
    const [message] = await db
      .insert(messages)
      .values({ userId, conversationId, role, content })
      .returning();
    return message;
  },
};
