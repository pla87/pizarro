// Subidas de archivos en curso. Cada una se lee entera en memoria y se procesa con sharp, así que se limitan las
// simultáneas en todo el servidor (como los huecos de ZIP de release-zip.ts). El cuerpo se lee con readBodyLimited, que
// corta en cuanto supera el tope del proyecto (también sin Content-Length): las rutas de subida no pasan por el proxy
// de Next (src/proxy.ts), así que nadie más pone un techo a lo que se recibe.

const slots = ((globalThis as unknown as { __pzUploadSlots?: { active: number; waiting: (() => void)[] } }).__pzUploadSlots ??= { active: 0, waiting: [] });
export const MAX_UPLOADS_AT_ONCE = 3;
/** Cuánto espera una subida a que quede un hueco antes de rendirse (varias a la vez de una misma persona hacen cola). */
const WAIT_MS = 60_000;

function release() {
  const next = slots.waiting.shift();
  if (next) next(); // el hueco pasa directamente a la siguiente en cola
  else slots.active--;
}

/**
 * Reserva un hueco de subida; si ya hay MAX_UPLOADS_AT_ONCE en curso, espera en cola hasta `waitMs`.
 * Devuelve la función que lo libera, o null si no quedó hueco a tiempo.
 */
export async function acquireUploadSlot(waitMs = WAIT_MS): Promise<(() => void) | null> {
  if (slots.active < MAX_UPLOADS_AT_ONCE) slots.active++;
  else {
    const got = await new Promise<boolean>((resolve) => {
      const turn = () => { clearTimeout(timer); resolve(true); };
      const timer = setTimeout(() => {
        const i = slots.waiting.indexOf(turn);
        if (i >= 0) slots.waiting.splice(i, 1);
        resolve(false);
      }, waitMs);
      slots.waiting.push(turn);
    });
    if (!got) return null;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
  };
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
