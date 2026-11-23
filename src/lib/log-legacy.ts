import "server-only";
// Filas de Logs guardadas por versiones anteriores a la v1.67, sin plantilla: solo el texto en español
// («Apagado ordenado (SIGTERM): sin peticiones ni envíos pendientes»). Para leerlas en inglés se busca la plantilla del
// diccionario que reproduce ese texto (sus partes fijas, con los datos en los huecos) y se pinta traducida. Es solo al
// leer: lo guardado no cambia (la búsqueda y el CSV en español siguen con el texto original).
//
// Seguro: solo plantillas con bastante texto fijo (MIN_FIXED: no casa «{a}: {b}»), el texto entero tiene que coincidir
// y, si varias encajan, gana la de más texto fijo. Los datos salen tal cual (ver param).
// Barato: las expresiones se montan una vez, agrupadas por su comienzo fijo; cada fila prueba solo las de su comienzo.
import { EN } from "@/i18n/en";
import { andList, renderLabel, type Label, type Params } from "./undo-label";

/**
 * Texto fijo mínimo (sin espacios) de una plantilla para usarla con filas antiguas: con un comienzo fijo, que ya filtra
 * mucho («Borró «{title}»»), basta poco; si empieza por un hueco («{n} aviso(s) …»), hace falta más.
 */
const MIN_FIXED = 6;
const MIN_FIXED_OPEN = 12;
/** Letras del comienzo fijo con las que se agrupan las plantillas. */
const PREFIX = 4;
const PLACEHOLDER = /\{(\w+)\}/g;

interface Pattern {
  key: string;
  re: RegExp;
  names: string[];
  fixed: number;
}

let index: { byPrefix: Map<string, Pattern[]>; open: Pattern[] } | null = null;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function build() {
  const byPrefix = new Map<string, Pattern[]>();
  const open: Pattern[] = [];
  for (const key of Object.keys(EN)) {
    if (!key.includes("{")) continue;
    const names = [...key.matchAll(PLACEHOLDER)].map((m) => m[1]!);
    if (!names.length || new Set(names).size !== names.length) continue;
    const parts = key.split(PLACEHOLDER).filter((_, i) => i % 2 === 0);
    const fixed = parts.join("").replace(/\s+/g, "").length;
    const head = parts[0]!;
    if (fixed < (head.length >= PREFIX ? MIN_FIXED : MIN_FIXED_OPEN)) continue;
    const re = new RegExp(`^${parts.map(escape).join("([\\s\\S]+?)")}$`);
    const p: Pattern = { key, re, names, fixed };
    if (head.length >= PREFIX) {
      const k = head.slice(0, PREFIX);
      const list = byPrefix.get(k);
      if (list) list.push(p);
      else byPrefix.set(k, [p]);
    } else open.push(p);
  }
  return { byPrefix, open };
}

/**
 * Un dato de la fila: una lista de textos fijos del diccionario («título y tipo», los campos cambiados) se traduce, y un
 * error o un motivo (TRANSLATED_PARAMS: «Falló la copia: BACKUP_KEY no está configurada.») también, fijo o con su propia
 * plantilla; lo demás sale tal cual. Un dato suelto de otro hueco no se traduce aunque esté en el diccionario: puede ser
 * de la persona (una columna «Hecho» no es la columna «Done»).
 */
function param(name: string, value: string, depth: number): Params[string] {
  if (TRANSLATED_PARAMS.has(name)) {
    if (value in EN) return { k: value };
    const inner = depth < 2 ? match(value, depth + 1) : null;
    if (inner) return inner;
  }
  const items = value.split(/, | y /);
  if (items.length > 1 && items.every((i) => i in EN)) return andList(items.map((k) => ({ k })));
  return value;
}

/** Huecos con textos de la app (errores, motivos, qué se redujo en una copia), no datos de la persona. */
const TRANSLATED_PARAMS = new Set(["error", "errors", "reason", "why", "what"]);

/**
 * Variable de una plantilla nueva con un texto ya montado en español (logText): el texto fijo del diccionario, la
 * plantilla que lo reproduce (un error con datos de es-text.ts: «La carpeta del destino externo no existe: /mnt/x…») o,
 * si no es de la app, el texto tal cual.
 */
export function appTextLabel(text: string): Label {
  return text in EN ? { k: text } : (match(text, 1) ?? { k: text });
}

/** Plantilla que reproduce el mensaje antiguo, o null si ninguna encaja con seguridad. */
export function legacyLogLabel(message: string): Label | null {
  return match(message, 0);
}

/**
 * Texto guardado en español (un error de las copias en su estado o en JobRun.lastError) en el idioma de `t`: traducido
 * si es un texto fijo del diccionario o reproduce una de sus plantillas (es-text.ts); si no, tal cual.
 */
export function storedText(text: string, t: (text: string, vars?: Record<string, string | number>) => string): string {
  const fixed = t(text);
  if (fixed !== text) return fixed;
  const label = match(text, 0);
  return label ? renderLabel(label, t) : text;
}

function match(message: string, depth: number): Label | null {
  if (!message || message.length > 1000 || !message.includes(" ")) return null;
  index ??= build();
  const candidates = [...(index.byPrefix.get(message.slice(0, PREFIX)) ?? []), ...index.open];
  let best: { p: Pattern; m: RegExpExecArray } | null = null;
  for (const p of candidates) {
    if (best && p.fixed <= best.p.fixed) continue;
    const m = p.re.exec(message);
    if (m) best = { p, m };
  }
  if (!best) return null;
  return { k: best.p.key, p: Object.fromEntries(best.p.names.map((n, i) => [n, param(n, best.m[i + 1]!, depth)])) };
}
