"use server";

import { rateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { describeAction, noteProject } from "@/lib/action-context";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { assertProjectAccess, visibleProjectsWhere } from "@/lib/access";
import { defaultColumns, PALETTE } from "@/lib/constants";
import { getLocale } from "@/i18n/server";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/positions";
import { localizeTemplate } from "@/lib/builtin-templates-en";
import { buildTemplateApplication, parseStoredTemplate, type TemplateData } from "@/lib/project-templates";
import { requireUser, type CurrentUser } from "@/lib/session";
import { purgeProject } from "@/lib/project-delete";
import * as v from "@/lib/validation";
import { dateToIso, isoToDate } from "@/lib/dates";
import type { LabelOption } from "@/lib/types";
import { revokeProject } from "@/lib/revoke";
import { GOOGLE_SHARE_MODES, isDomainMode } from "@/lib/google-share";
import { assertDeliverableCapacity, assertDeliverableCreateRate, assertLabelCapacity, assertLabelCreateRate } from "@/lib/caps";

/** Crea columnas, tipos propios, tipos generales ocultos y etiquetas de una plantilla en el proyecto (dentro de la transacción). */
async function applyTemplate(tx: Prisma.TransactionClient, projectId: string, template: TemplateData, locale: "es" | "en") {
  const general = await tx.taskKind.findMany({ where: { projectId: null }, orderBy: { position: "asc" }, select: { id: true, name: true } });
  const app = buildTemplateApplication(template, general, locale);
  await tx.column.createMany({ data: app.columns.map((c) => ({ ...c, projectId })) });
  if (app.kinds.length) await tx.taskKind.createMany({ data: app.kinds.map((k) => ({ ...k, projectId })) });
  if (app.hiddenKindIds.length) await tx.projectHiddenKind.createMany({ data: app.hiddenKindIds.map((kindId) => ({ projectId, kindId })) });
  if (app.labels.length) await tx.label.createMany({ data: app.labels.map((l) => ({ ...l, projectId })) });
}

/**
 * Proyecto sobre el que el usuario puede actuar (renombrar, borrar, cambiar miembros): los administradores
 * en cualquier proyecto que vean; el resto, solo en privados de los que son miembros (las
 * consultas ya filtran por visibilidad, así que un privado ajeno no existe para nadie).
 */
async function findManageableProject(user: CurrentUser, projectId: string) {
  const project = await db.project.findFirst({ where: { id: v.id.parse(projectId), ...visibleProjectsWhere(user) }, select: { id: true, name: true, isPrivate: true } });
  if (!project) throw notFound();
  noteProject(project.id, project.isPrivate);
  if (user.role !== "ADMIN" && !project.isPrivate) throw forbidden();
  return project;
}


export async function createProject(name: string, options?: { templateId?: string | null; isPrivate?: boolean }) {
  return runAction({ name: "projects.createProject", args: [name, options] }, async () => {
    const user = await requireUser();
    // Quien no es administrador solo puede crear proyectos privados (y sin plantillas, que gestionan los admins).
    if (user.role !== "ADMIN" && (!options?.isPrivate || options.templateId)) throw forbidden();
    if (!rateLimit(`project-create:${user.id}`, 10, 60 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.");
    if (user.role !== "ADMIN" && (await db.project.count({ where: { privateOwnerId: user.id } })) >= 100) {
      throw new AppError("Has llegado al máximo de proyectos privados.");
    }
    const projectName = v.name.parse(name);
    const templateRow = options?.templateId
      ? await db.projectTemplate.findUnique({ where: { id: v.id.parse(options.templateId) } })
      : null;
    if (options?.templateId && !templateRow) throw new AppError("La plantilla ya no existe.");
    // Sin plantilla, las columnas por defecto salen en el idioma de quien crea el proyecto.
    const locale = await getLocale();
    // Una plantilla de serie sin modificar se aplica en inglés a quien usa la interfaz en inglés.
    const template = templateRow ? localizeTemplate(parseStoredTemplate(templateRow), templateRow.builtinKey, locale) : null;
    const last = await db.project.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
    const project = await db.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name: projectName,
          position: (last?.position ?? 0) + POSITION_STEP,
          isPrivate: !!options?.isPrivate,
          privateOwnerId: options?.isPrivate ? user.id : null,
          // El creador es el primer miembro del proyecto privado.
          // Si es de equipo, el admin que lo crea lo marca como proyecto en el que trabaja.
          ...(options?.isPrivate ? { members: { create: { userId: user.id } } } : { adminPicks: { create: { userId: user.id } } }),
          ...(template ? {} : { columns: { create: defaultColumns(locale).map((c, i) => ({ ...c, position: (i + 1) * POSITION_STEP })) } }),
        },
        select: { id: true },
      });
      if (template) await applyTemplate(tx, created.id, template, locale);
      return created;
    });
    describeAction(`Creó el proyecto «${projectName}»${options?.isPrivate ? " (privado)" : ""}${template ? ` con la plantilla «${templateRow!.name}»` : ""}`);
    noteProject(project.id);
    revalidatePath("/", "layout");
    return project;
  });
}

