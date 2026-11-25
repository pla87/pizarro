import "server-only";
import { actionContext, type ActionContext } from "./action-context";
import { getMaxCommentsPerTask } from "./app-settings";
import { appTimeZone } from "./board";
import { assertColumnRoom } from "./column-capacity";
import { assignOnEnter, assignUndoOps, finishAssignOnEnter } from "./column-assign";
import { isShareColumn, shareLinkState } from "./share-out-board";
import { dateToIso, isoToDate } from "./dates";
import { db } from "./db";
import { AppError } from "./errors";
import { getInstanceSettings } from "./instance";
import { logEvent, logError } from "./log";
import { appUrl } from "./mail";
import { excerpt as makeExcerpt, mentionRegex, mentionsToPlain } from "./mentions";
import { dueChangeExcerpt, externalExcerpt } from "./notification-text";
import { notifyTask, taskFollowerIds } from "./notify";
import { rateLimit, rateIp } from "./rate-limit";
import { publishChange } from "./realtime";
import { spawnRecurrences } from "./recurrence";
import {
  inShareGrace, isShareTokenShape, MAX_SHARE_COMMENT, parseShareDate, sameHash, SHARE_GRACE_DAYS, SHARE_LIMITS, SHARE_USE_WRITE_MS, shareAuthorLabel,
  shareKeyOf, shareTokenHashes, type ShareNotice,
} from "./share-out-core";
import type { SharePageData } from "./share-out-page";
import { eventsOf } from "./task-events";
import { COLUMN_ORDER, lockColumns, placeInColumn, TASK_ORDER } from "./task-positions";
import { saveUndo } from "./undo";
import { encodeLabel, renderLabel, type Label } from "./undo-label";
import { intlLocale, makeT, type Locale, type T } from "../i18n/core";

// «Compartir fuera» con base de datos: el estado de cada columna para el tablero, resolver un token de /x/<token>, los
// datos de la página, los adjuntos que se pueden descargar y lo que se puede hacer desde fuera (marcar como hecha,
// cambiar la fecha, comentar). Lo de fuera queda en el historial de la tarea y en Logs (nunca el token), avisa al
// responsable, refresca los tableros abiertos y se puede deshacer desde la app (ver applyShareChange).

// --- Tablero ---------------------------------------------------------------------------------------------------------

/**
 * Termina el enlace de la columna (quitar la función, borrar la columna, revocar): la fila se queda sin columna para que
 * la dirección diga «ha caducado» 30 días. Devuelve si había una fila.
 */
export async function endColumnShare(client: Pick<typeof db, "columnShare">, columnId: string, now: Date = new Date()): Promise<boolean> {
  const rows = await client.columnShare.findMany({ where: { columnId }, select: { id: true, revokedAt: true } });
  for (const r of rows) await client.columnShare.update({ where: { id: r.id }, data: { columnId: null, revokedAt: r.revokedAt ?? now } });
  return rows.length > 0;
}

/** Apagar la función en un proyecto: todos sus enlaces dejan de funcionar al momento (se revocan). */
export async function revokeProjectShares(projectId: string, now: Date = new Date()): Promise<number> {
  const { count } = await db.columnShare.updateMany({ where: { projectId, tokenHash: { not: null }, revokedAt: null }, data: { revokedAt: now } });
  return count;
}

/**
 * Mantenimiento diario (con los enlaces de email caducados): olvida los enlaces que terminaron hace más de 30 días (ya
 * no dicen «ha caducado», sino «no encontrado») y borra las filas sin columna que ya no sirven para nada. Devuelve cuántas.
 */
export async function purgeEndedShares(now: Date = new Date()): Promise<number> {
  const limit = new Date(now.getTime() - SHARE_GRACE_DAYS * 86_400_000);
  const old = await db.columnShare.updateMany({ where: { oldEndedAt: { lt: limit } }, data: { oldTokenHash: null, oldEndedAt: null } });
  const loose = await db.columnShare.findMany({ where: { columnId: null }, select: { id: true, columnId: true, tokenHash: true, expiryDays: true, generatedAt: true, lastUsedAt: true, revokedAt: true, oldTokenHash: true } });
  const ids = loose.filter((r) => {
    if (r.oldTokenHash) return false;
    const { state, endsAt } = shareLinkState(r, now);
    return state === "none" || (endsAt !== null && endsAt < limit);
  }).map((r) => r.id);
  const gone = ids.length ? (await db.columnShare.deleteMany({ where: { id: { in: ids } } })).count : 0;
  return old.count + gone;
}

