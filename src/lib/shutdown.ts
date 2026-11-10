// Apagado ordenado al recibir SIGTERM (despliegue, reinicio del contenedor) o SIGINT (Ctrl+C con `npm start`).
//
// Next.js sale por su cuenta al recibir la señal (cierra el servidor HTTP y termina con el código 143), pero no conoce
// nuestro estado en memoria: los registros pendientes de escribir (lib/log.ts, se guardan en lote cada 3 s) y los emails
// que aún se están enviando se perdían. Con NEXT_MANUAL_SIG_HANDLE=1 Next no instala sus manejadores y este módulo se
// encarga (se registra desde instrumentation.ts). Orden:
//   1. Se marca el apagado: no se aceptan canales en vivo nuevos ni se lanzan tareas de fondo nuevas, y /api/health
//      responde 503 (el balanceador deja de mandar tráfico por las conexiones que sigan abiertas).
//   2. Se deja de escuchar en el puerto (Next no expone su servidor HTTP: se busca entre los manejadores activos) y se
//      cierran los canales en vivo (los navegadores reconectan solos a la instancia nueva), que si no lo retendrían.
//   3. Se espera como mucho GRACE_MS a las peticiones HTTP en curso (una subida a medias, una acción) y a los envíos de
//      email; las conexiones que quedan libres se cierran según terminan. Sin nada en curso no se espera nada.
//   4. Se escriben los registros pendientes (como mucho FLUSH_MS) y se sale.

import { AsyncLocalStorage } from "node:async_hooks";

const GRACE_MS = 5_000;
const FLUSH_MS = 3_000;

interface ShutdownState {
  stopping: boolean;
  installed: boolean;
  inflight: Set<Promise<unknown>>;
}

// En globalThis: instrumentation.ts y las rutas se compilan en paquetes distintos y deben ver el mismo estado.
const state = ((globalThis as unknown as { __pzShutdown?: ShutdownState }).__pzShutdown ??= { stopping: false, installed: false, inflight: new Set() });

/** ¿Se está apagando el proceso? Las tareas de fondo y los canales en vivo nuevos deben abstenerse. */
export function isShuttingDown(): boolean {
  return state.stopping;
}

// Un trabajo anotado que llama a otro también anotado (un envío en segundo plano que llama a sendMail) cuenta una sola vez.
const inTracked = new AsyncLocalStorage<true>();

/** Ejecuta `work` anotándolo como trabajo que el apagado debe esperar (un envío de email). Devuelve su promesa. */
export function trackInFlight<T>(work: () => Promise<T>): Promise<T> {
  if (inTracked.getStore()) return work();
  const promise = inTracked.run(true, work);
  state.inflight.add(promise);
  const done = () => void state.inflight.delete(promise);
  promise.then(done, done);
  return promise;
}

/** Espera a que terminen los trabajos anotados, como mucho `ms`. Devuelve cuántos siguen en curso. */
export async function waitForInFlight(ms: number): Promise<number> {
  const deadline = Date.now() + ms;
  while (state.inflight.size > 0 && Date.now() < deadline) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, Math.max(1, deadline - Date.now()))));
    await Promise.race([Promise.allSettled([...state.inflight]), timeout]);
    clearTimeout(timer);
  }
  return state.inflight.size;
}

/** Solo pruebas: vuelve al estado inicial (sin apagado en marcha ni trabajos anotados). */
export function resetShutdownForTests(): void {
  state.stopping = false;
  state.inflight.clear();
}

/** Lo que devuelve stopListening: cuántos puertos se cerraron y la espera a las peticiones que siguen en curso. */
export interface Listening {
  closed: number;
  /** Espera como mucho `ms` a que terminen las peticiones en curso; devuelve cuántas conexiones siguen abiertas. */
  drained: (ms: number) => Promise<number>;
}

type HttpLikeServer = import("node:net").Server & { closeIdleConnections?: () => void };

/** Cada cuánto se cierran las conexiones que han quedado libres (keep-alive) mientras se espera. */
const IDLE_SWEEP_MS = 50;

/**
 * Deja de aceptar conexiones nuevas en el puerto y prepara la espera a las que siguen abiertas. Next no da acceso a su
 * servidor HTTP: se busca entre los manejadores activos. server.close() avisa cuando se ha cerrado la última conexión;
 * las que quedan libres al terminar su petición (keep-alive) se cierran en cada barrido, así que el aviso llega en cuanto
 * acaba la última petición en curso, sin esperar al plazo del keep-alive.
 */
export async function stopListening(): Promise<Listening> {
  try {
    const { Server } = await import("node:net");
    const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
    const servers = handles.filter((h): h is HttpLikeServer => h instanceof Server && h.listening);
    const closed = servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve())));
    const sweep = () => {
      for (const s of servers) s.closeIdleConnections?.();
    };
    sweep();
    const open = () =>
      Promise.all(servers.map((s) => new Promise<number>((resolve) => s.getConnections((err, n) => resolve(err ? 0 : n))))).then((ns) => ns.reduce((a, n) => a + n, 0));
    return {
      closed: servers.length,
      drained: async (ms) => {
        if (!servers.length) return 0;
        const timer = setInterval(sweep, IDLE_SWEEP_MS);
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([Promise.all(closed), new Promise<void>((resolve) => (deadline = setTimeout(resolve, ms)))]);
        } finally {
          clearInterval(timer);
          clearTimeout(deadline);
        }
        return open();
      },
    };
  } catch {
    return { closed: 0, drained: async () => 0 };
  }
}