export async function updateProject(projectId: string, input: { name: string; description: string }) {
  return runAction({ name: "projects.updateProject", args: [projectId, input] }, async () => {
    const user = await requireUser();
    const data = z.object({ name: v.name, description: z.string().max(2000) }).parse(input);
    await findManageableProject(user, projectId);
    await db.project.update({ where: { id: projectId }, data });
    revalidatePath("/", "layout");
  });
}

/**
 * Topes (MB) de adjuntos del proyecto, guardados juntos: lo que pueden sumar los adjuntos de una tarea y
 * el tamaño de cada paquete ZIP de una release (que no puede ser menor que el de la tarea).
 */
export async function setAttachmentLimits(projectId: string, taskMb: number, zipMb: number) {
  return runAction({ name: "projects.setAttachmentLimits", args: [projectId, taskMb, zipMb] }, async () => {
    const user = await requireUser();
    const task = v.attachLimitMb.parse(taskMb);
    const zip = v.attachLimitMb.parse(zipMb);
    if (zip < task) throw new AppError("El paquete ZIP de una release no puede ser menor que el máximo de adjuntos de una tarea.");
    await findManageableProject(user, projectId);
    await db.project.update({ where: { id: projectId }, data: { taskAttachMaxMb: task, releaseZipMaxMb: zip } });
    describeAction(`Cambió el máximo de adjuntos por tarea a ${task} MB y el de cada ZIP de release a ${zip} MB`);
    revalidatePath(`/p/${projectId}/settings`);
  });
}

/**
 * Con quién se comparten los Docs/Sheets que se crean desde las tareas del proyecto. Los modos de dominio solo
 * existen en proyectos de equipo y con GOOGLE_WORKSPACE_DOMAIN configurado (se comprueba aquí, no solo en la pantalla).
 */
export async function setGoogleShareMode(projectId: string, mode: string) {
  return runAction({ name: "projects.setGoogleShareMode", args: [projectId, mode] }, async () => {
    const user = await requireUser();
    const parsed = z.enum(GOOGLE_SHARE_MODES).parse(mode);
    const project = await findManageableProject(user, projectId);
    if (isDomainMode(parsed)) {
      if (project.isPrivate) throw new AppError("Un proyecto privado no se puede compartir con todo el dominio.");
      if (!process.env.GOOGLE_WORKSPACE_DOMAIN) throw new AppError("Compartir con el dominio requiere configurar GOOGLE_WORKSPACE_DOMAIN en el servidor.");
    }
    await db.project.update({ where: { id: project.id }, data: { googleShareMode: parsed } });
    describeAction("Cambió cómo se comparten los documentos de Google");
    revalidatePath(`/p/${project.id}/settings`);
  });
}

/**
 * TEAM: lo ven los usuarios asignados (ProjectMember) y todos los administradores.
 * PRIVATE: solo sus miembros (quien lo marca como privado es el primero; ni el resto de administradores).
 * Al pasar a privado se desasignan las tarjetas de quien pierde el acceso y se quitan las elecciones de los
 * administradores; al pasar a equipo se conservan los miembros (los administradores pasan a «proyecto en el que trabajo»).
 * Si ya estaba en ese modo, no cambia nada (los usuarios se gestionan con addProjectMember/removeProjectMember).
 */
export async function setProjectVisibility(projectId: string, mode: "TEAM" | "PRIVATE") {
  return runAction({ name: "projects.setProjectVisibility", args: [projectId, mode] }, async () => {
    const user = await requireUser();
    if (user.role !== "ADMIN") throw forbidden();
    const id = v.id.parse(projectId);
    const visibility = z.enum(["TEAM", "PRIVATE"]).parse(mode);
    const current = await findManageableProject(user, id);
    if ((visibility === "PRIVATE") === current.isPrivate) return;
    if (visibility === "PRIVATE") {
      await db.$transaction([
        db.project.update({ where: { id }, data: { isPrivate: true, privateOwnerId: user.id } }),
        db.projectMember.deleteMany({ where: { projectId: id } }),
        db.projectMember.create({ data: { projectId: id, userId: user.id } }),
        db.adminProjectPick.deleteMany({ where: { projectId: id } }),
        // Las tarjetas asignadas a quien ya no tiene acceso quedan sin asignar.
        db.task.updateMany({ where: { projectId: id, assigneeId: { not: user.id } }, data: { assigneeId: null } }),
      ]);
    } else {
      const admins = await db.projectMember.findMany({ where: { projectId: id, user: { role: "ADMIN" } }, select: { userId: true } });
      await db.$transaction([
        db.project.update({ where: { id }, data: { isPrivate: false, privateOwnerId: null } }),
        db.projectMember.deleteMany({ where: { projectId: id, user: { role: "ADMIN" } } }),
        db.adminProjectPick.createMany({ data: admins.map((a) => ({ projectId: id, userId: a.userId })), skipDuplicates: true }),
      ]);
    }
    revokeProject(id);
    describeAction(`Cambió la visibilidad del proyecto a ${visibility === "TEAM" ? "equipo" : "privada"}`);
    revalidatePath("/", "layout");
  });
}

