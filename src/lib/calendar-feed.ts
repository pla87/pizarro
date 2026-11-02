import "server-only";
import { visibleProjectsWhere, workingProjectsWhere } from "./access";
import { FEED_FUTURE_DAYS, FEED_MAX_DELIVERABLES, FEED_MAX_TASKS, FEED_PAST_DAYS, FEED_REFRESH_MINUTES, feedTokenHashes, isFeedTokenShape, safeEqualHex, sequenceOf, snippet } from "./calendar-feed-core";
import { appTimeZone } from "./board";
import { addDaysIso, dateToIso, isoToDate, todayIso } from "./dates";
import { db } from "./db";
import { buildIcs, descriptionToPlain, type IcsEvent } from "./ics";
import { appUrl } from "./mail";
import { mentionsToPlain } from "./mentions";
import { makeT, toLocale } from "../i18n/core";
import type { CurrentUser } from "./session";
import type { CalendarFeedScope, Prisma } from "@/generated/prisma/client";

// Calendario vivo de una persona: sus tareas con fecha límite y los entregables con fecha de los proyectos que puede ver.

export interface FeedOwner {
  id: string;
  name: string;
  role: "ADMIN" | "MEMBER";
  locale: string;
}

/**
 * Persona y ajustes de un token, o null si no vale (forma incorrecta, desconocido, regenerado, desactivado, usuario inactivo
 * o borrado). Una sola consulta por token con forma válida y el mismo resultado para todos los fallos.
 */
export async function resolveFeedToken(token: string): Promise<{ feedId: string; scope: CalendarFeedScope; user: FeedOwner } | null> {
  if (!isFeedTokenShape(token)) return null;
  const candidates = feedTokenHashes(token);
  const feed = await db.calendarFeed.findFirst({
    where: { tokenHash: { in: candidates } },
    select: { id: true, scope: true, tokenHash: true, user: { select: { id: true, name: true, role: true, locale: true, active: true } } },
  });
  if (!feed || !candidates.some((c) => safeEqualHex(c, feed.tokenHash)) || !feed.user.active) return null;
  return { feedId: feed.id, scope: feed.scope, user: feed.user };
}

/** .ics con las tareas no archivadas con fecha límite y los entregables con fecha. Los permisos se evalúan aquí, en cada petición. */
export async function buildFeedIcs(user: FeedOwner, scope: CalendarFeedScope, now: Date = new Date()): Promise<{ ics: string; tasks: number; deliverables: number }> {
  const t = makeT(toLocale(user.locale));
  const base = appUrl();
  const today = todayIso(appTimeZone(), now);
  const window = { gte: isoToDate(addDaysIso(today, -FEED_PAST_DAYS)), lte: isoToDate(addDaysIso(today, FEED_FUTURE_DAYS)) };
  const mine = scope === "MINE";
  // «Todas las de mis proyectos»: los mismos proyectos que la página del calendario (un administrador, solo los de equipo que ha
  // elegido en su perfil y sus privados). «Solo las mías»: cualquier proyecto que pueda ver, pues la tarea ya es suya.
  const project: Prisma.ProjectWhereInput = mine ? visibleProjectsWhere(user as CurrentUser) : workingProjectsWhere(user as CurrentUser);

  const [tasks, deliverables] = await Promise.all([
    db.task.findMany({
      where: { project, archivedAt: null, dueDate: window, ...(mine ? { assigneeId: user.id } : {}) },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: FEED_MAX_TASKS,
      select: { id: true, title: true, description: true, dueDate: true, startDate: true, updatedAt: true, project: { select: { id: true, name: true, taskFields: true, updatedAt: true } }, column: { select: { name: true } } },
    }),
    db.deliverable.findMany({
      // Con «solo las mías», los entregables en los que tengo alguna tarea.
      where: { project, dueDate: window, ...(mine ? { tasks: { some: { assigneeId: user.id, archivedAt: null } } } : {}) },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: FEED_MAX_DELIVERABLES,
      select: { id: true, name: true, description: true, dueDate: true, updatedAt: true, project: { select: { id: true, name: true, updatedAt: true } } },
    }),
  ]);

  const events: IcsEvent[] = [];
  for (const x of tasks) {
    const due = dateToIso(x.dueDate);
    if (!due) continue;
    // Con el campo «Fecha de inicio» activo y una fecha de inicio anterior, el evento abarca de inicio a límite.
    const start = x.project.taskFields.includes("startDate") ? dateToIso(x.startDate) : null;
    const isRange = !!start && start < due;
    const modifiedAt = x.updatedAt > x.project.updatedAt ? x.updatedAt : x.project.updatedAt;
    const plain = x.description ? snippet(descriptionToPlain(x.description), 300) : "";
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
  for (const d of deliverables) {
    const due = dateToIso(d.dueDate);
    if (!due) continue;
    const modifiedAt = d.updatedAt > d.project.updatedAt ? d.updatedAt : d.project.updatedAt;
    events.push({
      uid: `deliverable-${d.id}@pizarro`,
      date: due,
      summary: `[${d.project.name}] ${t("Entregable: {name}", { name: d.name })}`,
      description: [t("Proyecto: {name}", { name: d.project.name }), d.description ? snippet(descriptionToPlain(d.description), 300) : ""].filter(Boolean).join("\n"),
      url: `${base}/p/${d.project.id}`,
      modifiedAt,
      sequence: sequenceOf(modifiedAt),
      category: t("Entregable"),
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
  const name = mine ? t("Pizarro: mis tareas") : t("Pizarro: tareas de mis proyectos");
  return { ics: buildIcs({ name, events, now, prodId: "-//Pizarro//Suscripcion//ES", refreshMinutes: FEED_REFRESH_MINUTES }), tasks: tasks.length, deliverables: deliverables.length };
}
