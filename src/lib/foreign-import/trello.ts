// Lector de la exportación JSON de un tablero de Trello («Más» → «Imprimir y exportar» → «Exportar como JSON»).
// Listas → columnas (en su orden), tarjetas → tareas, checklists → subtareas, comentarios (actions commentCard) →
// comentarios con el autor original citado, adjuntos → solo los enlaces, en la descripción. No se descarga nada.
import type { T } from "@/i18n/core";
import { AppError } from "../errors";
import { COLOR_NAME } from "../constants";
import { FOREIGN_LIMITS, type ForeignBoard, type ForeignLabel, type ForeignPerson, type ForeignTask } from "./types";
import { cleanMarkdown, cleanName, cleanTitle, clip, instantDay, mdLink, parseInstant, safeHttpUrl } from "./text";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Color de etiqueta de Trello (sin sufijo _light/_dark) → color de la paleta de la aplicación. */
const TRELLO_COLORS: Record<string, string> = {
  green: "#22c55e", lime: "#22c55e", yellow: "#eab308", orange: "#f97316", red: "#ef4444", purple: "#a855f7",
  blue: "#6366f1", sky: "#0ea5e9", pink: "#ec4899", black: "#64748b", null: "#64748b",
};
/** Verde «oscuro» solo para el verde de Trello, para distinguirlo del lima. */
const trelloColor = (raw: string): string => {
  const base = raw.replace(/_(light|dark)$/, "");
  return base === "green" ? (raw.endsWith("_light") ? "#22c55e" : "#166534") : (TRELLO_COLORS[base] ?? "#64748b");
};

/** ¿Es (probablemente) la exportación de un tablero de Trello? */
export function looksLikeTrello(data: unknown): data is Obj {
  return isObj(data) && Array.isArray(data.cards) && Array.isArray(data.lists);
}

export interface TrelloOptions {
  t: T;
  /** Zona horaria con la que se pasa la fecha límite (instante UTC) a día. */
  timeZone?: string;
  /** Nombre del archivo sin extensión: nombre del proyecto si el tablero no trae uno. */
  fileName?: string;
}