// --- Resolver un token ------------------------------------------------------------------------------------------------

/** Un enlace que funciona: lo que necesitan la página, las descargas y las acciones. */
export interface ActiveShare {
  id: string;
  projectId: string;
  projectPrivate: boolean;
  columnId: string;
  columnName: string;
  taskIds: string[];
  expiresAt: Date;
  lastUsedAt: Date | null;
  generatedById: string | null;
  /** Clave del enlace para el limitador (no es el token). */
  key: string;
}

export type ResolvedShare = { kind: "active"; share: ActiveShare } | { kind: "expired" } | null;

/**
 * Qué hay detrás de un token: un enlace activo, uno que terminó hace menos de 30 días (`expired`) o nada (null: forma mala,
 * desconocido o terminado hace más). Con el proyecto apagado o la columna sin la función, cuenta como terminado.
 */
export async function resolveShareToken(token: string, now: Date = new Date()): Promise<ResolvedShare> {
  if (!isShareTokenShape(token)) return null;
  const candidates = shareTokenHashes(token);
  const row = await db.columnShare.findFirst({
    where: { OR: [{ tokenHash: { in: candidates } }, { oldTokenHash: { in: candidates } }] },
    select: {
      id: true, projectId: true, columnId: true, tokenHash: true, oldTokenHash: true, oldEndedAt: true, expiryDays: true, taskIds: true,
      generatedAt: true, generatedById: true, lastUsedAt: true, revokedAt: true,
      project: { select: { shareOutEnabled: true, isPrivate: true } },
      column: { select: { name: true, role: true, assigneeId: true, assignDueDays: true } },
    },
  });
  if (!row) return null;
  const current = row.tokenHash && candidates.some((c) => sameHash(c, row.tokenHash!));
  if (!current) {
    // El enlace anterior de la columna (se sustituyó por otro): solo el aviso de «ha caducado».
    const ended = row.oldEndedAt ?? now;
    return row.oldTokenHash && candidates.some((c) => sameHash(c, row.oldTokenHash!)) && inShareGrace(ended, now) ? { kind: "expired" } : null;
  }
  const { state, endsAt } = shareLinkState(row, now);
  const usable = state === "active" && row.project.shareOutEnabled && row.column && isShareColumn({ ...row.column, share: true });
  if (!usable) return inShareGrace(state === "active" ? now : (endsAt ?? now), now) ? { kind: "expired" } : null;
  // Coincidió con la clave anterior (rotación de TOKEN_SECRET): se guarda ya con la actual.
  if (!sameHash(candidates[0]!, row.tokenHash!)) {
    await db.columnShare.updateMany({ where: { id: row.id, tokenHash: row.tokenHash }, data: { tokenHash: candidates[0]! } }).catch(() => {});
  }
  return {
    kind: "active",
    share: {
      id: row.id, projectId: row.projectId, projectPrivate: row.project.isPrivate, columnId: row.columnId!, columnName: row.column!.name,
      taskIds: row.taskIds, expiresAt: endsAt!, lastUsedAt: row.lastUsedAt, generatedById: row.generatedById, key: shareKeyOf(token),
    },
  };
}

/** Abrir la página cuenta como uso (de ahí la caducidad); se escribe como mucho una vez por hora. */
export async function noteShareUse(share: ActiveShare, now: Date = new Date()): Promise<void> {
  if (share.lastUsedAt && now.getTime() - share.lastUsedAt.getTime() < SHARE_USE_WRITE_MS) return;
  await db.columnShare.updateMany({ where: { id: share.id }, data: { lastUsedAt: now } });
}

/** Tope de peticiones por IP de todas las rutas de /x/ (mapa de seguridad del limitador). */
export const shareIpAllowed = (ip: string): boolean => rateLimit(`share-out:ip:${rateIp(ip)}`, SHARE_LIMITS.ip.limit, SHARE_LIMITS.ip.windowMs);
export const shareDownloadAllowed = (share: ActiveShare): boolean => rateLimit(`share-out:dl:${share.key}`, SHARE_LIMITS.downloads.limit, SHARE_LIMITS.downloads.windowMs);

