"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { assertProjectAccess, visibleProjectsWhere } from "@/lib/access";
import { DEFAULT_COLUMNS, PALETTE } from "@/lib/constants";
import { AppError, notFound } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/positions";
import { requireAdmin, requireUser } from "@/lib/session";
import { removeAttachmentFiles } from "@/lib/uploads";
import * as v from "@/lib/validation";
import type { LabelOption } from "@/lib/types";

export async function createProject(name: string) {
  return runAction(async () => {
    await requireAdmin();
    const last = await db.project.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
    const project = await db.project.create({
      data: {
        name: v.name.parse(name),
        position: (last?.position ?? 0) + POSITION_STEP,
        columns: { create: DEFAULT_COLUMNS.map((c, i) => ({ ...c, position: (i + 1) * POSITION_STEP })) },
      },
      select: { id: true },
    });
    revalidatePath("/", "layout");
    return project;
  });
}

export async function updateProject(projectId: string, input: { name: string; description: string }) {
  return runAction(async () => {
    await requireAdmin();
    const data = z.object({ name: v.name, description: z.string().max(2000) }).parse(input);
    await db.project.update({ where: { id: v.id.parse(projectId) }, data });
    revalidatePath("/", "layout");
  });
}

/** restricted=false: todos los usuarios ven el proyecto. true: solo admins y memberIds. */
export async function setProjectVisibility(projectId: string, restricted: boolean, memberIds: string[]) {
  return runAction(async () => {
    await requireAdmin();
    const id = v.id.parse(projectId);
    const ids = [...new Set(z.array(v.id).max(50).parse(memberIds))];
    const valid = await db.user.count({ where: { id: { in: ids } } });
    if (valid !== ids.length) throw new AppError("Usuario no válido.");
    await db.$transaction([
      db.project.update({ where: { id }, data: { restricted: z.boolean().parse(restricted) } }),
      db.projectMember.deleteMany({ where: { projectId: id } }),
      db.projectMember.createMany({ data: ids.map((userId) => ({ projectId: id, userId })) }),
    ]);
    revalidatePath("/", "layout");
  });
}

export async function deleteProject(projectId: string, confirmName: string) {
  return runAction(async () => {
    await requireAdmin();
    const project = await db.project.findUnique({ where: { id: v.id.parse(projectId) }, select: { name: true } });
    if (!project) throw notFound();
    if (project.name !== confirmName) throw new AppError("El nombre no coincide.");
    const attachments = await db.taskAttachment.findMany({ where: { task: { projectId } }, select: { id: true } });
    await db.$transaction([
      db.task.deleteMany({ where: { projectId } }),
      db.project.delete({ where: { id: projectId } }),
    ]);
    await removeAttachmentFiles(attachments.map((a) => a.id));
    revalidatePath("/", "layout");
  });
}

// --- Etiquetas ---------------------------------------------------------------

const labelSchema = z.object({ name: v.name.max(40, "Máximo 40 caracteres."), color: z.enum(PALETTE) });

export async function createLabel(projectId: string, input: { name: string; color: string }) {
  return runAction(async (): Promise<LabelOption> => {
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
  return runAction(async () => {
    const label = await findLabel(labelId);
    const data = labelSchema.parse(input);
    const dup = await db.label.count({ where: { projectId: label.projectId, name: data.name, id: { not: label.id } } });
    if (dup) throw new AppError("Ya existe una etiqueta con ese nombre.");
    await db.label.update({ where: { id: label.id }, data });
  });
}

export async function deleteLabel(labelId: string) {
  return runAction(async () => {
    const label = await findLabel(labelId);
    await db.label.delete({ where: { id: label.id } });
  });
}
