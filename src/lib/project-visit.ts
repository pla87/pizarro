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

/** Como mucho una escritura cada 5 minutos por usuario mientras siga en el mismo proyecto. */
const VISIT_EVERY_MS = 5 * 60_000;
/** Tope de personas recordadas en memoria (las que llevan más tiempo sin abrir nada salen primero). */
const VISIT_MEMORY_MAX = 10_000;

type LastVisit = { projectId: string; at: number };
const lastVisits = () => ((globalThis as unknown as { __pzLastVisits?: Map<string, LastVisit> }).__pzLastVisits ??= new Map());

/**
 * ¿Toca anotar la apertura? Sí al cambiar de proyecto (para que «Usados recientemente» ponga arriba el último abierto) y,
 * en el mismo, cada VISIT_EVERY_MS: los refrescos del tablero y las recargas no escriben. Si toca, la deja apuntada.
 */
export function projectVisitDue(userId: string, projectId: string, now: number, memory: Map<string, LastVisit> = lastVisits()): boolean {
  const last = memory.get(userId);
  if (last && last.projectId === projectId && now - last.at < VISIT_EVERY_MS && now >= last.at) return false;
  memory.delete(userId);
  memory.set(userId, { projectId, at: now });
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
    if (lastVisits().get(userId)?.projectId === projectId) lastVisits().delete(userId);
  }
}
