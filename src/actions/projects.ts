"use server";

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
import { buildTemplateApplication, parseStoredTemplate, type TemplateData } from "@/lib/project-templates";
import { requireUser, type CurrentUser } from "@/lib/session";
import { purgeProject } from "@/lib/project-delete";
import * as v from "@/lib/validation";
import { dateToIso, isoToDate } from "@/lib/dates";
import type { LabelOption } from "@/lib/types";
import { revokeProject } from "@/lib/revoke";

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
  if (user.role !== "ADMIN" && !project.isPrivate) throw forbidden();
  return project;
}

/** Usuarios activos del proyecto privado (cuentan para que siga accesible). */
const activeMembers = (projectId: string, exceptUserId?: string) =>
  db.projectMember.count({ where: { projectId, user: { active: true }, ...(exceptUserId ? { userId: { not: exceptUserId } } : {}) } });

export async function createProject(name: string, options?: { templateId?: string | null; isPrivate?: boolean }) {
  return runAction({ name: "projects.createProject", args: [name, options] }, async () => {
    const user = await requireUser();
    // Quien no es administrador solo puede crear proyectos privados (y sin plantillas, que gestionan los admins).
    if (user.role !== "ADMIN" && (!options?.isPrivate || options.templateId)) throw forbidden();
    const projectName = v.name.parse(name);
    const templateRow = options?.templateId
      ? await db.projectTemplate.findUnique({ where: { id: v.id.parse(options.templateId) } })
      : null;
    if (options?.templateId && !templateRow) throw new AppError("La plantilla ya no existe.");
    const template = templateRow ? parseStoredTemplate(templateRow) : null;
    const last = await db.project.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
    // Sin plantilla, las columnas por defecto salen en el idioma de quien crea el proyecto.
    const locale = await getLocale();
    const project = await db.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name: projectName,
          position: (last?.position ?? 0) + POSITION_STEP,
          isPrivate: !!options?.isPrivate,
          privateOwnerId: options?.isPrivate ? user.id : null,
          // El creador es el primer miembro del proyecto privado.
          ...(options?.isPrivate ? { members: { create: { userId: user.id } } } : {}),
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
 * PUBLIC: todos los usuarios ven el proyecto. RESTRICTED: solo admins y memberIds.
 * PRIVATE: solo sus miembros (quien lo marca como privado es el primero; ni el resto de administradores).
 * Si ya era privado, los miembros no cambian (se gestionan con addProjectMember/removeProjectMember).
 */
export async function setProjectVisibility(projectId: string, mode: "PUBLIC" | "RESTRICTED" | "PRIVATE", memberIds: string[]) {
  return runAction({ name: "projects.setProjectVisibility", args: [projectId, mode, memberIds] }, async () => {
    const user = await requireUser();
    if (user.role !== "ADMIN") throw forbidden();
    const id = v.id.parse(projectId);
    const visibility = z.enum(["PUBLIC", "RESTRICTED", "PRIVATE"]).parse(mode);
    const current = await findManageableProject(user, id);
    if (visibility === "PRIVATE" && current.isPrivate) return;
    const ids = visibility === "RESTRICTED" ? [...new Set(z.array(v.id).max(50).parse(memberIds))] : [];
    const valid = await db.user.count({ where: { id: { in: ids } } });
    if (valid !== ids.length) throw new AppError("Usuario no válido.");
    const finalMembers = visibility === "PRIVATE" ? [user.id] : ids;
    await db.$transaction([
      db.project.update({
        where: { id },
        data: { restricted: visibility === "RESTRICTED", isPrivate: visibility === "PRIVATE", privateOwnerId: visibility === "PRIVATE" ? user.id : null },
      }),
      db.projectMember.deleteMany({ where: { projectId: id } }),
      db.projectMember.createMany({ data: finalMembers.map((userId) => ({ projectId: id, userId })) }),
      // Al hacerlo privado, las tarjetas asignadas a quien ya no tiene acceso quedan sin asignar.
      ...(visibility === "PRIVATE" ? [db.task.updateMany({ where: { projectId: id, assigneeId: { notIn: finalMembers } }, data: { assigneeId: null } })] : []),
    ]);
    revokeProject(id);
    describeAction(`Cambió la visibilidad del proyecto a ${visibility === "PUBLIC" ? "pública" : visibility === "RESTRICTED" ? "usuarios seleccionados" : "privada"}`);
    revalidatePath("/", "layout");
  });
}

export async function deleteProject(projectId: string, confirmName: string) {
  return runAction({ name: "projects.deleteProject", args: [projectId, confirmName] }, async () => {
    const user = await requireUser();
    const project = await findManageableProject(user, projectId);
    if (project.name !== confirmName) throw new AppError("El nombre no coincide.");
    await purgeProject(projectId);
    revalidatePath("/", "layout");
  });
}

// --- Miembros de proyectos privados ------------------------------------------------

/** Añade a un usuario activo como miembro de un proyecto privado (cualquier miembro puede hacerlo). */
export async function addProjectMember(projectId: string, userId: string) {
  return runAction({ name: "projects.addProjectMember", args: [projectId, userId] }, async () => {
    const user = await requireUser();
    const project = await findManageableProject(user, projectId);
    if (!project.isPrivate) throw new AppError("Solo los proyectos privados tienen miembros propios.");
    const target = await db.user.findFirst({ where: { id: v.id.parse(userId), active: true }, select: { id: true, name: true } });
    if (!target) throw new AppError("Usuario no válido.");
    await db.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: target.id } },
      create: { projectId: project.id, userId: target.id },
      update: {},
    });
    describeAction(`Añadió a «${target.name}» al proyecto privado «${project.name}»`);
    revalidatePath("/", "layout");
  });
}

