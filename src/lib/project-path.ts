/**
 * Ruta equivalente al cambiar de proyecto: se queda en el mismo tipo de página (tablero, releases, ajustes…).
 * Función pura: se usa en todos los selectores de proyecto.
 */

/** Parámetros de consulta que valen para cualquier proyecto (el resto, p. ej. ?task=, referencia ids del anterior). */
const KEEP_PARAMS: Record<string, readonly string[]> = {
  "": ["archivadas"],
  releases: ["q"],
  // La pestaña activa; si no existe para el usuario en el destino, los ajustes abren la primera disponible.
  settings: ["tab"],
};

/** Secciones de /p/[projectId]/… que existen en el proyecto de destino. */
const SECTIONS = new Set(["releases", "settings", "docs"]);

export interface SwitchProjectOptions {
  /** Si el usuario puede abrir los ajustes del proyecto de destino; si no, se va al tablero. */
  canOpenSettings?: boolean;
}

/**
 * @param pathname ruta actual (p. ej. `/p/abc/settings`); si no es de un proyecto se devuelve el tablero del destino.
 * @param search query actual, con o sin `?` inicial.
 */
export function projectSwitchPath(pathname: string, search: string, targetId: string, options: SwitchProjectOptions = {}): string {
  const board = `/p/${targetId}`;
  const m = /^\/p\/[^/]+(?:\/([^/?#]+))?/.exec(pathname);
  const section = m?.[1] ?? "";
  // Secciones desconocidas (o rutas ajenas a un proyecto): tablero.
  if (section && !SECTIONS.has(section)) return board;
  if (section === "settings" && options.canOpenSettings === false) return board;
  // Un id de release u otra subruta más profunda se descarta: vale el índice de la sección.
  const base = section ? `${board}/${section}` : board;
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  const keep = new URLSearchParams();
  for (const key of KEEP_PARAMS[section] ?? []) {
    const value = params.get(key);
    if (value !== null) keep.set(key, value);
  }
  const qs = keep.toString();
  return qs ? `${base}?${qs}` : base;
}
