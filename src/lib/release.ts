// Generador de release notes. Función pura: se usa en el navegador (instantáneo)
// y en los tests.

import { decodeEntities } from "./markdown-entities";
import { mentionsToPlain } from "./mentions";
import { partSuffix } from "./zip-plan";

interface ReleaseKind {
  id: string;
  name: string;
}

interface ReleaseAttachmentInput {
  originalName: string;
  /** false = archivo no imagen: conserva su extensión original. Por defecto true (se guarda como .webp). */
  isImage?: boolean;
}

interface ReleaseTaskInput {
  id: string;
  title: string;
  kindId: string;
  linkUrl?: string | null;
  /** Descripción en Markdown (con menciones @[Nombre](user:ID)). */
  description?: string | null;
  /** Adjuntos de la tarea, en orden de creación. */
  attachments?: ReleaseAttachmentInput[];
}

interface ReleaseInput {
  header: string;
  footer: string;
  /** Tipos en el orden en que deben aparecer las secciones. */
  kinds: ReleaseKind[];
  tasks: ReleaseTaskInput[];
  /** Número que tendrá la release en el proyecto: prefijo de los códigos (R32F1). */
  releaseNumber?: number | null;
}

/** Escapa los caracteres que romperían el texto de un enlace Markdown. */
function escapeLinkText(text: string): string {
  return text.replace(/([\[\]\\])/g, "\\$1");
}

const OTHERS_NAME = "Otros";
const MAX_PREFIX_LETTERS = 4;

/** Solo las letras (A-Z) del nombre, en mayúsculas y sin acentos. */
function nameLetters(name: string): string {
  return name.normalize("NFD").replace(/[^a-zA-Z]/g, "").toUpperCase();
}

/**
 * Prefijo de código por tipo, en el orden de las secciones: primera letra del nombre;
 * si ya la usa un tipo anterior, las 2 primeras, luego 3, etc. (máximo 4 letras).
 */
function kindPrefixes(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const letters = nameLetters(name) || "X";
    let prefix = "";
    for (let n = 1; n <= Math.min(letters.length, MAX_PREFIX_LETTERS) && !prefix; n++) {
      if (!used.has(letters.slice(0, n))) prefix = letters.slice(0, n);
    }
    // Nombres agotados (p. ej. dos tipos llamados igual): se añade una letra distinta.
    for (let i = 0; !prefix && i < 26; i++) {
      const candidate = letters.slice(0, MAX_PREFIX_LETTERS - 1) + String.fromCharCode(65 + i);
      if (!used.has(candidate)) prefix = candidate;
    }
    if (!prefix) prefix = letters.slice(0, MAX_PREFIX_LETTERS);
    used.add(prefix);
    return prefix;
  });
}

/**
 * Código de cada tarea (taskId → «F1»): prefijo del tipo + número correlativo por tipo,
 * en el orden en que aparecen las tareas. «Otros» (tipos desconocidos) sigue la misma regla.
 * Con el número de la release, el código lo lleva delante: «R32F1».
 */
export function computeReleaseCodes(
  kinds: ReleaseKind[],
  tasks: Pick<ReleaseTaskInput, "id" | "kindId">[],
  releaseNumber?: number | null,
): Map<string, string> {
  const release = releaseNumber ? `R${releaseNumber}` : "";
  const prefixes = kindPrefixes([...kinds.map((k) => k.name), OTHERS_NAME]);
  const prefixByKind = new Map(kinds.map((k, i) => [k.id, prefixes[i]!]));
  const othersPrefix = prefixes[kinds.length]!;
  const counters = new Map<string, number>();
  const codes = new Map<string, string>();
  for (const t of tasks) {
    const prefix = prefixByKind.get(t.kindId) ?? othersPrefix;
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    codes.set(t.id, `${release}${prefix}${n}`);
  }
  return codes;
}

/**
 * Nombres de fichero de los adjuntos de una tarea: `${código}_${nombre}.webp` (las imágenes
 * se guardan convertidas a WebP; el resto conserva su extensión), saneados y con `-2`, `-3`… si se repiten. Mismo orden que la entrada.
 */
