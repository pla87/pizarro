import "server-only";
import { actionContext, type ActionContext } from "./action-context";
import { getMaxCommentsPerTask } from "./app-settings";
import { projectUsersWhere } from "./access";
import { appTimeZone } from "./board";
import { assertColumnRoom } from "./column-capacity";
import { assignOnEnter, assignUndoOps, finishAssignOnEnter } from "./column-assign";
import { boardShareOf, isShareColumn, shareLinkState, wasRevoked, type BoardShareInfo } from "./share-out-board";
import { dateToIso, isoToDate } from "./dates";
import { decryptSecret } from "./crypto";
import { db } from "./db";
import { AppError } from "./errors";
import { getInstanceSettings } from "./instance";
import { logEvent } from "./log";
import { appUrl } from "./mail";
import { excerpt as makeExcerpt, mentionRegex, mentionsToPlain } from "./mentions";
import { dueChangeExcerpt, externalExcerpt } from "./notification-text";
import { notifyTask, taskFollowerIds } from "./notify";
import { rateLimit, rateIp } from "./rate-limit";
import { publishChange } from "./realtime";
import { spawnRecurrences } from "./recurrence";
import {
  hashShareToken, inShareGrace, isShareTokenShape, MAX_SHARE_COMMENT, MAX_SHARE_PAGE_COMMENTS, parseShareDate, sameHash, SHARE_GRACE_DAYS, SHARE_LIMITS, SHARE_USE_WRITE_MS,
  externalUndoWhere, shareAuthorLabel, shareIpKey, shareKeyOf, shareNotifyBucket, SHARE_UNDO_KEYS, shareTokenHashes, shareUrl, type ShareNotice,
} from "./share-out-core";
import type { SharePageData } from "./share-out-page";
import { eventsOf } from "./task-events";
import { COLUMN_ORDER, lockColumns, placeInColumn, TASK_ORDER } from "./task-positions";
import { discardUndo, saveUndo } from "./undo";
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
  for (const r of rows) await client.columnShare.update({ where: { id: r.id }, data: { columnId: null, revokedAt: r.revokedAt ?? now, tokenEnc: null } });
  return rows.length > 0;
}

/**
 * Apagar la función en un proyecto: todos sus enlaces dejan de funcionar al momento (se revocan). Devuelve cuántos
 * funcionaban (como countActiveShares): los que ya habían caducado por tiempo también se cierran, pero no cuentan, y su
 * fin sigue siendo la caducidad (shareLinkState toma la fecha anterior).
 */
export async function revokeProjectShares(projectId: string, now: Date = new Date(), client: Pick<typeof db, "columnShare"> = db): Promise<number> {
  const where = { projectId, tokenHash: { not: null }, revokedAt: null };
  const rows = await client.columnShare.findMany({ where, select: { columnId: true, tokenHash: true, expiryDays: true, generatedAt: true, lastUsedAt: true, revokedAt: true, column: { select: { role: true, assigneeId: true, assignDueDays: true } } } });
  const active = rows.filter((r) => r.column && isShareColumn({ ...r.column, share: true }) && shareLinkState(r, now).state === "active").length;
  await client.columnShare.updateMany({ where, data: { revokedAt: now, tokenEnc: null } });
  return active;
}

/**
 * Enlaces que funcionan ahora en el proyecto (Ajustes, antes de apagar la función): con su columna «Compartir fuera», sin
 * revocar y sin caducar por tiempo. Son pocas filas: se miran una a una con shareLinkState.
 */
export async function countActiveShares(projectId: string, now: Date = new Date()): Promise<number> {
  const rows = await db.columnShare.findMany({
    where: { projectId, columnId: { not: null }, tokenHash: { not: null }, revokedAt: null },
    select: { columnId: true, tokenHash: true, expiryDays: true, generatedAt: true, lastUsedAt: true, revokedAt: true, column: { select: { role: true, assigneeId: true, assignDueDays: true } } },
  });
  return rows.filter((r) => r.column && isShareColumn({ ...r.column, share: true }) && shareLinkState(r, now).state === "active").length;
}

/** Nombres (de la cuenta) de quienes revocaron enlaces, por id: una cuenta borrada ya no sale. */
export async function revokerNames(rows: readonly { revokedById?: string | null }[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.revokedById).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();
  return new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
}

/** El estado del enlace para el tablero y el diálogo, con el nombre de quien lo revocó leído de su cuenta. */
export async function shareInfoOf(row: Parameters<typeof boardShareOf>[0] & { revokedById?: string | null }, now: Date = new Date()): Promise<BoardShareInfo> {
  const names = await revokerNames([row]);
  return boardShareOf(row, now, row.revokedById ? (names.get(row.revokedById) ?? null) : null);
}

