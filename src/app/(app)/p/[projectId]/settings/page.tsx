import { notFound } from "next/navigation";
import { visibleProjectsWhere } from "@/lib/access";
import { db } from "@/lib/db";
import { requireUserPage } from "@/lib/session";
import { ProjectSettings } from "./ProjectSettings";

export const metadata = { title: "Ajustes del proyecto" };

export default async function ProjectSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await requireUserPage();
  const { projectId } = await params;
  const isAdmin = user.role === "ADMIN";
  const project = await db.project.findFirst({
    where: { id: projectId, ...visibleProjectsWhere(user) },
    select: {
      id: true,
      name: true,
      description: true,
      restricted: true,
      members: { select: { userId: true } },
      labels: { orderBy: { name: "asc" }, select: { id: true, name: true, color: true } },
      tasks: {
        where: { archivedAt: { not: null } },
        orderBy: { archivedAt: "desc" },
        take: 100,
        select: { id: true, title: true, type: true, archivedAt: true },
      },
    },
  });
  if (!project) notFound();
  const users = isAdmin
    ? await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } })
    : [];

  return (
    <ProjectSettings
      isAdmin={isAdmin}
      project={{
        id: project.id,
        name: project.name,
        description: project.description,
        restricted: project.restricted,
        memberIds: project.members.map((m) => m.userId),
      }}
      labels={project.labels}
      archived={project.tasks.map((t) => ({ id: t.id, title: t.title, type: t.type, archivedAt: t.archivedAt!.toISOString() }))}
      users={users}
    />
  );
}
