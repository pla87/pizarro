// Lógica pura de la cola de subidas (sin React ni red): reparto de archivos aceptados y omitidos,
// concurrencia limitada y reintentos educados. El servidor atiende 3 subidas a la vez (upload-slots; 1 por persona si
// hay más de una activa: las demás esperan en su cola).

/** Subidas simultáneas desde el navegador: las mismas que admite el servidor. */
const UPLOAD_CONCURRENCY = 3;

/**
 * Cabecera de las respuestas de subida (también de las 2xx y del 429 «upload_busy») con las subidas a la vez que admite
 * ahora el servidor a cada persona (upload-slots.ts: 3 si solo hay una activa, 1 si hay más). La cola ajusta a ese valor
 * su concurrencia: con 3 cuerpos en paralelo y hueco para uno, los otros dos esperaban 60 s, recibían 429 y se volvían
 * a enviar enteros.
 */
export const UPLOAD_PER_USER_HEADER = "X-Pizarro-Upload-Per-User";

/** Valor de la cabecera UPLOAD_PER_USER_HEADER: entero entre 1 y UPLOAD_CONCURRENCY, o null si falta o no vale. */
export function parseUploadCap(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || !/^\s*\d+\s*$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? Math.min(n, UPLOAD_CONCURRENCY) : null;
}

/** Cuánto vale como reciente el último tope conocido antes de volver a preguntarlo al empezar una tanda. */
const UPLOAD_CAP_FRESH_MS = 15_000;

/**
 * Tope de subidas a la vez que ha indicado el servidor. `note` lo toma de la cabecera de cualquier respuesta de subida;
 * `refresh` (antes de una tanda de varias) usa el último si es reciente y, si no, lo pregunta con `fetchCap` (una
 * petición GET ligera); si falla, se queda con el que tenía (al principio, UPLOAD_CONCURRENCY).
 */
export function createUploadCapTracker(opts: { fetchCap: () => Promise<number | null>; now?: () => number; freshMs?: number }) {
  const now = opts.now ?? Date.now;
  const freshMs = opts.freshMs ?? UPLOAD_CAP_FRESH_MS;
  let value = UPLOAD_CONCURRENCY;
  let at = -Infinity;
  const set = (n: number | null) => {
    if (n === null) return;
    value = n;
    at = now();
  };
  return {
    note(headers: { get(name: string): string | null } | null | undefined) {
      set(parseUploadCap(headers?.get(UPLOAD_PER_USER_HEADER)));
    },
    current: () => value,
    async refresh(): Promise<number> {
      if (now() - at < freshMs) return value;
      set(await opts.fetchCap().catch(() => null));
      return value;
    },
  };
}

/** El del navegador: pregunta a GET /api/upload-limit. */
export const uploadCap = createUploadCapTracker({
  fetchCap: async () => {
    const res = await fetch("/api/upload-limit", { cache: "no-store" });
    return res.ok ? parseUploadCap(res.headers.get(UPLOAD_PER_USER_HEADER)) : null;
  },
});

/**
 * Puerta con un número variable de pasos a la vez (`limit()`, como mínimo 1): cada envío de un cuerpo (también los
 * reintentos de una subida ya empezada) pasa por ella, así que, aunque la cola haya empezado 3 antes de saber que el tope
 * es 1, los reintentos van de uno en uno. Con `signal` abortada (p. ej. «Descartar cambios») no se ejecuta `fn`: si
 * esperaba turno, deja la fila; en ambos casos rechaza con QueueStopped.
 */
export function createGate(limit: () => number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const cap = () => Math.max(1, Math.floor(limit()) || 1);
  const pump = () => {
    while (waiting.length && active < cap()) {
      active++;
      waiting.shift()!();
    }
  };
  return {
    async run<R>(fn: () => Promise<R>, signal?: AbortSignal): Promise<R> {
      if (signal?.aborted) throw new QueueStopped();
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const i = waiting.indexOf(grant);
          if (i < 0) return;
          waiting.splice(i, 1);
          reject(new QueueStopped());
        };
        const grant = () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        waiting.push(grant);
        signal?.addEventListener("abort", onAbort, { once: true });
        pump();
      });
      try {
        if (signal?.aborted) throw new QueueStopped();
        return await fn();
      } finally {
        active--;
        pump();
      }
    },
  };
}

/** La de todas las subidas del navegador (adjuntos y documentos), con el tope que dice el servidor. */
export const uploadGate = createGate(() => uploadCap.current());

type SkipReason = "empty" | "too_big" | "total";

export interface SkippedFile {
  name: string;
  size: number;
  reason: SkipReason;
}

/**
 * Separa los archivos que caben de los que no. Sin tope de cantidad: solo el tamaño de cada archivo y la suma
 * de la tarea (`remainingBytes` = lo que aún cabe). Un archivo que no cabe en la suma se omite pero los más
 * pequeños que vengan después sí pueden entrar.
 */
export function planUploads(
  files: readonly File[],
  limits: { fileMaxBytes: number; remainingBytes: number },
): { accepted: File[]; skipped: SkippedFile[] } {
  const accepted: File[] = [];
  const skipped: SkippedFile[] = [];
  let left = limits.remainingBytes;
  for (const file of files) {
    const base = { name: file.name, size: file.size };
    if (file.size === 0) skipped.push({ ...base, reason: "empty" });
    else if (file.size > limits.fileMaxBytes) skipped.push({ ...base, reason: "too_big" });
    else if (file.size > left) skipped.push({ ...base, reason: "total" });
    else {
      accepted.push(file);
      left -= file.size;
    }
  }
  return { accepted, skipped };
}

