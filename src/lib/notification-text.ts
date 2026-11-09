// Textos de los avisos por tipo. Funciones puras, compartidas por el servidor (emails) y el cliente (lista de avisos).
import type { T } from "../i18n/core";
import { formatDay } from "./dates";

export type NotificationKind = "MENTION" | "ASSIGNED" | "DUE_CHANGED" | "COMMENT" | "REPLY" | "WAITING";

/** Frase de cabecera del aviso, con `{actor}` y `{task}` ya sustituidos por los textos recibidos. */
export function notificationHeadline(kind: NotificationKind, t: T, vars: { actor: string; task: string }): string {
  switch (kind) {
    case "ASSIGNED": return t("{actor} te ha asignado {task}", vars);
    case "DUE_CHANGED": return t("{actor} ha cambiado la fecha límite de {task}", vars);
    case "COMMENT": return t("{actor} ha comentado en {task}", vars);
    case "WAITING": return t("{task} sigue esperando respuesta", vars);
    case "REPLY": return t("{actor} ha respondido a tu comentario en {task}", vars);
    default: return t("{actor} te ha mencionado en {task}", vars);
  }
}

/** El texto del aviso de cambio de fecha se guarda como «YYYY-MM-DD>YYYY-MM-DD» (vacío = sin fecha). */
export function dueChangeExcerpt(from: string | null, to: string | null): string {
  return `${from ?? ""}>${to ?? ""}`;
}

export function parseDueChange(excerpt: string): { from: string | null; to: string | null } {
  const [from = "", to = ""] = excerpt.split(">");
  return { from: from || null, to: to || null };
}

/** «3 oct → 5 oct», «Sin fecha → 5 oct»… en el idioma de quien lee. */
export function dueChangeText(excerpt: string, t: T, locale: string): string {
  const { from, to } = parseDueChange(excerpt);
  const show = (iso: string | null) => (iso ? formatDay(iso, undefined, locale) : t("Sin fecha"));
  return `${show(from)} → ${show(to)}`;
}

/** El aviso de espera guarda solo los días que lleva la tarea esperando. */
export function waitingText(excerpt: string, t: T): string {
  const n = Number.parseInt(excerpt, 10);
  return Number.isFinite(n) ? t("Lleva {n} d en espera", { n }) : "";
}

/**
 * Aviso de asignación de un lote de tareas (alta masiva): se guarda solo el número, con un tabulador delante que el
 * extracto de un título nunca lleva (excerpt() convierte todo espacio en blanco en un espacio), y el texto «N tareas»
 * se pone al mostrarlo, en el idioma de quien lo lee.
 */
export function assignedBatchExcerpt(count: number): string {
  return `\t${count}`;
}

function parseAssignedBatch(excerpt: string): number | null {
  const m = /^\t(\d+)$/.exec(excerpt);
  return m ? Number(m[1]) : null;
}

/** Texto bajo la cabecera del aviso, en el idioma de `t` (fechas con `locale`). */
export function notificationBody(kind: NotificationKind, excerpt: string, t: T, locale: string): string {
  switch (kind) {
    case "DUE_CHANGED": return dueChangeText(excerpt, t, locale);
    case "WAITING": return waitingText(excerpt, t);
    case "ASSIGNED": {
      const n = parseAssignedBatch(excerpt);
      return n === null ? excerpt : n === 1 ? t("1 tarea") : t("{n} tareas", { n });
    }
    default: return excerpt;
  }
}
