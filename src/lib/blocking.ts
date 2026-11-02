import "server-only";
import { db } from "./db";
import { AppError } from "./errors";

/** Por qué una tarea no puede quedar bloqueada por otra (null = sí puede). */
export type BlockProblem = "missing" | "self" | "cycle" | null;

type Client = Pick<typeof db, "task">;

/**
 * ¿Puede `taskId` quedar bloqueada por `blockerId`? La que bloquea debe existir en el MISMO proyecto, no ser la propia
 * tarea y no cerrar un ciclo (A → B → A, ni más largo): se sigue la cadena de bloqueos de la que bloquea.
 */
export async function blockProblem(taskId: string, blockerId: string, projectId: string, client: Client = db): Promise<BlockProblem> {
  if (blockerId === taskId) return "self";
  const blocker = await client.task.findFirst({ where: { id: blockerId, projectId }, select: { blockedById: true } });
  if (!blocker) return "missing";
  let cur = blocker.blockedById;
  for (let i = 0; cur && i < 1000; i++) {
    if (cur === taskId) return "cycle";
    cur = (await client.task.findUnique({ where: { id: cur }, select: { blockedById: true } }))?.blockedById ?? null;
  }
  return null;
}

/** Lanza el error legible si no se puede bloquear. */
export async function assertCanBlock(taskId: string, blockerId: string, projectId: string, client: Client = db): Promise<void> {
  const problem = await blockProblem(taskId, blockerId, projectId, client);
  if (problem === "self") throw new AppError("Una tarea no puede bloquearse a sí misma.");
  if (problem === "cycle") throw new AppError("Esa tarea ya está bloqueada por esta: no se pueden crear bloqueos en círculo.");
  if (problem === "missing") throw new AppError("La tarea que bloquea no existe en este proyecto.");
}
