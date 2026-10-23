// Plantillas de proyecto: esquemas de validación y ayudas puras (sin acceso a base de datos).
import "./zod-config";
import { z } from "zod";
import { COLUMN_ROLES, defaultColumns, PALETTE, type ColumnRoleValue } from "./constants";
import { POSITION_STEP } from "./positions";
import * as v from "./validation";
import { MAX_KIND_SUBTASKS } from "./kinds-special";

export const MAX_TEMPLATE_COLUMNS = 20;
export const MAX_TEMPLATE_KINDS = 30;
export const MAX_TEMPLATE_LABELS = 50;

/** Comparación de nombres sin distinguir mayúsculas ni espacios sobrantes. */
const nameKey = (s: string) => s.trim().toLowerCase();

function uniqueNames(items: { name: string }[]): boolean {
  return new Set(items.map((i) => nameKey(i.name))).size === items.length;
}

const itemName = v.name.max(40, "Máximo 40 caracteres.");

const templateColumnSchema = z.object({
  name: v.name,
  role: z.enum(COLUMN_ROLES),
  isDone: z.boolean(),
});

const templateKindSchema = z.object({
  name: itemName,
  color: v.hexColor,
  titleTemplate: z.string().trim().max(200, "El título automático es demasiado largo.").default(""),
  descriptionTemplate: z.string().max(5000, "El texto inicial es demasiado largo.").default(""),
  // Subtareas que se añaden al crear una tarea de este tipo.
  subtaskTemplate: z.array(z.string().trim().min(1).max(200, "Una subtarea es demasiado larga.")).max(MAX_KIND_SUBTASKS, `Máximo ${MAX_KIND_SUBTASKS} subtareas por tipo.`).default([]),
});

const templateLabelSchema = z.object({ name: itemName, color: z.enum(PALETTE) });

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
    // Oculta todos los tipos generales del proyecto nuevo, sean los que sean (para plantillas ajenas al software).
    hideAllGeneralKinds: z.boolean().default(false),
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
  /** Clave estable si es una plantilla incluida de serie (aunque se haya renombrado). */
  builtinKey?: string | null;
  /** Solo plantillas de serie: su contenido ya no coincide con el canónico (se puede restablecer). */
  builtinModified?: boolean;
}

/** Orden alfabético con la colación española (sin distinguir mayúsculas ni tildes; números por valor). */
export function sortTemplates<T extends { name: string }>(list: T[], locale: "es" | "en" = "es"): T[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  return [...list].sort((a, b) => collator.compare(a.name, b.name));
}

/** Resumen de una línea: «5 columnas · 2 tipos propios · 3 etiquetas · 1 general oculto». */
export function summarizeTemplate(t: Pick<TemplateData, "columns" | "kinds" | "labels" | "hiddenGeneralKinds"> & { hideAllGeneralKinds?: boolean }): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const parts = [
    n(t.columns.length, "columna", "columnas"),
    n(t.kinds.length, "tipo propio", "tipos propios"),
    n(t.labels.length, "etiqueta", "etiquetas"),
  ];
  if (t.hideAllGeneralKinds) parts.push("todos los generales ocultos");
  else if (t.hiddenGeneralKinds.length) parts.push(n(t.hiddenGeneralKinds.length, "general oculto", "generales ocultos"));
  return parts.join(" · ");
}

interface GeneralKind {
  id: string;
  name: string;
}

interface TemplateApplication {
  columns: { name: string; role: ColumnRoleValue; isDone: boolean; position: number }[];
  kinds: { name: string; color: string; titleTemplate: string; descriptionTemplate: string; subtaskTemplate: string[]; position: number }[];
  labels: { name: string; color: string }[];
  /** Ids de tipos generales que el proyecto no usará. */
  hiddenKindIds: string[];
}

/**
 * Datos a crear en un proyecto nuevo a partir de una plantilla. Los nombres de tipos generales
 * a ocultar se comparan sin distinguir mayúsculas y los inexistentes se ignoran. Si el proyecto
 * no tiene tipos propios nunca se ocultan todos los generales: se conserva el primero. Con
 * `hideAllGeneralKinds` se ocultan todos (salvo esa excepción), vengan o no en la lista de nombres.
 */
export function buildTemplateApplication(template: TemplateData, generalKinds: GeneralKind[], locale: "es" | "en" = "es"): TemplateApplication {
  const hiddenNames = new Set(template.hiddenGeneralKinds.map(nameKey));
  let hidden = template.hideAllGeneralKinds ? [...generalKinds] : generalKinds.filter((k) => hiddenNames.has(nameKey(k.name)));
  if (template.kinds.length === 0 && generalKinds.length > 0 && hidden.length >= generalKinds.length) {
    hidden = hidden.slice(1);
  }
  // Sin columnas (plantilla dañada): las de por defecto, para que el proyecto sea usable.
  const columns = template.columns.length ? template.columns : defaultColumns(locale);
  // Un tipo propio no puede llamarse como uno general (secciones repetidas en la release): se omite.
  const generalNames = new Set(generalKinds.map((k) => nameKey(k.name)));
  return {
    columns: columns.map((c, i) => ({ name: c.name, role: c.role, isDone: c.isDone, position: (i + 1) * POSITION_STEP })),
    kinds: template.kinds.filter((k) => !generalNames.has(nameKey(k.name))).map((k, i) => ({
      name: k.name,
      color: k.color,
      titleTemplate: k.titleTemplate,
      descriptionTemplate: k.descriptionTemplate,
      subtaskTemplate: k.subtaskTemplate,
      position: (i + 1) * POSITION_STEP,
    })),
    labels: template.labels.map((l) => ({ name: l.name, color: l.color })),
    hiddenKindIds: hidden.map((k) => k.id),
  };
}

/** Lee el JSON guardado en la base de datos y descarta lo que no cumpla el esquema. */
export function parseStoredTemplate(row: { id: string; name: string; description: string; columns: unknown; kinds: unknown; hiddenGeneralKinds: unknown; hideAllGeneralKinds?: unknown; labels: unknown }): TemplateDto {
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
    hideAllGeneralKinds: row.hideAllGeneralKinds === true,
    labels: list(templateLabelSchema, row.labels),
  };
}
