"use server";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { describeAction, noteProject, noteTasks } from "@/lib/action-context";
import { columnsLockName } from "@/lib/advisory-locks";
import { assertFitsProgramRole } from "@/lib/column-capacity";
import { db } from "@/lib/db";
import { runAction } from "@/lib/action";
import { assertAssignable, assertProjectAccess, visibleProjectsWhere } from "@/lib/access";
import { assignOnEnter, finishAssignOnEnter } from "@/lib/column-assign";
import { endColumnShare } from "@/lib/share-out";
import { isShareColumn } from "@/lib/share-out-board";
import { isAssignColumn, MAX_ASSIGN_DUE_DAYS, personColumnSlots } from "@/lib/column-assign-core";
import { AppError, notFound } from "@/lib/errors";
import { listKinds, projectPeople } from "@/lib/board";
import { logText } from "@/lib/log";
import { COLUMN_ROLE_LABEL, DEFAULT_WAITING_DAYS, EVERGREEN_COLUMN_ROLES, hasEvergreenTasks, isUniqueColumnRole, MAX_WAITING_DAYS, type ColumnRoleValue } from "@/lib/constants";
import { POSITION_STEP } from "@/lib/positions";
import { COLUMN_ORDER, lastPositionIn, lockColumns, setTaskColumnPositions, TASK_ORDER } from "@/lib/task-positions";
import { requireUser } from "@/lib/session";
import { isValidWipLimit, WIP_MAX, WIP_MIN } from "@/lib/wip";
import { normalizeTaskFields } from "@/lib/task-fields";
import { addUndo, captureTasks } from "@/lib/undo";
import * as v from "@/lib/validation";
import type { BoardColumn } from "@/lib/types";
import { getT } from "@/i18n/server";

const columnSelect = { id: true, name: true, position: true, role: true, isDone: true, waitingDays: true, routineTargetColumnId: true, wipLimit: true, assigneeId: true, assignDueDays: true, defaultKindId: true } as const;

async function findColumn(columnId: string) {
  const user = await requireUser();
  const column = await db.column.findFirst({
    where: { id: v.id.parse(columnId), project: visibleProjectsWhere(user) },
    select: { ...columnSelect, projectId: true, planCount: true, share: { select: { id: true } } },
  });
  if (!column) throw notFound();
  noteProject(column.projectId);
  return column;
}

