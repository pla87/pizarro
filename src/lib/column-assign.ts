import "server-only";
// Columna «Asignación a persona» (reglas puras en column-assign-core.ts): la regla de entrada en UN solo sitio para todas
// las vías que meten tareas en una columna (como el tope de column-capacity.ts): crear, crear varias, duplicar, importar
// tareas, la siguiente aparición de una repetición, mover (también en bloque, «Mover a…», pegar JSON con otra columna) y
// recuperar una archivada. La tarea pasa a la persona de la columna y, si la columna tiene plazo y la tarea no tiene fecha
// límite, vence hoy (zona de la app) + N días; una fecha que ya tenía se respeta.
//
// - Altas: `columnAssignment` antes de insertar y `newTaskAssignment` para los datos de cada tarea (sin otra escritura).
// - Movimientos: `assignOnEnter` dentro de la misma transacción (con la columna bloqueada) y, al terminar,
//   `finishAssignOnEnter`: deshacer (vuelven responsable y fecha anteriores), historial y un solo aviso para todo el lote.
//
// La persona solo asigna mientras puede tener tareas del proyecto (activa y con acceso): si no, la columna deja de
// asignar y el tablero lo avisa en su cabecera hasta que se elija otra. El deshacer y el rehacer no aplican la regla:
// devuelven las tareas como estaban (responsable y fecha incluidos), como hacen con el tope de sesiones.
import type { Prisma } from "@/generated/prisma/client";
import { projectUsersWhere } from "./access";
import { recordTaskEvent } from "./action-context";
import { db } from "./db";
import { assignedDueDate } from "./column-assign-core";
import { dateToIso, isoToDate, todayIso } from "./dates";
import { appTimeZone } from "./format";
import { excerpt as makeExcerpt } from "./mentions";
import { assignedBatchExcerpt } from "./notification-text";
import { notifyTask } from "./notify";
import { addUndo, type UndoOp } from "./undo";

type Tx = Prisma.TransactionClient;

/** La regla activa de una columna: su persona (que aún puede tener tareas del proyecto) y el plazo en días. */
export interface ColumnAssignment {
  columnId: string;
  projectId: string;
  assigneeId: string;
  dueDays: number | null;
}

/** ¿Puede esta persona tener tareas del proyecto? (activa y con acceso: lo mismo que assertAssignable). */
async function canBeAssigned(client: Tx | typeof db, projectId: string, userId: string): Promise<boolean> {
  const project = await client.project.findUnique({ where: { id: projectId }, select: { isPrivate: true } });
  if (!project) return false;
  return (await client.user.count({ where: { id: userId, active: true, ...projectUsersWhere(project, projectId) } })) > 0;
}

/** Lo que la regla necesita de la columna (p. ej. la lectura de assertColumnRoom, hecha con la columna bloqueada). */
type AssignColumnRow = { id: string; projectId: string; role: string; assigneeId: string | null; assignDueDays: number | null };

/**
 * La regla de la columna, o null si no es «Asignación a persona» o su persona ya no puede tener tareas del proyecto.
 * `column` es su id (se lee) o la columna ya leída: si no tiene persona (el caso de siempre), sin ninguna consulta. Solo
 * con rol NONE (isAssignColumn): una columna con otro rol y persona guardada (cambiada en una versión anterior, que no la
 * conoce) se comporta como la de su rol.
 */
export async function columnAssignment(client: Tx | typeof db, column: string | AssignColumnRow | null): Promise<ColumnAssignment | null> {
  const col = typeof column === "string"
    ? await client.column.findUnique({ where: { id: column }, select: { id: true, projectId: true, role: true, assigneeId: true, assignDueDays: true } })
    : column;
  if (!col?.assigneeId || col.role !== "NONE") return null;
  if (!(await canBeAssigned(client, col.projectId, col.assigneeId))) return null;
  return { columnId: col.id, projectId: col.projectId, assigneeId: col.assigneeId, dueDays: col.assignDueDays };
}

/** Fecha límite del plazo (hoy + N días), o null si la columna no tiene plazo o la tarea empieza después de esa fecha. */
function ruleDue(rule: ColumnAssignment, startDate: Date | null | undefined, today: string): string | null {
  const due = assignedDueDate(null, rule.dueDays, today);
  if (!due) return null;
  // Con «Fecha de inicio» posterior, la fecha límite quedaría antes del inicio: no se pone (se elige a mano).
  return startDate && dateToIso(startDate)! > due ? null : due;
}

/**
 * Responsable y fecha límite de una tarea que NACE en la columna (crear, duplicar, importar, repetición): la persona de la
 * columna y, si no trae fecha, la del plazo. Sin regla, los suyos.
 */
export function newTaskAssignment(
  rule: ColumnAssignment | null, task: { assigneeId: string | null; dueDate: Date | null; startDate?: Date | null }, today = todayIso(appTimeZone()),
): { assigneeId: string | null; dueDate: Date | null } {
  if (!rule) return { assigneeId: task.assigneeId, dueDate: task.dueDate };
  const due = task.dueDate ? null : ruleDue(rule, task.startDate, today);
  return { assigneeId: rule.assigneeId, dueDate: task.dueDate ?? (due ? isoToDate(due) : null) };
}

/** Lo que cambió `assignOnEnter`: valores anteriores de cada tarea tocada y quiénes han pasado a la persona. */
export interface AssignOnEnterResult {
  rule: ColumnAssignment;
  /** Tareas cambiadas con lo que tenían antes (para deshacer). */
  before: { id: string; assigneeId: string | null; dueDate: string | null; title: string }[];
  /** Las que no eran de la persona (las que reciben aviso y la línea «Asignó la tarea a…» del historial). */
  newlyAssigned: string[];
  /** Las que reciben la fecha límite del plazo. */
  dated: string[];
  /** Fecha puesta (YYYY-MM-DD) o null. */
  dueDate: string | null;
}

