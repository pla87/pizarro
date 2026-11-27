import { unreadCount, visibleNotificationsWhere } from "@/lib/notification-access";
import { UNREAD_COUNT_CAP } from "@/lib/unread-core";
import { db } from "@/lib/db";
import { appTimeZone } from "@/lib/board";
import { todayIso } from "@/lib/dates";
import { overdueMyTasksCount } from "@/lib/my-tasks-server";
import { mentionsToPlain } from "@/lib/mentions";
import { requireUserPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { NotificationList } from "./NotificationList";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Avisos") };
}

const PAGE_STEP = 100;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ limit?: string | string[] }> }) {
  const user = await requireUserPage();
  const sp = await searchParams;
  const rawLimit = Number(Array.isArray(sp.limit) ? sp.limit[0] : sp.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit >= PAGE_STEP ? Math.min(Math.floor(rawLimit), 5000) : PAGE_STEP;
  const [rows, unreadTotal, overdue] = await Promise.all([db.notification.findMany({
    // Solo avisos de tareas (o de proyectos) que el usuario sigue pudiendo ver.
    where: visibleNotificationsWhere(user),
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    select: {
      id: true,
      type: true,
      excerpt: true,
      createdAt: true,
      readAt: true,
      emailSentAt: true,
      whatsappSentAt: true,
      telegramSentAt: true,
      actor: { select: { id: true, name: true } },
      task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } },
      project: { select: { id: true, name: true } },
      document: { select: { id: true, name: true, project: { select: { id: true, name: true } } } },
    },
  }),
  // Recuento real de los sin leer, no solo de los cargados (con 150 decía «100 sin leer»).
  // El mismo número que el del layout (memoizado por petición: una sola consulta).
  unreadCount(user.id, user.role),
  // Sin avisos nuevos no se dice «Estás al día» a secas si hay tareas vencidas en «Mis tareas» (un count barato).
  overdueMyTasksCount(user, todayIso(appTimeZone()))]);
  const hasMore = rows.length > limit;
  return (
    <NotificationList
      moreHref={hasMore ? `?limit=${limit + PAGE_STEP}` : null}
      unreadTotal={unreadTotal}
      unreadCap={UNREAD_COUNT_CAP}
      overdueTasks={overdue}
      items={rows.slice(0, limit).map((n) => ({
        id: n.id,
        type: n.type,
        excerpt: n.excerpt,
        createdAt: n.createdAt.toISOString(),
        read: Boolean(n.readAt),
        viaEmail: Boolean(n.emailSentAt),
        viaWhatsapp: Boolean(n.whatsappSentAt),
        viaTelegram: Boolean(n.telegramSentAt),
        actor: n.actor,
        task: n.task ? { id: n.task.id, title: mentionsToPlain(n.task.title), projectId: n.task.project.id, projectName: n.task.project.name } : null,
        project: !n.task && n.project ? { id: n.project.id, name: n.project.name } : null,
        doc: !n.task && n.document ? { id: n.document.id, name: n.document.name, projectId: n.document.project.id, projectName: n.document.project.name } : null,
      }))}
    />
  );
}
