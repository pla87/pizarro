import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { visibleProjectsWhere } from "@/lib/access";
import { appTimeZone, boardTaskSelect, listKinds, projectUsers, toBoardTask, userTemplates } from "@/lib/board";
import { dateToIso, todayIso } from "@/lib/dates";
import { googleEnabled } from "@/lib/google";
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
    select: { id: true, name: true, restricted: true, privateOwnerId: true },
  });
  if (!project) notFound();

  // Todas las consultas en paralelo: una sola ida y vuelta efectiva.
  const [columns, tasks, users, labels, me, deliverables, kinds, templates] = await Promise.all([
    db.column.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, name: true, position: true, role: true, isDone: true } }),
    db.task.findMany({ where: { projectId, archivedAt: null }, orderBy: { position: "asc" }, select: boardTaskSelect }),
    projectUsers(projectId, project),
    db.label.findMany({ where: { projectId }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { cardStyle: true, googleAccount: { select: { id: true } } },
    }),
    db.deliverable.findMany({ where: { projectId }, orderBy: [{ position: "asc" }], select: { id: true, name: true, dueDate: true } }),
    listKinds(projectId),
    userTemplates(user.id),
  ]);

  const data: BoardData = {
    project: { id: project.id, name: project.name },
    columns,
    tasks: tasks.map(toBoardTask),
    users,
    labels,
    kinds,
    templates,
    cardStyle: me.cardStyle,
    currentUserId: user.id,
    deliverables: deliverables.map((d) => ({ id: d.id, name: d.name, dueDate: dateToIso(d.dueDate) })),
    google: { enabled: googleEnabled(), connected: Boolean(me.googleAccount) },
    today: todayIso(appTimeZone()),
  };
  const { task } = await searchParams;
  return <Board data={data} initialTaskId={typeof task === "string" ? task : null} />;
}
