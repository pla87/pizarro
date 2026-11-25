/** Automatización por tipo de tarea: al elegir el tipo se fija el título y/o se antepone un texto a la descripción. */
import { esT, type T } from "@/i18n/shared";
import { cutText } from "./graphemes";

interface KindAutomation {
  titleTemplate: string;
  descriptionTemplate: string;
}

/**
 * Título y descripción resultantes de aplicar la automatización del tipo
 * (título fijo y texto inicial en la descripción, sin duplicarlo); null si el tipo no tiene.
 */
function applyKindTemplate(
  kind: KindAutomation,
  current: { title: string; description: string },
): { title: string; description: string } | null {
  const titleTpl = kind.titleTemplate.trim();
  const descTpl = kind.descriptionTemplate.trim();
  if (!titleTpl && !descTpl) return null;
  let description = current.description;
  // Lo que ya había va tras una línea en blanco: así se distingue de una respuesta escrita en la última línea del
  // formulario, que va pegada a su etiqueta (ver switchKindDescription).
  if (descTpl && !description.trimStart().startsWith(descTpl)) {
    description = description.trim() ? `${descTpl}\n\n${description}` : `${descTpl}\n`;
  }
  return { title: titleTpl || current.title, description };
}

/** Máximo de subtareas por plantilla de tipo y por tarea nueva (el de createTask). */
export const MAX_KIND_SUBTASKS = 50;
const MAX_SUBTASK_LEN = 200;

const sameSubtask = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Texto de un cuadro de varias líneas → subtareas: recorta, descarta vacías y repetidas, respeta el máximo. */
export function parseSubtaskLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const title = cutText(line.trim(), MAX_SUBTASK_LEN).trimEnd();
    if (title && !out.some((x) => sameSubtask(x, title))) out.push(title);
    if (out.length >= MAX_KIND_SUBTASKS) break;
  }
  return out;
}

/** Añade al final las subtareas de la plantilla que aún no estén (sin distinguir mayúsculas), hasta el máximo. */
function mergeSubtasks(current: string[], template: string[]): string[] {
  const out = [...current];
  for (const raw of template) {
    const title = raw.trim().slice(0, MAX_SUBTASK_LEN);
    if (title && out.length < MAX_KIND_SUBTASKS && !out.some((x) => sameSubtask(x, title))) out.push(title);
  }
  return out;
}

function short(text: string, max = 60): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/** Una línea breve en español que explica la automatización del tipo; null si no tiene. */
export function describeKindAutomation(kind: KindAutomation, t: T = esT): string | null {
  const title = kind.titleTemplate.trim();
  const desc = kind.descriptionTemplate.trim();
  if (title && desc) return t("Al elegirlo, el título empieza por «{title}» y la descripción, por «{desc}».", { title: short(title), desc: short(desc) });
  if (title) return t("Al elegirlo, el título empieza por «{title}».", { title: short(title) });
  if (desc) return t("Al elegirlo, la descripción empieza por «{desc}».", { desc: short(desc) });
  return null;
}

// --- Cambiar de tipo con la plantilla del anterior puesta ---
// Lo que sigue tal como lo puso el tipo anterior (su prefijo en el título, su texto al principio de la descripción, sus
// subtareas) se sustituye por lo del tipo nuevo; lo que la persona ha escrito o cambiado se conserva y la plantilla del
// nuevo se añade sin duplicar. Antes se acumulaba: «Permisos y licencias» y luego «Presupuesto» dejaba los dos
// formularios en la descripción y las seis subtareas. No guarda estado: se deduce comparando con la plantilla del tipo
// anterior, así que vale igual en «Nueva tarea», con un borrador recuperado y en el detalle de una tarea ya creada.

interface KindTemplate extends KindAutomation {
  subtaskTemplate: readonly string[];
}

/** Título sin el prefijo del tipo `prev` (lo que va detrás, sin espacios); null si no empieza por él. */
function titleWithoutPrefix(prev: KindAutomation | null | undefined, title: string): string | null {
  const prefix = prev?.titleTemplate.trim() ?? "";
  if (!prefix || !title.startsWith(prefix)) return null;
  const rest = title.slice(prefix.length);
  // «Comprar» no es el prefijo de «Comprarlo todo»: detrás tiene que acabar la palabra (o el prefijo, en «:», «-»…).
  if (rest && !/^\s/.test(rest) && /[\p{L}\p{N}]$/u.test(prefix)) return null;
  return rest.trim();
}

