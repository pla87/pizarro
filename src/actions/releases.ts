"use server";

import { readFile } from "node:fs/promises";
import { after } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { describeAction } from "@/lib/action-context";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { assertProjectAccess } from "@/lib/access";
import { MAX_RELEASE_CONTENT } from "@/lib/constants";
import { appTimeZone } from "@/lib/board";
import { AppError } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { POSITION_STEP } from "@/lib/positions";
import { spawnRecurrences } from "@/lib/recurrence";
import { setTaskColumnPositions } from "@/lib/task-positions";
import { attachmentFileNames, zonedDayRange } from "@/lib/release";
import { requireUser } from "@/lib/session";
import { attachmentPath, compactImage, removeReleaseAttachmentFiles, saveReleaseAttachmentFile } from "@/lib/uploads";
import { addUndo, captureTasks } from "@/lib/undo";
import { tasksN } from "@/lib/undo-label";
import * as v from "@/lib/validation";
import { getT } from "@/i18n/server";
import { mentionsToPlain } from "@/lib/mentions";

const deploySchema = z.object({
  projectId: v.id,
  title: v.title,
  content: z.string().min(1, "El contenido está vacío.").max(MAX_RELEASE_CONTENT, "El contenido es demasiado largo."),
  taskIds: z.array(v.id).max(500),
  destination: z.enum(["IN_PRODUCTION", "ARCHIVE"]),
  /** Tareas con adjuntos y su código en el texto (F1, C2…), en el orden del diálogo. */
  attachments: z.array(z.object({ taskId: v.id, code: z.string().regex(/^(R\d{1,5})?[A-Z]{1,4}\d{1,4}$/) })).max(200).optional(),
  /** Número con el que se generaron los códigos (R32…): si otra persona desplegó antes, no coincide. */
  number: z.number().int().positive().optional(),
});

/**
 * Registra la release con el texto final editado y mueve las tarjetas incluidas
 * a la columna "En producción" (o las archiva).
 */
export async function deployRelease(input: z.input<typeof deploySchema>) {
  return runAction({ name: "releases.deployRelease", args: [input] }, async () => {
    const user = await requireUser();
    const data = deploySchema.parse(input);
    await assertProjectAccess(user, data.projectId);

    const tasks = await db.task.findMany({
      where: { id: { in: data.taskIds }, projectId: data.projectId, archivedAt: null },
      orderBy: [{ column: { position: "asc" } }, { position: "asc" }],
      select: { id: true, title: true, evergreen: true, kind: { select: { name: true } } },
    });

    // Deshacer: dónde estaba cada tarea (solo las de este proyecto); la release del histórico se quita (ver más abajo).
    // La columna de destino se busca a la vez.
    const [undo, target] = await Promise.all([
      captureTasks(tasks.map((t) => t.id), ["columnId", "position", "archivedAt", "archivedFromColumnId", "evergreen"]),
      data.destination === "IN_PRODUCTION"
        ? db.column.findFirst({ where: { projectId: data.projectId, role: "IN_PRODUCTION" }, select: { id: true, isDone: true } })
        : null,
    ]);
    addUndo(...undo);
    if (data.destination === "IN_PRODUCTION" && !target) {
      throw new AppError("No hay ninguna columna con el rol «En producción». Asígnalo en el menú de una columna o elige archivar.");
    }

    const result = await db.$transaction(async (tx) => {
      const last = await tx.release.findFirst({ where: { projectId: data.projectId }, orderBy: { number: "desc" }, select: { number: true } });
      const number = (last?.number ?? 0) + 1;
      if (data.number && data.number !== number) {
        const t = await getT();
        throw new AppError(t("Mientras tanto se ha desplegado la release {prev}: vuelve a generar el texto para que los códigos lleven R{number}.", { prev: number - 1, number }));
      }
      const release = await tx.release.create({
        data: {
          projectId: data.projectId,
          number,
          title: data.title,
          content: data.content,
          createdById: user.id,
          tasks: { create: tasks.map((t) => ({ taskId: t.id, title: mentionsToPlain(t.title), kindName: t.kind.name })) },
        },
        select: { id: true },
      });
      const moved: { id: string; columnId: string; position: number }[] = [];
      if (target) {
        const last = await tx.task.findFirst({ where: { columnId: target.id }, orderBy: { position: "desc" }, select: { position: true } });
        let pos = last?.position ?? 0;
        for (const t of tasks) {
          if (t.evergreen) continue; // las fijas se quedan en su columna
          pos += POSITION_STEP;
          moved.push({ id: t.id, columnId: target.id, position: pos });
        }
        // Una sola sentencia para todas (antes, un UPDATE por tarea: con 500 se acercaba al tope de 5 s de la transacción).
        await setTaskColumnPositions(moved, target.id, { client: tx });
      } else if (tasks.some((t) => !t.evergreen)) {
        // Se recuerda la columna de cada tarea para poder restaurarla en su sitio.
        await tx.$executeRaw`UPDATE "Task" SET "archivedAt" = NOW(), "archivedFromColumnId" = "columnId" WHERE "id" IN (${Prisma.join(tasks.filter((t) => !t.evergreen).map((t) => t.id))})`;
      }
      return { releaseId: release.id, moved, archived: target ? [] : tasks.filter((t) => !t.evergreen).map((t) => t.id) };
    });
    addUndo({ t: "release.remove", id: result.releaseId });
    // Recurrentes que salen terminadas (columna terminada de destino o archivo): nace su siguiente aparición.
    const spawned = !target || target.isDone ? await spawnRecurrences(tasks.filter((t) => !t.evergreen).map((t) => t.id), user.id) : [];
    const fixed = tasks.filter((t) => t.evergreen).length;
    describeAction(
      "Desplegó la release «{title}» con {count}{archived}{fixed}",
      {
        title: data.title,
        count: tasksN(tasks.length),
        archived: data.destination === "ARCHIVE" ? { k: " (archivadas)" } : "",
        fixed: fixed ? (fixed === 1 ? { k: " (1 fija se queda)" } : { k: " ({n} fijas se quedan)", p: { n: fixed } }) : "",
      },
      { releaseId: result.releaseId, taskIds: tasks.map((t) => t.id) },
    );
    // Copias compactas de los adjuntos para el histórico: tras responder (comprimir imágenes tarda), así el
    // despliegue no espera. El histórico las muestra unos segundos después; si algo falla queda en el registro.
    if (data.attachments?.length) {
      const job = { releaseId: result.releaseId, items: data.attachments, allowed: new Set(tasks.map((t) => t.id)), projectId: data.projectId, userId: user.id, userName: user.name };
      after(() =>
        saveReleaseAttachments(job).catch((err) =>
          logEvent({
            level: "error", category: "system", action: "releases.saveAttachments",
            message: `No se pudieron guardar los adjuntos de la release: ${err instanceof Error ? err.message : String(err)}`,
            userId: job.userId, userName: job.userName, projectId: job.projectId, details: { releaseId: job.releaseId },
          }),
        ),
      );
    }
    return { ...result, spawned };
  });
}

