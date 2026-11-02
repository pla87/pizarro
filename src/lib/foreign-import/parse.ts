// Detección del formato de un archivo de importación y lectura de los formatos de otros Kanban. Sin dependencias de Node.
import type { T } from "@/i18n/core";
import { AppError } from "../errors";
import { importMaxBytes } from "../project-export/config";
import { parseCsvBoard } from "./csv";
import { parseTrello } from "./trello";
import { FOREIGN_LIMITS, type ForeignBoard, type ForeignFormat } from "./types";

export type ImportFormat = "pizarro" | ForeignFormat;

/**
 * Formato de un archivo por su contenido (los primeros bytes) y, solo para desempatar, su extensión:
 * ZIP («PK») → exportación de Pizarro; texto que empieza por «{» o «[» → JSON de Trello; otro texto → CSV.
 * null = no se reconoce (binario, o un .json que no es JSON).
 */
export function sniffFormat(head: Uint8Array, fileName = ""): ImportFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName.trim())?.[1]?.toLowerCase() ?? "";
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5) && (head[3] === 4 || head[3] === 6)) return "pizarro";
  if (ext === "zip") return "pizarro"; // no es un ZIP: que el lector de Pizarro lo diga («archivo dañado»)
  const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);
  if (!utf16 && head.subarray(0, 8192).includes(0)) return null;
  const text = decodeText(head);
  const first = text.replace(/^﻿/, "").trimStart()[0];
  if (first === "{" || first === "[") return "trello";
  if (ext === "json") return null;
  return text.trim() ? "csv" : null;
}

/** Tamaño máximo (bytes) de un JSON o CSV: 25 MB, o PROJECT_IMPORT_MAX_MB si es menor (el ZIP de Pizarro solo tiene este último). */
export function foreignMaxBytes(raw: string | undefined = process.env.PROJECT_IMPORT_MAX_MB): number {
  return Math.min(importMaxBytes(raw), FOREIGN_LIMITS.maxBytes);
}

/** Bytes → texto: UTF-8 (con o sin BOM), UTF-16 con BOM (Excel) y, si no es UTF-8 válido, Windows-1252. */
export function decodeText(buf: Uint8Array): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    // Cortado a mitad de un carácter (solo la cabecera que se mira para detectar) o realmente no es UTF-8.
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, Math.max(0, buf.length - 3)));
    } catch {
      return new TextDecoder("windows-1252").decode(buf);
    }
  }
}

/** Topes de la aplicación sobre lo ya leído; lanza un AppError (texto en español, que el trabajo traduce). */
export function assertBoardLimits(board: ForeignBoard): void {
  if (board.columns.length > FOREIGN_LIMITS.columns) {
    throw new AppError("Hay más de 30 columnas distintas (máximo 30 por proyecto). Si importas un CSV, revisa que la columna de estado sea la correcta.");
  }
  if (board.tasks.filter((x) => !x.archived).length > FOREIGN_LIMITS.activeTasks) {
    throw new AppError("Hay más de 1000 tareas activas (máximo 1000 por proyecto). Quita o archiva tareas en el origen y vuelve a exportar.");
  }
}

export interface ParseOptions {
  t: T;
  timeZone?: string;
  /** Nombre del archivo sin extensión. */
  fileName?: string;
}

/** Lee un archivo ya decodificado de otro Kanban y lo deja listo para crear (con los topes comprobados). */
export function parseForeign(text: string, format: ForeignFormat, opts: ParseOptions): ForeignBoard {
  const board = format === "trello" ? parseTrello(text, opts) : parseCsvBoard(text, opts);
  assertBoardLimits(board);
  // Archivadas por encima del tope: se descartan las últimas con un aviso.
  const archived = board.tasks.filter((x) => x.archived);
  if (archived.length > FOREIGN_LIMITS.archivedTasks) {
    const drop = new Set(archived.slice(FOREIGN_LIMITS.archivedTasks));
    board.tasks = board.tasks.filter((x) => !drop.has(x));
    board.warnings.push(opts.t("{n} tareas archivadas sobraban (máximo {max}) y no se han importado.", { n: drop.size, max: FOREIGN_LIMITS.archivedTasks }));
  }
  if (!board.tasks.length) throw new AppError("El archivo no tiene ninguna tarea que importar.");
  return board;
}
