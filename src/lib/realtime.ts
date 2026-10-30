import "server-only";
import { randomUUID } from "node:crypto";

// Avisos en tiempo (casi) real: cada cambio en un proyecto se anuncia a las pestañas que lo
// tienen abierto (/api/projects/[id]/events) y estas se refrescan. En memoria: una sola instancia.

interface ProjectChange {
  projectId: string;
  userId: string | null;
  action: string;
  at: number;
  /** Id único del cambio: quien lo hizo lo recibe en el resultado de su acción y no se refresca por su propio aviso. */
  cid: string;
}

type Listener = (change: ProjectChange) => void;
const channels = (globalThis as unknown as { __pzRealtime?: Map<string, Set<Listener>> }).__pzRealtime ??= new Map();

export function subscribeProject(projectId: string, listener: Listener): () => void {
  let set = channels.get(projectId);
  if (!set) channels.set(projectId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) channels.delete(projectId);
  };
}

/** Anuncia un cambio y devuelve su id (aunque no haya nadie escuchando: la acción lo necesita para su resultado). */
export function publishChange(change: Omit<ProjectChange, "at" | "cid">): string {
  const cid = randomUUID();
  const set = channels.get(change.projectId);
  if (!set) return cid;
  const full = { ...change, at: Date.now(), cid };
  for (const l of set) {
    try {
      l(full);
    } catch {
      // Un oyente roto (pestaña cerrada) no afecta al resto.
    }
  }
  return cid;
}

// --- Registro de conexiones abiertas ----------------------------------------------
// Para poder cortar los canales SSE de quien pierde el acceso (desactivado, sesiones borradas,
// sacado de un proyecto) sin esperar a que cierre la pestaña. En memoria, como el resto.

/** Máximo de canales SSE simultáneos por usuario (varias pestañas/proyectos; frena abusos). */
export const MAX_STREAMS_PER_USER = 10;

export interface OpenStream {
  userId: string;
  projectId: string;
  sessionId: string;
  /** Cierra el canal; el navegador intentará reconectar y se encontrará con un 401/404 si ya no tiene acceso. */
  close: () => void;
}

const streams = (globalThis as unknown as { __pzStreams?: Set<OpenStream> }).__pzStreams ??= new Set();

/** Registra un canal abierto. Devuelve null si el usuario ya tiene el máximo de canales. */
export function registerStream(stream: OpenStream): (() => void) | null {
  let n = 0;
  for (const s of streams) if (s.userId === stream.userId) n++;
  if (n >= MAX_STREAMS_PER_USER) return null;
  streams.add(stream);
  return () => void streams.delete(stream);
}

function closeWhere(match: (s: OpenStream) => boolean): number {
  let closed = 0;
  for (const s of [...streams]) {
    if (!match(s)) continue;
    streams.delete(s);
    try {
      s.close();
    } catch {
      // Ya cerrado.
    }
    closed++;
  }
  return closed;
}

/** Cierra todos los canales de un usuario (desactivado, rol cambiado, contraseña restablecida, borrado). */
export function revokeUserStreams(userId: string): number {
  return closeWhere((s) => s.userId === userId);
}

/** Cierra los canales de una sesión concreta (cierre de sesión en un dispositivo). */
export function revokeSessionStreams(sessionId: string): number {
  return closeWhere((s) => s.sessionId === sessionId);
}

/** Cierra todos los canales de un proyecto: quien siga teniendo acceso reconecta solo, el resto recibe 404. */
export function revokeProjectStreams(projectId: string): number {
  return closeWhere((s) => s.projectId === projectId);
}

/** Número de canales abiertos (para pruebas y diagnóstico). */
export function openStreamCount(userId?: string): number {
  let n = 0;
  for (const s of streams) if (!userId || s.userId === userId) n++;
  return n;
}
