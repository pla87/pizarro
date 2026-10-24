import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { needsRebalance, positionBetween, POSITION_STEP } from "./positions";

type Client = Pick<Prisma.TransactionClient, "$executeRaw">;
type Tx = Prisma.TransactionClient;

// --- Posiciones únicas por columna ----------------------------------------------------------
// Dos tarjetas de una misma columna nunca deben tener la misma posición: con un empate, el orden
// entre ellas dependería de cómo devuelva las filas PostgreSQL y podría cambiar tras cualquier
// refresco (las tarjetas «se reordenan solas» al tocar otra columna). Todas las acciones que dan
// posición a una tarea lo hacen dentro de una transacción con la columna bloqueada (lockColumns),
// contando TODAS las tareas de la columna: también las fijas y las archivadas, que conservan su
// columna y su posición y pueden volver (recuperar, deshacer).

/** Orden de las tareas en el servidor: el mismo que compareTaskOrder en el cliente. */
export const TASK_ORDER = [{ position: "asc" }, { id: "asc" }] satisfies Prisma.TaskOrderByWithRelationInput[];

/**
 * Bloquea la ordenación de esas columnas hasta el final de la transacción: dos acciones a la vez
 * (dos personas soltando en el mismo hueco, dos altas seguidas) no pueden calcular la misma posición.
 * Siempre en el mismo orden, para no bloquearse entre sí.
 */
export async function lockColumns(tx: Tx, columnIds: string[]): Promise<void> {
  for (const id of [...new Set(columnIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`task-position:${id}`}, 0))`;
  }
}

/** Última posición de la columna (todas sus tareas, salvo `exclude`), o null si no hay ninguna. */
export async function lastPositionIn(tx: Tx, columnId: string, exclude?: string): Promise<number | null> {
  const last = await tx.task.findFirst({
    where: { columnId, ...(exclude ? { id: { not: exclude } } : {}) },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return last?.position ?? null;
}

/** Renumera la columna (1024, 2048…) conservando el orden; deshace también cualquier empate. */
export async function rebalanceColumn(tx: Tx, columnId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Task" AS t SET "position" = r.rn * ${POSITION_STEP}::float8, "updatedAt" = ${new Date()}
    FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY "position", "id") AS rn FROM "Task" WHERE "columnId" = ${columnId}) AS r
    WHERE t."id" = r."id" AND t."position" IS DISTINCT FROM r.rn * ${POSITION_STEP}::float8`;
}

/**
 * Posición para dejar una tarea en `columnId` entre las vecinas `prevId` y `nextId` (por id, como las ve
 * el cliente), sin coincidir con ninguna otra tarea de la columna. Si el cliente no ve alguna tarea que
 * está entre ellas (fijas, archivadas, recién creadas por otra persona), queda justo detrás de `prevId`
 * (o justo delante de `nextId` si no hay anterior). Una vecina que ya no está en la columna, o ninguna
 * vecina, la deja al final. Renumera la columna si no queda hueco. Llamar con la columna bloqueada.
 * `exclude`: la propia tarea que se mueve (su posición actual no cuenta).
 */
export async function placeInColumn(
  tx: Tx,
  columnId: string,
  prevId: string | null,
  nextId: string | null,
  exclude?: string,
): Promise<{ position: number; rebalanced: boolean; stale: boolean }> {
  let rebalanced = false;
  for (;;) {
    const ids = [prevId, nextId].filter((x): x is string => !!x && x !== exclude);
    const rows = ids.length ? await tx.task.findMany({ where: { id: { in: ids }, columnId }, select: { id: true, position: true } }) : [];
    const prev = prevId ? rows.find((r) => r.id === prevId)?.position : null;
    const next = nextId ? rows.find((r) => r.id === nextId)?.position : null;
    // undefined = la vecina indicada ya no está en esa columna (otro usuario la movió): al final.
    const stale = prev === undefined || next === undefined;
    if (stale || (prev == null && next == null)) {
      return { position: positionBetween(await lastPositionIn(tx, columnId, exclude), null), rebalanced, stale };
    }
    const skip = (id: string) => ({ notIn: [id, ...(exclude ? [exclude] : [])] });
    let lo: number | null;
    let hi: number | null;
    // Una tarea con la misma posición que la vecina (un empate de antes) cuenta como «pegada»: obliga a renumerar.
    if (prev != null) {
      // Justo detrás de la anterior: la siguiente REAL de la columna (puede no ser `nextId`).
      lo = prev;
      hi = (await tx.task.findFirst({ where: { columnId, id: skip(prevId!), position: { gte: prev } }, orderBy: { position: "asc" }, select: { position: true } }))?.position ?? null;
    } else {
      hi = next!;
      lo = (await tx.task.findFirst({ where: { columnId, id: skip(nextId!), position: { lte: next! } }, orderBy: { position: "desc" }, select: { position: true } }))?.position ?? null;
    }
    // Tras renumerar siempre hay hueco (múltiplos de POSITION_STEP): como mucho una vuelta más.
    if (!needsRebalance(lo, hi) || rebalanced) return { position: positionBetween(lo, hi), rebalanced, stale: false };
    await rebalanceColumn(tx, columnId);
    rebalanced = true;
  }
}