export function parseTrello(text: string, opts: TrelloOptions): ForeignBoard {
  const { t } = opts;
  const tz = opts.timeZone ?? "UTC";
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new AppError("El archivo no es un JSON válido.");
  }
  if (!looksLikeTrello(data)) throw new AppError("El JSON no parece una exportación de un tablero de Trello (faltan «lists» y «cards»).");

  const warnings: string[] = [];
  const clipped = { n: 0 };

  // --- Columnas: listas abiertas por su posición. Las archivadas no son columnas.
  const lists = arr(data.lists).map((l, i) => ({ id: str(l.id), name: str(l.name), closed: l.closed === true, pos: num(l.pos, i), i }));
  lists.sort((a, b) => a.pos - b.pos || a.i - b.i);
  const open = lists.filter((l) => !l.closed);
  const columns = open.map((l) => cleanName(l.name, FOREIGN_LIMITS.columnName) || t("Sin nombre"));
  const columnOf = new Map(open.map((l, i) => [l.id, i]));
  const listName = new Map(lists.map((l) => [l.id, l.name]));
  const closedList = new Set(lists.filter((l) => l.closed).map((l) => l.id));

  // --- Piezas sueltas indexadas por tarjeta.
  const boardLabels = new Map(arr(data.labels).map((l) => [str(l.id), l]));
  const members = new Map(arr(data.members).map((m) => [str(m.id), m]));
  const checklistsOf = new Map<string, Obj[]>();
  for (const c of arr(data.checklists)) {
    const list = checklistsOf.get(str(c.idCard));
    if (list) list.push(c); else checklistsOf.set(str(c.idCard), [c]);
  }
  const commentsOf = new Map<string, { at: Date | null; author: string; text: string }[]>();
  for (const a of arr(data.actions)) {
    if (a.type !== "commentCard" || !isObj(a.data)) continue;
    const cardId = isObj(a.data.card) ? str(a.data.card.id) : "";
    const body = str(a.data.text);
    if (!cardId || !body.trim()) continue;
    const who = isObj(a.memberCreator) ? str(a.memberCreator.fullName) || str(a.memberCreator.username) : "";
    const comment = { at: parseInstant(a.date), author: who, text: body };
    const list = commentsOf.get(cardId);
    if (list) list.push(comment); else commentsOf.set(cardId, [comment]);
  }

  // --- Tarjetas.
  const cards = arr(data.cards).map((c, i) => ({ c, i, pos: num(c.pos, i) }));
  const columnIndex = (c: Obj) => columnOf.get(str(c.idList)) ?? Number.MAX_SAFE_INTEGER;
  cards.sort((a, b) => columnIndex(a.c) - columnIndex(b.c) || a.pos - b.pos || a.i - b.i);

  let uploads = 0;
  let badDates = 0;
  let extraComments = 0;
  let extraSubtasks = 0;
  let extraLabels = 0;
  let noTitle = 0;
  const tasks: ForeignTask[] = [];
  for (const { c } of cards) {
    const title = cleanTitle(str(c.name), undefined, clipped);
    if (!title) { noTitle++; continue; }
    const id = str(c.id);
    const inClosedList = closedList.has(str(c.idList));

    // Descripción: la de la tarjeta y, a continuación, lo que no tiene sitio propio (enlaces adjuntos, origen).
    const extra: string[] = [];
    const links: string[] = [];
    for (const a of arr(c.attachments)) {
      const url = safeHttpUrl(a.url);
      if (a.isUpload === true || !url) {
        if (a.isUpload === true) uploads++;
        continue;
      }
      links.push(`- ${mdLink(str(a.name) || url, url)}`);
    }
    if (links.length) extra.push(`**${t("Adjuntos de Trello")}**\n${links.join("\n")}`);
    const memberNames = (Array.isArray(c.idMembers) ? c.idMembers : []).map((m) => (isObj(members.get(str(m))) ? members.get(str(m)) : null)).filter((m): m is Obj => !!m);
    const assignees: ForeignPerson[] = memberNames.map((m) => ({ email: null, name: str(m.fullName) || str(m.username) || null })).filter((p) => p.name);
    if (inClosedList) extra.push(`_${t("Lista de Trello archivada: {name}.", { name: cleanName(listName.get(str(c.idList)) ?? "", FOREIGN_LIMITS.columnName) })}_`);
    const origin = safeHttpUrl(c.shortUrl) ?? safeHttpUrl(c.url);
    if (origin) extra.push(`_${t("Tarjeta original en Trello:")} ${origin}_`);
    const description = cleanMarkdown([str(c.desc).trim(), ...extra].filter(Boolean).join("\n\n"), undefined, clipped);

    // Etiquetas: las de la tarjeta; sin nombre, el del color.
    const labelSrc = arr(c.labels).length ? arr(c.labels) : (Array.isArray(c.idLabels) ? c.idLabels : []).map((l) => boardLabels.get(str(l))).filter((l): l is Obj => !!l);
    const labels: ForeignLabel[] = [];
    const seenLabels = new Set<string>();
    for (const l of labelSrc) {
      const color = trelloColor(str(l.color));
      const name = cleanName(str(l.name), FOREIGN_LIMITS.labelName) || t(COLOR_NAME[color] ?? "Gris");
      if (seenLabels.has(name.toLowerCase())) continue;
      seenLabels.add(name.toLowerCase());
      if (labels.length >= FOREIGN_LIMITS.labelsPerTask) extraLabels++; else labels.push({ name, color });
    }

    // Checklists → subtareas (con el nombre de la lista si hay más de una).
    const lists2 = (checklistsOf.get(id) ?? []).sort((a, b) => num(a.pos) - num(b.pos));
    const subtasks: { title: string; done: boolean }[] = [];
    for (const cl of lists2) {
      const items = arr(cl.checkItems).sort((a, b) => num(a.pos) - num(b.pos));
      for (const it of items) {
        const label = cleanTitle(str(it.name), undefined, clipped);
        if (!label) continue;
        const prefix = lists2.length > 1 && str(cl.name).trim() ? `${cleanName(str(cl.name), 60)}: ` : "";
        if (subtasks.length >= FOREIGN_LIMITS.subtasksPerTask) { extraSubtasks++; continue; }
        subtasks.push({ title: clip(`${prefix}${label}`, 210), done: it.state === "complete" });
      }
    }

    // Comentarios: del más antiguo al más nuevo, con el autor original en el texto.
    const comments: ForeignTask["comments"] = [];
    for (const k of (commentsOf.get(id) ?? []).sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))) {
      if (comments.length >= FOREIGN_LIMITS.commentsPerTask) { extraComments++; continue; }
      const day = k.at ? instantDay(k.at, tz) : null;
      const author = cleanName(k.author, 80) || t("Alguien");
      const head = day ? t("{author} comentó en Trello el {date}:", { author, date: day }) : t("{author} comentó en Trello:", { author });
      comments.push({ body: cleanMarkdown(`**${head}**\n\n${k.text}`, FOREIGN_LIMITS.commentBody, clipped), createdAt: k.at });
    }

    let due: string | null = null;
    if (str(c.due)) {
      const d = parseInstant(c.due);
      due = d ? instantDay(d, tz) : null;
      if (!due) badDates++;
    }

    tasks.push({
      title, description, column: columnOf.get(str(c.idList)) ?? null, archived: c.closed === true || inClosedList, due, labels, subtasks, comments, priority: null, assignees,
    });
  }

  // La descripción del tablero también cuenta como recorte: se limpia antes de emitir el aviso.
  const boardDescription = cleanMarkdown(str(data.desc), 2000, clipped);

  if (noTitle) warnings.push(t("{n} tarjetas no tenían título y se han ignorado.", { n: noTitle }));
  if (clipped.n) warnings.push(t("{n} textos eran más largos de lo permitido y se han recortado.", { n: clipped.n }));
  if (uploads) warnings.push(t("{n} archivos adjuntos subidos a Trello no se han importado (solo se importan los enlaces).", { n: uploads }));
  if (badDates) warnings.push(t("{n} fechas límite no se pudieron interpretar y se han ignorado.", { n: badDates }));
  if (extraLabels) warnings.push(t("{n} etiquetas de tareas sobraban (máximo {max} por tarea) y no se han importado.", { n: extraLabels, max: FOREIGN_LIMITS.labelsPerTask }));
  if (extraSubtasks) warnings.push(t("{n} elementos de checklist sobraban (máximo {max} subtareas por tarea) y no se han importado.", { n: extraSubtasks, max: FOREIGN_LIMITS.subtasksPerTask }));
  if (extraComments) warnings.push(t("{n} comentarios sobraban (máximo {max} por tarea) y no se han importado.", { n: extraComments, max: FOREIGN_LIMITS.commentsPerTask }));

  return {
    name: cleanName(str(data.name), 80) || cleanName(opts.fileName ?? "", 80) || "Trello",
    description: boardDescription,
    columns,
    tasks,
    warnings,
  };
}