/**
 * Título al pasar del tipo `prev` (el que tenía; null si ninguno) a `next`. Lo escrito no se pierde nunca: el prefijo del
 * anterior se cambia por el del nuevo (o se quita, si el nuevo no tiene) y, si el título no lo llevaba, el del nuevo se
 * pone delante («Leche y pan» → «Comprar Leche y pan»). Si solo queda el prefijo, va con un espacio detrás para seguir
 * escribiendo («Comprar pan» y no «Comprarpan», que ya no se reconocería como prefijo): el espacio sobrante se quita al
 * guardar. `known` (los tipos del proyecto): si el título no empieza por el prefijo del anterior pero sí por el de otro
 * tipo que acaba en signo («Cita:», quedó de un cambio anterior), también se quita; así no se acumulan («Gestionar Cita:
 * …»). Uno que acaba en palabra («Comprar») solo se quita si es del tipo anterior: pudo escribirlo la persona.
 */
export function switchKindTitle(prev: KindAutomation | null | undefined, next: KindAutomation, title: string, known: readonly KindAutomation[] = []): string {
  const prefix = next.titleTemplate.trim();
  // El mismo tipo otra vez (pulsar el ya elegido): no se toca lo que haya.
  if (prev && prev.titleTemplate.trim() === prefix) return title;
  const join = (text: string) => (text ? `${prefix} ${text}` : `${prefix} `);
  let rest = titleWithoutPrefix(prev, title);
  // Ya empieza por el prefijo del nuevo (escrito a mano o de antes): se queda como está.
  if (rest === null && prefix && titleWithoutPrefix(next, title) !== null) return title;
  // Otro prefijo conocido del proyecto (el más largo primero: «Cita previa:» antes que «Cita»).
  if (rest === null) {
    // Solo los que acaban en signo («Cita:», «Bug -»): uno que acaba en palabra («Comprar», «Gestionar») pudo escribirlo
    // la persona («Comprar regalo de Ana» en una tarea de Casa) y solo se quita si es el del tipo anterior, arriba.
    const others = known
      .map((k) => k.titleTemplate.trim())
      .filter((p) => p && p !== prefix && !/[\p{L}\p{N}]$/u.test(p))
      .sort((a, b) => b.length - a.length);
    for (const p of others) {
      rest = titleWithoutPrefix({ titleTemplate: p, descriptionTemplate: "" }, title);
      if (rest !== null) break;
    }
  }
  // Con el prefijo de otro tipo: se cambia por el del nuevo y se conserva lo escrito detrás; si el nuevo no tiene, se quita
  // («Comprar renovar pasaporte» pasa a «renovar pasaporte» al ir a «Casa»; antes se quedaba y, al elegir luego
  // «Papeleo», salía «Gestionar Comprar renovar pasaporte»).
  if (rest !== null) return prefix ? join(rest) : rest;
  if (!prefix) return title;
  return join(title.trim());
}

const BOLD_LABEL = /^\*\*[^*\n]+\*\*/;
/** Una viñeta o casilla sin texto («- », «* [ ]», «1.»): el hueco de una lista en la plantilla, no una etiqueta. */
export const BARE_MARKER = /^(?:[-*+](?:\s*\[\s?\])?|\d+[.)])$/;

/** Etiqueta de una línea de formulario: la parte en negrita del principio («**Plazo:** [fecha]» → «**Plazo:**») o la línea. */
function formAnchor(line: string): string {
  return BOLD_LABEL.exec(line)?.[0] ?? line;
}

/** ¿Empieza `line` por la etiqueta `anchor`? También si la respuesta se escribió dentro de la negrita («**Plazo: lunes**»). */
function lineHasAnchor(line: string, anchor: string): boolean {
  const l = line.trimStart();
  if (l.startsWith(anchor)) return true;
  return anchor.startsWith("**") && anchor.endsWith("**") && anchor.length > 4 && l.startsWith(anchor.slice(0, -2));
}

/** Etiqueta comparable entre tipos: sin negritas, espacios ni mayúsculas («**Qué hay que hacer:**» = «Qué hay que hacer:»). */
const anchorKey = (anchor: string) => anchor.replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Mismo texto de formulario: sin contar espacios ni las viñetas vacías (el editor con barra las guarda como «-» o «- »). */
const sameForm = (a: string, b: string) => {
  const norm = (s: string) => s.split("\n").filter((l) => !BARE_MARKER.test(l.trim())).join(" ").replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
};

