// Etiqueta de una entrada de deshacer: plantilla en español con {variables} que se traduce al
// idioma de quien la lee. Se guarda como JSON {"k": plantilla, "p": variables} en la columna
// `label` (300 caracteres como máximo); las entradas antiguas son texto español plano.
import { makeT, type T } from "@/i18n/core";

/** Plantilla traducible (clave = texto en español) con sus variables. */
export interface Label {
  k: string;
  p?: Params;
}
/**
 * Variable de una plantilla: texto o número tal cual (contenido del usuario, nunca se traduce),
 * una plantilla anidada (se traduce) o una lista de plantillas (traducidas y unidas con «, »).
 */
export type Param = string | number | Label | Label[];
export type Params = Record<string, Param>;

export const LABEL_MAX = 300;

const PLACEHOLDER = /\{(\w+)\}/g;

function isLabel(x: unknown): x is Label {
  return !!x && typeof x === "object" && !Array.isArray(x) && typeof (x as Label).k === "string";
}

/** ¿Los parámetros cubren todos los {huecos} de la plantilla? */
export function fitsTemplate(template: string, params: Record<string, unknown>): boolean {
  const names = [...template.matchAll(PLACEHOLDER)].map((m) => m[1]);
  return names.length > 0 && names.every((n) => n !== undefined && n in params);
}

function renderParam(p: Param, t: T): string | number {
  if (typeof p === "string" || typeof p === "number") return p;
  if (Array.isArray(p)) return p.map((l) => renderLabel(l, t)).join(", ");
  return renderLabel(p, t);
}

/** Texto de la etiqueta en el idioma de `t`. */
export function renderLabel(label: Label, t: T): string {
  const vars: Record<string, string | number> = {};
  for (const [name, p] of Object.entries(label.p ?? {})) vars[name] = renderParam(p, t);
  return t(label.k, vars);
}

/** Texto en español (el de los registros). */
export function renderLabelEs(label: Label): string {
  return renderLabel(label, makeT("es"));
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

function clipParam(p: Param, max: number): Param {
  if (typeof p === "string") return clip(p, max);
  if (typeof p === "number") return p;
  if (Array.isArray(p)) return p.map((l) => clipLabel(l, max));
  return clipLabel(p, max);
}

function clipLabel(l: Label, max: number): Label {
  if (!l.p) return l;
  return { k: l.k, p: Object.fromEntries(Object.entries(l.p).map(([n, p]) => [n, clipParam(p, max)])) };
}

/**
 * Serializa la etiqueta para la columna `label`. Si no cabe en 300 caracteres se acortan los
 * valores de las variables (nunca el JSON, que quedaría inválido).
 */
export function encodeLabel(label: Label): string {
  for (const max of [200, 100, 60, 40, 25, 15, 8, 3]) {
    const s = JSON.stringify(max === 200 ? label : clipLabel(label, max));
    if (s.length <= LABEL_MAX) return s;
  }
  // Plantilla sin variables que ya es enorme: no debería ocurrir; se guarda plano.
  return clip(renderLabelEs(label), LABEL_MAX);
}

/** Lee el valor guardado; null si es texto plano (entradas antiguas). */
export function decodeLabel(raw: string): Label | null {
  if (!raw.startsWith("{")) return null;
  try {
    const x: unknown = JSON.parse(raw);
    return isLabel(x) ? x : null;
  } catch {
    return null;
  }
}

/** Etiqueta guardada → texto en el idioma de `t` (el texto plano antiguo se muestra tal cual). */
export function renderStoredLabel(raw: string, t: T): string {
  const l = decodeLabel(raw);
  return l ? renderLabel(l, t) : raw;
}


/** «1 tarea» / «N tareas» como plantilla traducible. */
export function tasksN(n: number): Label {
  return n === 1 ? { k: "1 tarea" } : { k: "{n} tareas", p: { n } };
}

/** «1 subtarea» / «N subtareas» como plantilla traducible. */
export function subtasksN(n: number): Label {
  return n === 1 ? { k: "1 subtarea" } : { k: "{n} subtareas", p: { n } };
}
