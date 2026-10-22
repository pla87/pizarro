import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
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
  const rows = await db.notification.findMany({
    // Solo avisos de tareas que el usuario sigue pudiendo ver.
    where: { userId: user.id, task: { project: visibleProjectsWhere(user) } },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    select: {
      id: true,
      excerpt: true,
      createdAt: true,
      readAt: true,
      emailSentAt: true,
      whatsappSentAt: true,
      actor: { select: { id: true, name: true } },
      task: { select: { id: true, title: true, project: { select: { id: true, name: true } } } },
    },
  });
  const hasMore = rows.length > limit;
  return (
    <NotificationList
      // Al cargar más cambia la lista del servidor: se reinicia el estado local.
      key={limit}
      moreHref={hasMore ? `?limit=${limit + PAGE_STEP}` : null}
      items={rows.slice(0, limit).map((n) => ({
        id: n.id,
        excerpt: n.excerpt,
        createdAt: n.createdAt.toISOString(),
        read: Boolean(n.readAt),
        viaEmail: Boolean(n.emailSentAt),
        viaWhatsapp: Boolean(n.whatsappSentAt),
        actor: n.actor,
        task: n.task ? { id: n.task.id, title: n.task.title, projectId: n.task.project.id, projectName: n.task.project.name } : null,
      }))}
    />
  );
}
