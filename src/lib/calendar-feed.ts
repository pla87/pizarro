import "server-only";
import { createHash } from "node:crypto";
import { visibleProjectsWhere, workingProjectsWhere } from "./access";
import { FEED_FUTURE_DAYS, FEED_MAX_DELIVERABLES, FEED_MAX_REPEATS, FEED_MAX_TASKS, FEED_PAST_DAYS, FEED_REFRESH_MINUTES, feedTokenHashes, isFeedTokenShape, safeEqualHex, sequenceOf, snippet } from "./calendar-feed-core";
import { appTimeZone } from "./board";
import { addDaysIso, dateToIso, isoToDate, todayIso } from "./dates";
import { db } from "./db";
import { buildIcs, descriptionToPlain, type IcsEvent } from "./ics";
import { appUrl } from "./mail";
import { boundedMemo } from "./memo";
import { mentionsToPlain } from "./mentions";
import { repeatIcsEvents } from "./recurrence-series";
import { recurrenceLabel } from "../components/board/recurrence-ui";
import { makeT, toLocale } from "../i18n/core";
import type { CurrentUser } from "./session";
import type { CalendarFeedScope, Prisma } from "@/generated/prisma/client";

// Calendario vivo de una persona: sus tareas con fecha límite y los entregables con fecha de los proyectos que puede ver.

interface FeedOwner {
  id: string;
  name: string;
  role: "ADMIN" | "MEMBER";
  locale: string;
}

/**
 * Persona y ajustes de un token, o null si no vale (forma incorrecta, desconocido, regenerado, desactivado, usuario inactivo
 * o borrado). Una sola consulta por token con forma válida y el mismo resultado para todos los fallos.
 */
export async function resolveFeedToken(token: string): Promise<{ feedId: string; tokenHash: string; scope: CalendarFeedScope; user: FeedOwner } | null> {
  if (!isFeedTokenShape(token)) return null;
  const candidates = feedTokenHashes(token);
  const feed = await db.calendarFeed.findFirst({
    where: { tokenHash: { in: candidates } },
    select: { id: true, scope: true, tokenHash: true, user: { select: { id: true, name: true, role: true, locale: true, active: true } } },
  });
  if (!feed || !candidates.some((c) => safeEqualHex(c, feed.tokenHash)) || !feed.user.active) return null;
  // Coincidió con la clave anterior (TOKEN_SECRET_PREVIOUS, durante una rotación): se guarda ya con la actual, así el enlace
  // sigue funcionando cuando se retire la anterior. Es una escritura rara (una vez por enlace y rotación).
  const current = candidates[0]!;
  if (!safeEqualHex(current, feed.tokenHash)) {
    await db.calendarFeed.updateMany({ where: { id: feed.id, tokenHash: feed.tokenHash }, data: { tokenHash: current } }).catch(() => {});
  }
  return { feedId: feed.id, tokenHash: current, scope: feed.scope, user: feed.user };
}

/** Cuánto se guarda el .ics ya hecho de cada enlace y cuántos enlaces como mucho (se olvidan los usados hace más tiempo). */
export const FEED_CACHE_MS = 60_000;
export const FEED_CACHE_MAX = 200;
const feedCache = boundedMemo("calendar-feed", FEED_CACHE_MS, FEED_CACHE_MAX);

/** Solo para las pruebas: vaciar la memoria del calendario y ver cuántos enlaces guarda. */
export const feedCacheForTests = { clear: () => feedCache.clear(), size: () => feedCache.size };

type FeedResult = Awaited<ReturnType<typeof buildFeedIcs>> & { etag: string };

/**
 * El .ics de un enlace ya validado (resolveFeedToken, que se comprueba en cada petición: un enlace regenerado,
 * desactivado o de un usuario inactivo da 404 aunque su calendario siga aquí guardado), con su ETag. Se guarda
 * FEED_CACHE_MS por enlace, alcance, idioma y rol, y las consultas simultáneas del mismo enlace comparten la misma
 * generación. Un cambio de permisos o de tareas se ve, como mucho, al cabo de FEED_CACHE_MS.
 */
export function cachedFeedIcs(feed: { tokenHash: string; scope: CalendarFeedScope; user: FeedOwner }, now: number = Date.now()): Promise<FeedResult> {
  const key = `${feed.tokenHash}|${feed.scope}|${toLocale(feed.user.locale)}|${feed.user.role}`;
  return feedCache.get(key, async () => {
    const built = await buildFeedIcs(feed.user, feed.scope);
    // Cada evento lleva como DTSTAMP su último cambio, así que un calendario igual da el mismo ETag (y 304).
    return { ...built, etag: `"${createHash("sha256").update(built.ics).digest("base64url").slice(0, 27)}"` };
  }, now);
}

