import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { dateToIso } from "./dates";
import { projectPeopleWhere, projectUsersWhere } from "./access";
import { db } from "./db";
import { TASK_ORDER } from "./task-positions";
import type { AttachmentTotals, BoardTask } from "./types";

/**
 * Campos de la tarjeta. Sin la descripción (puede ser larga y en el tablero solo hace falta saber si la hay) ni las filas
 * de subtareas, adjuntos, comentarios y enlaces: todo eso sale ya contado de boardExtras.
 */
const boardTaskSelect = {
  id: true,
  columnId: true,
  title: true,
  kindId: true,
  color: true,
  linkUrl: true,
  position: true,
  assigneeId: true,
  dueDate: true,
  deliverableId: true,
  evergreen: true,
  evergreenEvery: true,
  recurrence: true,
  recurrenceDay: true,
  contentUpdatedAt: true,
  columnEnteredAt: true,
  cost: true, costPaid: true, estimatedHours: true, actualHours: true, priority: true, client: true, startDate: true,
  // Solo id y título de la tarea que bloquea (una consulta por lote, sin N+1).
  blockedBy: { select: { id: true, title: true } },
  labels: { select: { labelId: true } },
} satisfies Prisma.TaskSelect;

type BoardTaskRow = Prisma.TaskGetPayload<{ select: typeof boardTaskSelect }>;
interface TaskExtras {
  hasDescription: boolean;
  comments: number;
  links: number;
  subtaskTotal: number;
  subtaskDone: number;
  imageCount: number;
  fileCount: number;
  attachBytes: number;
}
const NO_EXTRAS: TaskExtras = { hasDescription: false, comments: 0, links: 0, subtaskTotal: 0, subtaskDone: 0, imageCount: 0, fileCount: 0, attachBytes: 0 };

/**
 * Un carácter que no es espacio para `String.prototype.trim()` (espacios y saltos de línea de JavaScript, los Unicode
 * incluidos), escrito a mano para no depender de la configuración regional del servidor de PostgreSQL. Así «tiene
 * descripción» es lo mismo aquí que en el navegador (`description.trim().length > 0`, TaskDialog).
 */
const NON_SPACE = String.raw`[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]`;

/**
 * Si tiene descripción y comentarios (sin los borrados), enlaces, subtareas (total y hechas) y adjuntos (imágenes,
 * otros ficheros y bytes) de las tareas de `scope` (condición sobre `"Task" t`), en una sola consulta.
 *
 * Antes eran cuatro groupBy filtrados por proyecto: Prisma los convertía en un JOIN con Task que el planificador
 * resolvía recorriendo TODAS las filas de esas tablas del servidor (Seq Scan de los comentarios de todos los proyectos:
 * 40 ms con 200.000). Aquí cada recuento filtra por la lista de ids de las tareas (`= ANY`, con los índices por taskId),
 * así que solo lee las filas de esas tareas. No van como subconsultas correlacionadas por tarea: con un tablero grande su
 * coste estimado pasa el umbral del JIT de PostgreSQL, y compilarlo costaba más (unos 25 ms) que la propia consulta.
 *
 * La descripción no se lee entera: `<> ''` solo mira su longitud y el principio (`substr`) basta casi siempre para ver
 * un carácter que no sea espacio; solo se recorre completa si empieza por espacios.
 */
