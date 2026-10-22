// Textos de los avisos por tipo. Funciones puras, compartidas por el servidor (emails) y el cliente (lista de avisos).
import type { T } from "../i18n/core";
import { formatDay } from "./dates";

export type NotificationKind = "MENTION" | "ASSIGNED" | "DUE_CHANGED" | "COMMENT" | "REPLY";

/** Frase de cabecera del aviso, con `{actor}` y `{task}` ya sustituidos por los textos recibidos. */
export function notificationHeadline(kind: NotificationKind, t: T, vars: { actor: string; task: string }): string {
  switch (kind) {
    case "ASSIGNED": return t("{actor} te ha asignado {task}", vars);
    case "DUE_CHANGED": return t("{actor} ha cambiado la fecha límite de {task}", vars);
    case "COMMENT": return t("{actor} ha comentado en {task}", vars);
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
