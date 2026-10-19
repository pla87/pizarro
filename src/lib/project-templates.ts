// Plantillas de proyecto: esquemas de validación y ayudas puras (sin acceso a base de datos).
import { z } from "zod";
import { COLUMN_ROLES, DEFAULT_COLUMNS, PALETTE, type ColumnRoleValue } from "./constants";
import { POSITION_STEP } from "./positions";
import * as v from "./validation";

export const MAX_TEMPLATE_COLUMNS = 20;
export const MAX_TEMPLATE_KINDS = 30;
export const MAX_TEMPLATE_LABELS = 50;

/** Comparación de nombres sin distinguir mayúsculas ni espacios sobrantes. */
export const nameKey = (s: string) => s.trim().toLowerCase();

function uniqueNames(items: { name: string }[]): boolean {
  return new Set(items.map((i) => nameKey(i.name))).size === items.length;
}

const itemName = v.name.max(40, "Máximo 40 caracteres.");

export const templateColumnSchema = z.object({
  name: v.name,
  role: z.enum(COLUMN_ROLES),
  isDone: z.boolean(),
});

export const templateKindSchema = z.object({
  name: itemName,
  color: v.hexColor,
  titleTemplate: z.string().trim().max(200, "El título automático es demasiado largo.").default(""),
  descriptionTemplate: z.string().max(5000, "El texto inicial es demasiado largo.").default(""),
});

export const templateLabelSchema = z.object({ name: itemName, color: z.enum(PALETTE) });

/** Forma de los datos de una plantilla (lo que se guarda y lo que edita el administrador). */
export const templateInputSchema = z
  .object({
    name: v.name,
    description: z.string().trim().max(500, "Máximo 500 caracteres.").default(""),
    columns: z
      .array(templateColumnSchema)
      .min(1, "Debe haber al menos una columna.")
      .max(MAX_TEMPLATE_COLUMNS, `Máximo ${MAX_TEMPLATE_COLUMNS} columnas.`),
    kinds: z.array(templateKindSchema).max(MAX_TEMPLATE_KINDS, `Máximo ${MAX_TEMPLATE_KINDS} tipos propios.`),
    hiddenGeneralKinds: z.array(v.name).max(100),
    labels: z.array(templateLabelSchema).max(MAX_TEMPLATE_LABELS, `Máximo ${MAX_TEMPLATE_LABELS} etiquetas.`),
  })
  .superRefine((t, ctx) => {
    if (!uniqueNames(t.columns)) ctx.addIssue({ code: "custom", message: "Hay columnas con el mismo nombre.", path: ["columns"] });
    if (!uniqueNames(t.kinds)) ctx.addIssue({ code: "custom", message: "Hay tipos propios con el mismo nombre.", path: ["kinds"] });
    if (!uniqueNames(t.labels)) ctx.addIssue({ code: "custom", message: "Hay etiquetas con el mismo nombre.", path: ["labels"] });
    for (const role of COLUMN_ROLES) {
      if (role !== "NONE" && t.columns.filter((c) => c.role === role).length > 1) {
        ctx.addIssue({ code: "custom", message: "Cada rol especial solo puede usarse en una columna.", path: ["columns"] });
      }
    }
  });

export type TemplateInput = z.input<typeof templateInputSchema>;
export type TemplateData = z.output<typeof templateInputSchema>;

/** Plantilla tal y como la usa la interfaz. */
export interface TemplateDto extends TemplateData {
  id: string;
}

/** Resumen de una línea: «5 columnas · 2 tipos propios · 3 etiquetas · 1 general oculto». */
export function summarizeTemplate(t: Pick<TemplateData, "columns" | "kinds" | "labels" | "hiddenGeneralKinds">): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const parts = [
    n(t.columns.length, "columna", "columnas"),
    n(t.kinds.length, "tipo propio", "tipos propios"),
    n(t.labels.length, "etiqueta", "etiquetas"),
  ];
  if (t.hiddenGeneralKinds.length) parts.push(n(t.hiddenGeneralKinds.length, "general oculto", "generales ocultos"));
  return parts.join(" · ");
}

export interface GeneralKind {
  id: string;
  name: string;
}

export interface TemplateApplication {
  columns: { name: string; role: ColumnRoleValue; isDone: boolean; position: number }[];
  kinds: { name: string; color: string; titleTemplate: string; descriptionTemplate: string; position: number }[];
  labels: { name: string; color: string }[];
  /** Ids de tipos generales que el proyecto no usará. */
  hiddenKindIds: string[];
}

/**
 * Datos a crear en un proyecto nuevo a partir de una plantilla. Los nombres de tipos generales
 * a ocultar se comparan sin distinguir mayúsculas y los inexistentes se ignoran. Si el proyecto
 * no tiene tipos propios nunca se ocultan todos los generales: se conserva el primero.
 */
export function buildTemplateApplication(template: TemplateData, generalKinds: GeneralKind[]): TemplateApplication {
  const hiddenNames = new Set(template.hiddenGeneralKinds.map(nameKey));
  let hidden = generalKinds.filter((k) => hiddenNames.has(nameKey(k.name)));
  if (template.kinds.length === 0 && generalKinds.length > 0 && hidden.length >= generalKinds.length) {
    hidden = hidden.slice(1);
  }
  // Sin columnas (plantilla dañada): las de por defecto, para que el proyecto sea usable.
  const columns = template.columns.length ? template.columns : DEFAULT_COLUMNS;
  // Un tipo propio no puede llamarse como uno general (secciones repetidas en la release): se omite.
  const generalNames = new Set(generalKinds.map((k) => nameKey(k.name)));
  return {
    columns: columns.map((c, i) => ({ name: c.name, role: c.role, isDone: c.isDone, position: (i + 1) * POSITION_STEP })),
    kinds: template.kinds.filter((k) => !generalNames.has(nameKey(k.name))).map((k, i) => ({
      name: k.name,
      color: k.color,
      titleTemplate: k.titleTemplate,
      descriptionTemplate: k.descriptionTemplate,
      position: (i + 1) * POSITION_STEP,
    })),
    labels: template.labels.map((l) => ({ name: l.name, color: l.color })),
    hiddenKindIds: hidden.map((k) => k.id),
  };
}

/** Lee el JSON guardado en la base de datos y descarta lo que no cumpla el esquema. */
export function parseStoredTemplate(row: { id: string; name: string; description: string; columns: unknown; kinds: unknown; hiddenGeneralKinds: unknown; labels: unknown }): TemplateDto {
  const parsed = templateInputSchema.safeParse(row);
  if (parsed.success) return { id: row.id, ...parsed.data };
  // Datos corruptos: se devuelve lo que se pueda leer sin romper el listado.
  const list = <T,>(s: z.ZodType<T>, raw: unknown): T[] =>
    Array.isArray(raw) ? raw.flatMap((x) => { const r = s.safeParse(x); return r.success ? [r.data] : []; }) : [];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    columns: list(templateColumnSchema, row.columns),
    kinds: list(templateKindSchema, row.kinds),
    hiddenGeneralKinds: list(v.name, row.hiddenGeneralKinds),
    labels: list(templateLabelSchema, row.labels),
  };
}