export interface ShutdownDeps {
  flushLogs: () => Promise<void>;
  logEvent: (e: { level?: "info" | "warn" | "error"; category: string; action: string; message: string; details?: unknown }) => void;
  closeStreams: () => number;
  stopListening: () => Promise<Listening>;
  exit: (code: number) => void;
  graceMs: number;
  flushMs: number;
}

async function defaultDeps(): Promise<ShutdownDeps> {
  const [{ flushLogs, logEvent }, { closeAllStreams }] = await Promise.all([import("./log"), import("./realtime")]);
  return { flushLogs, logEvent, closeStreams: closeAllStreams, stopListening, exit: (code) => process.exit(code), graceMs: GRACE_MS, flushMs: FLUSH_MS };
}

function exitCode(signal: NodeJS.Signals): number {
  return signal === "SIGINT" ? 130 : 143;
}

/** Secuencia de apagado (ver arriba). No lanza; termina llamando a `deps.exit`. */
export async function runShutdown(signal: NodeJS.Signals, deps?: ShutdownDeps): Promise<void> {
  const code = exitCode(signal);
  if (state.stopping) {
    // Segunda señal (Ctrl+C repetido): salir ya.
    (deps?.exit ?? ((c: number) => process.exit(c)))(code);
    return;
  }
  state.stopping = true;
  const started = Date.now();
  let d: ShutdownDeps;
  try {
    d = deps ?? (await defaultDeps());
  } catch (err) {
    console.error("[shutdown] no se pudo preparar el apagado ordenado", err);
    process.exit(code);
    return;
  }
  // Tope absoluto por si algo se queda colgado (Docker mata el contenedor a los 10 s por defecto).
  const hard = setTimeout(() => d.exit(code), d.graceMs + d.flushMs + 1_000);
  hard.unref?.();
  console.info(`[shutdown] ${signal}: apagado ordenado`);
  let pending = 0;
  let open = 0;
  let listeners = 0;
  let streams = 0;
  try {
    const listening = await d.stopListening();
    listeners = listening.closed;
    // Sin el servidor HTTP (Next cambió cómo lo guarda o falló la búsqueda) no se corta la entrada ni se espera a las
    // peticiones en curso: que conste en el registro, en vez de apagarse a ciegas.
    if (!listeners && process.env.NODE_ENV === "production") {
      d.logEvent({
        level: "warn",
        category: "system",
        action: "system.shutdown.no_listener",
        message: `Apagado ordenado (${signal}): no se encontró el servidor HTTP entre los manejadores activos; no se dejó de aceptar conexiones ni se esperó a las peticiones en curso`,
        details: { signal },
      });
    }
    // Los canales en vivo no terminan nunca por sí solos: se cierran antes de esperar a las peticiones.
    streams = d.closeStreams();
    // Peticiones y emails en curso, a la vez y con el mismo plazo.
    [open, pending] = await Promise.all([listening.drained(d.graceMs), waitForInFlight(d.graceMs)]);
    const left = [open && `${open} conexión(es) con peticiones sin terminar`, pending && `${pending} envío(s) de email sin terminar`].filter(Boolean);
    d.logEvent({
      level: left.length ? "warn" : "info",
      category: "system",
      action: "system.shutdown",
      message: `Apagado ordenado (${signal}): ${left.length ? `${left.join(" y ")} tras ${d.graceMs / 1000} s` : "sin peticiones ni envíos pendientes"}`,
      details: { signal, openConnections: open, pendingSends: pending, closedStreams: streams, closedListeners: listeners, ms: Date.now() - started },
    });
    // Los avisos que registran los envíos al terminar (continuaciones de la misma cola de microtareas) ya se han añadido.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await Promise.race([d.flushLogs(), new Promise<void>((resolve) => setTimeout(resolve, d.flushMs))]);
  } catch (err) {
    console.error("[shutdown] error durante el apagado", err);
  } finally {
    clearTimeout(hard);
    console.info(`[shutdown] listo en ${Date.now() - started} ms`);
    d.exit(code);
  }
}

/**
 * Registra SIGTERM y SIGINT una sola vez por proceso (solo en producción: en desarrollo `next dev` gestiona las señales).
 * Si Next sí ha instalado los suyos (falta NEXT_MANUAL_SIG_HANDLE=1, p. ej. `node server.js` a mano), se retiran: el
 * suyo cerraría el proceso antes de guardar los registros.
 */
export function installShutdownHandlers(): void {
  if (state.installed || process.env.NODE_ENV !== "production") return;
  state.installed = true;
  if (!process.env.NEXT_MANUAL_SIG_HANDLE) {
    for (const sig of ["SIGTERM", "SIGINT"] as const) {
      for (const listener of process.listeners(sig)) if (listener.name === "cleanup") process.off(sig, listener);
    }
  }
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => void runShutdown(sig));
}