/**
 * Después de restaurar posiciones guardadas (deshacer, rehacer), otra tarjeta puede haber ocupado
 * entretanto la posición de alguna: esa tarea pasa justo delante de la que la ocupa (estaba allí antes).
 * Así deshacer tampoco deja empates.
 */
export async function resolvePositionTies(taskIds: string[]): Promise<void> {
  const ids = [...new Set(taskIds)];
  if (!ids.length) return;
  await db.$transaction(async (tx) => {
    const columns = await tx.task.findMany({ where: { id: { in: ids } }, select: { columnId: true } });
    await lockColumns(tx, columns.map((c) => c.columnId));
    const ordered = await tx.task.findMany({ where: { id: { in: ids } }, orderBy: TASK_ORDER, select: { id: true } });
    for (const { id } of ordered) {
      // Se relee cada una: una renumeración anterior puede haberla movido.
      const r = await tx.task.findUniqueOrThrow({ where: { id }, select: { id: true, columnId: true, position: true } });
      const clash = await tx.task.count({ where: { columnId: r.columnId, position: r.position, id: { not: r.id } } });
      if (!clash) continue;
      const lo = (await tx.task.findFirst({ where: { columnId: r.columnId, position: { lt: r.position } }, orderBy: { position: "desc" }, select: { position: true } }))?.position ?? null;
      if (needsRebalance(lo, r.position)) {
        // Sin hueco: se renumera la columna entera (el desempate por id deja un orden fijo).
        await rebalanceColumn(tx, r.columnId);
        continue;
      }
      await tx.task.update({ where: { id: r.id }, data: { position: positionBetween(lo, r.position) } });
    }
  });
}

/**
 * Lleva varias tareas a `columnId`, cada una con su posición, en una sola sentencia (antes era un UPDATE
 * por tarea: hasta 500 idas y vueltas en un despliegue). Equivale a `task.update({ columnId, position })`
 * por fila, `updatedAt` incluido; con `clearEvergreen` también quita la marca de fija.
 * Como con los update sueltos dentro de una transacción, si alguna tarea ya no existe no se mueve ninguna y
 * se lanza P2025 (runAction lo traduce a «Los datos han cambiado mientras tanto»).
 */
export async function setTaskColumnPositions(
  moves: { id: string; position: number }[],
  columnId: string,
  opts: { clearEvergreen?: boolean; client?: Client } = {},
): Promise<void> {
  if (!moves.length) return;
  const client = opts.client ?? db;
  const ids = moves.map((m) => m.id);
  const evergreen = opts.clearEvergreen ? Prisma.sql`, "evergreen" = false` : Prisma.empty;
  let count: number;
  try {
    count = await client.$executeRaw`
      UPDATE "Task" AS t
      SET "columnId" = ${columnId}, "position" = m."position", "updatedAt" = ${new Date()}${evergreen}
      FROM unnest(${ids}::text[], ${moves.map((m) => m.position)}::float8[]) AS m("id", "position")
      WHERE t."id" = m."id" AND (SELECT count(*) FROM "Task" WHERE "id" = ANY(${ids}::text[])) = ${new Set(ids).size}`;
  } catch (err) {
    // La columna ha desaparecido a la vez: el mismo error que daría task.update (clave foránea, P2003).
    if (isForeignKeyViolation(err)) throw knownError("P2003", "Foreign key constraint violated on Task.columnId");
    throw err;
  }
  if (count !== new Set(ids).size) throw knownError("P2025", "Some tasks to move no longer exist");
}

function knownError(code: string, message: string) {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: Prisma.prismaVersion.client });
}

function isForeignKeyViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === "P2003") return true;
  const meta = err.meta as { code?: string; driverAdapterError?: { cause?: { kind?: string; originalCode?: string } } } | undefined;
  return meta?.code === "23503" || meta?.driverAdapterError?.cause?.originalCode === "23503" || meta?.driverAdapterError?.cause?.kind === "ForeignKeyConstraintViolation";
}
