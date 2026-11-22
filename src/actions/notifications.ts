"use server";

import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { countUnread } from "@/lib/notification-access";
import { requireUser } from "@/lib/session";
import * as v from "@/lib/validation";

// Las dos devuelven el recuento real de sin leer de después (con el tope de 100, el mismo que el del layout): la cabecera
// lo pone tal cual. Bajarlo en el navegador se desincronizaba con otra pestaña abierta o con más de 100 sin leer.

export async function markNotificationRead(notificationId: string) {
  return runAction({ name: "notifications.markNotificationRead", args: [notificationId] }, async () => {
    const user = await requireUser();
    await db.notification.updateMany({ where: { id: v.id.parse(notificationId), userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { unreadCount: await countUnread(user.id, user.role) };
  });
}

export async function markAllNotificationsRead() {
  return runAction({ name: "notifications.markAllNotificationsRead", args: [] }, async () => {
    const user = await requireUser();
    await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    // Normalmente 0; uno que llegue justo después de marcar sí cuenta.
    return { unreadCount: await countUnread(user.id, user.role) };
  });
}
