// Subidas de archivos en curso. Cada una se lee entera en memoria y se procesa con sharp, así que se limitan las
// simultáneas en todo el servidor (como los huecos de ZIP de release-zip.ts). El cuerpo se lee con readBodyLimited, que
// corta en cuanto supera el tope del proyecto (también sin Content-Length): las rutas de subida no pasan por el proxy
// de Next (src/proxy.ts), así que nadie más pone un techo a lo que se recibe.

import { forgetUserActivity, noteUserActivity, recentlyActiveUsers } from "./user-activity";
import { UPLOAD_PER_USER_HEADER } from "./upload-queue";

// Reparto entre personas: si hay más de una activa en los últimos 5 minutos (user-activity.ts; cuenta también quien tiene
// una subida en curso o en cola), cada una tiene como mucho UNA subida a la vez y las demás suyas esperan en la cola; si
// solo hay una, puede usar los MAX_UPLOADS_AT_ONCE huecos. La cola es por orden de llegada, pero una espera cuya persona
// ya está en su tope no bloquea a las de detrás: el hueco que queda libre pasa a la primera que pueda usarlo (alguien que
// llega después sin ninguna en curso adelanta a las de otra persona que ya tiene una).

// Excepción: un cuerpo pequeño (Content-Length declarado por debajo de SMALL_BODY_BYTES, p. ej. el JSON de «Importar
// tareas» o de pegar) no cuenta para el tope por persona, solo para el global: no espera a una subida lenta de la misma
// persona. El servidor HTTP no deja pasar más bytes de los declarados, así que no se puede colar uno grande por aquí.

type Waiter = { userId: string; grant: () => void; small: boolean };
type Slots = { active: number; byUser: Map<string, number>; waiting: Waiter[]; recheck: ReturnType<typeof setTimeout> | null };
const slots: Slots = ((globalThis as unknown as { __pzUploadSlotsV2?: Slots }).__pzUploadSlotsV2 ??= { active: 0, byUser: new Map(), waiting: [], recheck: null });
export const MAX_UPLOADS_AT_ONCE = 3;
/** Subidas a la vez de una misma persona cuando hay más de una activa. */
const MAX_UPLOADS_PER_USER_SHARED = 1;
/** Por debajo de este Content-Length declarado, el cuerpo no cuenta para el tope por persona (opción `declaredBytes`). */
export const SMALL_BODY_BYTES = 256 * 1024;
/** Cuánto espera una subida a que quede un hueco antes de rendirse (varias a la vez de una misma persona hacen cola). */
const WAIT_MS = 60_000;

/** Tope por persona ahora mismo, y cuándo caduca la actividad de las que solo cuentan por ella (para volver a mirar). */
function perUserCap(now: number): { cap: number; nextExpiry: number | null } {
  const recent = recentlyActiveUsers(now);
  const busy = new Set<string>(slots.byUser.keys());
  for (const w of slots.waiting) busy.add(w.userId);
  const people = new Set<string>([...recent.keys(), ...busy]);
  if (people.size <= 1) return { cap: MAX_UPLOADS_AT_ONCE, nextExpiry: null };
  let nextExpiry: number | null = null;
  for (const [id, until] of recent) if (!busy.has(id) && (nextExpiry === null || until < nextExpiry)) nextExpiry = until;
  return { cap: MAX_UPLOADS_PER_USER_SHARED, nextExpiry };
}

function take(userId: string, small: boolean) {
  slots.active++;
  if (!small) slots.byUser.set(userId, (slots.byUser.get(userId) ?? 0) + 1);
}

/** Da los huecos libres a las esperas que pueden usarlos, por orden de llegada. */
function pump() {
  if (slots.recheck) { clearTimeout(slots.recheck); slots.recheck = null; }
  if (slots.waiting.length === 0) return;
  const now = Date.now();
  const { cap, nextExpiry } = perUserCap(now);
  for (let i = 0; i < slots.waiting.length && slots.active < MAX_UPLOADS_AT_ONCE;) {
    const w = slots.waiting[i]!;
    if (w.small || (slots.byUser.get(w.userId) ?? 0) < cap) {
      slots.waiting.splice(i, 1);
      take(w.userId, w.small);
      w.grant();
    } else i++;
  }
  // Quedan esperas frenadas solo por el tope por persona: cuando caduque la actividad de alguien que no sube nada,
  // puede que vuelva a haber una sola persona activa y se liberen sus huecos.
  if (slots.waiting.length > 0 && slots.active < MAX_UPLOADS_AT_ONCE && nextExpiry !== null) {
    slots.recheck = setTimeout(pump, Math.max(0, nextExpiry - now) + 1);
    slots.recheck.unref?.();
  }
}

