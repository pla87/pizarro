import "server-only";
import { visibleProjectsWhere } from "./access";
import { db } from "./db";
import type { CurrentUser } from "./session";

// Caché en memoria de «esta persona puede ver este proyecto» para las rutas que se consultan cada 15-20 s por
// pestaña (presencia, quién mira una tarea). Solo se guardan las respuestas afirmativas, 30 s como mucho, y se
// vacía en los mismos puntos que cortan las conexiones en vivo (revoke.ts). La sesión no se cachea: cada
// petición la sigue comprobando (getCurrentUser). Una sola instancia, como el resto de avisos.

const TTL_MS = 30_000;
const MAX_ENTRIES = 5000;

interface Stores {
  /** `${userId} ${role} ${projectId}` -> caduca en. El rol va en la clave: un cambio de rol no reutiliza el acceso viejo. */
  access: Map<string, number>;
  /** taskId -> proyecto de la tarea y caduca en. */
  tasks: Map<string, { projectId: string; until: number }>;
}
const stores = (globalThis as unknown as { __pzAccessCache?: Stores }).__pzAccessCache ??= { access: new Map(), tasks: new Map() };

function trim<V>(map: Map<string, V>, expired: (v: V) => boolean) {
  if (map.size <= MAX_ENTRIES) return;
  for (const [k, v] of map) if (expired(v)) map.delete(k);
  // Si seguía lleno de entradas vivas, se tira la más antigua (orden de inserción).
  while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value as string);
}

/** ¿Puede el usuario ver el proyecto? Mismo criterio que visibleProjectsWhere, con 30 s de caché si la respuesta es sí. */
export async function canAccessProject(user: Pick<CurrentUser, "id" | "role">, projectId: string): Promise<boolean> {
  const key = `${user.id} ${user.role} ${projectId}`;
  const now = Date.now();
  if ((stores.access.get(key) ?? 0) > now) return true;
  const ok = (await db.project.count({ where: { id: projectId, ...visibleProjectsWhere(user as CurrentUser) } })) > 0;
  if (ok) {
    stores.access.set(key, now + TTL_MS);
    trim(stores.access, (until) => until <= now);
  } else {
    stores.access.delete(key);
  }
  return ok;
}

/** Proyecto al que pertenece una tarea (null si no existe), con 30 s de caché. */
export async function projectOfTask(taskId: string): Promise<string | null> {
  const now = Date.now();
  const hit = stores.tasks.get(taskId);
  if (hit && hit.until > now) return hit.projectId;
  const task = await db.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
  if (!task) {
    stores.tasks.delete(taskId);
    return null;
  }
  stores.tasks.set(taskId, { projectId: task.projectId, until: now + TTL_MS });
  trim(stores.tasks, (v) => v.until <= now);
  return task.projectId;
}

/** Vacía lo guardado de un usuario (desactivado, rol cambiado, borrado). */
export function forgetUserAccess(userId: string): void {
  const prefix = `${userId} `;
  for (const k of stores.access.keys()) if (k.startsWith(prefix)) stores.access.delete(k);
}

/** Vacía lo guardado de un proyecto (visibilidad o miembros cambiados, borrado). */
export function forgetProjectAccess(projectId: string): void {
  const suffix = ` ${projectId}`;
  for (const k of stores.access.keys()) if (k.endsWith(suffix)) stores.access.delete(k);
  for (const [k, v] of stores.tasks) if (v.projectId === projectId) stores.tasks.delete(k);
}
