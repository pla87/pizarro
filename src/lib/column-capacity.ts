import "server-only";
// Tope de tareas de una columna: hoy solo lo tienen las columnas «Programa del curso» (rol PROGRAM), con
// PROGRAM_MAX_SESSIONS sesiones (tareas no archivadas) como mucho. Una sola función para todas las vías que meten tareas
// en una columna (crear, crear varias, duplicar, mover, mover en bloque, recuperar archivada, repetición), otra para
// cambiar el rol de una columna a PROGRAM y otra para «Aplicar plantilla».
//
// Cómo se hace atómico: quien llama tiene la columna bloqueada (lockColumns, el candado de las posiciones que ya toman
// todas esas vías) y el rol se lee aquí dentro de la misma transacción. setColumnRole y «Aplicar plantilla» toman el mismo
// candado antes de contar, así que un alta y un cambio de rol a la vez no pueden dejar la columna por encima del tope.
//
// El deshacer y el rehacer (lib/undo.ts), «Cancelar» del detalle (restoreTaskSnapshot) y deshacer el cambio de plantilla
// NO comprueban el tope: devuelven las tareas a donde estaban y fallar ahí dejaría sin recuperar una tarea borrada o
// movida. Si así una columna queda por encima, el tablero lo muestra (el contador de la cabecera, «103/100», en ámbar
// como al llegar al tope), los «+» siguen desactivados (el de la cabecera y el flotante del móvil), no entra nada más
// hasta bajar del tope y el PDF solo incluye las primeras PROGRAM_MAX_SESSIONS (con aviso).
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "./errors";
import { PROGRAM_MAX_SESSIONS } from "./program-limit";
import { lockColumns } from "./task-positions";
import { getT } from "@/i18n/server";

type Tx = Prisma.TransactionClient;

/** Por qué no caben las tareas: la columna, cuántas tiene ya (no archivadas) y cuántas entrarían. */
interface ColumnRoomProblem {
  columnId: string;
  name: string;
  active: number;
  adding: number;
  max: number;
}

/**
 * ¿Caben en la columna las tareas que llegan? null si caben (o si la columna no tiene tope). `incoming` es cuántas tareas
 * nuevas se crean en ella o, para las que ya existen (mover, recuperar), sus ids: cuentan solo las que aún no son tareas
 * activas de esa columna (reordenar dentro de la misma columna no suma, aunque esté por encima del tope por datos
 * antiguos). Llamar dentro de la transacción y con la columna bloqueada (lockColumns).
 */
export async function columnRoomProblem(tx: Tx, columnId: string, incoming: number | readonly string[]): Promise<ColumnRoomProblem | null> {
  if (typeof incoming === "number" ? incoming <= 0 : !incoming.length) return null;
  const column = await tx.column.findUnique({ where: { id: columnId }, select: { role: true, name: true } });
  if (!column || column.role !== "PROGRAM") return null;
  const adding = typeof incoming === "number"
    ? incoming
    : await tx.task.count({ where: { id: { in: [...new Set(incoming)] }, NOT: { columnId, archivedAt: null } } });
  if (adding <= 0) return null;
  const active = await tx.task.count({ where: { columnId, archivedAt: null } });
  if (active + adding <= PROGRAM_MAX_SESSIONS) return null;
  return { columnId, name: column.name, active, adding, max: PROGRAM_MAX_SESSIONS };
}

/** El mensaje para quien lo intenta: «La columna «X» admite como mucho 100 sesiones» (y cuántas tiene, si aún caben algunas). */
async function columnRoomMessage(problem: ColumnRoomProblem): Promise<string> {
  const t = await getT();
  const { name, max, active, adding } = problem;
  if (adding > 1 && active < max) return t("La columna «{name}» admite como mucho {max} sesiones: tiene {n} y no caben {adding} más.", { name, max, n: active, adding });
  return t("La columna «{name}» admite como mucho {max} sesiones.", { name, max });
}

/** Como columnRoomProblem, pero lanza el error con su mensaje. */
export async function assertColumnRoom(tx: Tx, columnId: string, incoming: number | readonly string[]): Promise<void> {
  const problem = await columnRoomProblem(tx, columnId, incoming);
  if (problem) throw new AppError(await columnRoomMessage(problem));
}

/** Mensaje de una columna que no puede ser (o seguir siendo) «Programa del curso» por tener demasiadas tareas. */
async function tooManyForProgram(name: string, n: number): Promise<AppError> {
  const t = await getT();
  return new AppError(t("La columna «{name}» tiene {n} tareas y una columna «Programa del curso» admite como mucho {max} sesiones. Mueve o archiva alguna antes de darle ese rol.", { name, n, max: PROGRAM_MAX_SESSIONS }));
}

/**
 * Antes de dar el rol PROGRAM a una columna: que no tenga más tareas no archivadas que el tope. Bloquea la columna
 * (lockColumns) para que nadie meta tareas mientras se cuenta y se cambia el rol.
 */
export async function assertFitsProgramRole(tx: Tx, column: { id: string; name: string }): Promise<void> {
  await lockColumns(tx, [column.id]);
  const active = await tx.task.count({ where: { columnId: column.id, archivedAt: null } });
  if (active > PROGRAM_MAX_SESSIONS) throw await tooManyForProgram(column.name, active);
}

/**
 * Tras «Aplicar plantilla» (dentro de su transacción, antes de confirmarla): ninguna columna PROGRAM del proyecto pasa
 * del tope, ni porque la plantilla le dio el rol a una columna con muchas tareas ni porque le unió las de otra. `before`
 * es cómo estaban las columnas antes del cambio (rol y tareas no archivadas): una columna que ya era PROGRAM y ya estaba
 * por encima por datos antiguos no impide aplicar la plantilla si el cambio no le añade tareas.
 */
export async function assertProgramColumnsFit(tx: Tx, projectId: string, before: readonly { id: string; role: string; active: number }[]): Promise<void> {
  const columns = await tx.column.findMany({ where: { projectId, role: "PROGRAM" }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } });
  if (!columns.length) return;
  await lockColumns(tx, columns.map((c) => c.id));
  const prev = new Map(before.map((c) => [c.id, c]));
  for (const c of columns) {
    const active = await tx.task.count({ where: { columnId: c.id, archivedAt: null } });
    const was = prev.get(c.id);
    if (active <= PROGRAM_MAX_SESSIONS || (was?.role === "PROGRAM" && active <= was.active)) continue;
    throw await tooManyForProgram(c.name, active);
  }
}