function release(userId: string, small: boolean) {
  slots.active--;
  if (small) return pump();
  const n = (slots.byUser.get(userId) ?? 1) - 1;
  if (n > 0) slots.byUser.set(userId, n);
  else slots.byUser.delete(userId);
  pump();
}

/**
 * Reserva un hueco de subida para `userId`; si no le toca ya (todos ocupados, o ya tiene las que le corresponden),
 * espera en cola hasta `waitMs`. Devuelve la función que lo libera, o null si no quedó hueco a tiempo.
 * `declaredBytes`: Content-Length de la petición; si es menor que SMALL_BODY_BYTES, no cuenta para el tope por persona.
 */
export async function acquireUploadSlot(userId: string, waitMs = WAIT_MS, opts: { declaredBytes?: number | null } = {}): Promise<(() => void) | null> {
  noteUserActivity(userId);
  const small = opts.declaredBytes !== undefined && opts.declaredBytes !== null && opts.declaredBytes < SMALL_BODY_BYTES;
  const got = await new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const waiter: Waiter = { userId, small, grant: () => { if (timer) clearTimeout(timer); resolve(true); } };
    slots.waiting.push(waiter);
    pump(); // si le toca ya, grant se llama aquí mismo
    if (!slots.waiting.includes(waiter)) return;
    timer = setTimeout(() => {
      const i = slots.waiting.indexOf(waiter);
      if (i >= 0) slots.waiting.splice(i, 1);
      resolve(false);
      pump();
    }, waitMs);
  });
  if (!got) return null;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release(userId, small);
  };
}

/**
 * Subidas a la vez que admite ahora mismo el servidor a cada persona: MAX_UPLOADS_AT_ONCE si solo hay una activa, 1 si
 * hay más. Va en la cabecera UPLOAD_PER_USER_HEADER de todas las respuestas de subida (y en GET /api/upload-limit)
 * para que la cola del navegador (upload-queue.ts) no envíe más cuerpos a la vez de los que van a tener hueco.
 */
export function uploadPerUserCap(now = Date.now()): number {
  return perUserCap(now).cap;
}

/** Pone en la respuesta la cabecera con el tope actual por persona (uploadPerUserCap). */
export function withUploadCapHeader<R extends Response>(res: R): R {
  res.headers.set(UPLOAD_PER_USER_HEADER, String(uploadPerUserCap()));
  return res;
}

/** Solo para las pruebas: vacía los huecos, la cola y la actividad anotada. */
export function resetUploadSlots(): void {
  if (slots.recheck) clearTimeout(slots.recheck);
  slots.recheck = null;
  slots.active = 0;
  slots.byUser.clear();
  slots.waiting.length = 0;
  forgetUserActivity();
}

/** Longitud declarada del cuerpo; null si falta o no es un entero válido (algunos proxies la quitan: entonces se comprueba al leer). */
export function declaredLength(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw);
}

/** El cuerpo de la petición supera el tope de readBodyLimited. */
export class BodyTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`body > ${maxBytes} bytes`);
    this.name = "BodyTooLargeError";
  }
}

/** La subida iba demasiado lenta (o tardó demasiado en total) y se cortó para no retener el hueco. */
export class UploadTooSlowError extends Error {
  constructor() {
    super("upload too slow");
    this.name = "UploadTooSlowError";
  }
}

/** Mensaje (clave i18n) para la respuesta 408 cuando se corta una subida lenta. */
export const UPLOAD_TOO_SLOW_MESSAGE = "La subida iba demasiado lenta y se ha cortado. Inténtalo de nuevo con mejor conexión.";

/**
 * Umbrales contra subidas que retienen un hueco. Velocidad mínima sostenida: 20 KB/s (~160 kbit/s, por debajo de una
 * 2G/EDGE mala pero muy por encima de un goteo malicioso) medida en ventanas de 30 s, es decir, 600 KB por ventana;
 * así una subida móvil con cobertura floja pasa y un cliente que manda unos pocos bytes por segundo no. Tiempo total:
 * 3 min de margen más lo que costaría el cuerpo esperado a la velocidad mínima, con tope de 30 min para los adjuntos
 * (como mucho unas decenas de MB) y de 3 h para la importación de un proyecto (hasta 500 MB o más: a ~190 KB/s, que
 * supera con creces el mínimo, ya tarda unos 45 min). Lo que frena el goteo malicioso es la ventana, no el total.
 */
