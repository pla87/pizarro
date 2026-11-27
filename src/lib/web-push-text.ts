import type { T } from "../i18n/shared";
import { ellipsize } from "./graphemes";
import { noticeBody, noticeHeadline, type NoticeMessage } from "./messaging-core";
import { samePath, type PushMessage } from "./web-push-core";

// Texto de un aviso push (puro, sin base de datos). La notificación se ve en la pantalla bloqueada del móvil, así que
// lleva lo justo: quién y qué tarea o nota (la cabecera del aviso, como en Telegram), el proyecto y, en los cambios de
// fecha y los recordatorios de «Esperando», las fechas o los días. Nunca el comentario, la respuesta ni el párrafo de
// la mención, ni descripciones.

/**
 * Aviso push de un aviso de Pizarro: `origin` es la dirección de la app (para quedarse con la ruta del enlace, siempre
 * del mismo origen), `icon` la ruta del icono de la app y `tag` agrupa en el dispositivo (un aviso no tapa a otro).
 */
export function pushNoticeMessage(m: NoticeMessage, t: T, origin: string, icon: string, tag: string): PushMessage {
  const type = m.type ?? "MENTION";
  const extra = type === "DUE_CHANGED" || type === "WAITING" ? noticeBody(m, t).replace(/\s+/g, " ").trim() : "";
  const project = ellipsize(m.projectName.replace(/\s+/g, " ").trim(), 100);
  return {
    title: noticeHeadline(m, t),
    body: extra ? `${project} · ${extra}` : project,
    url: samePath(m.url, origin),
    tag,
    icon,
  };
}

/** Aviso de prueba («Probar» en Mi perfil → Avisos). */
export const pushTestMessage = (t: T, icon: string): PushMessage => ({
  title: t("Aviso de prueba de Pizarro"),
  body: t("Si lo ves, los avisos en este dispositivo funcionan."),
  url: "/settings?tab=avisos",
  tag: "pizarro-test",
  icon,
});
