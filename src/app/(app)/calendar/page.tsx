import { listVisibleProjects, projectUsersWhere, visibleProjectsWhere, workingProjectsWhere } from "@/lib/access";
import { appTimeZone } from "@/lib/board";
import { defaultFeedScope } from "@/lib/calendar-feed";
import { BAND_DAYS, MAX_PERSON_FILTER, PERSON_UNASSIGNED, monthGrid, parseMonth, parsePersonParam } from "@/lib/calendar";
import { addDaysIso, dateToIso, isoToDate, todayIso } from "@/lib/dates";
import { db } from "@/lib/db";
import { mentionsToPlain } from "@/lib/mentions";
import { requireUserPage } from "@/lib/session";
import { getLocale, getT } from "@/i18n/server";
import { localizeGeneralKind } from "@/lib/kinds-localize";
import { projectOccurrences } from "@/lib/recurrence-series";
import type { Prisma } from "@/generated/prisma/client";
import { CalendarView, type CalendarDeliverable, type CalendarRepeat, type CalendarTask } from "@/components/calendar/CalendarView";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Calendario") };
}

type Params = { month?: string | string[]; project?: string | string[]; person?: string | string[]; hideDone?: string | string[] };
// Sin NUL: PostgreSQL no lo admite en un texto y ?project=%00 o ?person=%00 acababan en la página de error (22021).
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").replaceAll("\u0000", "");

