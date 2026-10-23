import { listVisibleProjects, projectUsersWhere, visibleProjectsWhere, workingProjectsWhere } from "@/lib/access";
import { appTimeZone } from "@/lib/board";
import { BAND_DAYS, MAX_PERSON_FILTER, PERSON_UNASSIGNED, monthGrid, parseMonth, parsePersonParam } from "@/lib/calendar";
import { addDaysIso, dateToIso, isoToDate, todayIso } from "@/lib/dates";
import { db } from "@/lib/db";
import { mentionsToPlain } from "@/lib/mentions";
import { requireUserPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import type { Prisma } from "@/generated/prisma/client";
import { CalendarView, type CalendarDeliverable, type CalendarTask } from "@/components/calendar/CalendarView";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Calendario") };
}

type Params = { month?: string | string[]; project?: string | string[]; person?: string | string[]; hideDone?: string | string[] };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Tope de tareas por mes: un tablero normal queda muy por debajo; evita enviar páginas enormes. */
const MAX_TASKS = 1000;
const MAX_DELIVERABLES = 200;
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
        _count: { select: { tasks: true } },
      },
    }),
  ]);

  // Hechas por entregable (en columna terminada o archivadas por una release): se cuentan en la BD, sin traer las tareas.
  const doneGroups = deliverableRows.length
    ? await db.task.groupBy({
        by: ["deliverableId"],
        where: { deliverableId: { in: deliverableRows.map((d) => d.id) }, OR: [{ archivedAt: { not: null } }, { column: { isDone: true } }] },
        _count: { _all: true },
      })
    : [];
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
  const rows = await db.task.findMany({
    where: { ...base, ...personWhere, ...(hideDone ? { column: { isDone: false } } : {}) },
    take: MAX_TASKS,
    orderBy: [{ dueDate: "asc" }, { project: { position: "asc" } }, { position: "asc" }],
    select: {
      id: true,
      title: true,
      dueDate: true,
      project: { select: { id: true, name: true } },
      kind: { select: { name: true, color: true } },
      column: { select: { isDone: true } },
    },
  });

  const tasks: CalendarTask[] = rows.map((r) => ({
    id: r.id,
    title: mentionsToPlain(r.title),
    due: dateToIso(r.dueDate)!,
    projectId: r.project.id,
    projectName: r.project.name,
    kind: r.kind,
    done: r.column.isDone,
  }));

  const deliverables: CalendarDeliverable[] = deliverableRows.map((d) => ({
    id: d.id,
    name: d.name,
    due: dateToIso(d.dueDate)!,
    projectId: d.project.id,
    projectName: d.project.name,
    total: d._count.tasks,
    done: doneBy.get(d.id) ?? 0,
  }));

  return (
    <CalendarView
      month={month}
      today={today}
      weeks={grid.weeks}
      tasks={tasks}
      deliverables={deliverables}
      projects={options}
      people={people}
      meId={user.id}
      filters={{ project: projectIds, person: personIds, hideDone }}
      truncated={rows.length >= MAX_TASKS}
    />
  );
}