/**
 * Quita a un miembro (o sale uno mismo). Debe quedar algún miembro activo: el último no puede salir,
 * tiene que borrar el proyecto. Las tarjetas que tuviera asignadas quedan sin asignar.
 */
export async function removeProjectMember(projectId: string, userId: string) {
  return runAction({ name: "projects.removeProjectMember", args: [projectId, userId] }, async () => {
    const user = await requireUser();
    const project = await findManageableProject(user, projectId);
    if (!project.isPrivate) throw new AppError("Solo los proyectos privados tienen miembros propios.");
    const targetId = v.id.parse(userId);
    const member = await db.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: targetId } },
      select: { user: { select: { name: true } } },
    });
    if (!member) throw notFound();
    if ((await activeMembers(project.id, targetId)) === 0) {
      throw new AppError("Eres el último miembro: no puedes salir del proyecto, bórralo si ya no lo necesitas.");
    }
    await db.$transaction([
      db.projectMember.delete({ where: { projectId_userId: { projectId: project.id, userId: targetId } } }),
      db.task.updateMany({ where: { projectId: project.id, assigneeId: targetId }, data: { assigneeId: null } }),
    ]);
    describeAction(targetId === user.id ? `Salió del proyecto privado «${project.name}»` : `Quitó a «${member.user.name}» del proyecto privado «${project.name}»`);
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
    const exists = await db.label.count({ where: { projectId, name: data.name } });
    if (exists) throw new AppError("Ya existe una etiqueta con ese nombre.");
    return db.label.create({ data: { projectId, ...data }, select: { id: true, name: true, color: true } });
  });
}

async function findLabel(labelId: string) {
  const user = await requireUser();
  const label = await db.label.findFirst({
    where: { id: v.id.parse(labelId), project: visibleProjectsWhere(user) },
    select: { id: true, projectId: true },
  });
  if (!label) throw notFound();
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
    const last = await db.deliverable.findFirst({ where: { projectId }, orderBy: { position: "desc" }, select: { position: true } });
    const d = await db.deliverable.create({
      data: { projectId, name: data.name, description: data.description, dueDate: data.dueDate ? isoToDate(data.dueDate) : null, position: (last?.position ?? 0) + POSITION_STEP },
      select: { id: true, name: true, description: true, dueDate: true },
    });
    return { ...d, dueDate: dateToIso(d.dueDate) };
  });
}

async function findDeliverable(deliverableId: string) {
  const user = await requireUser();
  const d = await db.deliverable.findFirst({
    where: { id: v.id.parse(deliverableId), project: visibleProjectsWhere(user) },
    select: { id: true },
  });
  if (!d) throw notFound();
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