/** Idioma de la página: el de la instalación (no hay nadie identificado). */
export async function shareLocale(): Promise<{ locale: Locale; t: T }> {
  const locale = (await getInstanceSettings()).locale;
  return { locale, t: makeT(locale) };
}

/** Nombre de pila (o el nombre visible si es de una palabra): la página nunca enseña más de las personas del equipo. */
const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name;

/** Tareas publicadas que siguen vivas (no archivadas ni borradas, del proyecto), en el orden en que se publicaron. */
async function liveSharedTasks(share: ActiveShare) {
  if (!share.taskIds.length) return [];
  const rows = await db.task.findMany({
    where: { id: { in: share.taskIds }, projectId: share.projectId, archivedAt: null },
    select: {
      id: true, title: true, description: true, dueDate: true,
      column: { select: { isDone: true } },
      assignee: { select: { name: true } },
      subtasks: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { title: true, done: true } },
      attachments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, originalName: true, size: true, isImage: true } },
      comments: { where: { deletedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100, select: { body: true, createdAt: true, authorName: true, author: { select: { name: true } } } },
    },
  });
  const order = new Map(share.taskIds.map((id, i) => [id, i]));
  return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

/** Primera columna «terminada» del proyecto (adonde va «Marcar como hecha»), o null. */
const firstDoneColumn = (projectId: string) => db.column.findFirst({ where: { projectId, isDone: true }, orderBy: COLUMN_ORDER, select: { id: true, name: true } });

/** Datos de la página (sin el token: lo pone la ruta). */
export async function loadSharePage(share: ActiveShare, token: string, notice: ShareNotice | null): Promise<{ data: SharePageData; t: T }> {
  const [{ locale, t }, tasks, done] = await Promise.all([shareLocale(), liveSharedTasks(share), firstDoneColumn(share.projectId)]);
  return {
    t,
    data: {
      token,
      columnName: share.columnName,
      canMarkDone: done !== null,
      expiresAt: share.expiresAt.toISOString(),
      notice,
      locale: intlLocale(locale),
      lang: locale,
      timeZone: appTimeZone(),
      appOrigin: appUrl(),
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        dueDate: dateToIso(task.dueDate),
        assignee: task.assignee ? firstName(task.assignee.name) : null,
        done: task.column.isDone,
        subtasks: task.subtasks,
        attachments: task.attachments.map((a) => ({ id: a.id, name: a.isImage ? a.originalName.replace(/\.[^.]+$/, "") + ".webp" : a.originalName, size: a.size, isImage: a.isImage })),
        comments: task.comments.reverse().map((c) => ({ author: c.author ? firstName(c.author.name) : (c.authorName ?? t("Alguien")), body: c.body, createdAt: c.createdAt.toISOString() })),
      })),
    },
  };
}

/** El adjunto, si es de una tarea publicada y viva de este enlace; null si no (la ruta responde 404 igual en los dos casos). */
export async function shareAttachment(share: ActiveShare, attachmentId: string): Promise<{ id: string; taskId: string; originalName: string; mimeType: string; isImage: boolean } | null> {
  const a = await db.taskAttachment.findUnique({ where: { id: attachmentId }, select: { id: true, taskId: true, originalName: true, mimeType: true, isImage: true, task: { select: { projectId: true, archivedAt: true } } } });
  if (!a || a.task.projectId !== share.projectId || a.task.archivedAt || !share.taskIds.includes(a.taskId)) return null;
  return { id: a.id, taskId: a.taskId, originalName: a.originalName, mimeType: a.mimeType, isImage: a.isImage };
}

// --- Acciones desde fuera ---------------------------------------------------------------------------------------------

/** Lo que manda un formulario de la página. */
export interface ShareChangeInput {
  op: string;
  due?: string;
  body?: string;
}

/** La tarea se archivó o cambió de proyecto mientras se marcaba como hecha. */
class ShareTaskGone extends Error {}

/** Sin menciones de verdad: lo de fuera no puede avisar a nadie escribiendo `@[Nombre](user:id)`. */
const plainMentions = (text: string): string => text.replace(mentionRegex(), (_m, name: string) => `@${name}`);

