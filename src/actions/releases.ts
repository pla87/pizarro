"use server";

import { after } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { describeAction, needOwnRefresh } from "@/lib/action-context";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { assertProjectAccess } from "@/lib/access";
import { MAX_RELEASE_CONTENT } from "@/lib/constants";
import { appTimeZone, listKinds } from "@/lib/board";
import { lockProject } from "@/lib/caps";
import { AppError } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/positions";
import { spawnRecurrences } from "@/lib/recurrence";
import { lastPositionIn, lockColumns, setTaskColumnPositions, TASK_ORDER } from "@/lib/task-positions";
import { computeReleaseCodes, titleWithReleaseCode, zonedDayRange } from "@/lib/release";
import { localizeGeneralKinds } from "@/lib/kinds-localize";
import { runReleaseAttachmentsJob, type PendingJob } from "@/lib/release-attachments";
import { requireUser } from "@/lib/session";
import { removeReleaseAttachmentFiles } from "@/lib/uploads";
import { addUndo, captureTasks } from "@/lib/undo";
import { tasksN } from "@/lib/undo-label";
import * as v from "@/lib/validation";
import { getLocale, getT } from "@/i18n/server";
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
    // Cambia títulos (códigos de release), columnas y tareas fijas de muchas tarjetas: esta pestaña también recarga.
    needOwnRefresh();

    const tasks = await db.task.findMany({
      where: { id: { in: data.taskIds }, projectId: data.projectId, archivedAt: null },
      orderBy: [{ column: { position: "asc" } }, ...TASK_ORDER],
      select: { id: true, title: true, evergreen: true, kindId: true, kind: { select: { name: true } } },
    });
    // El texto llega ya generado del cliente: si alguna tarea se ha archivado, borrado o movido de proyecto
    // mientras tanto, el histórico no coincidiría con lo que dice el texto. Se pide volver a generarlo.
    const missing = new Set(data.taskIds).size - tasks.length;
    if (missing > 0) {
      const t = await getT();
      throw new AppError(
        missing === 1
          ? t("Una de las tareas ya no está en el tablero (archivada, borrada o movida a otro proyecto): vuelve a generar la release.")
          : t("{n} de las tareas ya no están en el tablero (archivadas, borradas o movidas a otro proyecto): vuelve a generar la release.", { n: missing }),
        409,
      );
    }

    // Deshacer: dónde estaba cada tarea (solo las de este proyecto); la release del histórico se quita (ver más abajo).
    // La columna de destino se busca a la vez.
    const [undo, target] = await Promise.all([
      captureTasks(tasks.map((t) => t.id), ["columnId", "position", "archivedAt", "archivedFromColumnId", "evergreen", "title"]),
      data.destination === "IN_PRODUCTION"
        ? db.column.findFirst({ where: { projectId: data.projectId, role: "IN_PRODUCTION" }, select: { id: true, isDone: true } })
        : null,
    ]);
    addUndo(...undo);
    // Orden y tipos del diálogo para que los códigos coincidan con los del texto.
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const ordered = [...new Set(data.taskIds)].map((id) => ({ id, kindId: byId.get(id)!.kindId }));
    const kinds = localizeGeneralKinds(await listKinds(data.projectId), await getLocale());
    if (data.destination === "IN_PRODUCTION" && !target) {
      throw new AppError("No hay ninguna columna con el rol «En producción». Asígnalo en el menú de una columna o elige archivar.");
    }

    // Copias de adjuntos para el histórico: el trabajo se guarda con la release (si el servidor se reinicia a mitad, el arranque lo retoma).
    const job: PendingJob | null = data.attachments?.length
      ? { items: data.attachments, allowed: tasks.map((t) => t.id), projectId: data.projectId, userId: user.id, userName: user.name }
      : null;

    const result = await db.$transaction(async (tx) => {
      // Dos despliegues a la vez del mismo proyecto: el segundo espera aquí y ve el número del primero
      // (y recibe el aviso de abajo) en lugar de chocar con el índice único con un error genérico.
      await lockProject(tx, data.projectId);
      const last = await tx.release.findFirst({ where: { projectId: data.projectId }, orderBy: { number: "desc" }, select: { number: true } });
      const number = (last?.number ?? 0) + 1;
      if (data.number && data.number !== number) {
        const t = await getT();
        throw new AppError(t("Mientras tanto se ha desplegado la release {prev}: vuelve a generar el texto para que los códigos lleven R{number}.", { prev: number - 1, number }));
      }
      // Los códigos de los títulos se calculan aquí, con los mismos datos y orden que el diálogo (tipos del
      // proyecto en su idioma, tareas en el orden de taskIds); nunca se usa texto del cliente (los códigos
      // que envía para el ZIP solo nombran ficheros).
      const codes = computeReleaseCodes(kinds, ordered, number);
      const release = await tx.release.create({
        data: {
          projectId: data.projectId,
          number,
          title: data.title,
          content: data.content,
          createdById: user.id,
          ...(job ? { attachmentsPending: job } : {}),
          tasks: { create: tasks.map((t) => ({ taskId: t.id, title: mentionsToPlain(t.title), kindName: t.kind.name })) },
        },
        select: { id: true },
      });
      // Las tareas que salen (no las fijas) llevan el código de la release delante del título.
      const changed = tasks
        .filter((t) => !t.evergreen)
        .map((t) => [t.id, titleWithReleaseCode(t.title, codes.get(t.id)!)] as const)
        .filter(([id, title]) => title !== byId.get(id)!.title);
      if (changed.length) {
        await tx.$executeRaw`
          UPDATE "Task" AS t SET "title" = m."title", "updatedAt" = ${new Date()}
          FROM unnest(${changed.map(([id]) => id)}::text[], ${changed.map(([, title]) => title)}::text[]) AS m("id", "title")
          WHERE t."id" = m."id"`;
      }
      const moved: { id: string; columnId: string; position: number }[] = [];
      if (target) {
        await lockColumns(tx, [target.id]);
        let pos = (await lastPositionIn(tx, target.id)) ?? 0;
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
    const spawned = !target || target.isDone ? await spawnRecurrences(tasks.filter((t) => !t.evergreen).map((t) => t.id), user.id, new Map(tasks.map((t) => [t.id, t.title]))) : [];
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
    if (job) after(() => runReleaseAttachmentsJob(result.releaseId, job));
    return { ...result, spawned };
  });
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
