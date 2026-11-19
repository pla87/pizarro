// Quién ha usado la app hace poco (cualquier petición con sesión y cada subida), en memoria del proceso: basta con una
// sola instancia. Lo usa el reparto de huecos de subida (upload-slots.ts) para saber si hay más de una persona activa.
// Sin consultas a la base: lo anota la propia carga de la sesión (session.ts) y acquireUploadSlot.

export const ACTIVE_WINDOW_MS = 5 * 60_000;

const seen = ((globalThis as unknown as { __pzUserActivity?: Map<string, number> }).__pzUserActivity ??= new Map());

/** Anota actividad del usuario (no retrocede si llega una marca más antigua). */
export function noteUserActivity(userId: string, at = Date.now()): void {
  const prev = seen.get(userId);
  if (prev === undefined || at > prev) seen.set(userId, at);
}

/**
 * Usuarios con actividad en los últimos 5 minutos, con el momento en que caduca cada uno. Quita del mapa los caducados
 * (así no crece sin límite).
 */
export function recentlyActiveUsers(now = Date.now()): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, at] of seen) {
    if (now - at >= ACTIVE_WINDOW_MS) seen.delete(id);
    else out.set(id, at + ACTIVE_WINDOW_MS);
  }
  return out;
}

/** Solo para las pruebas: olvida toda la actividad anotada. */
export function forgetUserActivity(): void {
  seen.clear();
}