export async function deleteProject(projectId: string, confirmName: string) {
  return runAction({ name: "projects.deleteProject", args: [projectId] }, async () => {
    const user = await requireUser();
    const project = await findManageableProject(user, projectId);
    if (project.name !== confirmName) throw new AppError("El nombre no coincide.");
    await purgeProject(projectId);
    revalidatePath("/", "layout");
  });
}

// --- Usuarios asignados al proyecto -----------------------------------------------

/**
 * Asigna a un usuario activo al proyecto. En uno privado, cualquier miembro puede hacerlo; en uno de equipo,
 * los administradores (que ya ven todos los de equipo, así que no se asignan: lo eligen en su perfil).
 */
export async function addProjectMember(projectId: string, userId: string) {
  return runAction({ name: "projects.addProjectMember", args: [projectId, userId] }, async () => {
    const user = await requireUser();
    const project = await findManageableProject(user, projectId);
    const target = await db.user.findFirst({ where: { id: v.id.parse(userId), active: true }, select: { id: true, name: true, role: true } });
    if (!target) throw new AppError("Usuario no válido.");
    if (!project.isPrivate && target.role === "ADMIN") throw new AppError("Los administradores ven todos los proyectos de equipo: lo eligen en su perfil.");
    await db.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: target.id } },
      create: { projectId: project.id, userId: target.id },
      update: {},
    });
    describeAction(`Añadió a «${target.name}» al proyecto ${project.isPrivate ? "privado " : ""}«${project.name}»`);
    revalidatePath("/", "layout");
  });
}

/**
 * Quita la asignación de un usuario al proyecto (o sale uno mismo, en privados). Un proyecto privado debe conservar
 * algún miembro activo: el último no puede salir, tiene que borrar el proyecto. Las tarjetas que tuviera
 * asignadas quedan sin asignar y se cortan sus conexiones en vivo al proyecto.
 */
