// Subidas de archivos en curso. Cada una se lee entera en memoria (hasta el tope del proyecto) y se procesa con
// sharp, así que se limitan las simultáneas en todo el servidor (como los huecos de ZIP de release-zip.ts).

const slots = ((globalThis as unknown as { __pzUploadSlots?: { active: number } }).__pzUploadSlots ??= { active: 0 });
export const MAX_UPLOADS_AT_ONCE = 3;

/** Reserva un hueco de subida; null si ya hay MAX_UPLOADS_AT_ONCE en curso. Llama a la función devuelta al terminar. */
export function acquireUploadSlot(): (() => void) | null {
  if (slots.active >= MAX_UPLOADS_AT_ONCE) return null;
  slots.active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    slots.active--;
  };
}

/** Longitud declarada del cuerpo; null si falta o no es un entero válido (la subida exige Content-Length). */
export function declaredLength(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw);
}
