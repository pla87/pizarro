import "server-only";
import { db } from "./db";
import type { CurrentUser } from "./session";

/** Proyecto de equipo abierto por un administrador que no lo tiene en «Proyectos en los que trabajo». */
export interface OutsideListProject {
  id: string;
  name: string;
}

/**
 * Si `projectId` es un proyecto de equipo que el administrador puede abrir pero no está en su lista (no lo ha elegido;
 * estar asignado no basta, como en workingProjectsWhere), su id y nombre; si no, null. El selector y la navegación del proyecto lo muestran igualmente, marcado
 * «No está en tus proyectos», sin añadirlo solo a la lista. Para quien no es administrador siempre es null: su lista
 * son todos los proyectos a los que tiene acceso, y uno sin acceso no existe para él.
 */
export async function outsideListProject(user: Pick<CurrentUser, "id" | "role">, projectId: string): Promise<OutsideListProject | null> {
  if (user.role !== "ADMIN" || !projectId || projectId.length > 40 || projectId.includes("\0")) return null;
  return db.project.findFirst({
    where: { id: projectId, isPrivate: false, adminPicks: { none: { userId: user.id } } },
    select: { id: true, name: true },
  });
}

/** Como mucho una escritura cada 5 minutos por persona y proyecto, salvo al pasar de verdad a otro proyecto. */
const VISIT_EVERY_MS = 5 * 60_000;
/** Pasar a otro proyecto se anota enseguida, pero no más de una vez cada 30 s por persona (dos pestañas que se refrescan). */
const SWITCH_EVERY_MS = 30_000;
/** Tope de entradas en memoria (las más antiguas salen primero). */
const VISIT_MEMORY_MAX = 10_000;

type LastVisit = { projectId: string; at: number };
const lastVisits = () => ((globalThis as unknown as { __pzLastVisits?: Map<string, LastVisit> }).__pzLastVisits ??= new Map());

/**
 * ¿Toca anotar la apertura? La memoria guarda la última escritura de cada persona (clave: su id) y de cada par persona y
 * proyecto (clave: «id proyecto»). Se escribe si ese par lleva 5 minutos sin anotarse, o si la persona viene de otro
 * proyecto y su última escritura tiene más de 30 s: así A→B→A deja A arriba, pero dos pestañas abiertas en A y B que se
 * refrescan no reescriben (ni reordenan el selector) en cada refresco. Si toca, la deja apuntada.
 */
export function projectVisitDue(userId: string, projectId: string, now: number, memory: Map<string, LastVisit> = lastVisits()): boolean {
  const pairKey = `${userId} ${projectId}`;
  const pair = memory.get(pairKey);
  const last = memory.get(userId);
  const recent = (v: LastVisit | undefined, ms: number) => !!v && now >= v.at && now - v.at < ms;
  if (recent(pair, VISIT_EVERY_MS)) {
    const switched = !!last && last.projectId !== projectId && !recent(last, SWITCH_EVERY_MS);
    if (!switched) return false;
  }
  for (const key of [userId, pairKey]) {
    memory.delete(key);
    memory.set(key, { projectId, at: now });
  }
  while (memory.size > VISIT_MEMORY_MAX) memory.delete(memory.keys().next().value!);
  return true;
}

/**
 * Anota que `userId` ha abierto `projectId` (el tablero ya ha comprobado que puede verlo). Barata: como mucho una escritura
 * cada pocos minutos por persona y proyecto, y se llama con `after()` para no retrasar la página. Nunca lanza.
 */
export async function noteProjectVisit(userId: string, projectId: string, now: Date = new Date()): Promise<void> {
  if (!projectVisitDue(userId, projectId, now.getTime())) return;
  try {
    await db.$executeRaw`
      INSERT INTO "ProjectVisit" ("userId", "projectId", "visitedAt") VALUES (${userId}, ${projectId}, ${now})
      ON CONFLICT ("userId", "projectId") DO UPDATE SET "visitedAt" = EXCLUDED."visitedAt"`;
  } catch {
    // Proyecto o usuario borrados mientras tanto, o sin base: no pasa nada (la próxima apertura lo vuelve a intentar).
    lastVisits().delete(`${userId} ${projectId}`);
    if (lastVisits().get(userId)?.projectId === projectId) lastVisits().delete(userId);
  }
}