export async function removeProjectMember(projectId: string, userId: string) {
  return runAction({ name: "projects.removeProjectMember", args: [projectId, userId] }, async () => {
    const user = await requireUser();
    const project = await findManageableProject(user, projectId);
    const targetId = v.id.parse(userId);
    const member = await db.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: targetId } },
      select: { user: { select: { name: true } } },
    });
    if (!member) throw notFound();
    await db.$transaction(async (tx) => {
      // Bloquea el proyecto: dos miembros que salen a la vez no pueden dejar un privado sin nadie.
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${project.id} FOR UPDATE`;
      if (project.isPrivate) {
        const others = await tx.projectMember.count({ where: { projectId: project.id, userId: { not: targetId }, user: { active: true } } });
        if (others === 0) throw new AppError("Eres el último miembro: no puedes salir del proyecto, bórralo si ya no lo necesitas.");
      }
      await tx.projectMember.delete({ where: { projectId_userId: { projectId: project.id, userId: targetId } } });
      await tx.task.updateMany({ where: { projectId: project.id, assigneeId: targetId }, data: { assigneeId: null } });
    });
    // Quien sale deja de ver el tablero en vivo al momento (los demás se reconectan solos).
    revokeProject(project.id);
    const kind = project.isPrivate ? "privado " : "";
    describeAction(targetId === user.id ? `Salió del proyecto ${kind}«${project.name}»` : `Quitó a «${member.user.name}» del proyecto ${kind}«${project.name}»`);
    revalidatePath("/", "layout");
  });
}

/**
 * Proyectos de equipo en los que trabaja el administrador (salen en sus menús y selectores). Los privados de los
 * que es miembro aparecen siempre. Solo administradores; ids que no sean proyectos de equipo se ignoran.
 */
export async function setMyProjectPicks(projectIds: string[]) {
  return runAction({ name: "projects.setMyProjectPicks", args: [projectIds] }, async () => {
    const user = await requireUser();
    if (user.role !== "ADMIN") throw forbidden();
    const ids = [...new Set(z.array(v.id).max(500).parse(projectIds))];
    const valid = await db.project.findMany({ where: { id: { in: ids }, isPrivate: false }, select: { id: true } });
    await db.$transaction([
      db.adminProjectPick.deleteMany({ where: { userId: user.id } }),
      db.adminProjectPick.createMany({ data: valid.map((p) => ({ projectId: p.id, userId: user.id })) }),
    ]);
    describeAction(`Eligió ${valid.length} proyecto(s) en los que trabaja`);
    revalidatePath("/", "layout");
  });
}

// --- Etiquetas ---------------------------------------------------------------

const labelSchema = z.object({ name: v.name.max(40, "Máximo 40 caracteres."), color: z.enum(PALETTE) });

export async function createLabel(projectId: string, input: { name: string; color: string }) {
  return runAction({ name: "projects.createLabel", args: [projectId, input] }, async (): Promise<LabelOption> => {
    const user = await requireUser();
    await assertProjectAccess(user, v.id.parse(projectId));
    const data = labelSchema.parse(input);
    assertLabelCreateRate(user.id);
    const exists = await db.label.count({ where: { projectId, name: data.name } });
    if (exists) throw new AppError("Ya existe una etiqueta con ese nombre.");
    return db.$transaction(async (tx) => {
      await assertLabelCapacity(tx, projectId);
      return tx.label.create({ data: { projectId, ...data }, select: { id: true, name: true, color: true } });
    });
  });
}

async function findLabel(labelId: string) {
  const user = await requireUser();
  const label = await db.label.findFirst({
    where: { id: v.id.parse(labelId), project: visibleProjectsWhere(user) },
    select: { id: true, projectId: true },
  });
  if (!label) throw notFound();
  noteProject(label.projectId);
  return label;
}

export async function updateLabel(labelId: string, input: { name: string; color: string }) {
  return runAction({ name: "projects.updateLabel", args: [labelId, input] }, async () => {
    const label = await findLabel(labelId);
    const data = labelSchema.parse(input);
    const dup = await db.label.count({ where: { projectId: label.projectId, name: data.name, id: { not: label.id } } });
    if (dup) throw new AppError("Ya existe una etiqueta con ese nombre.");
    await db.label.update({ where: { id: label.id }, data });
  });
}

export async function deleteLabel(labelId: string) {
  return runAction({ name: "projects.deleteLabel", args: [labelId] }, async () => {
    const label = await findLabel(labelId);
    await db.label.delete({ where: { id: label.id } });
  });
}

// --- Entregables ---------------------------------------------------------------

const deliverableSchema = z.object({
  name: v.name.max(120, "Máximo 120 caracteres."),
  description: z.string().max(2000).default(""),
  dueDate: v.dayIso.default(null),
});

export async function createDeliverable(projectId: string, input: z.input<typeof deliverableSchema>) {
  return runAction({ name: "projects.createDeliverable", args: [projectId, input] }, async () => {
    const user = await requireUser();
    await assertProjectAccess(user, v.id.parse(projectId));
    const data = deliverableSchema.parse(input);
    assertDeliverableCreateRate(user.id);
    const d = await db.$transaction(async (tx) => {
      await assertDeliverableCapacity(tx, projectId);
      const last = await tx.deliverable.findFirst({ where: { projectId }, orderBy: { position: "desc" }, select: { position: true } });
      return tx.deliverable.create({
        data: { projectId, name: data.name, description: data.description, dueDate: data.dueDate ? isoToDate(data.dueDate) : null, position: (last?.position ?? 0) + POSITION_STEP },
        select: { id: true, name: true, description: true, dueDate: true },
      });
    });
    return { ...d, dueDate: dateToIso(d.dueDate) };
  });
}

async function findDeliverable(deliverableId: string) {
  const user = await requireUser();
  const d = await db.deliverable.findFirst({
    where: { id: v.id.parse(deliverableId), project: visibleProjectsWhere(user) },
    select: { id: true, projectId: true },
  });
  if (!d) throw notFound();
  noteProject(d.projectId);
  return d;
}

export async function updateDeliverable(deliverableId: string, input: z.input<typeof deliverableSchema>) {
  return runAction({ name: "projects.updateDeliverable", args: [deliverableId, input] }, async () => {
    const d = await findDeliverable(deliverableId);
    const data = deliverableSchema.parse(input);
    await db.deliverable.update({
      where: { id: d.id },
      data: { name: data.name, description: data.description, dueDate: data.dueDate ? isoToDate(data.dueDate) : null },
    });
  });
}

/** Las tarjetas del entregable no se borran: quedan sin entregable. */
export async function deleteDeliverable(deliverableId: string) {
  return runAction({ name: "projects.deleteDeliverable", args: [deliverableId] }, async () => {
    const d = await findDeliverable(deliverableId);
    await db.deliverable.delete({ where: { id: d.id } });
  });
}