async function boardExtras(scope: Prisma.Sql): Promise<(id: string) => TaskExtras> {
  const rows = await db.$queryRaw<({ id: string } & TaskExtras)[]>`
    WITH t AS MATERIALIZED (
      SELECT t."id", (t."description" <> '' AND (substr(t."description", 1, 64) ~ ${NON_SPACE} OR t."description" ~ ${NON_SPACE})) AS "hasDescription"
      FROM "Task" t WHERE ${scope}
    ), ids AS (SELECT array_agg("id") AS "all" FROM t)
    SELECT t."id", t."hasDescription",
      COALESCE(c."n", 0) AS "comments", COALESCE(l."n", 0) AS "links",
      COALESCE(s."total", 0) AS "subtaskTotal", COALESCE(s."done", 0) AS "subtaskDone",
      COALESCE(a."images", 0) AS "imageCount", COALESCE(a."files", 0) AS "fileCount", COALESCE(a."bytes", 0) AS "attachBytes"
    FROM t
    LEFT JOIN (
      SELECT "taskId", count(*)::int AS "n" FROM "TaskComment"
      WHERE "taskId" = ANY((SELECT "all" FROM ids)::text[]) AND "deletedAt" IS NULL GROUP BY "taskId"
    ) c ON c."taskId" = t."id"
    LEFT JOIN (
      SELECT "taskId", count(*)::int AS "n" FROM "TaskLink"
      WHERE "taskId" = ANY((SELECT "all" FROM ids)::text[]) GROUP BY "taskId"
    ) l ON l."taskId" = t."id"
    LEFT JOIN (
      SELECT "taskId", count(*)::int AS "total", (count(*) FILTER (WHERE "done"))::int AS "done" FROM "Subtask"
      WHERE "taskId" = ANY((SELECT "all" FROM ids)::text[]) GROUP BY "taskId"
    ) s ON s."taskId" = t."id"
    LEFT JOIN (
      SELECT "taskId", (count(*) FILTER (WHERE "isImage"))::int AS "images", (count(*) FILTER (WHERE NOT "isImage"))::int AS "files",
        sum("size")::float8 AS "bytes"
      FROM "TaskAttachment" WHERE "taskId" = ANY((SELECT "all" FROM ids)::text[]) GROUP BY "taskId"
    ) a ON a."taskId" = t."id"`;
  const byId = new Map(rows.map(({ id, ...extras }) => [id, extras]));
  return (id) => byId.get(id) ?? NO_EXTRAS;
}

function toBoardTask(t: BoardTaskRow, extras: TaskExtras): BoardTask {
  return {
    id: t.id,
    columnId: t.columnId,
    title: t.title,
    kindId: t.kindId,
    color: t.color,
    linkUrl: t.linkUrl,
    position: t.position,
    assigneeId: t.assigneeId,
    labelIds: t.labels.map((l) => l.labelId),
    subtaskTotal: extras.subtaskTotal,
    subtaskDone: extras.subtaskDone,
    imageCount: extras.imageCount,
    fileCount: extras.fileCount,
    attachBytes: extras.attachBytes,
    hasDescription: extras.hasDescription,
    dueDate: dateToIso(t.dueDate),
    deliverableId: t.deliverableId,
    commentCount: extras.comments,
    linkCount: extras.links,
    evergreen: t.evergreen,
    evergreenEvery: t.evergreenEvery,
    recurrence: t.recurrence,
    recurrenceDay: t.recurrenceDay,
    textVersion: t.contentUpdatedAt?.toISOString() ?? null,
    columnEnteredAt: t.columnEnteredAt.toISOString(),
    blockedBy: t.blockedBy,
    cost: t.cost?.toFixed(2) ?? null,
    costPaid: t.costPaid,
    estimatedHours: t.estimatedHours?.toFixed(2) ?? null,
    actualHours: t.actualHours?.toFixed(2) ?? null,
    priority: t.priority,
    client: t.client,
    startDate: dateToIso(t.startDate),
  };
}

/**
 * Tareas activas del tablero. No se traen las descripciones (pueden ser largas y se enviarían
 * todas al cliente): boardExtras dice cuáles tienen y el detalle se pide al abrir la tarea.
 */
export async function loadBoardTasks(projectId: string): Promise<BoardTask[]> {
  const [rows, extras] = await Promise.all([
    db.task.findMany({ where: { projectId, archivedAt: null }, orderBy: TASK_ORDER, select: boardTaskSelect }),
    boardExtras(Prisma.sql`t."projectId" = ${projectId} AND t."archivedAt" IS NULL`),
  ]);
  return rows.map((r) => toBoardTask(r, extras(r.id)));
}

/** Varias tareas por id (p. ej. las recién creadas), en el orden del tablero y con sus recuentos. */
export async function loadBoardTasksByIds(ids: string[]): Promise<BoardTask[]> {
  if (!ids.length) return [];
  const [rows, extras] = await Promise.all([
    db.task.findMany({ where: { id: { in: ids } }, orderBy: TASK_ORDER, select: boardTaskSelect }),
    boardExtras(Prisma.sql`t."id" = ANY(${ids}::text[])`),
  ]);
  return rows.map((r) => toBoardTask(r, extras(r.id)));
}

/**
 * Las tareas ACTIVAS de `projectId` con esos ids (refresco en vivo de tarjetas sueltas): las archivadas, las borradas y
 * las de otros proyectos no salen, y el tablero entiende que ya no están en él.
 */
export async function loadProjectBoardTasks(projectId: string, ids: string[]): Promise<BoardTask[]> {
  if (!ids.length) return [];
  const [rows, extras] = await Promise.all([
    db.task.findMany({ where: { id: { in: ids }, projectId, archivedAt: null }, orderBy: TASK_ORDER, select: boardTaskSelect }),
    boardExtras(Prisma.sql`t."id" = ANY(${ids}::text[]) AND t."projectId" = ${projectId} AND t."archivedAt" IS NULL`),
  ]);
  return rows.map((r) => toBoardTask(r, extras(r.id)));
}