/** Lo que se usa de cada descripción: descriptionToPlain recorta a tantos caracteres antes de convertir. */
const DESCRIPTION_READ = 1500;

/**
 * Comienzo de las descripciones de unas tareas y entregables, sin leer el resto (pueden ser muy largas y aquí solo se
 * usan ~300 caracteres). `substring` deja a PostgreSQL leer solo el principio del valor guardado.
 */
async function descriptionHeads(taskIds: string[], deliverableIds: string[]): Promise<{ tasks: Map<string, string>; deliverables: Map<string, string> }> {
  const [t, d] = await Promise.all([
    taskIds.length
      ? db.$queryRaw<{ id: string; d: string }[]>`SELECT "id", substring("description" from 1 for ${DESCRIPTION_READ}::int) AS "d" FROM "Task" WHERE "id" = ANY(${taskIds}::text[]) AND "description" <> ''`
      : [],
    deliverableIds.length
      ? db.$queryRaw<{ id: string; d: string }[]>`SELECT "id", substring("description" from 1 for ${DESCRIPTION_READ}::int) AS "d" FROM "Deliverable" WHERE "id" = ANY(${deliverableIds}::text[]) AND "description" <> ''`
      : [],
  ]);
  return { tasks: new Map(t.map((r) => [r.id, r.d])), deliverables: new Map(d.map((r) => [r.id, r.d])) };
}

/**
 * Qué incluye por defecto la suscripción de quien aún no tiene una: «Solo las mías» solo si al menos la mitad de las
 * tareas pendientes de sus proyectos (los del calendario) tienen responsable; si no (uso familiar o personal, donde las
 * tareas no suelen asignarse, o sin tareas), «Todas»: con «Solo las mías» el calendario saldría vacío.
 */
export async function defaultFeedScope(user: CurrentUser): Promise<CalendarFeedScope> {
  const pending: Prisma.TaskWhereInput = { project: workingProjectsWhere(user), archivedAt: null, column: { isDone: false } };
  const [total, assigned] = await Promise.all([db.task.count({ where: pending }), db.task.count({ where: { ...pending, assigneeId: { not: null } } })]);
  return total > 0 && assigned * 2 >= total ? "MINE" : "ALL";
}

/**
 * .ics con las tareas no archivadas ni terminadas con fecha límite y los entregables con fecha. Las tareas que se repiten
 * llevan además sus apariciones futuras previstas como una serie (RRULE). Los permisos se evalúan aquí, cada vez que se hace (la ruta lo guarda un minuto: cachedFeedIcs).
 */
