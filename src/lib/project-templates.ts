// Plantillas de proyecto: esquemas de validación y ayudas puras (sin acceso a base de datos).
import "./zod-config";
import { z } from "zod";
import { COLUMN_ROLES, MAX_DESCRIPTION, MAX_RELEASE_TEMPLATES_PER_KIND, MAX_TEMPLATE, UNIQUE_COLUMN_ROLES, defaultColumns, PALETTE, type ColumnRoleValue } from "./constants";
import { POSITION_STEP } from "./positions";
import * as v from "./validation";
import { MAX_KIND_SUBTASKS } from "./kinds-special";
import { normalizeTaskFields, TASK_FIELDS, type TaskFieldKey } from "./task-fields";

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
  descriptionTemplate: z.string().max(MAX_DESCRIPTION, "El texto inicial es demasiado largo.").default(""),
  // Subtareas que se añaden al crear una tarea de este tipo.
  subtaskTemplate: z.array(z.string().trim().min(1).max(200, "Una subtarea es demasiado larga.")).max(MAX_KIND_SUBTASKS, `Máximo ${MAX_KIND_SUBTASKS} subtareas por tipo.`).default([]),
});

const templateReleaseSchema = z.object({
  kind: z.enum(["HEADER", "FOOTER"]),
  name: v.name.max(60, "Máximo 60 caracteres."),
  content: z.string().max(MAX_TEMPLATE, "La plantilla es demasiado larga.").default(""),
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
    // Campos opcionales de tarea que activa el proyecto nuevo (con una columna «Presupuesto» siempre va el coste).
    taskFields: z.array(z.enum(TASK_FIELDS)).max(TASK_FIELDS.length).default([]),
    // Cabeceras y pies de release del proyecto (hasta 20 de cada tipo).
    releaseTemplates: z.array(templateReleaseSchema).max(MAX_RELEASE_TEMPLATES_PER_KIND * 2).default([]),
  })
  .superRefine((t, ctx) => {
    if (!uniqueNames(t.columns)) ctx.addIssue({ code: "custom", message: "Hay columnas con el mismo nombre.", path: ["columns"] });
    if (!uniqueNames(t.kinds)) ctx.addIssue({ code: "custom", message: "Hay tipos propios con el mismo nombre.", path: ["kinds"] });
    if (!uniqueNames(t.labels)) ctx.addIssue({ code: "custom", message: "Hay etiquetas con el mismo nombre.", path: ["labels"] });
    for (const kind of ["HEADER", "FOOTER"] as const) {
      if (t.releaseTemplates.filter((r) => r.kind === kind).length > MAX_RELEASE_TEMPLATES_PER_KIND) {
        ctx.addIssue({ code: "custom", message: `Máximo ${MAX_RELEASE_TEMPLATES_PER_KIND} plantillas de release de cada tipo.`, path: ["releaseTemplates"] });
      }
    }
    for (const role of UNIQUE_COLUMN_ROLES) {
      if (t.columns.filter((c) => c.role === role).length > 1) {
        ctx.addIssue({ code: "custom", message: "Los roles «Siguiente salto» y «En producción» solo pueden usarse en una columna.", path: ["columns"] });
      }
    }
  })
  .transform((t) => ({ ...t, taskFields: templateTaskFields(t) }));

/** Campos opcionales que activa una plantilla: los elegidos (sin repetir) y el coste si hay una columna de presupuesto. */
export function templateTaskFields(t: { taskFields?: readonly string[]; columns: { role: string }[] }): TaskFieldKey[] {
  const keys = [...(t.taskFields ?? [])];
  if (t.columns.some((c) => c.role === "BUDGET")) keys.push("cost");
  return normalizeTaskFields(keys);
}

export type TemplateReleaseTemplate = z.output<typeof templateReleaseSchema>;
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
  /** Campos opcionales de tarea que se activan en el proyecto. */
  taskFields: TaskFieldKey[];
  /** Cabeceras y pies de release, con su posición dentro de cada tipo. */
  releaseTemplates: { kind: "HEADER" | "FOOTER"; name: string; content: string; position: number }[];
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
    taskFields: templateTaskFields({ taskFields: template.taskFields, columns }),
    releaseTemplates: (["HEADER", "FOOTER"] as const).flatMap((kind) =>
      (template.releaseTemplates ?? []).filter((r) => r.kind === kind).slice(0, MAX_RELEASE_TEMPLATES_PER_KIND).map((r, i) => ({ ...r, position: (i + 1) * POSITION_STEP })),
    ),
  };
}

/** Lee el JSON guardado en la base de datos y descarta lo que no cumpla el esquema. */
export function parseStoredTemplate(row: { id: string; name: string; description: string; columns: unknown; kinds: unknown; hiddenGeneralKinds: unknown; hideAllGeneralKinds?: unknown; labels: unknown; taskFields?: unknown; releaseTemplates?: unknown }): TemplateDto {
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
    releaseTemplates: list(templateReleaseSchema, row.releaseTemplates),
    taskFields: normalizeTaskFields(Array.isArray(row.taskFields) ? row.taskFields.filter((x): x is string => typeof x === "string") : []),
  };
}
