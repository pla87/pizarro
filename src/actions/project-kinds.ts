"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertProjectAccess } from "@/lib/access";
import { runAction } from "@/lib/action";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import * as v from "@/lib/validation";

/**
 * Activa o desactiva un tipo general en un proyecto. Al desactivarlo, sus tareas del proyecto
 * pasan al tipo `replacementId` (obligatorio si hay alguna). Siempre debe quedar algún tipo usable.
 */
export async function setGeneralKindEnabled(projectId: string, kindId: string, enabled: boolean, replacementId: string | null) {
  return runAction({ name: "projectKinds.setGeneralKindEnabled", args: [projectId, kindId, enabled, replacementId] }, async () => {
    const user = await requireUser();
    const pid = v.id.parse(projectId);
    const kid = v.id.parse(kindId);
    const on = z.boolean().parse(enabled);
    await assertProjectAccess(user, pid);
    const kind = await db.taskKind.findFirst({ where: { id: kid, projectId: null }, select: { id: true, name: true } });
    if (!kind) throw notFound();

    if (on) {
      await db.projectHiddenKind.deleteMany({ where: { projectId: pid, kindId: kid } });
    } else {
      // Tipos que seguirían disponibles en el proyecto.
      const remaining = await db.taskKind.findMany({
        where: { id: { not: kid }, OR: [{ projectId: null, hiddenIn: { none: { projectId: pid } } }, { projectId: pid }] },
        select: { id: true },
      });
      if (remaining.length === 0) throw new AppError("El proyecto debe tener al menos un tipo de tarea.");
      const inUse = await db.task.count({ where: { projectId: pid, kindId: kid } });
      let target: string | null = null;
      if (inUse > 0) {
        target = replacementId ? v.id.parse(replacementId) : null;
        if (!target || !remaining.some((k) => k.id === target)) {
          throw new AppError(`Hay ${inUse} tarea(s) de tipo «${kind.name}»: elige a qué tipo pasan.`);
        }
      }
      await db.$transaction([
        ...(target ? [db.task.updateMany({ where: { projectId: pid, kindId: kid }, data: { kindId: target } })] : []),
        db.projectHiddenKind.upsert({
          where: { projectId_kindId: { projectId: pid, kindId: kid } },
          create: { projectId: pid, kindId: kid },
          update: {},
        }),
      ]);
    }
    revalidatePath(`/p/${pid}`, "layout");
  });
}
