"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { assertProjectAccess } from "@/lib/access";
import { MAX_RELEASE_CONTENT } from "@/lib/constants";
import { AppError } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/positions";
import { requireUser } from "@/lib/session";
import * as v from "@/lib/validation";

const deploySchema = z.object({
  projectId: v.id,
  title: v.title,
  content: z.string().min(1, "El contenido está vacío.").max(MAX_RELEASE_CONTENT, "El contenido es demasiado largo."),
  taskIds: z.array(v.id).max(500),
  destination: z.enum(["IN_PRODUCTION", "ARCHIVE"]),
});

/**
 * Registra la release con el texto final editado y mueve las tarjetas incluidas
 * a la columna "En producción" (o las archiva).
 */
export async function deployRelease(input: z.input<typeof deploySchema>) {
  return runAction(async () => {
    const user = await requireUser();
    const data = deploySchema.parse(input);
    await assertProjectAccess(user, data.projectId);

    const tasks = await db.task.findMany({
      where: { id: { in: data.taskIds }, projectId: data.projectId, archivedAt: null },
      orderBy: [{ column: { position: "asc" } }, { position: "asc" }],
      select: { id: true, title: true, kind: { select: { name: true } } },
    });

    let target: { id: string } | null = null;
    if (data.destination === "IN_PRODUCTION") {
      target = await db.column.findFirst({ where: { projectId: data.projectId, role: "IN_PRODUCTION" }, select: { id: true } });
      if (!target) throw new AppError("No hay ninguna columna con el rol «En producción». Asígnalo en el menú de una columna o elige archivar.");
    }

    const result = await db.$transaction(async (tx) => {
      const release = await tx.release.create({
        data: {
          projectId: data.projectId,
          title: data.title,
          content: data.content,
          createdById: user.id,
          tasks: { create: tasks.map((t) => ({ taskId: t.id, title: t.title, kindName: t.kind.name })) },
        },
        select: { id: true },
      });
      const moved: { id: string; columnId: string; position: number }[] = [];
      if (target) {
        const last = await tx.task.findFirst({ where: { columnId: target.id }, orderBy: { position: "desc" }, select: { position: true } });
        let pos = last?.position ?? 0;
        for (const t of tasks) {
          pos += POSITION_STEP;
          await tx.task.update({ where: { id: t.id }, data: { columnId: target.id, position: pos } });
          moved.push({ id: t.id, columnId: target.id, position: pos });
        }
      } else if (tasks.length) {
        await tx.task.updateMany({ where: { id: { in: tasks.map((t) => t.id) } }, data: { archivedAt: new Date() } });
      }
      return { releaseId: release.id, moved, archived: target ? [] : tasks.map((t) => t.id) };
    });
    return result;
  });
}
