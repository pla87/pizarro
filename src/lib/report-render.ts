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
  const worker = new Worker(/*turbopackIgnore: true*/ spec.file, { execArgv: spec.execArgv, name: "pdf" });
  const slot: Slot = { worker, jobs: new Map() };
  worker.on("message", (msg: PdfWorkerResponse) => {
    const p = slot.jobs.get(msg.id);
    if (!p) return;
    slot.jobs.delete(msg.id);
    if (msg.ok) p.resolve(new Uint8Array(msg.pdf));
    else p.reject(new Error(msg.error));
    if (!slot.jobs.size) idle(slot);
  });
  // Un fallo del propio worker (p. ej. sin memoria) rechaza lo pendiente; el siguiente PDF arranca otro.
  worker.on("error", (err) => drop(slot, err));
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