const UPLOAD_MIN_BYTES_PER_SEC = 20 * 1024;
const UPLOAD_WINDOW_MS = 30_000;
const UPLOAD_BASE_TOTAL_MS = 3 * 60_000;
export const UPLOAD_MAX_TOTAL_MS = 30 * 60_000;
export const IMPORT_MAX_TOTAL_MS = 3 * 60 * 60_000;

type SlowGuardOptions = { minBytesPerSec?: number; windowMs?: number; totalMs?: number };

/** Tiempo máximo total para recibir un cuerpo de `expectedBytes` (`maxMs`: tope; por defecto, el de los adjuntos). */
export function uploadTotalMs(expectedBytes: number, maxMs = UPLOAD_MAX_TOTAL_MS): number {
  return Math.min(maxMs, UPLOAD_BASE_TOTAL_MS + (expectedBytes / UPLOAD_MIN_BYTES_PER_SEC) * 1000);
}

/**
 * Vigila una lectura: llama a `onSlow` si pasa el tiempo máximo total o si en una ventana completa llegan menos bytes
 * que la velocidad mínima. Las subidas que acaban antes de cerrarse la primera ventana nunca se cortan. `add(n)` cuenta
 * bytes; `stop()` desarma los temporizadores (siempre hay que llamarlo al terminar).
 */
export function createSlowGuard(onSlow: () => void, opts: SlowGuardOptions & { expectedBytes: number }) {
  const minRate = opts.minBytesPerSec ?? UPLOAD_MIN_BYTES_PER_SEC;
  const windowMs = opts.windowMs ?? UPLOAD_WINDOW_MS;
  const totalMs = opts.totalMs ?? uploadTotalMs(opts.expectedBytes);
  let received = 0;
  let mark = 0;
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    clearTimeout(total);
    clearInterval(tick);
    onSlow();
  };
  const total = setTimeout(fire, totalMs);
  const tick = setInterval(() => {
    if (received - mark < (minRate * windowMs) / 1000) fire();
    mark = received;
  }, windowMs);
  total.unref?.();
  tick.unref?.();
  return {
    add(n: number) { received += n; },
    stop() { done = true; clearTimeout(total); clearInterval(tick); },
  };
}

/**
 * Lee el cuerpo como formulario (multipart) o como texto cortando en cuanto pasa de `maxBytes`, lleve o no
 * Content-Length (algún proxy la quita y entonces llega por trozos): nunca se acumula más que eso en memoria.
 * Lanza BodyTooLargeError si no cabe; con un cuerpo que no es un formulario válido, el error de siempre de formData().
 */
export async function readBodyLimited(req: Request, maxBytes: number, as: "formData", slow?: SlowGuardOptions): Promise<FormData>;
export async function readBodyLimited(req: Request, maxBytes: number, as: "text", slow?: SlowGuardOptions): Promise<string>;
export async function readBodyLimited(req: Request, maxBytes: number, as: "formData" | "text", slow: SlowGuardOptions = {}): Promise<FormData | string> {
  let received = 0;
  let exceeded = false;
  let tooSlow = false;
  let guard: ReturnType<typeof createSlowGuard> | null = null;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      guard = createSlowGuard(() => { tooSlow = true; controller.error(new UploadTooSlowError()); }, { ...slow, expectedBytes: Math.min(maxBytes, declaredLength(req.headers) ?? maxBytes) });
    },
    flush() { guard?.stop(); },
    transform(chunk, controller) {
      guard?.add(chunk.byteLength);
      received += chunk.byteLength;
      if (received > maxBytes) {
        exceeded = true;
        controller.error(new BodyTooLargeError(maxBytes));
      } else controller.enqueue(chunk);
    },
  });
  const limited = new Response(req.body ? req.body.pipeThrough(limiter) : null, { headers: { "content-type": req.headers.get("content-type") ?? "" } });
  try {
    return as === "formData" ? await limited.formData() : await limited.text();
  } catch (err) {
    if (tooSlow) throw new UploadTooSlowError();
    // formData() puede envolver el error del flujo en el suyo propio: lo que manda es si se superó el tope.
    if (exceeded) throw new BodyTooLargeError(maxBytes);
    throw err;
  }
  finally {
    (guard as ReturnType<typeof createSlowGuard> | null)?.stop();
  }
}
