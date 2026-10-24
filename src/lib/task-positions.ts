import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";

type Client = Pick<Prisma.TransactionClient, "$executeRaw">;

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
