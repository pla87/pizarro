import { listVisibleProjects, visibleProjectsWhere, workingProjectsWhere } from "@/lib/access";
import { appTimeZone } from "@/lib/board";
import { BAND_DAYS, monthGrid, parseMonth } from "@/lib/calendar";
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

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUserPage();
  const sp = await searchParams;
  const today = todayIso(appTimeZone());
  const month = parseMonth(one(sp.month), today);
  const grid = monthGrid(month, 1);

  const projects = await listVisibleProjects(user);
  // Un proyecto desconocido o no visible equivale a «todos».
  const projectId = projects.some((p) => p.id === one(sp.project)) ? one(sp.project) : "";
  const person = one(sp.person);
  const hideDone = one(sp.hideDone) === "1";

  // «Todos» son los proyectos en los que trabaja (un admin, los que eligió); uno concreto, cualquiera al que tenga acceso.
  const projectWhere: Prisma.ProjectWhereInput = projectId ? { ...visibleProjectsWhere(user), id: projectId } : workingProjectsWhere(user);
  const range = { gte: isoToDate(grid.start), lte: isoToDate(grid.end) };
  const base: Prisma.TaskWhereInput = { project: projectWhere, archivedAt: null, dueDate: range };

  const personWhere: Prisma.TaskWhereInput =
    person === "me" ? { assigneeId: user.id } : person === "none" ? { assigneeId: null } : person ? { assigneeId: person } : {};

  const [rows, assigneeGroups, deliverableRows] = await Promise.all([
    db.task.findMany({
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
    }),
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
        // Todas sus tareas (también archivadas por release: cuentan como hechas).
        tasks: { select: { archivedAt: true, column: { select: { isDone: true } } } },
      },
    }),
  ]);

  const peopleIds = assigneeGroups.map((g) => g.assigneeId).filter((x): x is string => !!x);
  const wanted = person && person !== "me" && person !== "none" ? [...new Set([...peopleIds, person])] : peopleIds;
  const people = wanted.length ? await db.user.findMany({ where: { id: { in: wanted }, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];

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
    total: d.tasks.length,
    done: d.tasks.filter((x) => x.archivedAt || x.column.isDone).length,
  }));

  return (
    <CalendarView
      month={month}
      today={today}
      weeks={grid.weeks}
      tasks={tasks}
      deliverables={deliverables}
      projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      people={people}
      filters={{ project: projectId, person, hideDone }}
      truncated={rows.length >= MAX_TASKS}
    />
  );
}
