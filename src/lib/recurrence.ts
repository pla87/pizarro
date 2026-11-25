import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { addDaysIso, daysBetween, dateToIso, isoToDate, todayIso } from "./dates";
import { db } from "./db";
import { appTimeZone, loadBoardTask, loadBoardTasksByIds } from "./board";
import { nextOccurrenceDue } from "./recurrence-date";
import { POSITION_STEP } from "./positions";
import { lastPositionIn, lockColumns } from "./task-positions";
import { addUndo } from "./undo";
import { noteTasks } from "./action-context";
import { MAX_ACTIVE_TASKS_PER_PROJECT } from "./constants";
import { columnRoomProblem } from "./column-capacity";
import { columnAssignment, notifyAssigned, type ColumnAssignment } from "./column-assign";
import { logError, logEvent } from "./log";
import { copyAttachmentsBatch } from "./attachment-copy";
import { attachmentRefIds, remapAttachmentRefs } from "./attachment-refs";
import type { BoardTask } from "./types";

/**
 * Responsables que pueden pasar a la siguiente aparición en cada proyecto (activos y con acceso), leídos de una vez
 * para todo el lote: `(projectId, userId) → userId | null`.
 */
async function assignableResolver(pairs: { projectId: string; assigneeId: string | null }[]): Promise<(projectId: string, userId: string | null) => string | null> {
  const userIds = [...new Set(pairs.map((p) => p.assigneeId).filter((id): id is string => !!id))];
  if (!userIds.length) return () => null;
  const projectIds = [...new Set(pairs.map((p) => p.projectId))];
  const [users, projects] = await Promise.all([
    db.user.findMany({ where: { id: { in: userIds }, active: true }, select: { id: true, role: true, memberships: { where: { projectId: { in: projectIds } }, select: { projectId: true } } } }),
    db.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, isPrivate: true } }),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const privateById = new Map(projects.map((p) => [p.id, p.isPrivate]));
  return (projectId, userId) => {
    if (!userId) return null;
    const user = userById.get(userId);
    const isPrivate = privateById.get(projectId);
    if (!user || isPrivate === undefined) return null;
    return user.memberships.some((m) => m.projectId === projectId) || (!isPrivate && user.role === "ADMIN") ? userId : null;
  };
}

/** Apariciones por transacción al crear muchas a la vez (cada transacción, muy por debajo de su tope de 5 s). */
const SPAWN_BATCH = 100;

type RoutineSource = { projectId: string; columnId: string; routineColumnId: string | null; column: { role: string } };

/**
 * Columna ROUTINES de la que cuelga cada tarea recurrente (en la que está o la última en la que estuvo) y columna
 * donde nace su siguiente aparición: la destino configurada o, por defecto, la propia columna de rutinas
 * (salvo que cuente como terminada: entonces se sigue la regla general). null si no viene de una rutina.
 * Una sola consulta para todo el lote.
 */
async function routineColumnsOf(sources: RoutineSource[]): Promise<(src: RoutineSource) => { columnId: string; targetId: string } | null> {
  const idOf = (src: RoutineSource) => (src.column.role === "ROUTINES" ? src.columnId : src.routineColumnId);
  const ids = [...new Set(sources.map(idOf).filter((id): id is string => !!id))];
  const cols = ids.length
    ? await db.column.findMany({ where: { id: { in: ids }, role: "ROUTINES" }, select: { id: true, projectId: true, isDone: true, routineTargetColumnId: true } })
    : [];
  const byId = new Map(cols.map((c) => [c.id, c]));
  return (src) => {
    const id = idOf(src);
    const col = id ? byId.get(id) : undefined;
    if (!col || col.projectId !== src.projectId) return null;
    if (col.routineTargetColumnId) return { columnId: col.id, targetId: col.routineTargetColumnId };
    return col.isDone ? null : { columnId: col.id, targetId: col.id };
  };
}

