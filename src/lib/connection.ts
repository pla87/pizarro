// Estado de la conexión con el servidor (solo navegador) y refresco seguro de la página.
//
// `router.refresh()` de Next pide la página al servidor (RSC). Si no la consigue (sin red, servidor caído o
// reiniciándose), Next «cae» a una navegación completa del navegador: la página se sustituye por la de error de Chrome
// (chrome-error://chromewebdata/) y se pierde todo lo escrito. Por eso ningún refresco que pueda ocurrir sin red llama a
// `router.refresh()` directamente: pasa por `safeRefresh`, que antes comprueba que el servidor responde (`/api/health`).
// Si no responde, no refresca: lo deja pendiente, marca «sin conexión» (aviso persistente, ver ConnectionNotice) y lo
// vuelve a intentar al volver la red (evento `online`) o cada cierto tiempo, cada vez más espaciado.

/** Mensaje de una acción que no llegó al servidor (sin red o servidor caído). */
export const OFFLINE_MESSAGE = "Sin conexión: no se ha guardado";

/** ¿El fallo es de red (la petición no llegó a tener respuesta)? */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (!(err instanceof TypeError)) return false;
  // Chrome: «Failed to fetch»; Firefox: «NetworkError when attempting to fetch resource.»; Safari: «Load failed».
  return /failed to fetch|networkerror|load failed|network ?error|network connection/i.test(err.message);
}

/** ¿Es el aviso de «sin conexión» (en español o ya traducido)? */
export function isOfflineMessage(message: string, t: (s: string) => string): boolean {
  return message === OFFLINE_MESSAGE || message === t(OFFLINE_MESSAGE);
}

/** Un sondeo correcto vale unos instantes: varios refrescos seguidos no repiten la comprobación. */
const PROBE_FRESH_MS = 1500;
const PROBE_TIMEOUT_MS = 8000;
/** Reintentos mientras no hay conexión: 2 s, 4 s, 8 s… hasta 30 s. */
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 30_000;

let offline = false;
let lastOkAt = -Infinity;
let probing: Promise<boolean> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = RETRY_MIN_MS;
const listeners = new Set<() => void>();
/** Refrescos que no se pudieron hacer: se hacen al volver la conexión (uno por clave). */
const pending = new Map<unknown, () => void>();
let installed = false;

function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("online", () => void checkNow());
  window.addEventListener("offline", () => goOffline());
}

function emit(): void {
  for (const l of [...listeners]) l();
}

function goOffline(): void {
  lastOkAt = -Infinity;
  if (!offline) {
    offline = true;
    emit();
  }
  scheduleRetry();
}

function goOnline(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryDelay = RETRY_MIN_MS;
  const wasOffline = offline;
  offline = false;
  if (wasOffline) emit();
  const queued = [...pending.values()];
  pending.clear();
  for (const fn of queued) fn();
}

function scheduleRetry(): void {
  if (retryTimer) return;
  const delay = retryDelay;
  retryDelay = Math.min(RETRY_MAX_MS, retryDelay * 2);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void checkNow();
  }, delay);
}

/** Comprueba ya si el servidor responde y actualiza el estado (y hace los refrescos pendientes si vuelve). */
async function checkNow(): Promise<boolean> {
  const ok = await probeServer();
  if (ok) goOnline();
  else goOffline();
  return ok;
}

/**
 * ¿Responde el servidor? Sin red (navigator.onLine) ni se intenta. Un 503 de la propia aplicación por otro motivo
 * (disco casi lleno, base de datos lenta) cuenta como que responde: la página se puede pedir. Mientras se apaga
 * (`shutting_down`) o si responde un proxy con otro error (502/504), no.
 */
export function probeServer(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (navigator.onLine === false) return Promise.resolve(false);
  if (performance.now() - lastOkAt < PROBE_FRESH_MS) return Promise.resolve(true);
  probing ??= (async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch("/api/health", { cache: "no-store", signal: abort.signal });
      let ok = res.ok;
      if (res.status === 503) {
        const body = (await res.json().catch(() => null)) as { reason?: unknown } | null;
        ok = !!body && body.reason !== "shutting_down";
      }
      if (ok) lastOkAt = performance.now();
      return ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      probing = null;
    }
  })();
  return probing;
}