export async function createColumn(projectId: string, name: string) {
  return runAction({ name: "columns.createColumn", args: [projectId, name] }, async (): Promise<BoardColumn> => {
    const user = await requireUser();
    await assertProjectAccess(user, v.id.parse(projectId));
    const colName = v.name.parse(name);
    // Bloqueo por proyecto: dos altas a la vez no pueden pasar del tope ni calcular la misma posición.
    const column = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${columnsLockName(projectId)}))`;
      const count = await tx.column.count({ where: { projectId } });
      if (count >= 30) throw new AppError("Máximo 30 columnas por proyecto.");
      const last = await tx.column.findFirst({ where: { projectId }, orderBy: { position: "desc" }, select: { position: true } });
      return tx.column.create({
        data: { projectId, name: colName, position: (last?.position ?? 0) + POSITION_STEP },
        select: columnSelect,
      });
    });
    describeAction("Creó la columna «{name}»", { name: colName });
    addUndo({ t: "column.remove", id: column.id });
    return column;
  });
}

/**
 * «Organizar por personas» (proyectos de «Casa y familia»): una columna «Asignación a persona» por cada persona del
 * proyecto (projectPeople: sus miembros y, si es de equipo, los administradores que lo tienen en su lista; el diálogo
 * cuenta con las mismas, `project.peopleIds`) que aún no tiene la suya, con su nombre y sin plazo, justo antes de la
 * primera columna terminada («Hecho») o, si no hay, al final (personColumnSlots). Nacen vacías (no entra ninguna tarea:
 * nada que asignar todavía). Todo o nada si no caben (máximo 30 columnas). Un solo paso de deshacer, que quita las nuevas
 * y devuelve a su posición las que se corrieron. Devuelve las nuevas (`created`) y las posiciones nuevas de las demás que
 * cambian (`moved`), para que el tablero las coloque sin recargar.
 */
export async function createPersonColumns(projectId: string) {
  return runAction({ name: "columns.createPersonColumns", args: [projectId] }, async (): Promise<{ created: BoardColumn[]; moved: { id: string; position: number }[] }> => {
    const user = await requireUser();
    const id = v.id.parse(projectId);
    await assertProjectAccess(user, id);
    const project = await db.project.findUniqueOrThrow({ where: { id }, select: { isPrivate: true } });
    const people = await projectPeople(id, project);
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${columnsLockName(id)}))`;
      const columns = await tx.column.findMany({ where: { projectId: id }, orderBy: COLUMN_ORDER, select: { id: true, assigneeId: true, position: true, isDone: true } });
      const taken = new Set(columns.flatMap((c) => (c.assigneeId ? [c.assigneeId] : [])));
      const missing = people.filter((p) => !taken.has(p.id));
      if (!missing.length) return { created: [], moved: [] };
      if (columns.length + missing.length > 30) throw new AppError("Máximo 30 columnas por proyecto.");
      const slots = personColumnSlots(columns, missing.length);
      for (const m of slots.moved) await tx.column.update({ where: { id: m.id }, data: { position: m.position }, select: { id: true } });
      const created: BoardColumn[] = [];
      for (const [i, p] of missing.entries()) {
        created.push(await tx.column.create({ data: { projectId: id, name: v.name.parse(p.name.slice(0, 80).trim() || "?"), position: slots.positions[i]!, assigneeId: p.id }, select: columnSelect }));
      }
      return { created, moved: slots.moved };
    });
    if (!result.created.length) return { created: [], moved: [] };
    addUndo(
      ...result.created.map((c) => ({ t: "column.remove" as const, id: c.id })),
      ...result.moved.map((m) => ({ t: "column.set" as const, id: m.id, data: { position: m.before } })),
    );
    const n = result.created.length;
    describeAction(n === 1 ? "Creó 1 columna «Asignación a persona»" : "Creó {n} columnas «Asignación a persona»", { n }, {});
    return { created: result.created, moved: result.moved.map(({ id: columnId, position }) => ({ id: columnId, position })) };
  });
}

type ColumnSlot = { id: string; position: number };

/**
 * Cambia el orden de las columnas del proyecto de `column` (arrastre de la cabecera y Alt+flechas). Se leen y renumeran
 * dentro de la transacción, con el bloqueo de las columnas del proyecto (el de crear y borrar): dos movimientos a la vez
 * no parten de las mismas posiciones ni se pisan. `reorder` recibe las columnas en su orden y devuelve el nuevo y el
 * índice al que va la columna, o null si no hay nada que mover (ni que deshacer, ni que anotar). Solo se escriben, y solo
 * guarda el deshacer, las columnas cuya posición cambia: deshacer no devuelve a su sitio columnas que otra persona mueva
 * después. Devuelve el índice de destino, o null.
 */
