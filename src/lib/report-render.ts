import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { PdfJob } from "./report-pdf";
import type { PdfWorkerRequest, PdfWorkerResponse } from "./report-pdf-worker";

// Lado del proceso web del generador de PDF: arranca el worker_thread (report-pdf-worker.ts) la primera vez, le pasa
// cada trabajo y recibe el fichero. El worker se queda encendido un rato para no pagar el arranque en cada PDF
// (cargar @react-pdf/renderer tarda unos cientos de ms) y se apaga solo si no se usa. La cola de uno en uno y el
// tiempo máximo están en report-build.ts: al agotarse, `signal` se aborta y aquí se termina el worker, así que un
// render atascado deja de gastar CPU (el siguiente PDF arranca un worker nuevo).

/** Tras este tiempo sin PDF que generar, el worker se apaga y libera su memoria. */
export const PDF_WORKER_IDLE_MS = 60_000;

/**
 * Memoria máxima (heap de V8, MB) del worker: sin tope heredaría el del proceso (~700 MB en un contenedor pequeño) y un
 * informe enorme podría dejar sin memoria al servidor entero. Al pasarse, Node termina SOLO el worker
 * (ERR_WORKER_OUT_OF_MEMORY): ese PDF falla con un error normal y el siguiente arranca otro worker.
 * Ajustable con PDF_WORKER_MAX_MB (64–4096).
 */
export const PDF_WORKER_MAX_MB = 256;

export function pdfWorkerMaxMb(env: Partial<NodeJS.ProcessEnv> = process.env): number {
  const n = Number(env.PDF_WORKER_MAX_MB);
  return Number.isFinite(n) && n > 0 ? Math.min(4096, Math.max(64, Math.floor(n))) : PDF_WORKER_MAX_MB;
}

/** Mensaje del error con el que se rechaza un PDF cuyo worker se quedó sin memoria. */
export const PDF_OUT_OF_MEMORY_MESSAGE = "El generador de PDF se quedó sin memoria";

/**
 * Fichero del worker. En producción, el empaquetado por scripts/postbuild.mjs (dist/pdf-worker.mjs, junto al server.js
 * del standalone y en la imagen Docker); en desarrollo y en los tests, el código fuente con tsx (sin compilar nada).
 */
export function pdfWorkerSpec(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): { file: string; execArgv?: string[] } {
  // turbopackIgnore: sin él, `next dev` toma la ruta (que depende de la carpeta actual) por un import y empaqueta el proyecto entero.
  if (env.NODE_ENV === "production") return { file: path.join(/*turbopackIgnore: true*/ cwd, "dist", "pdf-worker.mjs") };
  return { file: path.join(/*turbopackIgnore: true*/ cwd, "src", "lib", "report-pdf-worker.ts"), execArgv: ["--import", "tsx"] };
}

interface Pending {
  resolve: (pdf: Uint8Array) => void;
  reject: (err: unknown) => void;
}

interface Slot {
  worker: Worker;
  jobs: Map<number, Pending>;
}

let current: Slot | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let seq = 0;

/** Retira el worker (si sigue siendo el actual) y rechaza sus trabajos pendientes. */
function drop(slot: Slot, err: unknown) {
  if (current === slot) current = null;
  for (const p of slot.jobs.values()) p.reject(err);
  slot.jobs.clear();
}

function startWorker(): Slot {
  const spec = pdfWorkerSpec();
  if (!existsSync(spec.file)) {
    throw new Error(`No se encuentra el generador de PDF (${path.relative(process.cwd(), spec.file)}); vuelve a compilar con «npm run build»`);
  }
  const maxMb = pdfWorkerMaxMb();
  const worker = new Worker(/*turbopackIgnore: true*/ spec.file, { execArgv: spec.execArgv, name: "pdf", resourceLimits: { maxOldGenerationSizeMb: maxMb } });
  const slot: Slot = { worker, jobs: new Map() };
  worker.on("message", (msg: PdfWorkerResponse) => {
    const p = slot.jobs.get(msg.id);
    if (!p) return;
    slot.jobs.delete(msg.id);
    if (msg.ok) p.resolve(new Uint8Array(msg.pdf));
    else p.reject(new Error(msg.error));
    if (!slot.jobs.size) idle(slot);
  });
  // Un fallo del propio worker rechaza lo pendiente; el siguiente PDF arranca otro. Sin memoria, el error lo dice (con el
  // tope y la variable) para los logs; quien lo pidió recibe el «No se pudo generar el informe» de siempre.
  worker.on("error", (err) => {
    const oom = (err as NodeJS.ErrnoException).code === "ERR_WORKER_OUT_OF_MEMORY";
    drop(slot, oom ? new Error(`${PDF_OUT_OF_MEMORY_MESSAGE} (límite ${maxMb} MB, PDF_WORKER_MAX_MB)`, { cause: err }) : err);
  });
  worker.on("exit", (code) => drop(slot, new Error(`El generador de PDF se detuvo (código ${code})`)));
  return slot;
}

/** Sin trabajos: el worker no retiene el proceso (tests, scripts) y se apaga si sigue así un rato. */
function idle(slot: Slot) {
  slot.worker.unref();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (current === slot && !slot.jobs.size) stopPdfWorker();
  }, PDF_WORKER_IDLE_MS);
  idleTimer.unref();
}

/** Apaga el worker (si hay); lo pendiente se rechaza. */
export function stopPdfWorker(reason: unknown = new Error("Generador de PDF detenido")): void {
  const slot = current;
  if (!slot) return;
  drop(slot, reason);
  void slot.worker.terminate();
}

/** Genera un PDF en el worker. Si `signal` se aborta (tiempo agotado), termina el worker y rechaza con su motivo. */
export function renderInWorker(job: PdfJob, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<Uint8Array>((resolve, reject) => {
    let slot: Slot;
    try {
      slot = current ??= startWorker();
    } catch (err) {
      reject(err);
      return;
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    const id = ++seq;
    const onAbort = () => {
      if (current === slot) stopPdfWorker(signal!.reason);
      else reject(signal!.reason);
    };
    slot.jobs.set(id, {
      resolve: (pdf) => { signal?.removeEventListener("abort", onAbort); resolve(pdf); },
      reject: (err) => { signal?.removeEventListener("abort", onAbort); reject(err); },
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    slot.worker.ref();
    slot.worker.postMessage({ id, job } satisfies PdfWorkerRequest);
  });
}