/** Tope de tareas por mes: un tablero normal queda muy por debajo; evita enviar páginas enormes. */
const MAX_TASKS = 1000;
const MAX_DELIVERABLES = 200;
/** Tareas recurrentes de las que se prevén apariciones, y tope de apariciones previstas que se pintan por mes. */
const MAX_REPEAT_SOURCES = 300;
const MAX_REPEATS = 500;
/** Proyectos que se aceptan en `?project=`. */
const MAX_PROJECT_FILTER = 50;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUserPage();
  const sp = await searchParams;
  const today = todayIso(appTimeZone());
  const month = parseMonth(one(sp.month), today);
  const grid = monthGrid(month, 1);

  const projects = await listVisibleProjects(user);
  // `?project=a,b,c` (o un solo id, como antes). Los ids de la URL no se fían: solo valen los proyectos visibles;
  // sin ninguno válido equivale a «todos».
  const requested = [...new Set(one(sp.project).split(",").map((x) => x.trim()).filter(Boolean))].slice(0, MAX_PROJECT_FILTER);
  const picked = requested.length ? await db.project.findMany({ where: { ...visibleProjectsWhere(user), id: { in: requested } }, select: { id: true, name: true, isPrivate: true } }) : [];
  const projectIds = requested.filter((id) => picked.some((p) => p.id === id));
  // Un proyecto elegido que no está entre los de trabajo (p. ej. un enlace) también debe poder verse en el selector.
  const options = [...projects.map((p) => ({ id: p.id, name: p.name })), ...picked.filter((p) => !projects.some((x) => x.id === p.id))];
  // `?person=id1,id2,unassigned` (o los valores antiguos `me`, `none` o un solo id).
  const requestedPeople = parsePersonParam(one(sp.person), user.id, MAX_PERSON_FILTER);
  const hideDone = one(sp.hideDone) === "1";

  // «Todos» son los proyectos en los que trabaja (un admin, los que eligió); los elegidos, cualquiera al que tenga acceso.
  const projectWhere: Prisma.ProjectWhereInput = projectIds.length ? { ...visibleProjectsWhere(user), id: { in: projectIds } } : workingProjectsWhere(user);
  const range = { gte: isoToDate(grid.start), lte: isoToDate(grid.end) };
  const base: Prisma.TaskWhereInput = { project: projectWhere, archivedAt: null, dueDate: range };

  const [assigneeGroups, deliverableRows] = await Promise.all([
    // Personas con tareas en el rango (para el filtro): solo las que ya se ven en este calendario.
    db.task.groupBy({ by: ["assigneeId"], where: base }),
    db.deliverable.findMany({
      // La banda de un entregable cubre la semana previa a su fecha: se cargan también los del mes siguiente que la tocan.
      where: { project: projectWhere, dueDate: { gte: range.gte, lte: isoToDate(addDaysIso(grid.end, BAND_DAYS - 1)) } },
      take: MAX_DELIVERABLES,
      orderBy: [{ dueDate: "asc" }, { position: "asc" }],
      select: {
        id: true,
        name: true,
        dueDate: true,
        project: { select: { id: true, name: true } },
      },
    }),
  ]);

  // Total y hechas por entregable (en columna terminada o archivadas por una release): se cuentan en la BD, sin traer las
  // tareas, filtrando por los ids (un `_count` de relación agruparía todas las tareas del servidor).
  const deliverableIds = deliverableRows.map((d) => d.id);
  const [totalGroups, doneGroups] = deliverableIds.length
    ? await Promise.all([
        db.task.groupBy({ by: ["deliverableId"], where: { deliverableId: { in: deliverableIds } }, _count: { _all: true } }),
        db.task.groupBy({
          by: ["deliverableId"],
          where: { deliverableId: { in: deliverableIds }, OR: [{ archivedAt: { not: null } }, { column: { isDone: true } }] },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const totalBy = new Map(totalGroups.map((g) => [g.deliverableId, g._count._all]));
  const doneBy = new Map(doneGroups.map((g) => [g.deliverableId, g._count._all]));
  // Un id arbitrario en la URL no revela ningún nombre ni filtra nada: solo valen el propio usuario, quienes tienen tareas
  // visibles en el rango y quienes pueden usar alguno de los proyectos a la vista (projectUsersWhere).
  const peopleIds = assigneeGroups.map((g) => g.assigneeId).filter((x): x is string => !!x);
  const requestedIds = requestedPeople.filter((x) => x !== PERSON_UNASSIGNED && x !== user.id);
  const scope = projectIds.length ? picked : projects;
  const people = await db.user.findMany({
    where: {
      active: true,
      OR: [
        { id: { in: [...peopleIds, user.id] } },
        ...(requestedIds.length && scope.length ? [{ id: { in: requestedIds }, OR: scope.map((p) => projectUsersWhere(p, p.id)) }] : []),
      ],
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const personIds = requestedPeople.filter((x) => x === PERSON_UNASSIGNED || people.some((p) => p.id === x));
  const assigneeIds = personIds.filter((x) => x !== PERSON_UNASSIGNED);
  const personWhere: Prisma.TaskWhereInput = personIds.length
    ? { OR: [...(assigneeIds.length ? [{ assigneeId: { in: assigneeIds } }] : []), ...(personIds.includes(PERSON_UNASSIGNED) ? [{ assigneeId: null }] : [])] }
    : {};
  // También las tareas con rango que terminan después del mes mostrado pero empiezan dentro (solo si el proyecto tiene fecha de inicio).
  const overlapsEnd: Prisma.TaskWhereInput = { project: { AND: [projectWhere, { taskFields: { has: "startDate" } }] }, archivedAt: null, startDate: { lte: range.lte }, dueDate: { gt: range.lte } };
  const rows = await db.task.findMany({
    where: { AND: [{ OR: [base, overlapsEnd] }, personWhere, hideDone ? { column: { isDone: false } } : {}] },
    take: MAX_TASKS,
    orderBy: [{ dueDate: "asc" }, { project: { position: "asc" } }, { position: "asc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      dueDate: true,
      startDate: true,
      project: { select: { id: true, name: true, taskFields: true } },
      kind: { select: { id: true, name: true, color: true } },
      column: { select: { isDone: true } },
    },
  });

  // Apariciones futuras previstas de las tareas que se repiten y aún no han dado la siguiente (las terminadas ya la dieron o
  // no la darán; las archivadas tampoco). Solo con fecha límite: sin ella la fecha de la siguiente depende de cuándo se termine.
  // Solo se prevén días posteriores a hoy y a la fecha límite, dentro de la cuadrícula visible.
  const repeatRows = await db.task.findMany({
    where: { AND: [{ project: projectWhere, archivedAt: null, column: { isDone: false }, recurrence: { not: "NONE" }, recurrenceNext: { is: null }, dueDate: { not: null, lt: range.lte } }, personWhere] },
    take: MAX_REPEAT_SOURCES,
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      dueDate: true,
      recurrence: true,
      recurrenceDay: true,
      project: { select: { id: true, name: true } },
      kind: { select: { id: true, name: true, color: true } },
    },
  });
  const locale = await getLocale();
  const repeatFrom = addDaysIso(today, 1) > grid.start ? addDaysIso(today, 1) : grid.start;
  const repeats: CalendarRepeat[] = [];
  let repeatsCut = repeatRows.length >= MAX_REPEAT_SOURCES;
  for (const r of repeatRows) {
    const room = MAX_REPEATS - repeats.length;
    const days = projectOccurrences(r.recurrence, r.recurrenceDay, dateToIso(r.dueDate), today, repeatFrom, grid.end, room + 1);
    if (days.length > room) repeatsCut = true;
    const title = mentionsToPlain(r.title);
    const kind = { name: localizeGeneralKind(r.kind, locale).name, color: r.kind.color };
    for (const due of days.slice(0, room)) {
      repeats.push({ key: `${r.id}:${due}`, taskId: r.id, title, due, projectId: r.project.id, projectName: r.project.name, kind, recurrence: r.recurrence, recurrenceDay: r.recurrenceDay });
    }
    if (repeats.length >= MAX_REPEATS) break;
  }

  const feedRow = await db.calendarFeed.findUnique({ where: { userId: user.id }, select: { scope: true } });
  // Sin suscripción, la opción marcada depende de si en sus proyectos las tareas suelen tener responsable.
  const feedScope = feedRow?.scope ?? (await defaultFeedScope(user));
  const tasks: CalendarTask[] = rows.map((r) => ({
    id: r.id,
    title: mentionsToPlain(r.title),
    due: dateToIso(r.dueDate)!,
    // El rango solo se dibuja si el proyecto tiene activada la fecha de inicio.
    start: r.project.taskFields.includes("startDate") ? dateToIso(r.startDate) : null,
    projectId: r.project.id,
    projectName: r.project.name,
    kind: { name: localizeGeneralKind(r.kind, locale).name, color: r.kind.color },
    done: r.column.isDone,
  }));

  const deliverables: CalendarDeliverable[] = deliverableRows.map((d) => ({
    id: d.id,
    name: d.name,
    due: dateToIso(d.dueDate)!,
    projectId: d.project.id,
    projectName: d.project.name,
    total: totalBy.get(d.id) ?? 0,
    done: doneBy.get(d.id) ?? 0,
  }));

  return (
    <CalendarView
      month={month}
      today={today}
      weeks={grid.weeks}
      tasks={tasks}
      repeats={repeats}
      deliverables={deliverables}
      projects={options}
      people={people}
      meId={user.id}
      filters={{ project: projectIds, person: personIds, hideDone }}
      feed={{ active: !!feedRow, scope: feedScope }}
      truncated={rows.length >= MAX_TASKS || deliverableRows.length >= MAX_DELIVERABLES || repeatsCut}
    />
  );
}