/** ¿Empieza en `i` un párrafo de `lines` (una línea con texto tras una en blanco, o la primera)? */
const startsParagraph = (lines: readonly string[], i: number) => !!lines[i]!.trim() && (i === 0 || !lines[i - 1]!.trim());

/** Línea donde empieza el párrafo número `k + 1` de `lines` (lines.length si no hay tantos). */
function afterParagraphs(lines: readonly string[], k: number): number {
  let seen = 0;
  for (let i = 0; i < lines.length; i++) if (startsParagraph(lines, i) && ++seen > k) return i;
  return lines.length;
}

interface FormBlock {
  /** Líneas de la plantilla que ocupa: de la etiqueta a la última con texto antes de la siguiente etiqueta. */
  start: number;
  end: number;
  anchor: string;
  key: string;
  /** El apartado tal como viene en la plantilla (la etiqueta y, p. ej., la viñeta vacía de debajo). */
  text: string;
  paragraphs: number;
}

/**
 * Los apartados de una plantilla. Las etiquetas son las líneas que empiezan en negrita («**Plazo:**»); lo que vaya debajo
 * sin negrita («- », «[nombre]») es parte del apartado de encima. En una plantilla sin negritas (o antes de la primera),
 * cada línea con texto es una etiqueta, salvo las viñetas vacías.
 */
function formBlocks(tpl: string): { lines: string[]; blocks: FormBlock[] } {
  const lines = tpl.replace(/\r\n?/g, "\n").split("\n");
  const blocks: FormBlock[] = [];
  let bold = false;
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (!l) return;
    const isBold = BOLD_LABEL.test(l);
    bold ||= isBold;
    if (isBold || (!bold && !BARE_MARKER.test(l))) {
      const anchor = formAnchor(l);
      blocks.push({ start: i, end: i + 1, anchor, key: anchorKey(anchor), text: "", paragraphs: 0 });
    } else if (blocks.length) blocks[blocks.length - 1]!.end = i + 1;
  });
  for (const b of blocks) {
    const own = lines.slice(b.start, b.end);
    b.text = own.map((l) => l.trim()).join("\n");
    b.paragraphs = own.filter((_, i) => startsParagraph(own, i)).length;
  }
  return { lines, blocks };
}

/**
 * La descripción leída como el formulario del tipo `tpl`: sus apartados, en orden y cada uno al principio de una línea,
 * con lo escrito en cada uno. La primera línea del texto tiene que ser una etiqueta; los apartados borrados no cuentan.
 * Detrás pueden venir respuestas traídas de otro tipo (un párrafo que empieza por una etiqueta en negrita de `tpl` o de
 * `nextTpl`): también son apartados, para que al ir y volver de tipo cada una vuelva a su sitio y no se repita.
 * El último apartado ocupa lo que ocupa en la plantilla (su etiqueta y, si la tiene, la lista de debajo); lo que siga tras
 * una línea en blanco es `rest` (lo que había antes de elegir el tipo, o lo escrito aparte). Pero si el último sigue vacío
 * y hay respuestas en otros, lo de debajo es su respuesta escrita en el párrafo siguiente (el editor con barra separa así
 * los párrafos) y se queda con su etiqueta: como mucho, una etiqueta de más delante de lo escrito aparte, nunca una
 * respuesta bajo la etiqueta de otro apartado. null si no tiene esa forma (p. ej. hay algo escrito antes del formulario).
 */
function readForm(tpl: string, nextTpl: string, description: string): { sections: { key: string; text: string; filled: boolean }[]; rest: string } | null {
  const own = formBlocks(tpl).blocks;
  const lines = description.replace(/\r\n?/g, "\n").trim().split("\n");
  const found: { at: number; block: FormBlock }[] = [];
  let from = 0;
  for (const block of own) {
    const at = lines.findIndex((l, i) => i >= from && lineHasAnchor(l, block.anchor));
    if (at < 0) continue;
    found.push({ at, block });
    from = at + 1;
  }
  if (!found.length || found[0]!.at !== 0) return null;
  const ownCount = found.length;
  const known = [...formBlocks(nextTpl).blocks, ...own].filter((b) => BOLD_LABEL.test(b.anchor));
  for (let i = from; i < lines.length && known.length; i++) {
    if (!startsParagraph(lines, i)) continue;
    const block = known.find((b) => lineHasAnchor(lines[i]!, b.anchor));
    if (block) found.push({ at: i, block });
  }
  const sections = found.map(({ at, block }, i) => {
    const text = lines.slice(at, i + 1 < found.length ? found[i + 1]!.at : lines.length).join("\n").trimEnd();
    return { key: block.key, text, filled: !sameForm(text, block.text) };
  });
  const last = found[found.length - 1]!;
  const tail = lines.slice(last.at);
  const headEnd = afterParagraphs(tail, last.block.paragraphs);
  const head = tail.slice(0, headEnd).join("\n").trimEnd();
  const rest = tail.slice(headEnd).join("\n").trim();
  const headFilled = !sameForm(head, last.block.text);
  const answered = found.length > ownCount || sections.slice(0, -1).some((s) => s.filled);
  if (rest && !headFilled && answered) return { sections, rest: "" };
  sections[sections.length - 1] = { key: last.block.key, text: head, filled: headFilled };
  return { sections, rest };
}

