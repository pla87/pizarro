import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { visibleProjectsWhere } from "@/lib/access";
import { boardTaskSelect, projectUsers, toBoardTask } from "@/lib/board";
import { db } from "@/lib/db";
import { getCurrentUser, requireUserPage } from "@/lib/session";
import type { BoardData } from "@/lib/types";
import { Board } from "@/components/board/Board";

type Params = { params: Promise<{ projectId: string }>; searchParams: Promise<{ task?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const user = await getCurrentUser();
  const { projectId } = await params;
  // Solo se muestra el nombre si el usuario tiene acceso al proyecto.
  const p = user ? await db.project.findFirst({ where: { id: projectId, ...visibleProjectsWhere(user) }, select: { name: true } }) : null;
  return { title: p?.name ?? "Tablero" };
}

export default async function BoardPage({ params, searchParams }: Params) {
  const user = await requireUserPage();
  const { projectId } = await params;
  const project = await db.project.findFirst({
    where: { id: projectId, ...visibleProjectsWhere(user) },
    select: { id: true, name: true, restricted: true },
  });
  if (!project) notFound();

  // Todas las consultas en paralelo: una sola ida y vuelta efectiva.
  const [columns, tasks, users, labels, me] = await Promise.all([
    db.column.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, name: true, position: true, role: true } }),
    db.task.findMany({ where: { projectId, archivedAt: null }, orderBy: { position: "asc" }, select: boardTaskSelect }),
    projectUsers(projectId, project.restricted),
    db.label.findMany({ where: { projectId }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { releaseHeaderTemplate: true, releaseFooterTemplate: true } }),
  ]);

  const data: BoardData = {
    project: { id: project.id, name: project.name },
    columns,
    tasks: tasks.map(toBoardTask),
    users,
    labels,
    templates: { header: me.releaseHeaderTemplate, footer: me.releaseFooterTemplate },
    currentUserId: user.id,
  };
  const { task } = await searchParams;
  return <Board data={data} initialTaskId={typeof task === "string" ? task : null} />;
}
