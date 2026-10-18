import { db } from "@/lib/db";
import { requireUserPage } from "@/lib/session";
import { NotificationList } from "./NotificationList";

export const metadata = { title: "Avisos" };

export default async function NotificationsPage() {
  const user = await requireUserPage();
  const rows = await db.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
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
  return (
    <NotificationList
      items={rows.map((n) => ({
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
