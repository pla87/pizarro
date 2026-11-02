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

/**
 * Lee el cuerpo como formulario (multipart) o como texto cortando en cuanto pasa de `maxBytes`, lleve o no
 * Content-Length (algún proxy la quita y entonces llega por trozos): nunca se acumula más que eso en memoria.
 * Lanza BodyTooLargeError si no cabe; con un cuerpo que no es un formulario válido, el error de siempre de formData().
 */
export async function readBodyLimited(req: Request, maxBytes: number, as: "formData"): Promise<FormData>;
export async function readBodyLimited(req: Request, maxBytes: number, as: "text"): Promise<string>;
export async function readBodyLimited(req: Request, maxBytes: number, as: "formData" | "text"): Promise<FormData | string> {
  let received = 0;
  let exceeded = false;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
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
    // formData() puede envolver el error del flujo en el suyo propio: lo que manda es si se superó el tope.
    if (exceeded) throw new BodyTooLargeError(maxBytes);
    throw err;
  }
}