/** Una acción no llegó al servidor: «sin conexión» ya (sin esperar a un sondeo) y reintentos hasta que vuelva. */
export function reportOffline(): void {
  install();
  goOffline();
}

/**
 * Pide `refresh` cuando haya conexión: si el servidor responde, ahora; si no, queda pendiente (uno por `key`) hasta que
 * vuelva. `true` si se hizo ahora.
 */
export async function safeRefresh(refresh: () => void, key: unknown = refresh): Promise<boolean> {
  install();
  if (!(await probeServer())) {
    pending.set(key, refresh);
    goOffline();
    return false;
  }
  pending.delete(key);
  if (offline) goOnline();
  refresh();
  return true;
}

/** Deja un refresco pendiente para cuando vuelva la conexión (sin intentarlo ahora). */
export function refreshWhenOnline(refresh: () => void, key: unknown = refresh): void {
  install();
  pending.set(key, refresh);
}

/** Olvida un refresco pendiente (p. ej. el componente que lo pidió ya no está). */
function forgetRefresh(key: unknown): void {
  pending.delete(key);
}

/**
 * Lectura que no debe quedarse sin respuesta si falla la red (el detalle de una tarea, su historial, la lista de un
 * diálogo): si la petición no llega al servidor, marca «sin conexión» y se repite sola al volver la conexión (las veces
 * que haga falta). Otro fallo va a `onError`; sin él, se lanza (queda en los logs como cualquier promesa sin atender).
 * Antes esas lecturas no tenían `.catch`: sin red el diálogo se quedaba cargando para siempre, también al volver la red.
 * Devuelve la función que la cancela (al desmontar).
 */
export function loadWhenOnline<T>(load: () => Promise<T>, onResult: (value: T) => void, onError?: (err: unknown) => void): () => void {
  let alive = true;
  const key = {};
  const attempt = () => {
    if (!alive) return;
    load().then(
      (value) => {
        if (!alive) return;
        reportReachable();
        onResult(value);
      },
      (err: unknown) => {
        if (!alive) return;
        if (isNetworkError(err)) {
          reportOffline();
          refreshWhenOnline(attempt, key);
        } else if (onError) onError(err);
        else throw err;
      },
    );
  };
  attempt();
  return () => {
    alive = false;
    forgetRefresh(key);
  };
}

/**
 * Código que se carga aparte (`import()` de un diálogo). Sin red, o con el servidor caído, no se rechaza: espera y se
 * vuelve a pedir al volver la conexión. Antes el fallo (ChunkLoadError) llegaba a la pantalla de error, que lo tomaba por
 * una versión nueva y recargaba la página sin red: la página de error del navegador. Además, `React.lazy` (next/dynamic)
 * guarda el fallo para siempre. Si el servidor responde y aun así no llega, sí es una versión nueva: se rechaza (la
 * pantalla de error recarga la página).
 */
export function importWhenOnline<T>(load: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const attempt = () => {
      load().then(resolve, async (err: unknown) => {
        if (await probeServer()) return reject(err);
        reportOffline();
        refreshWhenOnline(attempt);
      });
    };
    attempt();
  });
}

/** Una petición acaba de llegar al servidor: si se daba por perdida la conexión, ha vuelto. */
export function reportReachable(): void {
  if (!offline) return;
  lastOkAt = performance.now();
  goOnline();
}

export function isOffline(): boolean {
  return offline;
}

export function subscribeConnection(listener: () => void): () => void {
  install();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Solo para pruebas: vuelve al estado inicial. */
export function resetConnectionForTests(): void {
  offline = false;
  lastOkAt = -Infinity;
  probing = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryDelay = RETRY_MIN_MS;
  pending.clear();
  listeners.clear();
}
