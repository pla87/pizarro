// Subidas de archivos en curso. Cada una se lee entera en memoria (hasta el tope del proyecto) y se procesa con
// sharp, así que se limitan las simultáneas en todo el servidor (como los huecos de ZIP de release-zip.ts).

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
