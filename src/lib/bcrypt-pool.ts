// bcrypt fuera del hilo principal: hilos de trabajo (worker_threads) que ejecutan bcryptjs, el mismo algoritmo y los
// mismos hashes ($2a$/$2b$) que ya hay guardados. bcryptjs es JavaScript puro: en el hilo principal, cada comprobación
// (~0,2 s con coste 11) dejaba el servidor sin atender a nadie, y varias a la vez sumaban segundos.
//
// El hilo carga bcryptjs desde node_modules (en la salida standalone de Next está porque va en serverExternalPackages).
// Si no se encuentra o los hilos fallan, se calcula en el hilo principal como antes: nunca deja de funcionar.
// Quien lo usa (password.ts) limita cuántas operaciones van a la vez, así que basta un hilo por operación en curso.

import path from "node:path";
import { Worker } from "node:worker_threads";

export type BcryptOp = { op: "hash"; plain: string; cost: number } | { op: "compare"; plain: string; hash: string };

// Código del hilo (eval: sin fichero propio, que el empaquetado de Next no copiaría). Recibe la ruta de bcryptjs.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const bcrypt = require(workerData.bcryptPath);
parentPort.on("message", (m) => {
  try {
    const value = m.op === "hash" ? bcrypt.hashSync(m.plain, m.cost) : bcrypt.compareSync(m.plain, m.hash);
    parentPort.postMessage({ id: m.id, value });
  } catch (err) {
    parentPort.postMessage({ id: m.id, error: String((err && err.message) || err) });
  }
});
parentPort.postMessage({ ready: true });
`;

class WorkerUnavailable extends Error {
  name = "BcryptWorkerUnavailable";
}
// Por nombre: los hilos (en globalThis) pueden haberlos creado otros paquetes de Next, con su propia copia de la clase.
const isWorkerUnavailable = (err: unknown) => err instanceof Error && err.name === "BcryptWorkerUnavailable";

type Slot = { worker: Worker; busy: boolean; ready: Promise<void>; pending: { id: number; resolve: (v: unknown) => void; reject: (e: Error) => void } | null };

interface PoolState {
  slots: Slot[];
  /** Ruta de bcryptjs para los hilos; null: no se encontró (todo en el hilo principal). undefined: aún sin buscar. */
  bcryptPath?: string | null;
  /** Fallos de los hilos: a partir de unos pocos se deja de intentar (hilo principal). */
  failures: number;
  nextId: number;
}

const MAX_FAILURES = 3;
// En una variable (no literal) para que el empaquetador no intente resolverlo por su cuenta.
const BCRYPT_PACKAGE = ["bcrypt", "js"].join("");
const g = globalThis as unknown as { __pzBcryptPool?: PoolState };
const state = (g.__pzBcryptPool ??= { slots: [], failures: 0, nextId: 1 });

function bcryptPath(): string | null {
  if (state.bcryptPath !== undefined) return state.bcryptPath;
  try {
    // Desde la carpeta de trabajo (la de server.js en la salida standalone; la del proyecto en desarrollo y pruebas).
    // createRequire se pide en tiempo de ejecución: si webpack ve `createRequire(…).resolve("…")`, lo sustituye por el
    // número de módulo de su paquete, que al hilo no le sirve.
    const mod = process.getBuiltinModule?.("node:module");
    const resolved = mod ? mod.createRequire(path.join(process.cwd(), "noop.js")).resolve(BCRYPT_PACKAGE) : null;
    state.bcryptPath = typeof resolved === "string" ? resolved : null;
  } catch {
    state.bcryptPath = null;
  }
  return state.bcryptPath;
}

/** ¿Se usan hilos? (false: no se encontró bcryptjs, se desactivaron con BCRYPT_WORKERS=0 o fallaron varias veces). */
export function bcryptWorkersEnabled(): boolean {
  if (/^(0|false|off|no)$/i.test((process.env.BCRYPT_WORKERS ?? "").trim())) return false;
  return state.failures < MAX_FAILURES && bcryptPath() !== null;
}

function dropSlot(slot: Slot, err: Error) {
  state.slots = state.slots.filter((s) => s !== slot);
  const p = slot.pending;
  slot.pending = null;
  p?.reject(new WorkerUnavailable(err.message));
}

function newSlot(file: string): Slot {
  const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { bcryptPath: file } });
  let markReady: () => void = () => {};
  let markFailed: (e: Error) => void = () => {};
  const slot: Slot = {
    worker,
    busy: false,
    pending: null,
    ready: new Promise<void>((resolve, reject) => {
      markReady = resolve;
      markFailed = reject;
    }),
  };
  slot.ready.catch(() => {});
  worker.on("message", (m: { ready?: boolean; id?: number; value?: unknown; error?: string }) => {
    if (m.ready) return markReady();
    const p = slot.pending;
    if (!p || p.id !== m.id) return;
    slot.pending = null;
    if (m.error !== undefined) p.reject(new Error(m.error));
    else p.resolve(m.value);
  });
  worker.on("error", (err) => {
    state.failures++;
    console.error("[bcrypt] hilo de trabajo", err.message);
    markFailed(new WorkerUnavailable(err.message));
    dropSlot(slot, err);
  });
  worker.on("exit", (code) => {
    markFailed(new WorkerUnavailable(`exit ${code}`));
    dropSlot(slot, new Error(`El hilo de bcrypt terminó (${code}).`));
  });
  // Sin trabajo, el hilo no retiene el proceso (se vuelve a «ref» mientras calcula).
  worker.unref();
  state.slots.push(slot);
  return slot;
}

/**
 * Tope de una operación en un hilo (arranque incluido): una comprobación tarda ~0,2 s; si un hilo se queda colgado, se
 * termina y la operación se repite en el hilo principal. Sin tope, el hueco del semáforo de password.ts quedaba ocupado
 * para siempre y, con dos así, nadie más podía entrar.
 */
const BCRYPT_OP_TIMEOUT_MS = 10_000;

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function runInWorker(file: string, job: BcryptOp, timeoutMs: number): Promise<unknown> {
  let slot: Slot;
  try {
    slot = state.slots.find((s) => !s.busy) ?? newSlot(file);
  } catch (err) {
    // new Worker puede fallar en el acto (sin memoria, demasiados hilos…): como un hilo que falla, al hilo principal.
    state.failures++;
    console.error("[bcrypt] no se pudo crear el hilo de trabajo", messageOf(err));
    throw new WorkerUnavailable(messageOf(err));
  }
  slot.busy = true;
  slot.worker.ref();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async () => {
      await slot.ready;
      return await new Promise((resolve, reject) => {
        const id = state.nextId++;
        slot.pending = { id, resolve, reject };
        try {
          slot.worker.postMessage({ id, ...job });
        } catch (err) {
          // Un error al enviar (p. ej. el hilo ya se cerró) no es un error de bcrypt: se calcula en el hilo principal.
          slot.pending = null;
          reject(new WorkerUnavailable(messageOf(err)));
        }
      });
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        state.failures++;
        console.error(`[bcrypt] el hilo de trabajo no respondió en ${timeoutMs} ms: se termina`);
        // Fuera de la lista antes de terminarlo: nadie más lo usa mientras se cierra.
        dropSlot(slot, new Error("tiempo agotado"));
        void slot.worker.terminate().catch(() => 0);
        reject(new WorkerUnavailable("tiempo agotado"));
      }, timeoutMs);
    });
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    slot.busy = false;
    slot.worker.unref();
  }
}

/**
 * Ejecuta la operación en un hilo de trabajo; si no hay hilos (o el hilo falla o no responde a tiempo), con `fallback`
 * en el hilo principal. Un error del propio bcrypt (p. ej. un hash con formato inválido) se propaga igual que en el hilo
 * principal. `timeoutMs`: solo para pruebas.
 */
export async function runBcrypt<T>(job: BcryptOp, fallback: () => Promise<T>, { timeoutMs = BCRYPT_OP_TIMEOUT_MS }: { timeoutMs?: number } = {}): Promise<T> {
  const file = bcryptWorkersEnabled() ? bcryptPath() : null;
  if (!file) return fallback();
  try {
    return (await runInWorker(file, job, timeoutMs)) as T;
  } catch (err) {
    if (isWorkerUnavailable(err)) return fallback();
    throw err;
  }
}

/** Hilos abiertos y fallos contados (pruebas y diagnóstico). */
export function bcryptPoolStats(): { workers: number; busy: number; failures: number } {
  return { workers: state.slots.length, busy: state.slots.filter((s) => s.busy).length, failures: state.failures };
}

/** Cierra los hilos y olvida los fallos (pruebas). */
export async function closeBcryptWorkers(): Promise<void> {
  const slots = state.slots;
  state.slots = [];
  state.failures = 0;
  await Promise.all(slots.map((s) => s.worker.terminate().catch(() => 0)));
}