async function reorderColumns(column: FoundColumn, reorder: (columns: ColumnSlot[]) => { order: ColumnSlot[]; target: number } | null): Promise<number | null> {
  const moved = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${columnsLockName(column.projectId)}))`;
    const columns = await tx.column.findMany({ where: { projectId: column.projectId }, orderBy: COLUMN_ORDER, select: { id: true, position: true } });
    const next = reorder(columns);
    if (!next) return null;
    const changed: ColumnSlot[] = [];
    for (const [i, c] of next.order.entries()) {
      const position = (i + 1) * POSITION_STEP;
      if (c.position === position) continue;
      changed.push(c);
      await tx.column.update({ where: { id: c.id }, data: { position }, select: { id: true } });
    }
    return { changed, target: next.target };
  });
  if (!moved) return null;
  addUndo(...moved.changed.map((c) => ({ t: "column.set" as const, id: c.id, data: { position: c.position } })));
  return moved.target;
}

/**
 * Soltar la cabecera de una columna sobre otra (`overColumnId`): ocupa su sitio, detrás de ella si viene de la izquierda
 * y delante si viene de la derecha. Se manda la columna de destino y no un índice: si otra persona ha creado, borrado o
 * movido columnas y el tablero aún no lo ha recibido, la columna acaba igualmente junto a la que se veía. Con el bloqueo
 * de las columnas, un solo paso de deshacer y solo las que cambian (reorderColumns).
 */
export async function placeColumn(columnId: string, overColumnId: string) {
  return runAction({ name: "columns.placeColumn", args: [columnId, overColumnId] }, async () => {
    const column = await findColumn(columnId);
    const overId = v.id.parse(overColumnId);
    const target = await reorderColumns(column, (columns) => {
      const from = columns.findIndex((c) => c.id === columnId);
      const to = columns.findIndex((c) => c.id === overId);
      // En su sitio, o una de las dos borrada entretanto (o de otro proyecto).
      if (from < 0 || to < 0 || from === to) return null;
      const order = columns.filter((c) => c.id !== columnId);
      order.splice(to, 0, columns[from]!);
      return { order, target: to };
    });
    if (target !== null) describeAction("Movió la columna «{name}» a la posición {n}", { name: column.name, n: target + 1 });
  });
}

export async function renameColumn(columnId: string, name: string) {
  return runAction({ name: "columns.renameColumn", args: [columnId, name] }, async () => {
    const column = await findColumn(columnId);
    addUndo({ t: "column.set", id: column.id, data: { name: column.name } });
    await db.column.update({ where: { id: columnId }, data: { name: v.name.parse(name) } });
    describeAction("Renombró la columna «{from}» a «{to}»", { from: column.name, to: v.name.parse(name) });
  });
}

/** Asigna un rol funcional; si otra columna del proyecto lo tenía, pasa a NONE. */
export async function setColumnRole(columnId: string, role: string) {
  return runAction({ name: "columns.setColumnRole", args: [columnId, role] }, async () => {
    const column = await findColumn(columnId);
    const value = v.columnRole.parse(role);
    // Elegir el rol que ya tiene no cambia nada: ni entrada en el historial ni deshacer. «Sin rol» en una columna
    // «Asignación a persona» (rol NONE con persona o plazo) o «Compartir fuera» sí: deja de asignar o de compartir.
    const shared = isShareColumn(column);
    if (value === column.role && !isAssignColumn(column) && !shared) return { costEnabled: false };
    // De qué rol a qué rol: los nombres van como plantilla anidada (se traducen al leer el registro).
    const from = isAssignColumn(column) ? "Asignación a persona" : shared ? "Compartir fuera" : COLUMN_ROLE_LABEL[column.role as ColumnRoleValue];
    describeAction("Cambió el rol de la columna «{name}» de «{from}» a «{to}»", { name: column.name, from: logText(from), to: logText(COLUMN_ROLE_LABEL[value]) });
    // Deja de compartir: su enlace deja de funcionar al momento (no se deshace: un enlace revocado no vuelve).
    return changeColumnRole(column, value, null, column.share ? (tx) => endColumnShare(tx, column.id) : undefined);
  });
}

/**
 * «Compartir fuera» (rol NONE con su fila ColumnShare): la columna publica sus tareas en una página sin cuenta (botón
 * «Generar web» al pie). Solo si un administrador la ha activado en el proyecto. Quita el rol que tuviera (y sus ajustes,
 * como cualquier cambio de rol: ese cambio sí se deshace) y «Asignación a persona». Una fila anterior de la columna (un
 * deshacer le devolvió otro rol) termina: el enlace nuevo se genera desde cero.
 */
export async function setColumnShareOut(columnId: string) {
  return runAction({ name: "columns.setColumnShareOut", args: [columnId] }, async () => {
    const column = await findColumn(columnId);
    const project = await db.project.findUniqueOrThrow({ where: { id: column.projectId }, select: { shareOutEnabled: true } });
    if (!project.shareOutEnabled) throw new AppError("«Compartir fuera» no está activado en este proyecto.");
    if (isShareColumn(column)) return;
    const from = isAssignColumn(column) ? "Asignación a persona" : COLUMN_ROLE_LABEL[column.role as ColumnRoleValue];
    describeAction("Cambió el rol de la columna «{name}» de «{from}» a «{to}»", { name: column.name, from: logText(from), to: logText("Compartir fuera") });
    const share = async (tx: Prisma.TransactionClient) => {
      await endColumnShare(tx, column.id);
      await tx.columnShare.create({ data: { projectId: column.projectId, columnId: column.id }, select: { id: true } });
    };
    // Ya era una columna sin rol: solo la fila (no hay nada que deshacer en la columna).
    if (column.role === "NONE" && !isAssignColumn(column)) await db.$transaction(share);
    else await changeColumnRole(column, "NONE", null, share);
  });
}

type FoundColumn = Awaited<ReturnType<typeof findColumn>>;

/**
 * El cambio de rol de una columna, también hacia «Asignación a persona» (`assign`: rol NONE con persona y plazo). Cualquier
 * otro rol (o «Sin rol») quita la persona y el plazo; deshacer los devuelve. `inside` se ejecuta en la misma transacción,
 * después de cambiar la columna. Quien llama anota la acción (describeAction).
 */
async function changeColumnRole<R = undefined>(
  column: FoundColumn, value: ColumnRoleValue, assign: { assigneeId: string; dueDays: number | null } | null,
  inside?: (tx: Prisma.TransactionClient) => Promise<R>,
  /** Nombre nuevo de la columna, en el mismo paso (y el mismo deshacer): el de la persona de «Asignación a persona». */
  rename?: string,
): Promise<{ costEnabled: boolean; inside?: R }> {
  const columnId = column.id;
  // Si la columna deja de ser «Esperando» o «Rutinas», se borra su plazo de espera o su destino (y el deshacer los devuelve).
  const clearWaiting = column.role === "WAITING" && value !== "WAITING";
  const clearRoutine = column.role === "ROUTINES" && value !== "ROUTINES";
  // «Asignación a persona» no es un valor del rol: la marcan la persona y el plazo.
  const assignData = assign ? { assigneeId: assign.assigneeId, assignDueDays: assign.dueDays } : { assigneeId: null, assignDueDays: null };
  const assignChanged = assignData.assigneeId !== column.assigneeId || assignData.assignDueDays !== column.assignDueDays;
  // Deshacer: solo lo que cambia (esta columna, la que tenía el rol si es único y las tareas fijas que dejan de serlo),
  // para no pisar al deshacer los roles que otras personas hayan cambiado en otras columnas.
  const [holders, fixed] = await Promise.all([
    isUniqueColumnRole(value) ? db.column.findMany({ where: { projectId: column.projectId, role: value, id: { not: columnId } }, select: { id: true } }) : [],
    db.task.findMany({
      // Pierden la marca las de esta columna si su rol nuevo no tiene fijas y, con un rol único (la release), las de la
      // columna que lo tenía y lo pierde. Las de otras columnas de plan para IA se conservan.
      where: {
        projectId: column.projectId, evergreen: true,
        OR: [
          ...(hasEvergreenTasks(value) ? [] : [{ columnId }]),
          ...(isUniqueColumnRole(value) && hasEvergreenTasks(value) ? [{ columnId: { not: columnId }, column: { role: value } }] : []),
        ],
      },
      select: { id: true },
    }),
  ]);
  // Una columna de presupuesto suma el coste de sus tareas: el campo Coste se activa si no lo estaba (y el deshacer lo
  // vuelve a desactivar: `costOff`).
  const project = value === "BUDGET" && column.role !== "BUDGET" ? await db.project.findUniqueOrThrow({ where: { id: column.projectId }, select: { taskFields: true } }) : null;
  const enablesCost = project !== null && !project.taskFields.includes("cost");
  addUndo(
    {
      t: "column.set", id: column.id,
      data: {
        role: column.role,
        ...(clearWaiting ? { waitingDays: column.waitingDays } : {}),
        ...(clearRoutine ? { routineTargetColumnId: column.routineTargetColumnId } : {}),
        ...(assignChanged ? { assigneeId: column.assigneeId, assignDueDays: column.assignDueDays } : {}),
        ...(rename ? { name: column.name } : {}),
      },
      ...(enablesCost ? { costOff: true as const } : {}),
    },
    ...holders.map((c) => ({ t: "column.set" as const, id: c.id, data: { role: value } })),
    ...(await captureTasks(fixed.map((t) => t.id), ["evergreen", "evergreenEvery"])),
  );
  const result = await db.$transaction(async (tx) => {
    // «Programa del curso»: como mucho PROGRAM_MAX_SESSIONS sesiones; con más tareas no se le da el rol (con la
    // columna bloqueada, para que nadie meta tareas a la vez: column-capacity.ts).
    if (value === "PROGRAM" && column.role !== "PROGRAM") await assertFitsProgramRole(tx, column);
    if (enablesCost) await tx.project.update({ where: { id: column.projectId }, data: { taskFields: normalizeTaskFields([...project!.taskFields, "cost"]) } });
    // Solo NEXT_RELEASE e IN_PRODUCTION son únicos; WAITING, WEEKLY_PLAN y BUDGET se pueden repetir.
    if (isUniqueColumnRole(value)) {
      await tx.column.updateMany({ where: { projectId: column.projectId, role: value }, data: { role: "NONE" } });
    }
    await tx.column.update({
      where: { id: columnId },
      data: { role: value, ...(clearWaiting ? { waitingDays: null } : {}), ...(clearRoutine ? { routineTargetColumnId: null } : {}), ...(assignChanged ? assignData : {}), ...(rename ? { name: rename } : {}) },
    });
    // Una columna que pasa a «Esperando» cuenta la espera desde ahora: sin esto, las tareas antiguas recibirían de golpe un aviso cada una.
    if (value === "WAITING" && column.role !== "WAITING") await tx.task.updateMany({ where: { columnId, archivedAt: null }, data: { columnEnteredAt: new Date(), waitingNotifiedAt: null } });
    // Las tareas fijas solo existen en la columna de release y en las de plan para IA: las que quedan fuera pasan a normales.
    await tx.task.updateMany({ where: { projectId: column.projectId, evergreen: true, column: { role: { notIn: [...EVERGREEN_COLUMN_ROLES] } } }, data: { evergreen: false, evergreenEvery: 1 } });
    return inside ? await inside(tx) : undefined;
  });
  return { costEnabled: enablesCost, ...(result !== undefined ? { inside: result } : {}) };
}

const assignSchema = z.object({
  assigneeId: v.id,
  dueDays: z.number().int("Indica un número entero de días.").min(1, "Mínimo 1 día.").max(MAX_ASSIGN_DUE_DAYS, "Máximo 365 días.").nullable(),
  /** Poner a la columna el nombre de la persona (lo propone el diálogo si la columna tiene un nombre genérico). */
  rename: z.boolean().optional(),
});

/**
 * «Asignación a persona»: la columna pasa a tener esa persona (de las que pueden tener tareas del proyecto) y, opcional,
 * un plazo (`dueDays`, 1-365). Si tenía otro rol, lo pierde (rol NONE: es exclusivo con los demás). Todas sus tarjetas no
 * archivadas pasan a la persona (las que tenían otra o ninguna; el plazo es solo para las que entren después). Mismo
 * permiso que cambiar el rol. Todo en una transacción y un solo paso de deshacer (columna y tarjetas); un solo aviso a la
 * persona por todo el lote. Con la misma persona solo cambia el plazo: las tarjetas que ya están no se tocan.
 */
export async function setColumnAssignee(columnId: string, input: { assigneeId: string; dueDays: number | null; rename?: boolean }) {
  return runAction({ name: "columns.setColumnAssignee", args: [columnId, input] }, async (): Promise<{ reassigned: number }> => {
    const user = await requireUser();
    const column = await findColumn(columnId);
    const data = assignSchema.parse(input);
    await assertAssignable(column.projectId, data.assigneeId);
    const samePerson = isAssignColumn(column) && column.assigneeId === data.assigneeId;
    // El nombre de la persona como nombre de la columna (cortado al máximo de un nombre), si se pidió y es otro.
    const personName = data.rename ? (await userName(data.assigneeId)).slice(0, 80).trim() : "";
    const rename = personName && personName !== column.name ? personName : undefined;
    if (samePerson && rename) {
      // Misma persona: solo el nombre (y el plazo, si cambia), en un paso de deshacer.
      addUndo({ t: "column.set", id: column.id, data: { name: column.name, assignDueDays: column.assignDueDays } });
      const { count } = await db.column.updateMany({ where: { id: columnId, role: "NONE", assigneeId: data.assigneeId }, data: { name: rename, assignDueDays: data.dueDays } });
      if (!count) throw new AppError("Los datos han cambiado mientras tanto. Recarga e inténtalo de nuevo.");
      describeAction("Renombró la columna «{from}» a «{to}»", { from: column.name, to: rename });
      return { reassigned: 0 };
    }
    if (samePerson && column.assignDueDays === data.dueDays) return { reassigned: 0 };
    if (samePerson) {
      // Solo el plazo: vale para las que entren a partir de ahora. Si entretanto otra persona ha cambiado la columna, no se
      // pisa su cambio.
      const { count } = await db.column.updateMany({ where: { id: columnId, role: "NONE", assigneeId: data.assigneeId }, data: { assignDueDays: data.dueDays } });
      if (!count) throw new AppError("Los datos han cambiado mientras tanto. Recarga e inténtalo de nuevo.");
      addUndo({ t: "column.set", id: column.id, data: { assignDueDays: column.assignDueDays } });
      if (data.dueDays == null) describeAction("Quitó el plazo de la columna «{col}»", { col: column.name });
      else if (data.dueDays === 1) describeAction("Cambió el plazo de la columna «{col}» a 1 día", { col: column.name });
      else describeAction("Cambió el plazo de la columna «{col}» a {n} días", { col: column.name, n: data.dueDays });
      return { reassigned: 0 };
    }
    const rule = { columnId, projectId: column.projectId, assigneeId: data.assigneeId, dueDays: data.dueDays };
    const name = await userName(data.assigneeId);
    describeAction(
      isAssignColumn(column) ? "Cambió la persona de la columna «{col}» a {name}" : "Convirtió la columna «{col}» en «Asignación a persona» ({name})",
      { col: column.name, name },
    );
    const { inside: reassigned } = await changeColumnRole(column, "NONE", { assigneeId: data.assigneeId, dueDays: data.dueDays }, async (tx) => {
      // «Compartir fuera» y «Asignación a persona» son exclusivas: el enlace deja de funcionar.
      if (column.share) await endColumnShare(tx, columnId);
      // Con la columna bloqueada: nadie mete ni saca tarjetas mientras se reasignan.
      await lockColumns(tx, [columnId]);
      const ids = (await tx.task.findMany({ where: { columnId, archivedAt: null }, select: { id: true } })).map((t) => t.id);
      return assignOnEnter(tx, columnId, ids, { assigneeOnly: true, rule });
    }, rename);
    if (reassigned) noteTasks(reassigned.newlyAssigned);
    await finishAssignOnEnter(reassigned ?? null, user.id, { personName: name });
    return { reassigned: reassigned?.newlyAssigned.length ?? 0 };
  });
}

async function userName(id: string): Promise<string> {
  return (await db.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? "?";
}

/** Días que una tarea puede esperar en una columna WAITING antes de recordárselo a su responsable (null = por defecto). */
export async function setColumnWaitingDays(columnId: string, days: number | null) {
  return runAction({ name: "columns.setColumnWaitingDays", args: [columnId, days] }, async () => {
    const column = await findColumn(columnId);
    if (column.role !== "WAITING") throw new AppError("Solo las columnas con el rol «Esperando» tienen plazo de espera.");
    const value = days === null ? null : z.number().int("Indica un número entero de días.").min(1, "Mínimo 1 día.").max(MAX_WAITING_DAYS, `Máximo ${MAX_WAITING_DAYS} días.`).parse(days);
    const current = await db.column.findUniqueOrThrow({ where: { id: columnId }, select: { waitingDays: true } });
    addUndo({ t: "column.set", id: column.id, data: { waitingDays: current.waitingDays } });
    describeAction("Cambió el plazo de espera de la columna «{name}» a {days} d", { name: column.name, days: value ?? DEFAULT_WAITING_DAYS });
    await db.column.update({ where: { id: columnId }, data: { waitingDays: value } });
  });
}

/**
 * Límite orientativo de tarjetas (1-999, null = sin límite). Solo avisa en el tablero al pasarlo; nunca impide mover
 * ni crear tarjetas. Se puede deshacer.
 */
export async function setColumnWipLimit(columnId: string, limit: number | null) {
  return runAction({ name: "columns.setColumnWipLimit", args: [columnId, limit] }, async () => {
    const column = await findColumn(columnId);
    const value = limit === null ? null : z.number().int("Indica un número entero de tarjetas.").parse(limit);
    // El rango se comprueba aparte para dar el texto ya traducido (con {min} y {max} no hay clave fija que traducir después).
    if (value !== null && !isValidWipLimit(value)) {
      const t = await getT();
      throw new AppError(t("Indica un número entero entre {min} y {max}, o déjalo vacío.", { min: WIP_MIN, max: WIP_MAX }));
    }
    if (value === column.wipLimit) return;
    addUndo({ t: "column.set", id: column.id, data: { wipLimit: column.wipLimit } });
    if (value === null) describeAction("Quitó el límite de tarjetas de la columna «{name}»", { name: column.name });
    else if (value === 1) describeAction("Puso un límite de 1 tarjeta a la columna «{name}»", { name: column.name });
    else describeAction("Puso un límite de {n} tarjetas a la columna «{name}»", { name: column.name, n: value });
    await db.column.update({ where: { id: columnId }, data: { wipLimit: value } });
  });
}

/** Rutinas: columna a la que va la siguiente aparición de una tarea recurrente de esta columna (null = la misma). */
export async function setColumnRoutineTarget(columnId: string, targetId: string | null) {
  return runAction({ name: "columns.setColumnRoutineTarget", args: [columnId, targetId] }, async () => {
    const column = await findColumn(columnId);
    if (column.role !== "ROUTINES") throw new AppError("Solo las columnas con el rol «Rutinas» tienen destino de la siguiente aparición.");
    const value = targetId === null || targetId === columnId ? null : v.id.parse(targetId);
    if (value) {
      const target = await db.column.findFirst({ where: { id: value, projectId: column.projectId }, select: { isDone: true, role: true } });
      if (!target) throw notFound();
      if (target.isDone || target.role === "ROUTINES") throw new AppError("El destino no puede ser una columna terminada ni otra columna de rutinas.");
    }
    addUndo({ t: "column.set", id: column.id, data: { routineTargetColumnId: column.routineTargetColumnId } });
    describeAction("Cambió el destino de la siguiente aparición de la columna «{name}»", { name: column.name });
    await db.column.update({ where: { id: columnId }, data: { routineTargetColumnId: value } });
  });
}

/**
 * «Tipo por defecto…»: el tipo con el que se abre «Nueva tarea» desde esta columna (uno de los visibles del proyecto), o
 * null para volver al último que usó cada persona. Se puede deshacer.
 */
export async function setColumnDefaultKind(columnId: string, kindId: string | null) {
  return runAction({ name: "columns.setColumnDefaultKind", args: [columnId, kindId] }, async () => {
    const column = await findColumn(columnId);
    const value = kindId === null ? null : v.id.parse(kindId);
    if (value === column.defaultKindId) return;
    const kind = value ? (await listKinds(column.projectId)).find((k) => k.id === value) : undefined;
    if (value && !kind) throw notFound();
    addUndo({ t: "column.set", id: column.id, data: { defaultKindId: column.defaultKindId } });
    if (kind) describeAction("Puso el tipo por defecto «{kind}» a la columna «{name}»", { kind: kind.name, name: column.name });
    else describeAction("Quitó el tipo por defecto de la columna «{name}»", { name: column.name });
    await db.column.update({ where: { id: columnId }, data: { defaultKindId: value } });
  });
}

/** Marca si las tarjetas de la columna cuentan como terminadas (informe y plazos). */
export async function setColumnDone(columnId: string, isDone: boolean) {
  return runAction({ name: "columns.setColumnDone", args: [columnId, isDone] }, async () => {
    const column = await findColumn(columnId);
    addUndo({ t: "column.set", id: column.id, data: { isDone: column.isDone } });
    describeAction(isDone ? "Marcó la columna «{name}» como terminada" : "Desmarcó la columna «{name}» como terminada", { name: column.name });
    await db.column.update({ where: { id: columnId }, data: { isDone: z.boolean().parse(isDone) } });
  });
}

/**
 * Mueve la columna una posición a la izquierda (-1) o derecha (+1) (Alt+flechas y el menú de la columna). Como placeColumn:
 * con el bloqueo de las columnas y solo las que cambian, en la base y en el deshacer (reorderColumns).
 */
export async function moveColumn(columnId: string, direction: number) {
  return runAction({ name: "columns.moveColumn", args: [columnId, direction] }, async () => {
    const column = await findColumn(columnId);
    const dir = z.union([z.literal(-1), z.literal(1)]).parse(direction);
    const target = await reorderColumns(column, (columns) => {
      const idx = columns.findIndex((c) => c.id === columnId);
      const to = idx + dir;
      // Ya en el extremo (o borrada entretanto).
      if (idx < 0 || to < 0 || to >= columns.length) return null;
      const order = [...columns];
      [order[idx], order[to]] = [order[to]!, order[idx]!];
      return { order, target: to };
    });
    if (target === null) return;
    describeAction(dir < 0 ? "Movió la columna «{name}» a la izquierda" : "Movió la columna «{name}» a la derecha", { name: column.name });
  });
}

/** Solo se puede borrar una columna sin tarjetas visibles. Las archivadas se reubican. */
export async function deleteColumn(columnId: string) {
  return runAction({ name: "columns.deleteColumn", args: [columnId] }, async () => {
    const column = await findColumn(columnId);
    const other = await db.column.findFirst({
      where: { projectId: column.projectId, id: { not: columnId } },
      orderBy: COLUMN_ORDER,
      select: { id: true },
    });
    if (!other) throw new AppError("Un proyecto necesita al menos una columna.");
    // Deshacer: la columna (se recrea primero) y la columna de sus archivadas.
    const archived = await db.task.findMany({ where: { columnId, archivedAt: { not: null } }, select: { id: true } });
    // Se aplican en orden inverso: primero se recrea la columna y luego vuelven sus archivadas.
    // Las columnas de rutinas que apuntaban a esta (el borrado deja su destino en null) se vuelven a apuntar al final.
    const pointing = await db.column.findMany({ where: { projectId: column.projectId, routineTargetColumnId: columnId }, select: { id: true } });
    addUndo(
      ...pointing.map((c) => ({ t: "column.set" as const, id: c.id, data: { routineTargetColumnId: column.id } })),
      ...archived.map((t) => ({ t: "task.set" as const, id: t.id, data: { columnId: column.id } })),
      { t: "column.restore", row: { id: column.id, projectId: column.projectId, name: column.name, position: column.position, role: column.role, isDone: column.isDone, waitingDays: column.waitingDays, routineTargetColumnId: column.routineTargetColumnId, wipLimit: column.wipLimit, planCount: column.planCount, assigneeId: column.assigneeId, assignDueDays: column.assignDueDays, defaultKindId: column.defaultKindId } },
    );
    await db.$transaction(async (tx) => {
      // Bloqueo de las columnas del proyecto (el de createColumn) y la otra columna, otra vez dentro: borrar a la vez las
      // dos últimas columnas dejaba el proyecto sin ninguna (las dos veían a la otra antes de que nadie borrase).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${columnsLockName(column.projectId)}))`;
      const target = await tx.column.findFirst({
        where: { projectId: column.projectId, id: { not: columnId } },
        orderBy: COLUMN_ORDER,
        select: { id: true },
      });
      if (!target) throw new AppError("Un proyecto necesita al menos una columna.");
      const active = await tx.task.count({ where: { columnId, archivedAt: null } });
      if (active > 0) throw new AppError("La columna todavía tiene tarjetas. Muévelas antes de borrarla.");
      // «Compartir fuera»: su enlace deja de funcionar (la fila se queda para el aviso de «ha caducado»).
      await endColumnShare(tx, columnId);
      // Solo se reubican las archivadas, al final de la otra columna y en su orden (sin compartir posición con
      // las de allí). Si alguien suelta una tarjeta activa a la vez, la clave foránea (Restrict) hace fallar el
      // borrado en lugar de moverla en silencio.
      await lockColumns(tx, [target.id]);
      const rows = await tx.task.findMany({ where: { columnId, archivedAt: { not: null } }, orderBy: TASK_ORDER, select: { id: true } });
      let pos = (await lastPositionIn(tx, target.id)) ?? 0;
      await setTaskColumnPositions(rows.map((r) => ({ id: r.id, position: (pos += POSITION_STEP) })), target.id, { client: tx });
      await tx.column.delete({ where: { id: columnId } });
    });
    describeAction("Borró la columna «{name}»", { name: column.name });
  });
}
