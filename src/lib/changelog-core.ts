// Categorías del changelog y su forma, sin zod: lo importa la página del changelog en el navegador (el esquema que
// valida changelog.json está en changelog.ts, solo en el servidor).

export const CHANGE_CATEGORIES = [
  { key: "nuevas", label: "Nuevas funcionalidades" },
  { key: "mejoras", label: "Mejoras" },
  { key: "correcciones", label: "Correcciones" },
  { key: "tecnicos", label: "Cambios técnicos / DB" },
] as const;

export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number]["key"];

/** Cambios de una versión por categoría. */
export type Changes = Record<ChangeCategory, string[]>;