/**
 * La dirección del enlace activo de una fila, descifrando su token (solo para el diálogo de la columna, a quien puede
 * editar el proyecto). `lost`: el enlace funciona, pero no se puede volver a enseñar (se creó antes de guardar el token
 * cifrado, o ENCRYPTION_KEY cambió sin rotar las claves): el diálogo ofrece crear uno nuevo.
 * Si la huella guardada no es la de la clave actual de TOKEN_SECRET (se cambió sin pasar rotate-keys, o aún vale la
 * anterior), se rehace con el token descifrado antes de entregar la dirección: si no, la que se entregaba podía responder
 * «no encontrado» con el pie diciendo «Enlace activo». Es seguro: el token sale de nuestro propio cifrado.
 */
export async function activeShareUrl(row: { id: string; tokenEnc: string | null; tokenHash: string | null }): Promise<{ url: string | null; lost: boolean }> {
  if (!row.tokenEnc || !row.tokenHash) return { url: null, lost: true };
  let token: string;
  try {
    token = decryptSecret(row.tokenEnc);
  } catch {
    return { url: null, lost: true };
  }
  if (!isShareTokenShape(token)) return { url: null, lost: true };
  const hash = hashShareToken(token);
  if (!sameHash(hash, row.tokenHash)) {
    const { count } = await db.columnShare.updateMany({ where: { id: row.id, tokenHash: row.tokenHash }, data: { tokenHash: hash } });
    // Otra petición la cambió entre medias: solo vale si quedó con la huella de este token (la rehízo otra igual).
    if (!count && (await db.columnShare.findUnique({ where: { id: row.id }, select: { tokenHash: true } }))?.tokenHash !== hash) return { url: null, lost: true };
  }
  return { url: shareUrl(appUrl(), token), lost: false };
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
  // El token cifrado de un enlace que ya no funciona (caducó por tiempo) no sirve para nada: fuera.
  const sealed = await db.columnShare.findMany({ where: { tokenEnc: { not: null } }, select: { id: true, columnId: true, tokenHash: true, expiryDays: true, generatedAt: true, lastUsedAt: true, revokedAt: true } });
  const stale = sealed.filter((r) => shareLinkState(r, now).state !== "active").map((r) => r.id);
  if (stale.length) await db.columnShare.updateMany({ where: { id: { in: stale } }, data: { tokenEnc: null } });
  return old.count + gone;
}

// --- Resolver un token ------------------------------------------------------------------------------------------------

/** Un enlace que funciona: lo que necesitan la página, las descargas y las acciones. */
interface ActiveShare {
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

type ResolvedShare = { kind: "active"; share: ActiveShare } | { kind: "expired"; revoked: boolean } | null;

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
    return row.oldTokenHash && candidates.some((c) => sameHash(c, row.oldTokenHash!)) && inShareGrace(ended, now) ? { kind: "expired", revoked: false } : null;
  }
  const { state, endsAt } = shareLinkState(row, now);
  const usable = state === "active" && row.project.shareOutEnabled && row.column && isShareColumn({ ...row.column, share: true });
  if (!usable) return inShareGrace(state === "active" ? now : (endsAt ?? now), now) ? { kind: "expired", revoked: wasRevoked(row) } : null;
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

/** Quién firma lo que pasa desde la web en Logs: «<columna> (fuera)», como el historial y los avisos. */
export async function shareAuthorName(share: Pick<ActiveShare, "columnName">): Promise<string> {
  const { t } = await shareLocale();
  return renderLabel(shareAuthorLabel(share.columnName), t);
}

/** Abrir la página cuenta como uso (de ahí la caducidad); se escribe como mucho una vez por hora. */
export async function noteShareUse(share: ActiveShare, now: Date = new Date()): Promise<void> {
  if (share.lastUsedAt && now.getTime() - share.lastUsedAt.getTime() < SHARE_USE_WRITE_MS) return;
  await db.columnShare.updateMany({ where: { id: share.id }, data: { lastUsedAt: now } });
}

/** Tope de peticiones por IP de todas las rutas de /x/ (mapa general del limitador: se cuenta antes de mirar el token). */
export const shareIpAllowed = (ip: string): boolean => rateLimit(shareIpKey(rateIp(ip)), SHARE_LIMITS.ip.limit, SHARE_LIMITS.ip.windowMs);
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
      // Los últimos (acota el tamaño de la página); los anteriores solo se cuentan.
      comments: { where: { deletedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MAX_SHARE_PAGE_COMMENTS, select: { body: true, createdAt: true, authorName: true, author: { select: { name: true } } } },
      _count: { select: { comments: { where: { deletedAt: null } } } },
    },
  });
  const order = new Map(share.taskIds.map((id, i) => [id, i]));
  return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