export function attachmentFileNames(code: string, attachments: ReleaseAttachmentInput[]): string[] {
  const taken = new Set<string>();
  return attachments.map((a) => {
    const isImage = a.isImage ?? true;
    const base = a.originalName.replace(/\.[^.]+$/, "");
    const clean = `${code}_${base}`.replace(/\s+/g, "_").replace(/[^\p{L}\p{N}._-]/gu, "_");
    // Extensión original (saneada) para los no imagen; .webp para las imágenes.
    const ext = isImage ? "webp" : (/\.([^.]+)$/.exec(a.originalName)?.[1] ?? "").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 12);
    const suffix = ext ? `.${ext}` : "";
    let name = `${clean}${suffix}`;
    // Se compara sin distinguir mayúsculas: hay sistemas de ficheros que tampoco lo hacen.
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${clean}-${n}${suffix}`;
    taken.add(name.toLowerCase());
    return name;
  });
}

export function formatReleaseLine(task: Pick<ReleaseTaskInput, "title" | "linkUrl">, code?: string): string {
  const title = mentionsToPlain(task.title).replace(/\s+/g, " ").trim();
  const link = task.linkUrl ? ` ([enlace](<${task.linkUrl.replace(/[<>]/g, "")}>))` : "";
  return `- ${code ? `**${code}** · ` : ""}${escapeLinkText(title)}${link}`;
}

/** Descripción sangrada 2 espacios: menciones en texto plano, sin espacios finales ni líneas en blanco repetidas. */
function formatReleaseDescription(description: string | null | undefined): string[] {
  const lines: string[] = [];
  // Descripciones guardadas por versiones anteriores del editor pueden traer `-&gt;` en vez de `->`.
  for (const raw of decodeEntities(mentionsToPlain(description ?? "")).split(/\r\n|\r|\n/)) {
    const line = raw.trimEnd();
    if (!line && (lines.length === 0 || lines.at(-1) === "")) continue;
    lines.push(line);
  }
  while (lines.at(-1) === "") lines.pop();
  return lines.map((l) => (l ? `  ${l}` : ""));
}

/** Línea de la tarea + adjuntos + descripción (los adjuntos antes, para que una lista al final de la descripción no los absorba). */
function formatReleaseTask(task: ReleaseTaskInput, code: string): string {
  const lines = [formatReleaseLine(task, code)];
  if (task.attachments?.length) lines.push(`  Adjuntos: ${attachmentFileNames(code, task.attachments).join(", ")}`);
  lines.push(...formatReleaseDescription(task.description));
  return lines.join("\n");
}

/** Secciones por tipo (sin título, cabecera ni pie). */
function buildSections(input: Pick<ReleaseInput, "kinds" | "tasks" | "releaseNumber">): string[] {
  const parts: string[] = [];
  const codes = computeReleaseCodes(input.kinds, input.tasks, input.releaseNumber);
  const line = (t: ReleaseTaskInput) => formatReleaseTask(t, codes.get(t.id)!);
  const known = new Set(input.kinds.map((k) => k.id));
  for (const kind of input.kinds) {
    const items = input.tasks.filter((t) => t.kindId === kind.id);
    if (items.length) parts.push([`### ${kind.name}`, ...items.map(line)].join("\n"));
  }
  const others = input.tasks.filter((t) => !known.has(t.kindId));
  if (others.length) parts.push([`### ${OTHERS_NAME}`, ...others.map(line)].join("\n"));
  if (input.tasks.length === 0) parts.push("_Sin tareas seleccionadas._");
  return parts;
}

/** Orden: cabecera, secciones, pie. El título de la release no forma parte del texto. */
export function buildReleaseMarkdown(input: ReleaseInput): string {
  const header = input.header.trim();
  const footer = input.footer.trim();
  return [header, ...buildSections(input), footer].filter(Boolean).join("\n\n") + "\n";
}

/**
 * Cambia la cabecera (o el pie) de un texto ya editado: si el bloque anterior sigue
 * intacto se sustituye; si no, el nuevo se añade al principio (cabecera) o al final (pie).
 */
export function swapTemplateBlock(text: string, previous: string, next: string, where: "start" | "end"): string {
  const prev = previous.trim();
  const nxt = next.trim();
  if (prev) {
    const idx = where === "start" ? text.indexOf(prev) : text.lastIndexOf(prev);
    if (idx >= 0) {
      const before = text.slice(0, idx);
      const after = text.slice(idx + prev.length);
      if (!nxt) {
        // Quitar también la línea en blanco que lo separaba del resto.
        if (where === "start") {
          const head = before.replace(/\s+$/, "");
          const tail = after.replace(/^\s+/, "");
          return head && tail ? `${head}\n\n${tail}` : head ? `${head}\n` : tail;
        }
        return before.replace(/\s+$/, "") + after.replace(/^\s+/, "\n");
      }
      return before + nxt + after;
    }
  }
  if (!nxt) return text;
  if (where === "start") {
    const rest = text.replace(/^\s+/, "");
    return rest ? `${nxt}\n\n${rest}` : `${nxt}\n`;
  }
  return `${text.replace(/\s+$/, "")}\n\n${nxt}\n`;
}

/**
 * Título por defecto: «Release 2026-10-18 · Proyecto». Si ya hay releases desplegadas ese día,
 * se indica el ordinal tras la fecha: «Release 2026-10-18 (2) · Proyecto».
 */
export function defaultReleaseTitle(dayIso: string, projectName: string, releasesToday = 0): string {
  const n = Math.max(0, Math.floor(releasesToday)) + 1;
  return `Release ${dayIso}${n > 1 ? ` (${n})` : ""} · ${projectName}`;
}

/** Instantes UTC [inicio, fin) del día local `dayIso` (YYYY-MM-DD) en la zona horaria dada. */
export function zonedDayRange(dayIso: string, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = dayIso.split("-").map(Number) as [number, number, number];
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  });
  const midnight = (yy: number, mm: number, dd: number) => {
    const wall = Date.UTC(yy, mm - 1, dd);
    // Se afina dos veces por si el desfase cambia (horario de verano) cerca de la medianoche.
    let guess = wall;
    for (let i = 0; i < 2; i++) {
      const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((x) => [x.type, Number(x.value)]));
      const shown = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
      guess -= shown - wall;
    }
    return new Date(guess);
  };
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return { start: midnight(y, m, d), end: midnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()) };
}

/** Nombre del ZIP de adjuntos del histórico: título saneado + «-adjuntos.zip» (con «-1de3» si hay varios paquetes). */
export function releaseZipName(title: string, part = 1, total = 1): string {
  const base = title
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}._-]/gu, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[_.-]+|[_.-]+$/g, "")
    .slice(0, 80);
  return `${base || "release"}-adjuntos${partSuffix(part, total)}.zip`;
}

/** Fecha local en formato YYYY-MM-DD. */
export function isoDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function releaseFileName(date: Date, ext: "md" | "txt"): string {
  return `release-${isoDate(date)}.${ext}`;
}
