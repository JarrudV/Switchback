import type { Express, Request, Response } from "express";
import { chatStorage } from "./storage";
import { getGeminiClient, getGeminiModel } from "../../gemini-client";

/*
Supported models: gemini-2.5-flash (fast), gemini-2.5-pro (advanced reasoning)
Usage: Include httpOptions with baseUrl and empty apiVersion when using AI Integrations (required)
*/

export function registerChatRoutes(app: Express): void {
  const requireUserId = (req: Request, res: Response): string | null => {
    const userId = (req as any)?.user?.claims?.sub;
    if (!userId || typeof userId !== "string") {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }
    return userId;
  };

  const parseConversationId = (rawId: string | string[] | undefined): number | null => {
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!id) return null;
    const parsed = parseInt(id, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  // Get all conversations
  app.get("/api/conversations", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const conversations = await chatStorage.getAllConversations(userId);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Get single conversation with messages
  app.get("/api/conversations/:id", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const id = parseConversationId(req.params.id);
      if (id == null) {
        return res.status(400).json({ error: "Invalid conversation id" });
      }
      const conversation = await chatStorage.getConversation(userId, id);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      const messages = await chatStorage.getMessagesByConversation(userId, id);
      res.json({ ...conversation, messages });
    } catch (error) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // Create new conversation
  app.post("/api/conversations", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { title } = req.body;
      const conversation = await chatStorage.createConversation(userId, title || "New Chat");
      res.status(201).json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  // Delete conversation
  app.delete("/api/conversations/:id", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const id = parseConversationId(req.params.id);
      if (id == null) {
        return res.status(400).json({ error: "Invalid conversation id" });
      }
      await chatStorage.deleteConversation(userId, id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  // Send message and get AI response (streaming)
  app.post("/api/conversations/:id/messages", async (req: Request, res: Response) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const conversationId = parseConversationId(req.params.id);
      if (conversationId == null) {
        return res.status(400).json({ error: "Invalid conversation id" });
      }
      const { content } = req.body;
      const conversation = await chatStorage.getConversation(userId, conversationId);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      // Save user message
      await chatStorage.createMessage(userId, conversationId, "user", content);

      // Get conversation history for context
      const messages = await chatStorage.getMessagesByConversation(userId, conversationId);
      const chatMessages = messages.map((m) => ({
        role: m.role as "user" | "model",
        parts: [{ text: m.content }],
      }));

      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Stream response from Gemini
      const ai = getGeminiClient();
      const stream = await ai.models.generateContentStream({
        model: getGeminiModel("gemini-2.5-flash"),
        contents: chatMessages,
        config: { maxOutputTokens: 8192 },
      });

      let fullResponse = "";

      for await (const chunk of stream) {
        const content = chunk.text || "";
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      // Save assistant message
      await chatStorage.createMessage(userId, conversationId, "assistant", fullResponse);

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error sending message:", error);
      // Check if headers already sent (SSE streaming started)
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Failed to send message" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to send message" });
      }
    }
  });
}