interface AttachmentJob {
  releaseId: string;
  items: { taskId: string; code: string }[];
  allowed: Set<string>;
  projectId: string;
  userId: string;
  userName: string;
}

async function saveReleaseAttachments({ releaseId, items, allowed, projectId, userId, userName }: AttachmentJob) {
  const valid = items.filter((i) => allowed.has(i.taskId));
  if (new Set(valid.map((i) => i.taskId)).size !== valid.length || new Set(valid.map((i) => i.code)).size !== valid.length) return;
  const tasks = await db.task.findMany({
    where: { id: { in: valid.map((i) => i.taskId) } },
    select: { id: true, attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, originalName: true, isImage: true } } },
  });
  const byId = new Map(tasks.map((t) => [t.id, t.attachments]));
  const saved: string[] = [];
  let position = 0;
  // La release ya no está (deshecha o borrada antes de empezar): no hay nada que copiar.
  const releaseGone = async () => !(await db.release.count({ where: { id: releaseId } }));
  if (await releaseGone()) return;
  outer: for (const item of valid) {
    const attachments = byId.get(item.taskId) ?? [];
    const names = attachmentFileNames(item.code, attachments);
    for (const [i, att] of attachments.entries()) {
      let rowId: string | null = null;
      try {
        const raw = await readFile(attachmentPath(att.id, att.isImage ? "full" : "file"));
        const data = att.isImage ? await compactImage(raw) : raw;
        const row = await db.releaseAttachment.create({
          data: { releaseId, fileName: names[i]!, size: data.length, isImage: att.isImage, position: position++ },
          select: { id: true },
        });
        rowId = row.id;
        await saveReleaseAttachmentFile(row.id, data, att.isImage ? "webp" : "bin");
        saved.push(row.id);
      } catch (err) {
        if (rowId) await db.releaseAttachment.delete({ where: { id: rowId } }).catch(() => {});
        // La release se ha borrado o deshecho a mitad: se para aquí, sin un error por cada adjunto restante.
        if (await releaseGone()) break outer;
        // Fichero ausente o ilegible: se omite; si ya había fila, se ha retirado para no dejarla sin fichero.
        logEvent({
          level: "error", category: "system", action: "releases.saveAttachments",
          message: `Adjunto omitido en la release: «${names[i] ?? att.originalName}» (${err instanceof Error ? err.message : String(err)})`,
          userId, userName, projectId, details: { releaseId, attachmentId: att.id },
        });
      }
    }
  }
  // Se guardan después de responder: si mientras tanto se ha borrado o deshecho la release, sus filas ya no
  // están y los ficheros recién escritos sobran.
  if (saved.length) {
    const alive = new Set((await db.releaseAttachment.findMany({ where: { id: { in: saved } }, select: { id: true } })).map((a) => a.id));
    const gone = saved.filter((id) => !alive.has(id));
    if (gone.length) await removeReleaseAttachmentFiles(gone);
  }
}