/** Se lanza (como rechazo) para los elementos que no llegaron a empezar porque la cola se detuvo. */
export class QueueStopped extends Error {
  constructor() {
    super("queue stopped");
  }
}

interface QueueOptions {
  concurrency?: number;
  /**
   * Tope variable (se consulta cada vez que se va a empezar un elemento; entre 1 y `concurrency`): p. ej. el que indica el
   * servidor en sus respuestas. Si baja, los que ya van siguen; si sube, se empiezan más al terminar el siguiente.
   */
  limit?: () => number;
  onStart?: (index: number) => void;
  onSettle?: (index: number, result: PromiseSettledResult<unknown>) => void;
  /** Si devuelve true para un error, no se empiezan más elementos (los que faltan quedan como QueueStopped). */
  stopWhen?: (reason: unknown) => boolean;
  /** Al abortar no se empieza ningún elemento más (los que faltan quedan como QueueStopped); los que ya van siguen hasta el final. */
  signal?: AbortSignal;
}

/** Ejecuta `worker` sobre cada elemento con como mucho `concurrency` (o `limit()`) a la vez, respetando el orden de salida. */
export async function runQueue<T, R>(items: readonly T[], worker: (item: T, index: number) => Promise<R>, opts: QueueOptions = {}): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? UPLOAD_CONCURRENCY, items.length || 1));
  const cap = () => (opts.limit ? Math.max(1, Math.min(concurrency, Math.floor(opts.limit()) || 1)) : concurrency);
  let next = 0;
  let running = 0;
  let stopped = false;
  return new Promise((resolve) => {
    const pump = () => {
      while (next < items.length) {
        if (stopped || opts.signal?.aborted) {
          const i = next++;
          results[i] = { status: "rejected", reason: new QueueStopped() };
          opts.onSettle?.(i, results[i]!);
          continue;
        }
        if (running >= cap()) break;
        const i = next++;
        running++;
        opts.onStart?.(i);
        let p: Promise<R>;
        try {
          p = Promise.resolve(worker(items[i]!, i));
        } catch (reason) {
          p = Promise.reject(reason);
        }
        void p
          .then(
            (value) => { results[i] = { status: "fulfilled", value }; },
            (reason) => {
              results[i] = { status: "rejected", reason };
              if (opts.stopWhen?.(reason)) stopped = true;
            },
          )
          .then(() => {
            running--;
            opts.onSettle?.(i, results[i]!);
            pump();
          });
      }
      if (next >= items.length && running === 0) resolve(results);
    };
    pump();
  });
}

const RETRY_STATUSES = [429, 503];

/** Espera total máxima de una subida entre reintentos (cubre una ventana de límite por persona de 60 s). */
const RETRY_MAX_WAIT_MS = 70_000;

/** Espera antes del reintento nº `attempt` (0, 1…): la indicada por el servidor (Retry-After, hasta 65 s) o 2, 4, 8 s…, con tope de 30 s. */
export function retryDelayMs(attempt: number, retryAfterSec?: number | null): number {
  if (retryAfterSec && retryAfterSec > 0) return Math.min(65_000, retryAfterSec * 1000);
  return Math.min(30_000, 2000 * 2 ** attempt);
}

/** Espera `ms`, o menos si se aborta `signal`. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Repite `fn` mientras falle con un estado reintentable (429/503), hasta `retries` veces y sin esperar en total más de
 * `maxWaitMs`. Con `signal` abortada no se vuelve a intentar: la espera se corta y rechaza con QueueStopped (antes se
 * dormía la espera entera y después se enviaba igual, p. ej. tras «Descartar cambios»).
 */
export async function withRetry<R>(
  fn: () => Promise<R>,
  opts: {
    retries?: number;
    maxWaitMs?: number;
    signal?: AbortSignal;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    info?: (err: unknown) => { status?: number; retryAfterSec?: number | null };
  } = {},
): Promise<R> {
  const retries = opts.retries ?? 4;
  const maxWait = opts.maxWaitMs ?? RETRY_MAX_WAIT_MS;
  let waited = 0;
  const sleep = opts.sleep ?? abortableSleep;
  const info = opts.info ?? ((err: unknown) => err as { status?: number; retryAfterSec?: number | null });
  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) throw new QueueStopped();
    try {
      return await fn();
    } catch (err) {
      const { status, retryAfterSec } = info(err) ?? {};
      if (attempt >= retries || status === undefined || !RETRY_STATUSES.includes(status)) throw err;
      const delay = retryDelayMs(attempt, retryAfterSec);
      if (opts.signal?.aborted || waited + delay > maxWait) throw err;
      waited += delay;
      await sleep(delay, opts.signal);
    }
  }
}

/** Resumen para un solo aviso: «a.zip, b.zip, …» con un máximo de nombres y «+N» para el resto. */
export function summarizeSkipped(skipped: readonly SkippedFile[], label: (s: SkippedFile) => string, maxNames = 5): string {
  const shown = skipped.slice(0, maxNames).map(label);
  const more = skipped.length - shown.length;
  return more > 0 ? `${shown.join(", ")} … +${more}` : shown.join(", ");
}
