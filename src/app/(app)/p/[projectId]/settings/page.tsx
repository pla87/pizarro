import { notFound } from "next/navigation";
import { CanonicalTabParam } from "@/components/CanonicalTabParam";
import { visibleProjectsWhere } from "@/lib/access";
import { appTimeZone, listKinds, projectReleaseTemplates } from "@/lib/board";
import { projectPlanTemplates } from "@/lib/ai-plan-templates";
import { dateToIso } from "@/lib/dates";
import { db } from "@/lib/db";
import { requireUserPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { projectSectionMetadata } from "../project-title";
import { normalizeTaskFields } from "@/lib/task-fields";
import { emailEnabled } from "@/lib/mail";
import { invitePendingFrom } from "@/lib/user-entered";
import { googleEnabled } from "@/lib/google";
import { googleWorkspaceDomain } from "@/lib/google-config";
import { effectiveShareMode } from "@/lib/google-share";
import { largestAttachments, projectStorage } from "@/lib/storage-stats";
import { ProjectSettings } from "./ProjectSettings";
import { StorageSection } from "./StorageSection";
import { resolveProjectSettingsTab } from "./project-settings-tabs";
import { ReportScheduleSection } from "./ReportScheduleSection";
import { reportRecipientPeople, reportRecipientView, reportUnsubscribedView } from "@/lib/report-recipient";
import { ApplyTemplate } from "./ApplyTemplate";
import { ShareOutSettings } from "./ShareOutSettings";
import { countActiveShares } from "@/lib/share-out";
import { undoableTemplateChange } from "@/lib/template-apply";
import { TEMPLATE_UNDO_HOURS } from "@/lib/template-apply-core";

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }) {
  const t = await getT();
  return projectSectionMetadata(params, t("Ajustes del proyecto"));
}

