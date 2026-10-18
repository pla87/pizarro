"use server";

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { assertProjectAccess } from "@/lib/access";
import { MAX_RELEASE_CONTENT } from "@/lib/constants";
import { appTimeZone } from "@/lib/board";
import { AppError } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/positions";
import { attachmentFileNames, zonedDayRange } from "@/lib/release";
import { requireUser } from "@/lib/session";
import { attachmentPath, compactImage, saveReleaseAttachmentFile } from "@/lib/uploads";
import * as v from "@/lib/validation";

const deploySchema = z.object({
  projectId: v.id,
  title: v.title,
  content: z.string().min(1, "El contenido está vacío.").max(MAX_RELEASE_CONTENT, "El contenido es demasiado largo."),
  taskIds: z.array(v.id).max(500),
  destination: z.enum(["IN_PRODUCTION", "ARCHIVE"]),
  /** Tareas con adjuntos y su código en el texto (F1, C2…), en el orden del diálogo. */
  attachments: z.array(z.object({ taskId: v.id, code: z.string().regex(/^[A-Z]{1,4}\d{1,4}$/) })).max(200).optional(),
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
    // Copias compactas de los adjuntos para el histórico; si algo falla se omite, el despliegue ya está hecho.
    if (data.attachments?.length) {
      await saveReleaseAttachments(result.releaseId, data.attachments, new Set(tasks.map((t) => t.id))).catch((err) =>
        console.error("[releases] no se pudieron guardar los adjuntos", err),
      );
    }
    return result;
  });
}

async function saveReleaseAttachments(releaseId: string, items: { taskId: string; code: string }[], allowed: Set<string>) {
  const valid = items.filter((i) => allowed.has(i.taskId));
  if (new Set(valid.map((i) => i.taskId)).size !== valid.length || new Set(valid.map((i) => i.code)).size !== valid.length) return;
  const tasks = await db.task.findMany({
    where: { id: { in: valid.map((i) => i.taskId) } },
    select: { id: true, attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, originalName: true } } },
  });
  const byId = new Map(tasks.map((t) => [t.id, t.attachments]));
  let position = 0;
  for (const item of valid) {
    const attachments = byId.get(item.taskId) ?? [];
    const names = attachmentFileNames(item.code, attachments);
    for (const [i, att] of attachments.entries()) {
      let rowId: string | null = null;
      try {
        const data = await compactImage(await readFile(attachmentPath(att.id, "full")));
        const row = await db.releaseAttachment.create({
          data: { releaseId, fileName: names[i]!, size: data.length, position: position++ },
          select: { id: true },
        });
        rowId = row.id;
        await saveReleaseAttachmentFile(row.id, data);
      } catch (err) {
        // Fichero ausente o ilegible: se omite; si ya había fila, se retira para no dejarla sin fichero.
        console.error("[releases] adjunto omitido", err);
        if (rowId) await db.releaseAttachment.delete({ where: { id: rowId } }).catch(() => {});
      }
    }
  }
}

const countSchema = z.object({ projectId: v.id, dayIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** Releases desplegadas en el proyecto durante el día local indicado (zona horaria de la app). */
export async function countReleasesOn(input: z.input<typeof countSchema>) {
  return runAction(async (): Promise<number> => {
    const user = await requireUser();
    const data = countSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    const { start, end } = zonedDayRange(data.dayIso, appTimeZone());
    return db.release.count({ where: { projectId: data.projectId, deployedAt: { gte: start, lt: end } } });
  });
}

const detailsSchema = z.object({ projectId: v.id, taskIds: z.array(v.id).max(500) });

export interface ReleaseTaskDetails {
  id: string;
  description: string;
  attachments: { id: string; originalName: string }[];
}

/** Descripción y adjuntos de las tareas elegidas, para incluirlos en el texto de la release. */
export async function getReleaseTaskDetails(input: z.input<typeof detailsSchema>) {
  return runAction(async (): Promise<ReleaseTaskDetails[]> => {
    const user = await requireUser();
    const data = detailsSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    return db.task.findMany({
      where: { id: { in: data.taskIds }, projectId: data.projectId },
      select: {
        id: true,
        description: true,
        attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, originalName: true } },
      },
    });
  });
}