const countSchema = z.object({ projectId: v.id, dayIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** Releases desplegadas en el proyecto durante el día local indicado (zona horaria de la app) y número de la siguiente. */
export async function countReleasesOn(input: z.input<typeof countSchema>) {
  return runAction({ name: "releases.countReleasesOn", args: [input] }, async (): Promise<{ today: number; nextNumber: number }> => {
    const user = await requireUser();
    const data = countSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    const { start, end } = zonedDayRange(data.dayIso, appTimeZone());
    const [today, last] = await Promise.all([
      db.release.count({ where: { projectId: data.projectId, deployedAt: { gte: start, lt: end } } }),
      db.release.findFirst({ where: { projectId: data.projectId }, orderBy: { number: "desc" }, select: { number: true } }),
    ]);
    return { today, nextNumber: (last?.number ?? 0) + 1 };
  });
}

const detailsSchema = z.object({ projectId: v.id, taskIds: z.array(v.id).max(500) });

interface ReleaseTaskDetails {
  id: string;
  description: string;
  attachments: { id: string; originalName: string; isImage: boolean }[];
}

/** Descripción y adjuntos de las tareas elegidas, para incluirlos en el texto de la release. */
export async function getReleaseTaskDetails(input: z.input<typeof detailsSchema>) {
  return runAction({ name: "releases.getReleaseTaskDetails", args: [input] }, async (): Promise<ReleaseTaskDetails[]> => {
    const user = await requireUser();
    const data = detailsSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    describeAction(`Generó el texto de una release con ${data.taskIds.length === 1 ? "1 tarea" : `${data.taskIds.length} tareas`}`);
    return db.task.findMany({
      where: { id: { in: data.taskIds }, projectId: data.projectId },
      select: {
        id: true,
        description: true,
        attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, originalName: true, isImage: true } },
      },
    });
  });
}

const releaseIdSchema = z.object({ releaseId: v.id });

/** Carga la release y comprueba que el usuario ve su proyecto. */
async function loadAccessibleRelease(user: Awaited<ReturnType<typeof requireUser>>, releaseId: string) {
  const release = await db.release.findUnique({ where: { id: releaseId }, select: { id: true, projectId: true, title: true } });
  if (!release) throw new AppError("La release no existe.");
  await assertProjectAccess(user, release.projectId);
  return release;
}

/** Borra la release del histórico con sus adjuntos; las tareas no se tocan. */
export async function deleteRelease(releaseId: string) {
  return runAction({ name: "releases.deleteRelease", args: [releaseId] }, async () => {
    const user = await requireUser();
    const { releaseId: id } = releaseIdSchema.parse({ releaseId });
    const release = await loadAccessibleRelease(user, id);
    // Los ids se leen antes de borrar: las filas caen en cascada con la release.
    const ids = (await db.releaseAttachment.findMany({ where: { releaseId: id }, select: { id: true } })).map((a) => a.id);
    await db.release.delete({ where: { id } });
    describeAction(`Borró del histórico la release «${release.title}»`, { releaseId: id });
    await removeReleaseAttachmentFiles(ids);
    return { id: release.id };
  });
}

/** Borra solo los adjuntos de la release (filas y ficheros); el texto se conserva. */
export async function deleteReleaseAttachments(releaseId: string) {
  return runAction({ name: "releases.deleteReleaseAttachments", args: [releaseId] }, async () => {
    const user = await requireUser();
    const { releaseId: id } = releaseIdSchema.parse({ releaseId });
    await loadAccessibleRelease(user, id);
    const ids = (await db.releaseAttachment.findMany({ where: { releaseId: id }, select: { id: true } })).map((a) => a.id);
    await db.releaseAttachment.deleteMany({ where: { releaseId: id } });
    await removeReleaseAttachmentFiles(ids);
    return { id };
  });
}
