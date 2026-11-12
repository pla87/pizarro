// Formato de changelog.json y su sincronización con la tabla AppVersionLog.
import "./zod-config";
import { z } from "zod";
import type { Changes } from "./changelog-core";

const list = z.array(z.string()).default([]);
const changesSchema = z.object({ nuevas: list, mejoras: list, correcciones: list, tecnicos: list }) satisfies z.ZodType<Changes, unknown>;

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