/** Descripción al pasar del tipo `prev` a `next`. */
export function switchKindDescription(prev: KindAutomation | null | undefined, next: KindAutomation, description: string): string {
  const tpl = prev?.descriptionTemplate.trim() ?? "";
  const fresh = next.descriptionTemplate.trim();
  if (prev && tpl === fresh) return description;
  // Formulario del anterior con algo respondido: cada apartado vacío se quita y cada respuesta se conserva una sola vez, en
  // el apartado del nuevo con la misma etiqueta («Qué hay que hacer:» de «Casa» a «Reforma u obra») o, si el nuevo no lo
  // tiene, debajo de su formulario. Antes el formulario nuevo se ponía delante del viejo entero (etiquetas repetidas y
  // apartados vacíos que ya no tocaban). Si el anterior no tenía plantilla (un tipo general entre dos con formulario:
  // «Mejora» → «Corrección» → «Mejora»), lo que haya se lee como el formulario del nuevo, para no ponerlo dos veces.
  const form = tpl ? readForm(tpl, fresh, description) : prev && fresh ? readForm(fresh, fresh, description) : null;
  if (form && form.sections.some((s) => s.filled)) {
    const filled = form.sections.filter((s) => s.filled);
    const used = new Set<number>();
    // El formulario nuevo tal cual (con sus líneas en blanco), con cada respuesta en lugar de su apartado (la etiqueta y lo
    // que la plantilla pone debajo, como la viñeta vacía de una lista).
    const { lines: tplLines, blocks } = formBlocks(fresh);
    const out: string[] = [];
    let at = 0;
    for (const b of blocks) {
      out.push(...tplLines.slice(at, b.start));
      const i = filled.findIndex((s, j) => !used.has(j) && s.key === b.key);
      if (i >= 0) used.add(i);
      out.push(...(i >= 0 ? [filled[i]!.text] : tplLines.slice(b.start, b.end)));
      at = b.end;
    }
    out.push(...tplLines.slice(at));
    const parts = [fresh ? out.join("\n") : "", ...filled.filter((_, j) => !used.has(j)).map((s) => s.text), form.rest].filter(Boolean);
    return form.rest ? parts.join("\n\n") : `${parts.join("\n\n")}\n`;
  }
  let base = description;
  const start = description.trimStart();
  // El texto del anterior sigue al principio y sin tocar: se quita, y lo que vaya debajo tras una línea en blanco (lo que
  // ya había, o lo escrito aparte) se conserva. Lo escrito justo en la línea siguiente es la respuesta a la última
  // etiqueta del formulario: cuenta como formulario rellenado y se conserva entero (sin la etiqueta se leería como la
  // respuesta a la última del tipo nuevo).
  if (tpl && start.startsWith(tpl)) {
    const rest = start.slice(tpl.length);
    const below = /^[ \t]*\r?\n[ \t]*\r?\n/.exec(rest);
    if (!rest.trim()) base = "";
    else if (below) base = rest.slice(below[0].length);
  }
  return applyKindTemplate(next, { title: "", description: base })?.description ?? base;
}

