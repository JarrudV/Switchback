import webpush from "web-push";
import { storage } from "./storage";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

let configured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
} else {
  console.warn("[push] VAPID env vars are missing. Push delivery is disabled; using in-app fallback only.");
}

export function isPushConfigured() {
  return configured;
}

export function getPublicVapidKey() {
  return VAPID_PUBLIC_KEY ?? null;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export async function sendPushToUserSubscriptions(userId: string, payload: PushPayload): Promise<number> {
  if (!configured) {
    return 0;
  }

  const subscriptions = await storage.listPushSubscriptions(userId);
  if (subscriptions.length === 0) {
    return 0;
  }

  const payloadJson = JSON.stringify(payload);
  let sent = 0;

  for (const item of subscriptions) {
    try {
      await webpush.sendNotification(item.subscription as webpush.PushSubscription, payloadJson);
      sent++;
    } catch (error: any) {
      const statusCode = error?.statusCode;
      // Endpoint invalidated remotely; remove to keep subscription set clean.
      if (statusCode === 404 || statusCode === 410) {
        await storage.removePushSubscription(userId, item.endpoint);
      }
    }
  }

  return sent;
}
