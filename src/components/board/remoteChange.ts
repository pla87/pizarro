// Aviso dentro de la página de cada cambio que llega por el canal en vivo del proyecto (ver Board.tsx): el tablero se
// refresca por su cuenta; los componentes que muestran algo que el refresco del tablero no trae (los comentarios del
// detalle abierto) lo escuchan para ponerse al día.

export const REMOTE_CHANGE_EVENT = "pz:remote-change";

export interface RemoteChange {
  /** Acción del servidor («tasks.addComment», «undo.undoLast»…). */
  action: string;
  /** Tarea afectada si fue solo una. */
  taskId: string | null;
  userId: string | null;
}

/** Reenvía a la página el aviso recibido por el canal (datos ya leídos del JSON). */
export function announceRemoteChange(data: unknown): void {
  if (!data || typeof data !== "object" || typeof window === "undefined") return;
  const d = data as Record<string, unknown>;
  const detail: RemoteChange = {
    action: typeof d.action === "string" ? d.action : "",
    taskId: typeof d.taskId === "string" ? d.taskId : null,
    userId: typeof d.userId === "string" ? d.userId : null,
  };
  window.dispatchEvent(new CustomEvent<RemoteChange>(REMOTE_CHANGE_EVENT, { detail }));
}

/** ¿El cambio puede haber tocado los comentarios de esta tarea? (deshacer y rehacer no dicen qué tarea tocan). */
export function touchesComments(change: RemoteChange, taskId: string): boolean {
  if (change.taskId === taskId) return /comment/i.test(change.action);
  return !change.taskId && /^undo\./.test(change.action);
}

/** Aviso del canal a la espera de decidir si refresca el tablero (`announced`: ya se reenvió a la página al llegar). */
export interface IncomingChange {
  cid: string | null;
  change: unknown;
  announced: boolean;
}

/**
 * ¿Se reenvía a la página en cuanto llega? Si es de otra persona (o del sistema), sí: no puede ser de una acción de
 * esta pestaña, y esperar a que terminen las propias en vuelo (una subida puede durar minutos) dejaría el detalle abierto
 * sin sus comentarios. Los de la propia persona esperan a saber si son de una acción de aquí (por su id de cambio).
 */
export function announceOnArrival(change: unknown, currentUserId: string): boolean {
  const userId = change && typeof change === "object" ? (change as { userId?: unknown }).userId : undefined;
  return userId !== currentUserId;
}

/**
 * Decide la cola cuando no quedan acciones en vuelo: lo que no es de una acción propia refresca el tablero y, si no se
 * reenvió al llegar, se reenvía ahora. Retira de `own` los ids ya vistos.
 */
export function settleIncoming(queue: IncomingChange[], own: Set<string>): { announce: unknown[]; refresh: boolean } {
  const foreign = queue.filter(({ cid }) => !cid || !own.has(cid));
  for (const { cid } of queue) if (cid) own.delete(cid);
  return { announce: foreign.filter((c) => !c.announced).map((c) => c.change), refresh: foreign.length > 0 };
}

/** Retardo máximo por defecto antes de refrescar el tablero por un cambio de otra persona (LIVE_REFRESH_JITTER_MS). */
export const DEFAULT_LIVE_REFRESH_JITTER_MS = 2_000;
/** Tope del retardo configurable: más allá, el tablero dejaría de parecer «en vivo». */
export const MAX_LIVE_REFRESH_JITTER_MS = 10_000;

/**
 * Retardo antes de refrescar el tablero por estos avisos (se calcula antes de settleIncoming, que retira los ids propios).
 * Un cambio de otra persona llega a la vez a todas las pestañas abiertas del proyecto, y todas pedían el tablero entero al
 * servidor en el mismo instante: cada una espera un tiempo al azar entre 0 y `maxMs`, así las peticiones se reparten. Si
 * todo es de la propia persona (desde otra pestaña), sin espera: lo acaba de hacer y quiere verlo ya. Los comentarios del
 * detalle abierto no esperan nunca: se reenvían a la página al llegar (announceOnArrival), sin pasar por aquí.
 */
export function foreignRefreshDelay(queue: IncomingChange[], own: Set<string>, maxMs: number, random: () => number = Math.random): number {
  const fromOthers = queue.some(({ cid, announced }) => announced && (!cid || !own.has(cid)));
  if (!fromOthers || !(maxMs > 0)) return 0;
  return Math.floor(Math.min(1, Math.max(0, random())) * Math.min(maxMs, MAX_LIVE_REFRESH_JITTER_MS));
}

/** Posición en el canal en vivo de un proyecto: proceso del servidor (`boot`) y número del último aviso visto. */
export interface LiveCursor {
  boot: string;
  seq: number;
}

/**
 * Saludo del servidor al (re)abrir el canal (`hello`, con su último aviso): ¿se perdió alguno mientras estuvo cerrado
 * (pestaña oculta, corte de red)? Avanza `cursor` hasta él. Sin posición previa (primera conexión sin dato de la página)
 * no se refresca, como antes; si el servidor se reinició (otro `boot`) no se puede saber y se refresca. Un saludo ilegible
 * cuenta como perdido si ya había posición.
 */
export function missedWhileClosed(cursor: { current: LiveCursor | null }, raw: string): boolean {
  let hello: LiveCursor | null = null;
  try {
    const p = JSON.parse(raw) as { boot?: unknown; seq?: unknown };
    if (typeof p.boot === "string" && typeof p.seq === "number") hello = { boot: p.boot, seq: p.seq };
  } catch {
    // Ilegible: abajo.
  }
  const prev = cursor.current;
  if (!hello) return prev !== null;
  if (!prev) {
    cursor.current = hello;
    return false;
  }
  if (prev.boot !== hello.boot) {
    cursor.current = hello;
    return true;
  }
  cursor.current = { boot: prev.boot, seq: Math.max(prev.seq, hello.seq) };
  return hello.seq > prev.seq;
}

/** Datos (de la página) más recientes que la posición: la posición avanza hasta ellos. */
export function advanceCursor(cursor: LiveCursor | null, seen: LiveCursor | undefined): LiveCursor | null {
  if (!seen) return cursor;
  if (!cursor || cursor.boot !== seen.boot) return seen;
  return seen.seq > cursor.seq ? seen : cursor;
}

/** Borrado o archivado de tareas que llega por el canal (quién y qué; `taskId` null si fueron varias). */
export interface Removal {
  kind: "deleted" | "archived";
  taskId: string | null;
  userId: string | null;
}

/** ¿El aviso es de borrar o archivar tareas? (para decir quién lo hizo si la tarea abierta desaparece). */
export function removalOf(change: unknown): Removal | null {
  if (!change || typeof change !== "object") return null;
  const c = change as { action?: unknown; taskId?: unknown; userId?: unknown };
  if (typeof c.action !== "string") return null;
  const kind = /^tasks\.delete(Task|Tasks)$/.test(c.action) ? "deleted" : /^tasks\.archive(Task|Tasks)$/.test(c.action) ? "archived" : null;
  if (!kind) return null;
  return { kind, taskId: typeof c.taskId === "string" ? c.taskId : null, userId: typeof c.userId === "string" ? c.userId : null };
}