/** Primera columna «terminada» del proyecto (adonde va «Marcar como hecha»), o null. */
const firstDoneColumn = (projectId: string) => db.column.findFirst({ where: { projectId, isDone: true }, orderBy: COLUMN_ORDER, select: { id: true, name: true } });

/** Datos de la página (sin el token: lo pone la ruta). */
export async function loadSharePage(share: ActiveShare, token: string, notice: ShareNotice | null, noticeTaskId: string | null = null): Promise<{ data: SharePageData; t: T }> {
  const [{ locale, t }, tasks, done, by] = await Promise.all([
    shareLocale(), liveSharedTasks(share), firstDoneColumn(share.projectId),
    // Quien generó la web, por el nombre de su cuenta: solo si sigue activa y con acceso al proyecto (la misma regla que para
    // avisarle de los cambios); si no, la página no dice quién.
    liveGeneratorUser(share),
  ]);
  return {
    t,
    data: {
      token,
      columnName: share.columnName,
      canMarkDone: done !== null,
      expiresAt: share.expiresAt.toISOString(),
      notice,
      noticeTaskId: noticeTaskId && tasks.some((x) => x.id === noticeTaskId) ? noticeTaskId : null,
      sharedBy: by ? firstName(by.name) : null,
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
        olderComments: Math.max(0, task._count.comments - task.comments.length),
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
interface ShareChangeInput {
  op: string;
  due?: string;
  body?: string;
}

/** La tarea se archivó o cambió de proyecto mientras se marcaba como hecha. */
class ShareTaskGone extends Error {}

/** Quien generó la web, si su cuenta existe, está activa y ve el proyecto; si no, null. */
async function liveGeneratorUser(share: ActiveShare): Promise<{ id: string; name: string } | null> {
  if (!share.generatedById) return null;
  return db.user.findFirst({ where: { id: share.generatedById, active: true, ...projectUsersWhere({ isPrivate: share.projectPrivate }, share.projectId) }, select: { id: true, name: true } });
}

const liveGenerator = async (share: ActiveShare): Promise<string | null> => (await liveGeneratorUser(share))?.id ?? null;

/** Lo que sigue a un cambio ya guardado: si falla, se registra y el cambio se queda (quien está fuera nunca ve un 500). */
async function sideEffect(what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[share-out] ${what}`, err);
  }
}

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
  // Quién puede deshacerlo y recibe el aviso: el responsable o, sin él, quien generó la web, si su cuenta sigue activa y ve
  // el proyecto (pudo borrarse o salir de él: una clave ajena a una cuenta que ya no existe haría fallar la siguiente
  // aparición de una tarea fija). Sin ninguno de los dos, nadie: el cambio se hace igual.
  const ownerId = task.assigneeId && task.assignee?.active ? task.assigneeId : await liveGenerator(share);
  // Los envíos externos de estos avisos, con su propio tope por enlace (no el de los avisos del sistema).
  const ctx: ActionContext = { projectId: share.projectId, projectIsPrivate: share.projectPrivate, taskId, notifyBucket: { key: shareNotifyBucket(share.id), limit: SHARE_LIMITS.notify.limit } };
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
          const { count } = await tx.task.updateMany({ where: { id: taskId, projectId: share.projectId, archivedAt: null }, data: { columnId: target.id, position: placed.position, evergreen: false, evergreenEvery: 1 } });
          if (!count) throw new ShareTaskGone();
          return assignOnEnter(tx, room, [taskId]);
        });
        const assignUndo = assignUndoOps(assigned)[0]?.data ?? {};
        ctx.undo = [{ t: "task.set", id: taskId, data: { columnId: task.columnId, position: task.position, evergreen: task.evergreen, ...(task.evergreen ? { evergreenEvery: task.evergreenEvery } : {}), ...assignUndo } }];
        ctx.events = [{ taskId, code: "done", label: { k: "Movió la tarea de «{from}» a «{to}»", p: { from: task.column.name, to: target.name } } }];
        // Ya está hecha: lo de después (asignar, la siguiente aparición de una tarea fija, el aviso) no la deshace si falla.
        await sideEffect("assign", () => finishAssignOnEnter(assigned, ownerId, { undo: false }));
        await sideEffect("recurrence", () => spawnRecurrences([taskId], ownerId));
        if (ownerId) await sideEffect("notify", () => notifyTask({ type: "COMMENT", actorId: null, taskId, projectId: share.projectId, recipientIds: [ownerId], excerpt: externalExcerpt(author, "done") }));
        return { notice: "done", label: { k: SHARE_UNDO_KEYS.done, p: { who: author, title } } };
      }
      if (op === "due") {
        const due = parseShareDate(input.due ?? "");
        if (due === undefined) return { notice: "invalid", label: { k: "" } };
        const before = dateToIso(task.dueDate);
        if (due === before) return null;
        const startIso = dateToIso(task.startDate);
        if (due && startIso && due < startIso) return { notice: "invalid", label: { k: "" } };
        // Solo si sigue en el proyecto y sin archivar (pudo cambiar desde que se leyó).
        const { count } = await db.task.updateMany({ where: { id: taskId, projectId: share.projectId, archivedAt: null }, data: { dueDate: due ? isoToDate(due) : null } });
        if (!count) throw new ShareTaskGone();
        ctx.undo = [{ t: "task.set", id: taskId, data: { dueDate: before } }];
        ctx.events = [{ taskId, code: "update", label: due ? { k: "Puso la fecha límite el {date}", p: { date: due } } : { k: "Quitó la fecha límite" } }];
        if (ownerId) await sideEffect("notify", () => notifyTask({ type: "DUE_CHANGED", actorId: null, taskId, projectId: share.projectId, recipientIds: [ownerId], excerpt: externalExcerpt(author, "due", dueChangeExcerpt(before, due)) }));
        return { notice: "due", label: { k: SHARE_UNDO_KEYS.due, p: { who: author, title } } };
      }
      const body = plainMentions((input.body ?? "").replace(/\r\n?/g, "\n").trim());
      if (!body || [...body].length > MAX_SHARE_COMMENT) return { notice: "invalid", label: { k: "" } };
      const max = await getMaxCommentsPerTask();
      const comment = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "Task" WHERE "id" = ${taskId} FOR NO KEY UPDATE`;
        // Doble clic en «Comentar»: el mismo texto, de la misma firma, hace menos de 30 s, ya está publicado.
        // Con el reloj de la app: `createdAt` lo pone Prisma (@default(now()) se calcula en la app, no en la base).
        const last = await tx.taskComment.findFirst({ where: { taskId, deletedAt: null }, orderBy: { createdAt: "desc" }, select: { authorId: true, authorName: true, body: true, createdAt: true } });
        if (last && last.authorId === null && last.authorName === author.slice(0, 200) && last.body === body && Date.now() - last.createdAt.getTime() < 30_000) return "repeated" as const;
        if ((await tx.taskComment.count({ where: { taskId, deletedAt: null } })) >= max) return null;
        return tx.taskComment.create({ data: { taskId, authorId: null, authorName: author.slice(0, 200), body }, select: { id: true } });
      });
      if (comment === "repeated") return { notice: "comment", label: { k: "" } };
      if (!comment) return { notice: "full", label: { k: "" } };
      ctx.undo = [{ t: "comment.remove", id: comment.id }];
      ctx.events = [{ taskId, code: "comment", label: { k: "Comentó en «{title}»", p: { title } } }];
      // El comentario ya está guardado: buscar a quién avisar tampoco puede romperlo (un 500 haría que lo reenviasen).
      await sideEffect("notify", async () => {
        const recipients = [...new Set([...(ownerId ? [ownerId] : []), ...(await taskFollowerIds(taskId))])];
        if (recipients.length) await notifyTask({ type: "COMMENT", actorId: null, taskId, projectId: share.projectId, recipientIds: recipients, excerpt: externalExcerpt(author, "comment", makeExcerpt(body)), commentId: comment.id });
      });
      return { notice: "comment", label: { k: SHARE_UNDO_KEYS.comment, p: { who: author, title } } };
    });
    // Nada que cambiar (ya estaba hecha, la misma fecha): se dice igual que salió bien.
    if (!out) return op === "done" ? "done" : "due";
    notice = out.notice;
    label = out.label;
    if (!label.k) return notice;
  } catch (err) {
    if (err instanceof ShareTaskGone) return "gone";
    if (err instanceof AppError) return "invalid";
    // Lo registra la ruta (una sola fila por fallo, también si falla antes de llegar aquí).
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
    // Como mucho una entrada «de fuera» en la pila del responsable en el proyecto: la nueva sustituye a la anterior de
    // fuera, y no cuenta para el límite de 10 (saveUndo no la cuenta al recortar), así que lo hecho desde la página no le
    // echa de la pila lo que hizo él. Esas entradas solo llevan `task.set` o `comment.remove` (ningún adjunto);
    // discardUndo, además, solo libera los ficheros que ninguna otra entrada retiene.
    await discardUndo({ userId: ownerId, projectId: share.projectId, kind: "UNDO", ...externalUndoWhere() })
      .then(() => saveUndo(ownerId, share.projectId, encodeLabel(label), ctx.undo!, taskId, "UNDO", false, null, { eventIds }))
      .catch((err) => console.error("[share-out] deshacer", err));
  }
  await actionContext.run(ctx, async () => logEvent({
    category: "api", action: `shareOut.${op}`, label, userName: author, projectId: share.projectId, path: "/x/…", ip, durationMs: performance.now() - start,
    details: { taskId, shareId: share.id },
  }));
  return notice;
}
