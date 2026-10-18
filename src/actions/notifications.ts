"use server";

import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { requireUser } from "@/lib/session";
import * as v from "@/lib/validation";

export async function markNotificationRead(notificationId: string) {
  return runAction(async () => {
    const user = await requireUser();
    await db.notification.updateMany({ where: { id: v.id.parse(notificationId), userId: user.id, readAt: null }, data: { readAt: new Date() } });
  });
}

export async function markAllNotificationsRead() {
  return runAction(async () => {
    const user = await requireUser();
    await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  });
}