/**
 * Aplica la regla a tareas que ACABAN de entrar en la columna (ya escritas en ella, dentro de la misma transacción y con
 * la columna bloqueada). `column` como en columnAssignment: mejor la columna que ya se ha leído con el candado
 * (assertColumnRoom), así no hay consulta de más y la regla es la de ese momento. Solo las activas de esa columna: las
 * demás se ignoran. Null si la columna no asigna o no cambia nada. Con `assigneeOnly` solo cambia la persona (cambiar la
 * persona de la columna: el plazo es para las que entran).
 */
export async function assignOnEnter(tx: Tx, column: string | AssignColumnRow | null, taskIds: readonly string[], opts: { assigneeOnly?: boolean; rule?: ColumnAssignment } = {}): Promise<AssignOnEnterResult | null> {
  if (!taskIds.length) return null;
  const rule = opts.rule ?? (await columnAssignment(tx, column));
  if (!rule) return null;
  const rows = await tx.task.findMany({ where: { id: { in: [...new Set(taskIds)] }, columnId: rule.columnId, archivedAt: null }, select: { id: true, assigneeId: true, dueDate: true, startDate: true, title: true } });
  const today = todayIso(appTimeZone());
  const dueDate = opts.assigneeOnly ? null : assignedDueDate(null, rule.dueDays, today);
  const newlyAssigned = rows.filter((r) => r.assigneeId !== rule.assigneeId).map((r) => r.id);
  const dated = dueDate ? rows.filter((r) => !r.dueDate && ruleDue(rule, r.startDate, today)).map((r) => r.id) : [];
  if (!newlyAssigned.length && !dated.length) return null;
  const now = new Date();
  if (newlyAssigned.length) await tx.task.updateMany({ where: { id: { in: newlyAssigned } }, data: { assigneeId: rule.assigneeId, updatedAt: now } });
  if (dated.length) await tx.task.updateMany({ where: { id: { in: dated }, dueDate: null }, data: { dueDate: isoToDate(dueDate!), updatedAt: now } });
  const touched = new Set([...newlyAssigned, ...dated]);
  const before = rows.filter((r) => touched.has(r.id)).map((r) => ({ id: r.id, assigneeId: r.assigneeId, dueDate: dateToIso(r.dueDate), title: r.title }));
  return { rule, before, newlyAssigned, dated, dueDate };
}

/** Responsable y fecha límite con que han quedado las tarjetas tocadas, para la pestaña que mueve (los aplica sin recargar). */
export type AssignedPatch = { id: string; assigneeId: string; dueDate: string | null };

export function assignedPatches(res: AssignOnEnterResult | null): AssignedPatch[] {
  if (!res) return [];
  const dated = new Set(res.dated);
  return res.before.map((b) => ({ id: b.id, assigneeId: res.rule.assigneeId, dueDate: dated.has(b.id) ? res.dueDate : b.dueDate }));
}

/** Deshacer de lo que hizo assignOnEnter: cada tarea recupera su responsable y su fecha límite (solo lo que cambió). */
export function assignUndoOps(res: AssignOnEnterResult | null): Extract<UndoOp, { t: "task.set" }>[] {
  if (!res) return [];
  const assigned = new Set(res.newlyAssigned);
  const dated = new Set(res.dated);
  return res.before.map((b) => ({
    t: "task.set" as const,
    id: b.id,
    data: { ...(assigned.has(b.id) ? { assigneeId: b.assigneeId } : {}), ...(dated.has(b.id) ? { dueDate: b.dueDate } : {}) },
  }));
}

/**
 * Después de la transacción: el deshacer (con `undo` en false, quien llama ya lo ha juntado con el suyo), el historial y
 * los avisos. Un solo aviso a la persona para todo el lote (enlaza a la primera tarea), como al crear varias asignadas.
 */
export async function finishAssignOnEnter(res: AssignOnEnterResult | null, actorId: string, opts: { undo?: boolean; personName?: string } = {}): Promise<void> {
  if (!res) return;
  if (opts.undo !== false) addUndo(...assignUndoOps(res));
  const name = opts.personName ?? (await db.user.findUnique({ where: { id: res.rule.assigneeId }, select: { name: true } }))?.name ?? "?";
  for (const id of res.newlyAssigned) recordTaskEvent(id, "update", { k: "Asignó la tarea a {name}", p: { name } });
  for (const id of res.dated) recordTaskEvent(id, "update", { k: "Puso la fecha límite el {date}", p: { date: res.dueDate! } });
  await notifyAssigned(res.rule, res.newlyAssigned, actorId, res.before);
}

/** Aviso «te han asignado» a la persona de la columna: uno por lote. También descarta los avisos de fecha pendientes de otros. */
export async function notifyAssigned(rule: { projectId: string; assigneeId: string }, taskIds: readonly string[], actorId: string, rows: readonly { id: string; title: string }[]): Promise<void> {
  if (!taskIds.length) return;
  // Como dropPendingDueChanges (updateTask), de una vez para todo el lote.
  await db.pendingDueNotice.deleteMany({ where: { taskId: { in: [...taskIds] }, recipientId: { not: rule.assigneeId } } });
  const first = rows.find((r) => r.id === taskIds[0]);
  await notifyTask({
    type: "ASSIGNED", actorId, taskId: taskIds[0]!, projectId: rule.projectId, recipientIds: [rule.assigneeId],
    excerpt: taskIds.length === 1 && first ? makeExcerpt(first.title) : assignedBatchExcerpt(taskIds.length),
  });
}
