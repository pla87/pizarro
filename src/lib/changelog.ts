// Formato de changelog.json y su sincronización con la tabla AppVersionLog.
import { z } from "zod";

export const CHANGE_CATEGORIES = [
  { key: "nuevas", label: "Nuevas funcionalidades" },
  { key: "mejoras", label: "Mejoras" },
  { key: "correcciones", label: "Correcciones" },
  { key: "tecnicos", label: "Cambios técnicos / DB" },
] as const;

const list = z.array(z.string()).default([]);
export const changesSchema = z.object({ nuevas: list, mejoras: list, correcciones: list, tecnicos: list });
export type Changes = z.infer<typeof changesSchema>;

export const changelogSchema = z.object({
  versions: z.array(
    z.object({
      version: z.string().regex(/^\d+\.\d+\.\d+$/, "Versión SemVer no válida"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha YYYY-MM-DD no válida"),
      /** Momento del lanzamiento (ISO con zona); las versiones antiguas pueden no tenerlo. */
      releasedAt: z.string().datetime({ offset: true }).optional(),
      summary: z.string().default(""),
      changes: changesSchema,
      /** Traducción al inglés (opcional). */
      en: z.object({ summary: z.string().default(""), changes: changesSchema }).optional(),
    }),
  ),
});

export function parseChanges(value: unknown): Changes {
  const parsed = changesSchema.safeParse(value);
  return parsed.success ? parsed.data : { nuevas: [], mejoras: [], correcciones: [], tecnicos: [] };
}