/** Subtareas al pasar del tipo `prev` a `next`: las del anterior se quitan solo si siguen todas (si falta alguna, se han editado). */
export function switchKindSubtasks(prev: { subtaskTemplate: readonly string[] } | null | undefined, next: { subtaskTemplate: readonly string[] }, subtasks: readonly string[]): string[] {
  const old = mergeSubtasks([], [...(prev?.subtaskTemplate ?? [])]);
  const fresh = mergeSubtasks([], [...next.subtaskTemplate]);
  // El mismo tipo otra vez (o uno con las mismas subtareas): no se toca la lista (lo quitado no vuelve).
  if (prev && old.length === fresh.length && old.every((x, i) => sameSubtask(x, fresh[i]!))) return [...subtasks];
  const untouched = old.length > 0 && old.every((x) => subtasks.some((s) => sameSubtask(s, x)));
  const base = untouched ? subtasks.filter((s) => !old.some((x) => sameSubtask(s, x))) : [...subtasks];
  return mergeSubtasks(base, [...next.subtaskTemplate]);
}

/**
 * Subtareas al cambiar el tipo de una tarea ya creada (el detalle): se quitan las de la plantilla del anterior que siguen
 * sin marcar y con su texto original (cada una de la plantilla, una vez) y se añaden al final las del nuevo que falten
 * (sin distinguir mayúsculas), hasta `max` en total. Lo marcado, lo renombrado y lo añadido a mano se queda. A diferencia
 * de «Nueva tarea» (switchKindSubtasks), aquí cada subtarea cuenta por sí misma: una ya hecha no impide cambiar las demás.
 */
export function switchKindSubtaskRows<S extends { title: string; done: boolean }>(
  prev: { subtaskTemplate: readonly string[] } | null | undefined,
  next: { subtaskTemplate: readonly string[] },
  subtasks: readonly S[],
  max: number,
): { remove: S[]; add: string[] } {
  const old = mergeSubtasks([], [...(prev?.subtaskTemplate ?? [])]);
  const fresh = mergeSubtasks([], [...next.subtaskTemplate]);
  if (prev && old.length === fresh.length && old.every((x, i) => sameSubtask(x, fresh[i]!))) return { remove: [], add: [] };
  const pending = [...old];
  const remove: S[] = [];
  for (const s of subtasks) {
    const i = s.done ? -1 : pending.indexOf(s.title);
    if (i < 0) continue;
    pending.splice(i, 1);
    // También está en la plantilla del nuevo: se queda donde está (quitarla y volver a ponerla la llevaría al final).
    if (!fresh.some((x) => sameSubtask(x, s.title))) remove.push(s);
  }
  const kept = subtasks.filter((s) => !remove.includes(s)).map((s) => s.title);
  const add: string[] = [];
  for (const title of fresh) {
    if (kept.length + add.length >= max) break;
    if (!kept.some((x) => sameSubtask(x, title)) && !add.some((x) => sameSubtask(x, title))) add.push(title);
  }
  return { remove, add };
}

/** Título, descripción y subtareas al pasar del tipo `prev` (null: ninguno con plantilla puesta) al tipo `next`. */
export function switchKindText(
  prev: KindTemplate | null | undefined,
  next: KindTemplate,
  current: { title: string; description: string; subtasks: readonly string[] },
  known: readonly KindAutomation[] = [],
): { title: string; description: string; subtasks: string[] } {
  return {
    title: switchKindTitle(prev, next, current.title, known),
    description: switchKindDescription(prev, next, current.description),
    subtasks: switchKindSubtasks(prev, next, current.subtasks),
  };
}

/**
 * Aviso tras cambiar el tipo en el detalle: lo que ha cambiado además del tipo, contado por separado
 * («Tipo cambiado: 3 subtareas añadidas, 2 quitadas y plantilla de la descripción aplicada»). Solo las partes que aplican;
 * null si solo ha cambiado el tipo. `description`: la descripción guardada ha pasado a la plantilla del tipo nuevo.
 */
export function kindChangeNotice(t: T, change: { added: number; removed: number; description?: boolean }): string | null {
  const { added, removed } = change;
  const parts: string[] = [];
  if (added) parts.push(added === 1 ? t("1 subtarea añadida") : t("{n} subtareas añadidas", { n: added }));
  if (removed) {
    // Tras «N subtareas añadidas» basta con «2 quitadas».
    if (added) parts.push(removed === 1 ? t("1 quitada") : t("{n} quitadas", { n: removed }));
    else parts.push(removed === 1 ? t("1 subtarea quitada") : t("{n} subtareas quitadas", { n: removed }));
  }
  if (change.description) parts.push(t("plantilla de la descripción aplicada"));
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0]! : t("{list} y {last}", { list: parts.slice(0, -1).join(", "), last: parts.at(-1)! });
  return t("Tipo cambiado: {changes}", { changes: list });
}
