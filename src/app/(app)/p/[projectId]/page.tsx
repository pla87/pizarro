import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { visibleProjectsWhere } from "@/lib/access";
import { appTimeZone, listKinds, loadBoardTasks, projectUsers, userTemplates } from "@/lib/board";
import { dateToIso, todayIso } from "@/lib/dates";
import { googleEnabled } from "@/lib/google";
import { db } from "@/lib/db";
import { getCurrentUser, requireUserPage } from "@/lib/session";
import { effectiveFileMaxMb } from "@/lib/upload-size";
import type { BoardData } from "@/lib/types";
import { getLocale, getT } from "@/i18n/server";
import { localizeGeneralKinds } from "@/lib/kinds-localize";
import { Board } from "@/components/board/Board";

type Params = { params: Promise<{ projectId: string }>; searchParams: Promise<{ task?: string }> };

// Una sola consulta por petición para el título y la página.
const visibleProject = cache(async (projectId: string) => {
  const user = await getCurrentUser();
  return user ? db.project.findFirst({ where: { id: projectId, ...visibleProjectsWhere(user) }, select: { id: true, name: true, isPrivate: true, taskAttachMaxMb: true, fileMaxMb: true } }) : null;
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getT();
  const { projectId } = await params;
  // Solo se muestra el nombre si el usuario tiene acceso al proyecto.
  const p = await visibleProject(projectId);
  return { title: p?.name ?? t("Tablero") };
}

export default async function BoardPage({ params, searchParams }: Params) {
  const user = await requireUserPage();
  const { projectId } = await params;
  const project = await visibleProject(projectId);
  if (!project) notFound();

  // Todas las consultas en paralelo: una sola ida y vuelta efectiva.
  const [columns, tasks, users, labels, me, deliverables, kinds, templates] = await Promise.all([
    db.column.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, name: true, position: true, role: true, isDone: true, waitingDays: true } }),
    loadBoardTasks(projectId),
    projectUsers(projectId, project),
    db.label.findMany({ where: { projectId }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { cardStyle: true, editorMode: true, googleAccount: { select: { id: true } } },
    }),
    db.deliverable.findMany({ where: { projectId }, orderBy: [{ position: "asc" }], select: { id: true, name: true, dueDate: true } }),
    listKinds(projectId),
    userTemplates(user.id),
  ]);

  const data: BoardData = {
    project: { id: project.id, name: project.name, attachMaxMb: project.taskAttachMaxMb, fileMaxMb: effectiveFileMaxMb(project.fileMaxMb) },
    columns,
    tasks,
    users,
    labels,
    kinds: localizeGeneralKinds(kinds, await getLocale()),
    templates,
    cardStyle: me.cardStyle,
    editorMode: me.editorMode,
    currentUserId: user.id,
    deliverables: deliverables.map((d) => ({ id: d.id, name: d.name, dueDate: dateToIso(d.dueDate) })),
    google: { enabled: googleEnabled(), connected: Boolean(me.googleAccount) },
    today: todayIso(appTimeZone()),
  };
  const { task } = await searchParams;
  return <Board data={data} initialTaskId={typeof task === "string" ? task : null} />;
}