/**
 * Imágenes y enlaces de la descripción (`![…](/api/attachments/<id>)`) que apuntan a adjuntos de la aparición anterior:
 * la siguiente lleva su propia copia de esos adjuntos (solo de los citados: los demás adjuntos no pasan) y su
 * descripción apunta a ellas. Si no, borrar la anterior (o ese adjunto) dejaba la imagen rota en la nueva. Lo que no cabe
 * (tope de la tarea, cuotas, disco) conserva la referencia a la anterior y queda anotado en el registro. Para todo el
 * lote a la vez: una lectura de los adjuntos, una transacción para las filas y un UPDATE para las descripciones (sin
 * ninguna consulta si ninguna descripción cita adjuntos).
 */
async function copyDescriptionAttachments(spawned: { src: { id: string; projectId: string; title: string; description: string }; id: string }[]): Promise<void> {
  const requests = spawned
    .map(({ src, id }) => ({ src, fromTaskId: src.id, toTaskId: id, attachmentIds: attachmentRefIds(src.description) }))
    .filter((r) => r.attachmentIds.length > 0);
  if (!requests.length) return;
  const results = await copyAttachmentsBatch(requests, "al crear la siguiente aparición de una tarea repetida");
  const ids: string[] = [];
  const before: string[] = [];
  const after: string[] = [];
  requests.forEach((r, i) => {
    const res = results[i]!;
    const description = remapAttachmentRefs(r.src.description, res.ids);
    if (description !== r.src.description) {
      ids.push(r.toTaskId);
      before.push(r.src.description);
      after.push(description);
    }
    if (res.skipped.length) {
      logEvent({
        level: "warn", category: "system", action: "recurrence.attachmentsSkipped",
        label: {
          k: res.skipped.length === 1
            ? "La siguiente aparición de «{title}» no lleva copia de un adjunto de su descripción: sigue apuntando a los de la anterior"
            : "La siguiente aparición de «{title}» no lleva copia de {n} adjuntos de su descripción: sigue apuntando a los de la anterior",
          p: { title: r.src.title, n: res.skipped.length },
        },
        projectId: r.src.projectId,
        details: { taskId: r.toTaskId, fromTaskId: r.fromTaskId, skipped: res.skipped.map((s) => ({ name: s.name, size: s.size, reason: s.reason })) },
      });
    }
  });
  // Solo si nadie la ha cambiado entretanto (la descripción sigue siendo la copiada).
  if (ids.length) await db.$executeRaw`UPDATE "Task" AS t SET "description" = d.a FROM unnest(${ids}::text[], ${before}::text[], ${after}::text[]) AS d(id, b, a) WHERE t."id" = d.id AND t."description" = d.b`;
}

/**
 * Crea la siguiente aparición de las tareas recurrentes que se acaban de terminar (movidas a una columna
 * «terminada») o archivar. Es idempotente: `recurrenceFromId` es único, así que de cada tarea solo sale una
 * siguiente, aunque se mueva varias veces, se archive después de terminarla o dos personas lo hagan a la vez.
 *
 * La nueva copia lleva los mismos campos (subtareas sin marcar; sin comentarios ni historial; el entregable solo si no
 * ha vencido, y de los adjuntos solo copia de los que cita la descripción: copyDescriptionAttachments),
 * la misma repetición y la fecha límite que marca la regla. Va al final de la primera columna no terminada
 * o, si la tarea no estaba en una terminada (p. ej. se archivó desde «En curso»), de su misma columna.
 * Deshacer la acción que la provocó quita también la copia (operación inversa anotada aquí).
 * `titles` (taskId → título) sustituye al guardado: el despliegue de una release antepone un código al título
 * y la siguiente aparición debe nacer con el original.
 * `asDone`: las tareas cuentan como terminadas aunque su columna no lo sea (el despliegue de una release con destino
 * «Archivar» las archiva desde la columna de la release): la siguiente va a la primera columna no terminada, como al
 * terminarlas, y no a la de la release (que entraría en la próxima release sin hacerse).
 *
 * Lo que no depende de cada tarea (columnas de rutina, primera columna abierta, tope de tareas, roles de las columnas,
 * responsables) se lee una vez para todo el lote; cada tarea conserva su transacción corta (columna bloqueada, tope de
 * sesiones de un «Programa del curso», idempotencia por `recurrenceFromId`). `actorId` null: sin nadie de la app que la
 * cree (lo hecho desde «Compartir fuera» sin responsable ni autor de la web activos): la siguiente nace sin autor.
 */
