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
export function applyKindTemplate(
  kind: KindAutomation,
  current: { title: string; description: string },
): { title: string; description: string } | null {
  const titleTpl = kind.titleTemplate.trim();
  const descTpl = kind.descriptionTemplate.trim();
  if (!titleTpl && !descTpl) return null;
  let description = current.description;
  if (descTpl && !description.trimStart().startsWith(descTpl)) {
    description = description.trim() ? `${descTpl}\n${description}` : `${descTpl}\n`;
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
export function mergeSubtasks(current: string[], template: string[]): string[] {
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
  if (title && desc) return t("Al elegirlo, el título pasa a ser «{title}» y la descripción empieza por «{desc}».", { title: short(title), desc: short(desc) });
  if (title) return t("Al elegirlo, el título pasa a ser «{title}».", { title: short(title) });
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

/** Título al pasar del tipo `prev` (el que tenía; null si ninguno) a `next`. */
export function switchKindTitle(prev: KindAutomation | null | undefined, next: KindAutomation, title: string): string {
  const prefix = next.titleTemplate.trim();
  // El mismo tipo otra vez (pulsar el ya elegido): no se toca lo que haya.
  if (prev && prev.titleTemplate.trim() === prefix) return title;
  const rest = titleWithoutPrefix(prev, title);
  // Con el prefijo del anterior: se cambia por el del nuevo y se conserva lo escrito detrás. Si el nuevo no tiene, solo se
  // quita el prefijo sin nada detrás («Respuesta a Juan» no pasa a «a Juan»).
  if (rest !== null) return prefix ? (rest ? `${prefix} ${rest}` : prefix) : rest ? title : "";
  // Si no, como siempre: el título fijo del tipo nuevo, si lo tiene.
  return prefix || title;
}

/** Descripción al pasar del tipo `prev` a `next`. */
export function switchKindDescription(prev: KindAutomation | null | undefined, next: KindAutomation, description: string): string {
  const tpl = prev?.descriptionTemplate.trim() ?? "";
  if (prev && tpl === next.descriptionTemplate.trim()) return description;
  let base = description;
  const start = description.trimStart();
  // El texto del anterior sigue al principio y sin tocar (lo que haya debajo es de la persona): se quita.
  if (tpl && start.startsWith(tpl)) {
    const rest = start.slice(tpl.length);
    if (!rest.trim()) base = "";
    else if (/^\r?\n/.test(rest)) base = rest.replace(/^\r?\n/, "");
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

/** Título, descripción y subtareas al pasar del tipo `prev` (null: ninguno con plantilla puesta) al tipo `next`. */
export function switchKindText(
  prev: KindTemplate | null | undefined,
  next: KindTemplate,
  current: { title: string; description: string; subtasks: readonly string[] },
): { title: string; description: string; subtasks: string[] } {
  return {
    title: switchKindTitle(prev, next, current.title),
    description: switchKindDescription(prev, next, current.description),
    subtasks: switchKindSubtasks(prev, next, current.subtasks),
  };
}
