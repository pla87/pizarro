// Programa de un curso (columna con rol PROGRAM): cada tarea de la columna es una sesión. Funciones puras para preparar
// el PDF «Publicar programa»: número, fecha (fecha límite o rango inicio–fin), título, descripción y responsable.
// El Markdown de las descripciones se convierte en bloques en el worker de PDF (programBlocks, desde report-pdf.tsx), no en
// el proceso web: con miles de sesiones largas eran segundos de CPU que paraban todas las peticiones.
import type { T } from "../i18n/core";
import { isoToDate } from "./dates";
import { markdownToPdfBlocks, type PdfBlock } from "./pdf-markdown";
import { mentionsToPlain } from "./mentions";

interface ProgramSession {
  /** Número de la sesión (1, 2, 3…) en el orden de la columna. */
  n: number;
  title: string;
  /** Fecha ya escrita en el idioma del PDF, o null si la sesión no tiene fecha. */
  date: string | null;
  /** Responsable (profesor), solo si se pidió incluirlo y la sesión lo tiene. */
  assignee: string | null;
  /** Descripción de la tarea (Markdown, tal cual): la convierte en bloques el worker (programBlocks). */
  description: string;
}

export interface ProgramPdfInput {
  project: string;
  today: string;
  /** ¿Se pidió el responsable? (la columna «Responsable» de la cabecera de cada sesión). */
  withAssignee: boolean;
  sessions: ProgramSession[];
}

interface SessionSource {
  title: string;
  /** Comienzo automático del título de su tipo (TaskKind.titleTemplate), que el PDF quita. */
  titlePrefix?: string | null;
  description: string;
  startDate: string | null;
  dueDate: string | null;
  assignee: string | null;
}

const fmt = (iso: string, locale: string, opts: Intl.DateTimeFormatOptions) => isoToDate(iso).toLocaleDateString(locale, { ...opts, timeZone: "UTC" });

/**
 * Fecha de una sesión: un día («martes, 12 de enero de 2027») o un rango («12 de enero de 2027 – 16 de enero de 2027»)
 * si tiene fecha de inicio anterior a la fecha límite. Solo inicio: «Desde …». Un inicio posterior a la fecha límite
 * (dato incoherente) se ignora.
 */
export function programDateLabel(start: string | null, due: string | null, locale: string, t: T): string | null {
  const long: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
  const plain: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
  if (due && start && start < due) return `${fmt(start, locale, plain)} – ${fmt(due, locale, plain)}`;
  if (due) return fmt(due, locale, long);
  if (start) return t("Desde el {date}", { date: fmt(start, locale, long) });
  return null;
}

/**
 * Nombre del PDF guardado en la Documentación del proyecto: «Programa – 2026-11-13_v3.pdf», con la versión del programa
 * (Project.programVersion, que se reserva al guardar). Cada publicación guardada es un documento nuevo: no sustituye a
 * las anteriores, y la versión distingue dos del mismo día.
 */
export function programDocumentName(t: T, today: string, version: number): string {
  return `${t("Programa")} – ${today}_v${version}.pdf`;
}

/** Lo que pinta el PDF: cada sesión con sus bloques en lugar del Markdown. */
export type ProgramPdfDocument = Omit<ProgramPdfInput, "sessions"> & { sessions: (Omit<ProgramSession, "description"> & { blocks: PdfBlock[] })[] };

/** Convierte el Markdown de cada sesión en bloques para el PDF. Se llama en el worker de PDF, nunca en el proceso web. */
export function programBlocks(input: ProgramPdfInput): ProgramPdfDocument {
  return { ...input, sessions: input.sessions.map(({ description, ...rest }) => ({ ...rest, blocks: markdownToPdfBlocks(description) })) };
}

/**
 * Título de la sesión sin el comienzo automático de su tipo («Sesión: Fundamentos» → «Fundamentos»), porque el PDF ya
 * la numera («Sesión 1»). Si quitarlo lo dejara vacío, se deja el título tal cual.
 */
export function sessionTitle(title: string, prefix?: string | null): string {
  const p = (prefix ?? "").trim();
  if (!p || !title.startsWith(p)) return title;
  const rest = title.slice(p.length).trim();
  return rest || title;
}

/** Sesiones del programa en el orden recibido (el de la columna), numeradas desde 1. Sin analizar el Markdown (programBlocks). */
export function buildProgramSessions(tasks: SessionSource[], opts: { locale: string; t: T; withAssignee: boolean; useStartDate: boolean }): ProgramSession[] {
  return tasks.map((task, i) => ({
    n: i + 1,
    title: mentionsToPlain(sessionTitle(task.title, task.titlePrefix), false),
    date: programDateLabel(opts.useStartDate ? task.startDate : null, task.dueDate, opts.locale, opts.t),
    assignee: opts.withAssignee ? task.assignee : null,
    description: task.description ?? "",
  }));
}