/**
 * Hace un cambio desde la página y devuelve el aviso que enseñará. Solo tareas publicadas y vivas (si no, `gone`). Topes:
 * cambios por enlace y hora (`rate`). Se ejecuta en un contexto de acción propio para reutilizar la regla de las columnas
 * «Asignación a persona», el deshacer y el historial; al terminar se guarda el historial (firmado «<columna> (fuera)»),
 * la entrada de deshacer en la pila del responsable (o, sin él, de quien generó la web), el registro y el aviso en vivo.
 */
export async function applyShareChange(share: ActiveShare, taskId: string, input: ShareChangeInput, ip: string): Promise<ShareNotice> {
  if (!share.taskIds.includes(taskId)) return "gone";
  const task = await db.task.findFirst({
    where: { id: taskId, projectId: share.projectId, archivedAt: null },
    select: { id: true, title: true, columnId: true, position: true, evergreen: true, evergreenEvery: true, dueDate: true, startDate: true, assigneeId: true, column: { select: { name: true, isDone: true } }, assignee: { select: { active: true } } },
  });
  if (!task) return "gone";
  const op = input.op;
  if (op !== "done" && op !== "due" && op !== "comment") return "invalid";
  if (!rateLimit(`share-out:change:${share.key}`, SHARE_LIMITS.changes.limit, SHARE_LIMITS.changes.windowMs)) return "rate";

  const { t } = await shareLocale();
  const author = renderLabel(shareAuthorLabel(share.columnName), t);
  const title = mentionsToPlain(task.title);
  // Quién puede deshacerlo y recibe el aviso: el responsable o, sin él, quien generó la web.
  const ownerId = task.assigneeId && task.assignee?.active ? task.assigneeId : share.generatedById;
  const ctx: ActionContext = { projectId: share.projectId, projectIsPrivate: share.projectPrivate, taskId };
  const start = performance.now();
  let notice: ShareNotice;
  let label: Label;
  try {
    const out = await actionContext.run(ctx, async (): Promise<{ notice: ShareNotice; label: Label } | null> => {
      if (op === "done") {
        if (task.column.isDone) return null;
        const target = await firstDoneColumn(share.projectId);
        if (!target) return { notice: "invalid", label: { k: "" } };
        const assigned = await db.$transaction(async (tx) => {
          await lockColumns(tx, [target.id]);
          const room = await assertColumnRoom(tx, target.id, [taskId]);
          // Arriba de la columna terminada.
          const first = await tx.task.findFirst({ where: { columnId: target.id, archivedAt: null, id: { not: taskId } }, orderBy: TASK_ORDER, select: { id: true } });
          const placed = await placeInColumn(tx, target.id, null, first?.id ?? null, taskId);
          const { count } = await tx.task.updateMany({ where: { id: taskId, archivedAt: null }, data: { columnId: target.id, position: placed.position, evergreen: false, evergreenEvery: 1 } });
          if (!count) throw new ShareTaskGone();
          return assignOnEnter(tx, room, [taskId]);
        });
        const assignUndo = assignUndoOps(assigned)[0]?.data ?? {};
        ctx.undo = [{ t: "task.set", id: taskId, data: { columnId: task.columnId, position: task.position, evergreen: task.evergreen, ...(task.evergreen ? { evergreenEvery: task.evergreenEvery } : {}), ...assignUndo } }];
        ctx.events = [{ taskId, code: "done", label: { k: "Movió la tarea de «{from}» a «{to}»", p: { from: task.column.name, to: target.name } } }];
        if (ownerId) {
          await finishAssignOnEnter(assigned, ownerId, { undo: false });
          await spawnRecurrences([taskId], ownerId);
        }
        if (ownerId) await notifyTask({ type: "COMMENT", actorId: null, taskId, projectId: share.projectId, recipientIds: [ownerId], excerpt: externalExcerpt(author, "done") });
        return { notice: "done", label: { k: "{who}: marcó «{title}» como hecha", p: { who: author, title } } };
      }
      if (op === "due") {
        const due = parseShareDate(input.due ?? "");
        if (due === undefined) return { notice: "invalid", label: { k: "" } };
        const before = dateToIso(task.dueDate);
        if (due === before) return null;
        const startIso = dateToIso(task.startDate);
        if (due && startIso && due < startIso) return { notice: "invalid", label: { k: "" } };
        await db.task.update({ where: { id: taskId }, data: { dueDate: due ? isoToDate(due) : null } });
        ctx.undo = [{ t: "task.set", id: taskId, data: { dueDate: before } }];
        ctx.events = [{ taskId, code: "update", label: due ? { k: "Puso la fecha límite el {date}", p: { date: due } } : { k: "Quitó la fecha límite" } }];
        if (ownerId) await notifyTask({ type: "DUE_CHANGED", actorId: null, taskId, projectId: share.projectId, recipientIds: [ownerId], excerpt: externalExcerpt(author, "due", dueChangeExcerpt(before, due)) });
        return { notice: "due", label: { k: "{who}: cambió la fecha de «{title}»", p: { who: author, title } } };
      }
      const body = plainMentions((input.body ?? "").replace(/\r\n?/g, "\n").trim());
      if (!body || [...body].length > MAX_SHARE_COMMENT) return { notice: "invalid", label: { k: "" } };
      const max = await getMaxCommentsPerTask();
      const comment = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "Task" WHERE "id" = ${taskId} FOR NO KEY UPDATE`;
        if ((await tx.taskComment.count({ where: { taskId, deletedAt: null } })) >= max) return null;
        return tx.taskComment.create({ data: { taskId, authorId: null, authorName: author.slice(0, 200), body }, select: { id: true } });
      });
      if (!comment) return { notice: "full", label: { k: "" } };
      ctx.undo = [{ t: "comment.remove", id: comment.id }];
      ctx.events = [{ taskId, code: "comment", label: { k: "Comentó en «{title}»", p: { title } } }];
      const recipients = [...new Set([...(ownerId ? [ownerId] : []), ...(await taskFollowerIds(taskId))])];
      if (recipients.length) await notifyTask({ type: "COMMENT", actorId: null, taskId, projectId: share.projectId, recipientIds: recipients, excerpt: externalExcerpt(author, "comment", makeExcerpt(body)), commentId: comment.id });
      return { notice: "comment", label: { k: "{who}: comentó en «{title}»", p: { who: author, title } } };
    });
    // Nada que cambiar (ya estaba hecha, la misma fecha): se dice igual que salió bien.
    if (!out) return op === "done" ? "done" : "due";
    notice = out.notice;
    label = out.label;
    if (!label.k) return notice;
  } catch (err) {
    if (err instanceof ShareTaskGone) return "gone";
    if (err instanceof AppError) return "invalid";
    logEvent({ level: "error", category: "api", action: `shareOut.${op}Failed`, label: { k: "Fallo de una acción de «Compartir fuera»: {error}", p: { error: logError(err) } }, projectId: share.projectId, path: "/x/…", ip, durationMs: performance.now() - start });
    throw err;
  }

  // Después de confirmar: tableros abiertos, historial, deshacer y registro (cada uno sin romper lo hecho si falla).
  publishChange({ projectId: share.projectId, userId: null, action: `shareOut.${op}`, taskId, taskIds: [taskId], full: true });
  let eventIds: string[] = [];
  try {
    const events = eventsOf(`shareOut.${op}`, ctx);
    if (events.length) {
      eventIds = (await db.taskEvent.createManyAndReturn({
        data: events.map((e) => ({ taskId: e.taskId, projectId: share.projectId, userId: null, userName: author.slice(0, 200), code: e.code, label: encodeLabel(e.label) })),
        select: { id: true },
      })).map((e) => e.id);
    }
  } catch (err) {
    console.error("[share-out] historial", err);
  }
  if (ownerId && ctx.undo?.length) {
    await saveUndo(ownerId, share.projectId, encodeLabel(label), ctx.undo, taskId, "UNDO", false, null, { eventIds }).catch((err) => console.error("[share-out] deshacer", err));
  }
  await actionContext.run(ctx, async () => logEvent({
    category: "api", action: `shareOut.${op}`, label, userName: author, projectId: share.projectId, path: "/x/…", ip, durationMs: performance.now() - start,
    details: { taskId, shareId: share.id },
  }));
  return notice;
}