export async function spawnRecurrences(taskIds: string[], actorId: string | null, titles?: Map<string, string>, opts: { asDone?: boolean } = {}): Promise<BoardTask[]> {
  if (!taskIds.length) return [];
  const sources = await db.task.findMany({
    where: { id: { in: taskIds }, recurrence: { not: "NONE" }, recurrenceNext: null },
    orderBy: [{ column: { position: "asc" } }, { position: "asc" }],
    select: {
      id: true, projectId: true, columnId: true, title: true, description: true, kindId: true, color: true, linkUrl: true,
      assigneeId: true, dueDate: true, startDate: true, cost: true, estimatedHours: true, priority: true, client: true, deliverableId: true, recurrence: true, recurrenceDay: true,
      routineColumnId: true,
      deliverable: { select: { dueDate: true } },
      column: { select: { isDone: true, role: true } },
      labels: { select: { labelId: true } },
      subtasks: { orderBy: { position: "asc" }, select: { title: true, position: true } },
    },
  });
  if (!sources.length) return [];
  const today = todayIso(appTimeZone());
  const created: string[] = [];
  const projectIds = [...new Set(sources.map((s) => s.projectId))];
  const [routineOf, assignable, openCols, activeCounts] = await Promise.all([
    routineColumnsOf(sources),
    assignableResolver(sources),
    // Primera columna no terminada de cada proyecto (la primera por posición de cada uno).
    db.column.findMany({ where: { projectId: { in: projectIds }, isDone: false }, orderBy: [{ projectId: "asc" }, { position: "asc" }], distinct: ["projectId"], select: { id: true, projectId: true } }),
    // Tareas activas por proyecto: se cuentan una vez y se suman las que van naciendo (antes, un COUNT por tarea).
    db.task.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds }, archivedAt: null }, _count: { _all: true } }),
  ]);
  const firstOpen = new Map(openCols.map((c) => [c.projectId, c.id]));
  const active = new Map(activeCounts.map((r) => [r.projectId, r._count._all]));
  const plan = sources.map((src) => {
    const routine = routineOf(src);
    // Rutinas: si la tarea vive (o vivió) en una columna ROUTINES, la siguiente aparición va a su columna destino.
    const columnId = routine ? routine.targetId : src.column.isDone || opts.asDone ? (firstOpen.get(src.projectId) ?? src.columnId) : src.columnId;
    return { src, routine, columnId };
  });
  // Solo las columnas «Programa del curso» tienen tope de sesiones: las demás van en lote. Leído fuera de la transacción,
  // solo sirve para repartir: el tope lo deciden createOne y createMany con la columna bloqueada (una columna puede pasar
  // a PROGRAM entre esta lectura y el alta).
  const targetCols = await db.column.findMany({
    where: { id: { in: [...new Set(plan.map((p) => p.columnId))] } },
    select: { id: true, projectId: true, role: true, assigneeId: true, assignDueDays: true },
  });
  const programCols = new Set(targetCols.filter((c) => c.role === "PROGRAM").map((c) => c.id));

  // Columnas «Asignación a persona» de destino: la aparición nace de su persona (fecha no hace falta: siempre lleva la de
  // la regla de repetición). Con la misma lectura, fuera de las transacciones, como programCols (en columnas normales,
  // ninguna consulta más): un cambio de persona en ese mismo instante deja la aparición con la persona anterior, como si
  // hubiera nacido justo antes del cambio.
  const assignRules = new Map<string, ColumnAssignment | null>();
  for (const c of targetCols) assignRules.set(c.id, await columnAssignment(db, c));

  /** Centinela de createMany: una columna del lote es ya «Programa del curso» (se repite una a una). */
  const PROGRAM_SINCE_READ = new Error("program-column");

  type Item = (typeof plan)[number] & { data: Omit<Prisma.TaskCreateManyInput, "position"> };

  /** Una aparición en su propia transacción (columnas «Programa del curso», que tienen tope, y reintentos). */
  const createOne = async ({ src, columnId, data }: Item): Promise<string | null> => {
    try {
      // Al final de la columna, con la columna bloqueada (sin compartir posición con otra tarea).
      const next = await db.$transaction(async (tx) => {
        await lockColumns(tx, [columnId]);
        // Columna «Programa del curso» en el tope de sesiones: tampoco nace (igual que con el tope del proyecto). El rol se
        // lee aquí, con la columna bloqueada (no vale programCols, leído antes y fuera de la transacción).
        if (await columnRoomProblem(tx, columnId, 1)) return null;
        const last = await lastPositionIn(tx, columnId);
        return tx.task.create({
          data: {
            ...data,
            position: (last ?? 0) + POSITION_STEP,
            labels: { create: src.labels.map((l) => ({ labelId: l.labelId })) },
            subtasks: { create: src.subtasks.map((s) => ({ title: s.title, position: s.position })) },
          },
          select: { id: true },
        });
      });
      if (!next) {
        logEvent({
          level: "warn", category: "system", action: "recurrence.skippedColumnLimit",
          label: { k: "No se creó la siguiente aparición de «{title}»: su columna tiene el máximo de sesiones", p: { title: src.title } },
          details: { taskId: src.id, projectId: src.projectId, columnId },
        });
        return null;
      }
      return next.id;
    } catch (err) {
      // Otra petición ya creó la siguiente aparición de esta tarea: nada que hacer.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
      throw err;
    }
  };

  /**
   * Varias apariciones (de columnas sin tope de sesiones) en una transacción: las columnas bloqueadas, una posición
   * final por columna y tres INSERT para todas (tareas, etiquetas y subtareas), en el orden del lote. Si otra petición
   * ha creado a la vez la siguiente de alguna (índice único de `recurrenceFromId`), no se crea ninguna del grupo y se
   * repite una a una, que salta solo esa. Igual si alguna columna ha pasado a «Programa del curso» desde que se leyó
   * programCols: una a una, cada una con su comprobación del tope.
   */
  const createMany = async (items: Item[]): Promise<(string | null)[]> => {
    try {
      return await db.$transaction(async (tx) => {
        const cols = [...new Set(items.map((i) => i.columnId))];
        await lockColumns(tx, cols);
        if (await tx.column.count({ where: { id: { in: cols }, role: "PROGRAM" } })) throw PROGRAM_SINCE_READ;
        const pos = new Map<string, number>();
        for (const c of cols) pos.set(c, (await lastPositionIn(tx, c)) ?? 0);
        const rows = await tx.task.createManyAndReturn({
          data: items.map((i) => {
            const position = pos.get(i.columnId)! + POSITION_STEP;
            pos.set(i.columnId, position);
            return { ...i.data, position };
          }),
          select: { id: true, recurrenceFromId: true },
        });
        const idOf = new Map(rows.map((r) => [r.recurrenceFromId, r.id]));
        const labels = items.flatMap((i) => i.src.labels.map((l) => ({ taskId: idOf.get(i.src.id)!, labelId: l.labelId })));
        if (labels.length) await tx.taskLabel.createMany({ data: labels });
        const subtasks = items.flatMap((i) => i.src.subtasks.map((s) => ({ taskId: idOf.get(i.src.id)!, title: s.title, position: s.position })));
        if (subtasks.length) await tx.subtask.createMany({ data: subtasks });
        return items.map((i) => idOf.get(i.src.id) ?? null);
      });
    } catch (err) {
      if (err !== PROGRAM_SINCE_READ && !(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      const out: (string | null)[] = [];
      for (const item of items) out.push(await createOne(item));
      return out;
    }
  };

  let pending: Item[] = [];
  const spawned: { src: Item["src"]; id: string }[] = [];
  const settle = (items: Item[], ids: (string | null)[]) => {
    ids.forEach((id, i) => {
      if (id) {
        created.push(id);
        spawned.push({ src: items[i]!.src, id });
        addUndo({ t: "task.remove", id });
      } else {
        // No nació: deja de contar para el tope del proyecto.
        const projectId = items[i]!.src.projectId;
        active.set(projectId, (active.get(projectId) ?? 1) - 1);
      }
    });
  };
  const flush = async () => {
    if (!pending.length) return;
    const items = pending;
    pending = [];
    settle(items, await createMany(items));
  };

  for (const entry of plan) {
    const { src, routine, columnId } = entry;
    if (src.recurrence === "NONE") continue;
    // Proyecto en el tope de tareas activas: no nace la siguiente aparición (y mover la tarjeta no falla).
    if ((active.get(src.projectId) ?? 0) >= MAX_ACTIVE_TASKS_PER_PROJECT) {
      logEvent({
        level: "warn", category: "system", action: "recurrence.skippedCap",
        label: { k: "No se creó la siguiente aparición de «{title}»: el proyecto tiene el máximo de tareas activas", p: { title: src.title } },
        details: { taskId: src.id, projectId: src.projectId },
      });
      continue;
    }
    active.set(src.projectId, (active.get(src.projectId) ?? 0) + 1);
    const dueIso = nextOccurrenceDue(src.recurrence, src.recurrenceDay, dateToIso(src.dueDate), today);
    const dueDate = isoToDate(dueIso);
    // La fecha de inicio se desplaza los mismos días que la límite (sin límite no hay referencia: queda vacía).
    const oldDue = dateToIso(src.dueDate);
    const oldStart = dateToIso(src.startDate);
    const startDate = oldStart && oldDue && dueIso ? isoToDate(addDaysIso(oldStart, daysBetween(oldDue, dueIso))) : null;
    // El entregable se hereda mientras no haya vencido (hoy, en la zona de la app, aún vale): la siguiente aparición de una
    // tarea semanal no debe colgar de un entregable que ya pasó.
    const deliverableDue = dateToIso(src.deliverable?.dueDate);
    const deliverableId = deliverableDue && deliverableDue < today ? null : src.deliverableId;
    const item: Item = {
      ...entry,
      data: {
        projectId: src.projectId,
        columnId,
        title: titles?.get(src.id) ?? src.title,
        description: src.description,
        kindId: src.kindId,
        color: src.color,
        linkUrl: src.linkUrl,
        assigneeId: assignRules.get(columnId)?.assigneeId ?? assignable(src.projectId, src.assigneeId),
        deliverableId,
        dueDate,
        startDate,
        cost: src.cost,
        costPaid: false,
        estimatedHours: src.estimatedHours,
        actualHours: null,
        priority: src.priority,
        client: src.client,
        recurrence: src.recurrence,
        recurrenceDay: src.recurrenceDay,
        recurrenceFromId: src.id,
        routineColumnId: routine?.columnId ?? null,
        createdById: actorId,
      },
    };
    if (programCols.has(columnId)) {
      // Con tope de sesiones, de una en una y en orden (lo pendiente antes).
      await flush();
      settle([item], [await createOne(item)]);
    } else {
      pending.push(item);
      if (pending.length >= SPAWN_BATCH) await flush();
    }
  }
  await flush();
  // Las que una columna «Asignación a persona» ha dado a otra persona: un aviso por columna (como cualquier asignación).
  const handedOver = new Map<ColumnAssignment, { id: string; title: string }[]>();
  const columnOf = new Map(plan.map((p) => [p.src.id, p.columnId]));
  for (const { src, id } of spawned) {
    const rule = assignRules.get(columnOf.get(src.id)!);
    if (rule && rule.assigneeId !== src.assigneeId) (handedOver.get(rule) ?? handedOver.set(rule, []).get(rule)!).push({ id, title: src.title });
  }
  for (const [rule, rows] of handedOver) await notifyAssigned(rule, rows.map((r) => r.id), actorId, rows);
  // Las demás pestañas piden también las apariciones nuevas (canal en vivo; fuera de una acción no hace nada).
  noteTasks(created);
  // Las apariciones ya están guardadas: si copiar los adjuntos de la descripción falla, se anota y el movimiento sigue
  // siendo un éxito (las descripciones conservan la referencia a los de la anterior).
  await copyDescriptionAttachments(spawned).catch((err) =>
    logEvent({ level: "error", category: "system", action: "recurrence.attachmentsSkipped", label: { k: "No se copiaron los adjuntos de la descripción: {error}", p: { error: logError(err) } } }),
  );
  // En el orden en que nacieron; varias, con una sola lectura para todas (antes, una por tarea).
  if (created.length <= 1) return Promise.all(created.map((id) => loadBoardTask(id)));
  const byId = new Map((await loadBoardTasksByIds(created)).map((t) => [t.id, t]));
  return created.map((id) => byId.get(id)).filter((t): t is BoardTask => !!t);
}
