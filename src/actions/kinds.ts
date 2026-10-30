"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertProjectAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { AppError, notFound } from "@/lib/errors";
import { MAX_DESCRIPTION } from "@/lib/constants";
import { POSITION_STEP } from "@/lib/positions";
import { requireAdmin, requireUser } from "@/lib/session";
import * as v from "@/lib/validation";
import { MAX_KIND_SUBTASKS, parseSubtaskLines } from "@/lib/kinds-special";
import { getT } from "@/i18n/server";

const kindSchema = z.object({
  name: v.name.max(40, "Máximo 40 caracteres."),
  color: v.hexColor,
  // Automatización opcional al elegir el tipo (vacío = ninguna).
  titleTemplate: z.string().trim().max(200, "Máximo 200 caracteres.").default(""),
  descriptionTemplate: z.string().trim().max(MAX_DESCRIPTION, "La descripción es demasiado larga.").default(""),
  // Subtareas que se añaden al crear una tarea de este tipo (sin vacías ni repetidas).
  subtaskTemplate: z
    .array(z.string().trim().min(1).max(200, "Máximo 200 caracteres."))
    .max(MAX_KIND_SUBTASKS, "Máximo 50 subtareas.")
    .default([])
    .transform((list) => parseSubtaskLines(list.join("\n"))),
});
type KindInput = { name: string; color: string; titleTemplate?: string; descriptionTemplate?: string; subtaskTemplate?: string[] };
const MAX_KINDS = 30;

/**
 * Tipos de tarea. Los generales (projectId null) solo los gestionan los administradores;
 * los de un proyecto, cualquiera con acceso a ese proyecto. Cada tipo es una sección de la release.
 */
async function authorize(projectId: string | null) {
  if (projectId === null) {
    await requireAdmin();
  } else {
    await assertProjectAccess(await requireUser(), projectId);
  }
}

/** Un tipo, con su ámbito, tras comprobar que se puede gestionar. */
async function loadKind(kindId: string) {
  const kind = await db.taskKind.findUnique({ where: { id: v.id.parse(kindId) }, select: { id: true, name: true, projectId: true } });
  if (!kind) throw notFound();
  await authorize(kind.projectId);
  return kind;
}

/**
 * Evita dos secciones con el mismo nombre en una release:
 * un tipo general no puede repetir el nombre de ningún otro tipo (general o de proyecto),
 * y uno de proyecto no puede repetir el de un general ni el de otro tipo de ese proyecto.
 */
async function assertUniqueName(name: string, projectId: string | null, exceptId?: string) {
  const dup = await db.taskKind.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(projectId === null ? {} : { OR: [{ projectId: null }, { projectId }] }),
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { projectId: true },
  });
  if (!dup) return;
  if (projectId === null && dup.projectId !== null) throw new AppError("Ya hay un tipo con ese nombre en algún proyecto.");
  if (projectId !== null && dup.projectId === null) throw new AppError("Ya existe un tipo general con ese nombre.");
  throw new AppError("Ya existe un tipo con ese nombre.");
}

function revalidate(projectId: string | null) {
  revalidatePath(projectId ? `/p/${projectId}` : "/", "layout");
}

/** Crea un tipo general (sin projectId, solo admins) o exclusivo del proyecto indicado. */
export async function createKind(input: KindInput, projectId?: string | null) {
  return runAction({ name: "kinds.createKind", args: [input, projectId] }, async () => {
    const scope = projectId ? v.id.parse(projectId) : null;
    await authorize(scope);
    const data = kindSchema.parse(input);
    await assertUniqueName(data.name, scope);
    if ((await db.taskKind.count({ where: { projectId: scope } })) >= MAX_KINDS) {
      const t = await getT();
      throw new AppError(t("Máximo {n} tipos de tarea.", { n: MAX_KINDS }));
    }
    const last = await db.taskKind.findFirst({ where: { projectId: scope }, orderBy: { position: "desc" }, select: { position: true } });
    const kind = await db.taskKind.create({
      data: { ...data, projectId: scope, position: (last?.position ?? 0) + POSITION_STEP },
      select: { id: true, name: true, color: true, titleTemplate: true, descriptionTemplate: true, subtaskTemplate: true },
    });
    revalidate(scope);
    return kind;
  });
}

export async function updateKind(kindId: string, input: KindInput) {
  return runAction({ name: "kinds.updateKind", args: [kindId, input] }, async () => {
    const kind = await loadKind(kindId);
    const data = kindSchema.parse(input);
    await assertUniqueName(data.name, kind.projectId, kind.id);
    await db.taskKind.update({ where: { id: kind.id }, data });
    revalidate(kind.projectId);
  });
}

/** Mueve el tipo una posición arriba (-1) o abajo (+1) dentro de su ámbito: cambia el orden de las secciones de la release. */
export async function moveKind(kindId: string, direction: number) {
  return runAction({ name: "kinds.moveKind", args: [kindId, direction] }, async () => {
    const kind = await loadKind(kindId);
    const dir = z.union([z.literal(-1), z.literal(1)]).parse(direction);
    const kinds = await db.taskKind.findMany({
      where: { projectId: kind.projectId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const idx = kinds.findIndex((k) => k.id === kind.id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= kinds.length) return;
    [kinds[idx], kinds[target]] = [kinds[target]!, kinds[idx]!];
    await db.$transaction(kinds.map((k, i) => db.taskKind.update({ where: { id: k.id }, data: { position: (i + 1) * POSITION_STEP } })));
    revalidate(kind.projectId);
  });
}

/**
 * Borra un tipo pasando sus tareas a otro. El de destino de un tipo general debe ser general
 * (siempre queda al menos uno); el de un tipo de proyecto, general o de ese mismo proyecto.
 */
export async function deleteKind(kindId: string, replacementId: string) {
  return runAction({ name: "kinds.deleteKind", args: [kindId, replacementId] }, async () => {
    const kind = await loadKind(kindId);
    const replacement = v.id.parse(replacementId);
    if (kind.id === replacement) throw new AppError("Elige otro tipo para las tareas.");
    const target = await db.taskKind.findUnique({ where: { id: replacement }, select: { projectId: true } });
    if (!target || (target.projectId !== null && target.projectId !== kind.projectId)) throw new AppError("El tipo de destino no es válido.");
    // Un tipo general oculto no puede recibir tareas de un proyecto que lo oculta (luego no se podrían editar ni duplicar).
    if (target.projectId === null) {
      const hiddenWhere = kind.projectId
        ? { kindId: replacement, projectId: kind.projectId }
        : { kindId: replacement, project: { tasks: { some: { kindId: kind.id } } } };
      if (await db.projectHiddenKind.count({ where: hiddenWhere })) throw new AppError("Ese tipo está oculto en un proyecto con tareas de este tipo: elige otro o actívalo antes en ese proyecto.");
    }
    await db.$transaction([
      db.task.updateMany({ where: { kindId: kind.id }, data: { kindId: replacement } }),
      db.taskKind.delete({ where: { id: kind.id } }),
    ]);
    revalidate(kind.projectId);
  });
}
