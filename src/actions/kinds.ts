"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { AppError, notFound } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/positions";
import { requireAdmin } from "@/lib/session";
import * as v from "@/lib/validation";

const kindSchema = z.object({ name: v.name.max(40, "Máximo 40 caracteres."), color: v.hexColor });

async function assertUniqueName(name: string, exceptId?: string) {
  const dup = await db.taskKind.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (dup) throw new AppError("Ya existe un tipo con ese nombre.");
}

/** Tipos de tarea: solo administradores. Cada tipo es una sección de la release. */
export async function createKind(input: { name: string; color: string }) {
  return runAction(async () => {
    await requireAdmin();
    const data = kindSchema.parse(input);
    await assertUniqueName(data.name);
    if ((await db.taskKind.count()) >= 30) throw new AppError("Máximo 30 tipos de tarea.");
    const last = await db.taskKind.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
    const kind = await db.taskKind.create({
      data: { ...data, position: (last?.position ?? 0) + POSITION_STEP },
      select: { id: true, name: true, color: true },
    });
    revalidatePath("/", "layout");
    return kind;
  });
}

export async function updateKind(kindId: string, input: { name: string; color: string }) {
  return runAction(async () => {
    await requireAdmin();
    const data = kindSchema.parse(input);
    const id = v.id.parse(kindId);
    if (!(await db.taskKind.count({ where: { id } }))) throw notFound();
    await assertUniqueName(data.name, id);
    await db.taskKind.update({ where: { id }, data });
    revalidatePath("/", "layout");
  });
}

/** Mueve el tipo una posición arriba (-1) o abajo (+1): cambia el orden de las secciones de la release. */
export async function moveKind(kindId: string, direction: number) {
  return runAction(async () => {
    await requireAdmin();
    const dir = z.union([z.literal(-1), z.literal(1)]).parse(direction);
    const kinds = await db.taskKind.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } });
    const idx = kinds.findIndex((k) => k.id === kindId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= kinds.length) return;
    [kinds[idx], kinds[target]] = [kinds[target]!, kinds[idx]!];
    await db.$transaction(kinds.map((k, i) => db.taskKind.update({ where: { id: k.id }, data: { position: (i + 1) * POSITION_STEP } })));
    revalidatePath("/", "layout");
  });
}

/** Borra un tipo pasando sus tareas a otro. Siempre debe quedar al menos uno. */
export async function deleteKind(kindId: string, replacementId: string) {
  return runAction(async () => {
    await requireAdmin();
    const id = v.id.parse(kindId);
    const replacement = v.id.parse(replacementId);
    if (id === replacement) throw new AppError("Elige otro tipo para las tareas.");
    const [exists, target] = await Promise.all([db.taskKind.count({ where: { id } }), db.taskKind.count({ where: { id: replacement } })]);
    if (!exists || !target) throw notFound();
    await db.$transaction([
      db.task.updateMany({ where: { kindId: id }, data: { kindId: replacement } }),
      db.taskKind.delete({ where: { id } }),
    ]);
    revalidatePath("/", "layout");
  });
}
