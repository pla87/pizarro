// Lógica pura de la cola de subidas (sin React ni red): reparto de archivos aceptados y omitidos,
// concurrencia limitada y reintentos educados. El servidor atiende 3 subidas a la vez (upload-slots).

/** Subidas simultáneas desde el navegador: las mismas que admite el servidor. */
export const UPLOAD_CONCURRENCY = 3;

export type SkipReason = "empty" | "too_big" | "total";

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

export interface QueueOptions {
  concurrency?: number;
  onStart?: (index: number) => void;
  onSettle?: (index: number, result: PromiseSettledResult<unknown>) => void;
  /** Si devuelve true para un error, no se empiezan más elementos (los que faltan quedan como QueueStopped). */
  stopWhen?: (reason: unknown) => boolean;
}

/** Ejecuta `worker` sobre cada elemento con como mucho `concurrency` a la vez, respetando el orden de salida. */
export async function runQueue<T, R>(items: readonly T[], worker: (item: T, index: number) => Promise<R>, opts: QueueOptions = {}): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? UPLOAD_CONCURRENCY, items.length || 1));
  let next = 0;
  let stopped = false;
  const lane = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      if (stopped) {
        results[i] = { status: "rejected", reason: new QueueStopped() };
        opts.onSettle?.(i, results[i]!);
        continue;
      }
      opts.onStart?.(i);
      try {
        results[i] = { status: "fulfilled", value: await worker(items[i]!, i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
        if (opts.stopWhen?.(reason)) stopped = true;
      }
      opts.onSettle?.(i, results[i]!);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, lane));
  return results;
}

export const RETRY_STATUSES = [429, 503];

/** Espera antes del reintento nº `attempt` (0, 1…): la indicada por el servidor (Retry-After) o 2, 4, 8 s…, con tope de 30 s. */
export function retryDelayMs(attempt: number, retryAfterSec?: number | null): number {
  if (retryAfterSec && retryAfterSec > 0) return Math.min(30_000, retryAfterSec * 1000);
  return Math.min(30_000, 2000 * 2 ** attempt);
}

/** Repite `fn` mientras falle con un estado reintentable (429/503), hasta `retries` veces. */
export async function withRetry<R>(
  fn: () => Promise<R>,
  opts: { retries?: number; sleep?: (ms: number) => Promise<void>; info?: (err: unknown) => { status?: number; retryAfterSec?: number | null } } = {},
): Promise<R> {
  const retries = opts.retries ?? 4;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const info = opts.info ?? ((err: unknown) => err as { status?: number; retryAfterSec?: number | null });
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const { status, retryAfterSec } = info(err) ?? {};
      if (attempt >= retries || status === undefined || !RETRY_STATUSES.includes(status)) throw err;
      await sleep(retryDelayMs(attempt, retryAfterSec));
    }
  }
}

/** Resumen para un solo aviso: «a.zip, b.zip, …» con un máximo de nombres y «+N» para el resto. */
export function summarizeSkipped(skipped: readonly SkippedFile[], label: (s: SkippedFile) => string, maxNames = 5): string {
  const shown = skipped.slice(0, maxNames).map(label);
  const more = skipped.length - shown.length;
  return more > 0 ? `${shown.join(", ")} … +${more}` : shown.join(", ");
}
