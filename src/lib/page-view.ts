// Visitas de página: los refrescos automáticos del tablero (cada 2 min, en cada pestaña) repiten la misma visita, así
// que se anota una por persona y página cada PAGE_VIEW_DEDUP_MS. La memoria tiene tope duro: la ruta de la clave va
// recortada (la cabecera admite hasta 16 KB) y, al pasar de PAGE_VIEW_MAX_KEYS, se olvida la anotada hace más tiempo
// (como mucho, una visita de más en Logs).

export const PAGE_VIEW_DEDUP_MS = 15 * 60_000;
export const PAGE_VIEW_MAX_KEYS = 5000;
/** Caracteres de la ruta que cuentan para la clave (el log guarda hasta 500). */
export const PAGE_VIEW_KEY_PATH_MAX = 300;

/** ¿Toca anotar la visita de `userId` a `path`? Si sí, la recuerda desde `now`. */
export function pageViewDue(state: Map<string, number>, userId: string, path: string, now: number): boolean {
  const key = `${userId} ${path.slice(0, PAGE_VIEW_KEY_PATH_MAX)}`;
  const prev = state.get(key);
  if (prev !== undefined && now - prev < PAGE_VIEW_DEDUP_MS) return false;
  // Al final del Map (orden de inserción = orden de anotación): las más antiguas son las primeras en olvidarse.
  state.delete(key);
  state.set(key, now);
  if (state.size > PAGE_VIEW_MAX_KEYS) state.delete(state.keys().next().value!);
  return true;
}