export async function buildFeedIcs(user: FeedOwner, scope: CalendarFeedScope, now: Date = new Date()): Promise<{ ics: string; tasks: number; deliverables: number; repeats: number }> {
  const locale = toLocale(user.locale);
  const t = makeT(locale);
  const base = appUrl();
  const today = todayIso(appTimeZone(), now);
  const window = { gte: isoToDate(addDaysIso(today, -FEED_PAST_DAYS)), lte: isoToDate(addDaysIso(today, FEED_FUTURE_DAYS)) };
  const mine = scope === "MINE";
  // «Todas las de mis proyectos»: los mismos proyectos que la página del calendario (un administrador, solo los de equipo que ha
  // elegido en su perfil y sus privados). «Solo las mías»: cualquier proyecto que pueda ver, pues la tarea ya es suya.
  const project: Prisma.ProjectWhereInput = mine ? visibleProjectsWhere(user as CurrentUser) : workingProjectsWhere(user as CurrentUser);

  const [tasks, deliverables, repeating] = await Promise.all([
    db.task.findMany({
      // Sin las terminadas (en columnas que cuentan como hechas), como «Ocultar terminadas» en el Calendario.
      where: { project, archivedAt: null, column: { isDone: false }, dueDate: window, ...(mine ? { assigneeId: user.id } : {}) },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: FEED_MAX_TASKS,
      select: { id: true, title: true, dueDate: true, startDate: true, updatedAt: true, project: { select: { id: true, name: true, taskFields: true, updatedAt: true } }, column: { select: { name: true } } },
    }),
    db.deliverable.findMany({
      // Con «solo las mías», los entregables en los que tengo alguna tarea.
      where: { project, dueDate: window, ...(mine ? { tasks: { some: { assigneeId: user.id, archivedAt: null } } } : {}) },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: FEED_MAX_DELIVERABLES,
      select: { id: true, name: true, dueDate: true, updatedAt: true, project: { select: { id: true, name: true, updatedAt: true } } },
    }),
    db.task.findMany({
      // Tareas que se repiten y aún no han dado su siguiente aparición: la serie sale de ellas (la tarea en sí va arriba si
      // su fecha cae en la ventana; una vencida hace tiempo también da serie). Sin fecha límite no hay previsión.
      where: { project, archivedAt: null, column: { isDone: false }, recurrence: { not: "NONE" }, recurrenceNext: { is: null }, dueDate: { not: null, lte: window.lte }, ...(mine ? { assigneeId: user.id } : {}) },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: FEED_MAX_REPEATS,
      select: { id: true, title: true, dueDate: true, recurrence: true, recurrenceDay: true, updatedAt: true, project: { select: { id: true, name: true, updatedAt: true } }, column: { select: { name: true } } },
    }),
  ]);
  // Las descripciones van aparte y solo su comienzo (lo único que se usa).
  const heads = await descriptionHeads([...new Set([...tasks, ...repeating].map((x) => x.id))], deliverables.map((d) => d.id));
  const toPlain = (md: string | undefined) => (md ? snippet(descriptionToPlain(md, DESCRIPTION_READ), 300) : "");
  // La descripción en texto plano se calcula una vez por tarea (la tarea y su serie la comparten).
  const plainOf = new Map<string, string>();
  const plainFor = (id: string) => {
    let s = plainOf.get(id);
    if (s === undefined) plainOf.set(id, (s = toPlain(heads.tasks.get(id))));
    return s;
  };

  const events: IcsEvent[] = [];
  for (const x of tasks) {
    const due = dateToIso(x.dueDate);
    if (!due) continue;
    // Con el campo «Fecha de inicio» activo y una fecha de inicio anterior, el evento abarca de inicio a límite.
    const start = x.project.taskFields.includes("startDate") ? dateToIso(x.startDate) : null;
    const isRange = !!start && start < due;
    const modifiedAt = x.updatedAt > x.project.updatedAt ? x.updatedAt : x.project.updatedAt;
    const plain = plainFor(x.id);
    events.push({
      // Mismo UID que el .ics de la columna Agenda: un solo evento por tarea aunque se importen los dos.
      uid: `${x.id}@pizarro`,
      date: isRange ? start : due,
      endDate: isRange ? due : undefined,
      summary: `[${x.project.name}] ${mentionsToPlain(x.title)}`,
      description: [t("Proyecto: {name}", { name: x.project.name }), t("Columna: {name}", { name: x.column.name }), plain].filter(Boolean).join("\n"),
      url: `${base}/p/${x.project.id}?task=${x.id}`,
      modifiedAt,
      sequence: sequenceOf(modifiedAt),
      category: t("Tarea"),
    });
  }
  const until = addDaysIso(today, FEED_FUTURE_DAYS);
  for (const x of repeating) {
    const modifiedAt = x.updatedAt > x.project.updatedAt ? x.updatedAt : x.project.updatedAt;
    const rule = recurrenceLabel(x, t, locale) ?? "";
    events.push(
      ...repeatIcsEvents({ id: x.id, recurrence: x.recurrence, recurrenceDay: x.recurrenceDay, due: dateToIso(x.dueDate) }, {
        summary: `[${x.project.name}] ${mentionsToPlain(x.title)}`,
        description: [t("Repetición prevista ({rule}): se crea al terminar la anterior.", { rule }), t("Proyecto: {name}", { name: x.project.name }), t("Columna: {name}", { name: x.column.name }), plainFor(x.id)].filter(Boolean).join("\n"),
        url: `${base}/p/${x.project.id}?task=${x.id}`,
        modifiedAt,
        sequence: sequenceOf(modifiedAt),
        category: t("Tarea"),
      }, today, until),
    );
  }
  for (const d of deliverables) {
    const due = dateToIso(d.dueDate);
    if (!due) continue;
    const modifiedAt = d.updatedAt > d.project.updatedAt ? d.updatedAt : d.project.updatedAt;
    events.push({
      uid: `deliverable-${d.id}@pizarro`,
      date: due,
      summary: `[${d.project.name}] ${t("Entregable: {name}", { name: d.name })}`,
      description: [t("Proyecto: {name}", { name: d.project.name }), toPlain(heads.deliverables.get(d.id))].filter(Boolean).join("\n"),
      url: `${base}/p/${d.project.id}`,
      modifiedAt,
      sequence: sequenceOf(modifiedAt),
      category: t("Entregable"),
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
  const name = mine ? t("Pizarro: mis tareas") : t("Pizarro: tareas de mis proyectos");
  return { ics: buildIcs({ name, events, now, prodId: "-//Pizarro//Suscripcion//ES", refreshMinutes: FEED_REFRESH_MINUTES }), tasks: tasks.length, deliverables: deliverables.length, repeats: repeating.length };
}
