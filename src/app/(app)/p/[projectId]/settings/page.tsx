import { notFound } from "next/navigation";
import { visibleProjectsWhere } from "@/lib/access";
import { appTimeZone, listKinds } from "@/lib/board";
import { dateToIso } from "@/lib/dates";
import { db } from "@/lib/db";
import { requireUserPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { emailEnabled } from "@/lib/mail";
import { ProjectSettings } from "./ProjectSettings";
import { ReportScheduleSection } from "./ReportScheduleSection";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Ajustes del proyecto") };
}

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
      isPrivate: true,
      releaseZipMaxMb: true,
      hiddenKinds: { select: { kindId: true } },
      members: { select: { userId: true, user: { select: { name: true, active: true } } }, orderBy: { user: { name: "asc" } } },
      labels: { orderBy: { name: "asc" }, select: { id: true, name: true, color: true } },
      kinds: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, color: true, titleTemplate: true, descriptionTemplate: true, subtaskTemplate: true, _count: { select: { tasks: true } } },
      },
      deliverables: {
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { position: "asc" }],
        select: { id: true, name: true, description: true, dueDate: true, _count: { select: { tasks: { where: { archivedAt: null } } } } },
      },
    },
  });
  if (!project) notFound();
  const [generalKinds, generalUsage] = await Promise.all([
    listKinds(),
    db.task.groupBy({ by: ["kindId"], where: { projectId: project.id }, _count: { _all: true } }),
  ]);
  const hidden = new Set(project.hiddenKinds.map((h) => h.kindId));
  const usage = new Map(generalUsage.map((g) => [g.kindId, g._count._all]));
  // Los administradores asignan usuarios a los proyectos de equipo; los miembros de un privado añaden a otros usuarios.
  const users = isAdmin || project.isPrivate
    ? await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } })
    : [];

  const schedule = await db.reportSchedule.findUnique({ where: { projectId: project.id }, select: { enabled: true, recipient: true, weekday: true, hour: true } });
  const editorMode = (await db.user.findUnique({ where: { id: user.id }, select: { editorMode: true } }))?.editorMode ?? "MARKDOWN";

  return (
    <ProjectSettings
      isAdmin={isAdmin}
      currentUserId={user.id}
      project={{
        id: project.id,
        name: project.name,
        description: project.description,
        visibility: project.isPrivate ? "PRIVATE" : "TEAM",
        releaseZipMaxMb: project.releaseZipMaxMb,
        members: project.members.map((m) => ({ id: m.userId, name: m.user.name, active: m.user.active })),
      }}
      labels={project.labels}
      kinds={project.kinds.map((k) => ({ id: k.id, name: k.name, color: k.color, titleTemplate: k.titleTemplate, descriptionTemplate: k.descriptionTemplate, subtaskTemplate: k.subtaskTemplate, taskCount: k._count.tasks }))}
      generalKinds={generalKinds.map((k) => ({ ...k, enabled: !hidden.has(k.id), taskCount: usage.get(k.id) ?? 0 }))}
      deliverables={project.deliverables.map((d) => ({ id: d.id, name: d.name, description: d.description, dueDate: dateToIso(d.dueDate), taskCount: d._count.tasks }))}
      users={users}
      editorMode={editorMode}
      reportSchedule={
        <ReportScheduleSection
          projectId={project.id}
          initial={schedule ?? { enabled: false, recipient: user.email, weekday: 1, hour: 8 }}
          emailAvailable={emailEnabled()}
          timeZone={appTimeZone()}
        />
      }
    />
  );
}
