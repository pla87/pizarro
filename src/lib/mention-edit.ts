// Edición de texto con menciones «bonitas»: en la caja se ve «@Ana» y el id de la persona va aparte (en `mentions`),
// así que el texto que se guarda sigue siendo el de siempre, @[Ana](user:ID). Funciones puras: las usa MentionTextarea
// y se prueban sin navegador.
import { mentionToken, splitMentions } from "./mentions";

/** Mención dentro del texto visible: `text.slice(start, end)` es exactamente `@${name}`. */
export interface MentionSpan {
  start: number;
  end: number;
  id: string;
  name: string;
}

/** Texto tal como se ve en la caja y las menciones que contiene (ordenadas y sin solaparse). */
export interface MentionModel {
  text: string;
  mentions: MentionSpan[];
}

/** @[Ana](user:x) hola → { text: "@Ana hola", mentions: [{ 0, 4, x, Ana }] }. */
export function modelFromRaw(raw: string): MentionModel {
  let text = "";
  const mentions: MentionSpan[] = [];
  for (const part of splitMentions(raw)) {
    if (typeof part === "string") text += part;
    else {
      const shown = `@${part.name}`;
      mentions.push({ start: text.length, end: text.length + shown.length, id: part.id, name: part.name });
      text += shown;
    }
  }
  return { text, mentions };
}

/** Texto para guardar: cada mención vuelve a ser @[Nombre](user:ID). */
export function modelToRaw(model: MentionModel): string {
  let out = "";
  let last = 0;
  for (const m of model.mentions) {
    out += model.text.slice(last, m.start) + mentionToken(m.name, m.id);
    last = m.end;
  }
  return out + model.text.slice(last);
}

/** Trozo [start, end) del texto visible en formato guardado (copiar y cortar conservan las menciones enteras). */
export function sliceToRaw(model: MentionModel, start: number, end: number): string {
  const mentions = model.mentions
    .filter((m) => m.start >= start && m.end <= end)
    .map((m) => ({ ...m, start: m.start - start, end: m.end - start }));
  return modelToRaw({ text: model.text.slice(start, end), mentions });
}

/** ¿Hay alguna mención entera dentro de [start, end)? */
export function hasMentionIn(model: MentionModel, start: number, end: number): boolean {
  return model.mentions.some((m) => m.start >= start && m.end <= end);
}

/**
 * Tramo que cambió entre dos textos: [from, toPrev) en el anterior pasa a ser [from, toNext) en el nuevo. Con `caret`
 * (el cursor tras el cambio, que queda al final de lo escrito) se resuelven los casos ambiguos: escribir una «n» dentro
 * de «@Ann» da el mismo texto que escribirla detrás, pero el cursor dice dónde fue.
 */
export function changedRange(prev: string, next: string, caret?: number): { from: number; toPrev: number; toNext: number } {
  const max = Math.min(prev.length, next.length);
  let suffix = 0;
  const suffixLimit = caret === undefined ? max : Math.min(max, Math.max(0, next.length - caret));
  while (suffix < suffixLimit && prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  let prefix = 0;
  while (prefix < max - suffix && prev[prefix] === next[prefix]) prefix++;
  return { from: prefix, toPrev: prev.length - suffix, toNext: next.length - suffix };
}

/**
 * El texto visible cambió (tecla, pegado, dictado, deshacer del navegador…): las menciones de antes del cambio se
 * quedan, las de después se desplazan y las que el cambio toca dejan de ser menciones (queda su texto, sin id).
 */
export function applyTextChange(model: MentionModel, next: string, caret?: number): MentionModel {
  if (model.text === next) return model;
  const { from, toPrev, toNext } = changedRange(model.text, next, caret);
  const delta = toNext - toPrev;
  const mentions: MentionSpan[] = [];
  for (const m of model.mentions) {
    const insertion = from === toPrev;
    if (insertion ? from <= m.start : toPrev <= m.start) mentions.push({ ...m, start: m.start + delta, end: m.end + delta });
    else if (from >= m.end) mentions.push(m);
    // Si no, el cambio cae dentro de la mención (o la pisa): se queda como texto normal.
  }
  return { text: next, mentions };
}

/** Añade menciones ya colocadas en el texto (al elegir una persona o al pegar), si su texto coincide y no se solapan. */
export function addMentions(model: MentionModel, spans: MentionSpan[]): MentionModel {
  const mentions = [...model.mentions];
  for (const s of spans) {
    if (model.text.slice(s.start, s.end) !== `@${s.name}`) continue;
    if (mentions.some((m) => m.start < s.end && s.start < m.end)) continue;
    mentions.push(s);
  }
  mentions.sort((a, b) => a.start - b.start);
  return { text: model.text, mentions };
}

/** Sustituye [start, end) del texto visible por `insert` (texto con menciones en formato guardado). */
export function replaceRange(model: MentionModel, start: number, end: number, insertRaw: string): { model: MentionModel; caret: number } {
  const ins = modelFromRaw(insertRaw);
  const next = applyTextChange(model, model.text.slice(0, start) + ins.text + model.text.slice(end), start + ins.text.length);
  return { model: addMentions(next, ins.mentions.map((m) => ({ ...m, start: m.start + start, end: m.end + start }))), caret: start + ins.text.length };
}

/**
 * Si el texto visible contiene algo con forma de mención guardada (alguien pegó o escribió «@[Ana](user:x)»), se
 * convierte en mención: es lo que acabaría siendo al guardarlo. Devuelve el mismo objeto si no hay nada que convertir.
 */
export function normalizeModel(model: MentionModel): MentionModel {
  const again = modelFromRaw(modelToRaw(model));
  return again.text === model.text ? model : again;
}

/** Mención que acaba justo en `pos` (Retroceso) o que empieza en `pos` (Supr): se borra entera. */
export function mentionTouching(model: MentionModel, pos: number, dir: "backward" | "forward"): MentionSpan | undefined {
  return model.mentions.find((m) => (dir === "backward" ? m.end === pos : m.start === pos));
}

/** Iguales (mismo texto y mismas menciones). */
export function sameModel(a: MentionModel, b: MentionModel): boolean {
  return a.text === b.text && a.mentions.length === b.mentions.length && a.mentions.every((m, i) => {
    const o = b.mentions[i]!;
    return m.start === o.start && m.end === o.end && m.id === o.id && m.name === o.name;
  });
}
