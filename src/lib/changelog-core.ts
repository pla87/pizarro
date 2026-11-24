// Categorías del changelog y su forma, sin zod: lo importa la página del changelog en el navegador (el esquema que
// valida changelog.json está en changelog.ts, solo en el servidor).

export const CHANGE_CATEGORIES = [
  { key: "nuevas", label: "Nuevas funcionalidades" },
  { key: "mejoras", label: "Mejoras" },
  { key: "correcciones", label: "Correcciones" },
  { key: "tecnicos", label: "Cambios técnicos / DB" },
] as const;

type ChangeCategory = (typeof CHANGE_CATEGORIES)[number]["key"];

/** Cambios de una versión por categoría. */
export type Changes = Record<ChangeCategory, string[]>;

/** Una versión tal como la pinta el Historial de versiones (ya en el idioma de quien la ve). */
export interface ChangelogVersion {
  id: string;
  version: string;
  releasedAt: string;
  summary: string;
  changes: Changes;
}

/** Versiones que la página pinta de entrada; las anteriores se piden con «Ver más», al buscar o al abrir el enlace de una. */
export const CHANGELOG_FIRST_PAGE = 10;

/** Ancla de una versión en la página (`/changelog#v1.2.3`). */
export function versionAnchor(version: string): string {
  return `v${version}`;
}

/** Versión de un ancla `#v1.2.3` (con o sin «#»), o null si no lo es. */
export function versionFromHash(hash: string): string | null {
  const m = /^#?v(\d+\.\d+\.\d+)$/.exec(hash);
  return m ? m[1]! : null;
}

/** Orden de más reciente a más antigua (SemVer). */
export function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  return 0;
}
