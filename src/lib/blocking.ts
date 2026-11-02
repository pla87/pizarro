import "server-only";
import { db } from "./db";
import { AppError } from "./errors";

/** Por qué una tarea no puede quedar bloqueada por otra (null = sí puede). */
export type BlockProblem = "missing" | "self" | "cycle" | null;

type Client = Pick<typeof db, "$queryRaw" | "$executeRaw">;

/**
 * Candado por proyecto (hasta el final de la transacción) para todo lo que escribe `blockedById`: la comprobación de ciclos
 * y la escritura van juntas bajo él, así dos bloqueos A → B y B → A a la vez no pueden cerrar un ciclo.
 */
export async function lockBlocking(tx: Pick<typeof db, "$executeRaw">, projectId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`block:${projectId}`}))`;
}

/**
 * ¿Puede `taskId` quedar bloqueada por `blockerId`? La que bloquea debe existir en el MISMO proyecto, no ser la propia
 * tarea y no cerrar un ciclo (A → B → A, ni más largo): se sigue la cadena de bloqueos de la que bloquea con una sola
 * consulta recursiva (UNION: termina aunque ya hubiera un ciclo). Para que el resultado valga hay que escribir bajo `lockBlocking`.
 */
export async function blockProblem(taskId: string, blockerId: string, projectId: string, client: Client = db): Promise<BlockProblem> {
  if (blockerId === taskId) return "self";
  const rows = await client.$queryRaw<{ found: boolean; cycle: boolean }[]>`
    WITH RECURSIVE chain(id, nxt) AS (
      SELECT id, "blockedById" FROM "Task" WHERE id = ${blockerId} AND "projectId" = ${projectId}
      UNION
      SELECT t.id, t."blockedById" FROM "Task" t JOIN chain c ON t.id = c.nxt
    )
    SELECT EXISTS (SELECT 1 FROM chain WHERE id = ${blockerId}) AS found,
           EXISTS (SELECT 1 FROM chain WHERE id = ${taskId}) AS cycle`;
  if (!rows[0]?.found) return "missing";
  return rows[0].cycle ? "cycle" : null;
}

/** Lanza el error legible si no se puede bloquear. */
export async function assertCanBlock(taskId: string, blockerId: string, projectId: string, client: Client = db): Promise<void> {
  const problem = await blockProblem(taskId, blockerId, projectId, client);
  if (problem === "self") throw new AppError("Una tarea no puede bloquearse a sí misma.");
  if (problem === "cycle") throw new AppError("Esa tarea ya está bloqueada por esta: no se pueden crear bloqueos en círculo.");
  if (problem === "missing") throw new AppError("La tarea que bloquea no existe en este proyecto.");
}
