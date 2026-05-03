import cron from "node-cron";
import { DateTime } from "luxon";
import { storage } from "./storage";
import { sendPushToUserSubscriptions } from "./push";

let started = false;

function inReminderWindow(now: DateTime, hour: number) {
  return now.hour === hour && now.minute < 5;
}

async function dispatchReminder(
  userId: string,
  dedupeKey: string,
  type: string,
  title: string,
  body: string,
  url: string,
) {
  const firstDispatch = await storage.createNotificationDispatch(userId, dedupeKey, "reminder");
  if (!firstDispatch) {
    return;
  }

  const sentCount = await sendPushToUserSubscriptions(userId, {
    title,
    body,
    url,
    tag: dedupeKey,
  });

  if (sentCount > 0) {
    return;
  }

  await storage.createInAppNotification(userId, {
    type,
    title,
    body,
    payload: { url },
  });
}

async function processUserReminderSchedule(userId: string, timezone: string) {
  const now = DateTime.now().setZone(timezone);
  const zonedNow = now.isValid ? now : DateTime.now().setZone("UTC");
  const today = zonedNow.toISODate();
  if (!today) {
    return;
  }

  const settings = await storage.getReminderSettings(userId);
  if (!settings) {
    return;
  }

  if (settings.longRideEveningBeforeEnabled && inReminderWindow(zonedNow, 19)) {
    const tomorrow = zonedNow.plus({ days: 1 }).toISODate();
    if (tomorrow) {
      const sessions = await storage.getSessions(userId);
      const longRides = sessions.filter(
        (session) =>
          session.type === "Long Ride" &&
          session.scheduledDate === tomorrow &&
          !session.completed,
      );
      for (const session of longRides) {
        await dispatchReminder(
          userId,
          `long-ride:${session.id}:${tomorrow}`,
          "long_ride",
          "Long Ride Reminder",
          `${session.description} is scheduled for tomorrow.`,
          "/",
        );
      }
    }
  }

  if (inReminderWindow(zonedNow, 9)) {
    if (settings.serviceDueDateEnabled) {
      const serviceItems = await storage.getServiceItems(userId);
      const dueItems = serviceItems.filter(
        (item) => item.dueDate === today && item.status !== "Done",
      );
      for (const item of dueItems) {
        await dispatchReminder(
          userId,
          `service-due:${item.id}:${today}`,
          "service_due",
          "Service Item Due Today",
          `${item.item} is due today.`,
          "/",
        );
      }
    }

    if (settings.goalOneWeekCountdownEnabled) {
      const goal = await storage.getGoal(userId);
      const oneWeekOut = zonedNow.plus({ days: 7 }).toISODate();
      if (goal?.startDate && oneWeekOut && goal.startDate === oneWeekOut) {
        await dispatchReminder(
          userId,
          `goal-countdown:${goal.id}:${today}`,
          "goal_countdown",
          "1 Week to Goal Event",
          `${goal.name} is one week away.`,
          "/",
        );
      }
    }
  }
}

async function runReminderSweep() {
  const users = await storage.listReminderSettingsUsers();
  for (const reminder of users) {
    const shouldProcess =
      reminder.longRideEveningBeforeEnabled ||
      reminder.serviceDueDateEnabled ||
      reminder.goalOneWeekCountdownEnabled;

    if (!shouldProcess) {
      continue;
    }

    const now = DateTime.now().setZone(reminder.timezone || "UTC");
    const zonedNow = now.isValid ? now : DateTime.now().setZone("UTC");

    if (
      (reminder.longRideEveningBeforeEnabled && inReminderWindow(zonedNow, 19)) ||
      ((reminder.serviceDueDateEnabled || reminder.goalOneWeekCountdownEnabled) &&
        inReminderWindow(zonedNow, 9))
    ) {
      await processUserReminderSchedule(reminder.userId, reminder.timezone || "UTC");
    }
  }
}

export function startReminderScheduler() {
  if (started) {
    return;
  }
  started = true;
  cron.schedule("*/5 * * * *", () => {
    runReminderSweep().catch((error) => {
      console.error("[reminders] scheduler run failed:", error instanceof Error ? error.message : "unknown");
    });
  });
}