export default async function ProjectSettingsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUserPage();
  const { projectId } = await params;
  const { tab: tabParam } = await searchParams;
  const isAdmin = user.role === "ADMIN";
  const project = await db.project.findFirst({
    where: { id: projectId, ...visibleProjectsWhere(user) },
    select: {
      id: true,
      name: true,
      description: true,
      isPrivate: true,
      releaseZipMaxMb: true,
      taskAttachMaxMb: true,
      googleShareMode: true,
      fileMaxMb: true,
      taskFields: true,
      shareOutEnabled: true,
      _count: { select: { columns: { where: { role: "BUDGET" } } } },
      hiddenKinds: { select: { kindId: true } },
      members: {
        select: { userId: true, user: { select: { name: true, active: true, role: true, mustChangePassword: true, googleSub: true, _count: { select: { sessions: true, knownDevices: true } } } } },
        orderBy: { user: { name: "asc" } },
      },
      labels: { orderBy: { name: "asc" }, select: { id: true, name: true, color: true } },
      kinds: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, color: true, titleTemplate: true, descriptionTemplate: true, subtaskTemplate: true },
      },
      deliverables: {
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { position: "asc" }],
        select: { id: true, name: true, description: true, dueDate: true },
      },
    },
  });
  if (!project) notFound();
  // Gestionan el proyecto los administradores y, si es privado, sus miembros (como en las acciones).
  const canManage = isAdmin || project.isPrivate;
  const asked = resolveProjectSettingsTab(tabParam, canManage);
  // Otro nombre de una pestaña («?tab=plantillas», «?tab=board»): se pinta la suya y el cliente pasa la dirección a su id
  // (el de los enlaces de las pestañas) conservando el ancla (`?tab=board#labels`), que un redirect perdía.
  const tab = asked.tab;
  // Una pestaña que existe pero es de gestión (quien no gestiona el proyecto no la tiene): se dice cuál es.
  const manageView = asked.kind === "unknown" && !canManage ? resolveProjectSettingsTab(tabParam, true) : null;
  const restricted = manageView && manageView.kind !== "unknown" ? manageView.tab : undefined;
  // Las cabeceras y pies solo se leen cuando se abre la pestaña Releases, que es donde se editan; el almacenamiento,
  // en la pestaña Adjuntos. Los administradores asignan usuarios a los proyectos de equipo; los miembros de un privado
  // añaden a otros usuarios.
  const showStorage = tab === "adjuntos" && canManage;
  // Tareas por tipo y por entregable con groupBy filtrado por sus ids: un `_count` de relación en la consulta del proyecto
  // agrupaba TODAS las tareas del servidor en cada carga (Prisma 7 lo hace con un LEFT JOIN a un GROUP BY sin filtro).
  const kindIds = project.kinds.map((k) => k.id);
  const deliverableIds = project.deliverables.map((d) => d.id);
  const [releaseTemplates, planTemplates, generalKinds, generalUsage, kindUsage, deliverableUsage, users, schedule, editorRow, storageInitial, storageLargest, templateChange, reportPeople] = await Promise.all([
    tab === "releases" ? projectReleaseTemplates(project.id) : Promise.resolve({ headers: [], footers: [] }),
    tab === "releases" ? projectPlanTemplates(project.id) : Promise.resolve({ headers: [], footers: [] }),
    listKinds(),
    db.task.groupBy({ by: ["kindId"], where: { projectId: project.id }, _count: { _all: true } }),
    kindIds.length ? db.task.groupBy({ by: ["kindId"], where: { kindId: { in: kindIds } }, _count: { _all: true } }) : Promise.resolve([]),
    deliverableIds.length
      ? db.task.groupBy({ by: ["deliverableId"], where: { deliverableId: { in: deliverableIds }, archivedAt: null }, _count: { _all: true } })
      : Promise.resolve([]),
    canManage ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }) : Promise.resolve([]),
    db.reportSchedule.findUnique({ where: { projectId: project.id }, select: { enabled: true, recipient: true, weekday: true, hour: true, unsubscribedEmail: true, unsubscribedAt: true } }),
    db.user.findUnique({ where: { id: user.id }, select: { editorMode: true } }),
    showStorage ? projectStorage(project.id) : Promise.resolve(null),
    showStorage ? largestAttachments(project.id, 20) : Promise.resolve(null),
    tab === "tablero" && canManage ? undoableTemplateChange(project.id) : Promise.resolve(null),
    tab === "informes" ? reportRecipientPeople(project.id) : Promise.resolve([]),
  ]);
  const unsubscribed = tab === "informes" && schedule ? await reportUnsubscribedView(schedule, reportPeople, user) : null;
  // «Compartir fuera» (solo administradores): cuántos enlaces activos dejarían de funcionar al apagarla.
  const shareLinks = tab === "tablero" && isAdmin && project.shareOutEnabled
    ? await countActiveShares(project.id)
    : 0;
  const hidden = new Set(project.hiddenKinds.map((h) => h.kindId));
  const usage = new Map(generalUsage.map((g) => [g.kindId, g._count._all]));
  const kindTasks = new Map(kindUsage.map((g) => [g.kindId, g._count._all]));
  const deliverableTasks = new Map(deliverableUsage.map((g) => [g.deliverableId, g._count._all]));
  const editorMode = editorRow?.editorMode ?? "MARKDOWN";

  const storageSection = storageInitial && storageLargest
    ? <StorageSection projectId={project.id} isAdmin={isAdmin} initial={storageInitial} initialLargest={storageLargest} />
    : null;

  return (
    <>
      {asked.kind === "alias" && <CanonicalTabParam tab={tab} />}
      <ProjectSettings
        // Aplicar o deshacer una plantilla cambia etiquetas y campos, que el formulario guarda en su estado: se vuelve a montar.
        key={templateChange ? templateChange.createdAt.toISOString() : "sin-cambio"}
        storageSection={storageSection}
        shareOutSection={tab === "tablero" && isAdmin ? <ShareOutSettings projectId={project.id} enabled={project.shareOutEnabled} activeLinks={shareLinks} /> : null}
        applyTemplate={tab === "tablero" && canManage ? (
          <ApplyTemplate
            projectId={project.id}
            lastChange={templateChange ? {
              templateName: templateChange.templateName,
              mode: templateChange.mode,
              createdAt: templateChange.createdAt.toISOString(),
              until: new Date(templateChange.createdAt.getTime() + TEMPLATE_UNDO_HOURS * 3_600_000).toISOString(),
              userName: templateChange.userName,
            } : null}
          />
        ) : null}
        isAdmin={isAdmin}
        tab={tab}
        unknownTab={asked.kind === "unknown" ? asked.asked : undefined}
        restrictedTab={restricted}
        releaseTemplates={releaseTemplates}
        planTemplates={planTemplates}
        currentUserId={user.id}
        project={{
          id: project.id,
          name: project.name,
          description: project.description,
          visibility: project.isPrivate ? "PRIVATE" : "TEAM",
          releaseZipMaxMb: project.releaseZipMaxMb,
          taskAttachMaxMb: project.taskAttachMaxMb,
          googleShareMode: effectiveShareMode(project.googleShareMode, project.isPrivate, { role: process.env.GOOGLE_SHARE_ROLE }),
          fileMaxMb: project.fileMaxMb,
          taskFields: normalizeTaskFields(project.taskFields),
          budgetColumns: project._count.columns,
          // El rol solo se dice en los de equipo (marca «admin» de un administrador asignado); en un privado no hace falta.
          // «Invitación pendiente»: aún no ha elegido contraseña ni ha entrado (el mismo criterio que Administración → Usuarios).
          members: project.members.map((m) => ({ id: m.userId, name: m.user.name, active: m.user.active, admin: !project.isPrivate && m.user.role === "ADMIN", invitePending: invitePendingFrom(m.user) })),
        }}
        labels={project.labels}
        kinds={project.kinds.map((k) => ({ id: k.id, name: k.name, color: k.color, titleTemplate: k.titleTemplate, descriptionTemplate: k.descriptionTemplate, subtaskTemplate: k.subtaskTemplate, taskCount: kindTasks.get(k.id) ?? 0 }))}
        generalKinds={generalKinds.map((k) => ({ ...k, enabled: !hidden.has(k.id), taskCount: usage.get(k.id) ?? 0 }))}
        deliverables={project.deliverables.map((d) => ({ id: d.id, name: d.name, description: d.description, dueDate: dateToIso(d.dueDate), taskCount: deliverableTasks.get(d.id) ?? 0 }))}
        users={users}
        emailAvailable={emailEnabled()}
        editorMode={editorMode}
        google={{ enabled: googleEnabled(), domain: googleWorkspaceDomain() ?? null }}
        reportSchedule={
          <ReportScheduleSection
            projectId={project.id}
            initial={schedule
              ? { enabled: schedule.enabled, weekday: schedule.weekday, hour: schedule.hour, recipient: reportRecipientView(schedule.recipient, reportPeople, isAdmin) }
              : { enabled: false, recipient: null, weekday: 1, hour: 8 }}
            unsubscribed={unsubscribed}
            people={reportPeople.map((p) => ({ id: p.id, name: p.name }))}
            currentUserId={user.id}
            emailAvailable={emailEnabled()}
            timeZone={appTimeZone()}
            recipients={project.isPrivate ? "members" : isAdmin ? "any" : "team"}
          />
        }
      />
    </>
  );
}