/**
 * Contadores de adjuntos de una tarea según las filas de TaskAttachment (nunca los ficheros del disco, que se
 * conservan un tiempo para poder deshacer un borrado). El cliente los usa como valor absoluto, no como suma.
 */
export async function attachmentTotals(taskId: string, client: Pick<typeof db, "taskAttachment"> = db): Promise<AttachmentTotals> {
  const rows = await client.taskAttachment.groupBy({ by: ["isImage"], where: { taskId }, _count: { _all: true }, _sum: { size: true } });
  const imgs = rows.find((r) => r.isImage);
  const files = rows.find((r) => !r.isImage);
  return { imageCount: imgs?._count._all ?? 0, fileCount: files?._count._all ?? 0, attachBytes: (imgs?._sum.size ?? 0) + (files?._sum.size ?? 0) };
}

export async function loadBoardTask(id: string): Promise<BoardTask> {
  const [row, extras] = await Promise.all([
    db.task.findUniqueOrThrow({ where: { id }, select: boardTaskSelect }),
    boardExtras(Prisma.sql`t."id" = ${id}`),
  ]);
  return toBoardTask(row, extras(id));
}

/** Usuarios activos que pueden ver el proyecto (para el selector de asignación). */
export async function projectUsers(projectId: string, project: { isPrivate: boolean }) {
  return db.user.findMany({
    where: { active: true, ...projectUsersWhere(project, projectId) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Personas activas para «Organizar por personas» (projectPeopleWhere): en un proyecto privado, las mismas que projectUsers;
 * en uno de equipo, sin los administradores que no lo tienen en su lista.
 */
export async function projectPeople(projectId: string, project: { isPrivate: boolean }) {
  return db.user.findMany({
    where: { active: true, ...projectPeopleWhere(project, projectId) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Zona horaria de referencia para «hoy» en plazos e informes (la misma que usa el navegador, ver format.ts). */
export { appTimeZone } from "./format";

/** Selección común de los tipos (con su automatización). */
const kindSelect = { id: true, name: true, color: true, titleTemplate: true, descriptionTemplate: true, subtaskTemplate: true } as const;

/**
 * Tipos de tarea: sin proyecto, solo los generales; con proyecto, los generales que el proyecto
 * usa (los que haya ocultado no aparecen) y después los propios del proyecto.
 */
export function listKinds(projectId?: string) {
  return db.taskKind.findMany({
    where: projectId
      ? { OR: [{ projectId: null, hiddenIn: { none: { projectId } } }, { projectId }] }
      : { projectId: null },
    orderBy: [{ projectId: { sort: "asc", nulls: "first" } }, { position: "asc" }, { createdAt: "asc" }],
    select: kindSelect,
  });
}

export async function userTemplates(userId: string) {
  const rows = await db.releaseTemplate.findMany({
    // Solo los de release: los del plan para IA (PLAN_HEADER/PLAN_FOOTER) van en la misma tabla y aquí no se usan.
    where: { userId, kind: { in: ["HEADER", "FOOTER"] } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, kind: true, name: true, content: true },
  });
  const pick = (kind: "HEADER" | "FOOTER") => rows.filter((r) => r.kind === kind).map(({ id, name, content }) => ({ id, name, content }));
  return { headers: pick("HEADER"), footers: pick("FOOTER") };
}

/** Cabeceras y pies de release definidos en el proyecto, en el orden que se les dio. */
export async function projectReleaseTemplates(projectId: string) {
  const rows = await db.projectReleaseTemplate.findMany({
    where: { projectId, kind: { in: ["HEADER", "FOOTER"] } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, kind: true, name: true, content: true },
  });
  const pick = (kind: "HEADER" | "FOOTER") => rows.filter((r) => r.kind === kind).map(({ id, name, content }) => ({ id, name, content }));
  return { headers: pick("HEADER"), footers: pick("FOOTER") };
}

/** Clientes distintos ya usados en las tareas del proyecto (para sugerir en el campo «Cliente»). */
export async function projectClients(projectId: string): Promise<string[]> {
  const rows = await db.task.groupBy({ by: ["client"], where: { projectId, client: { not: null } }, orderBy: { client: "asc" }, take: 200 });
  return rows.map((r) => r.client!).filter(Boolean);
}
