import type { T } from "@/i18n/shared";

/** Las cuatro clases de aviso, con el mismo texto y orden en email, dispositivo y Telegram/WhatsApp. */
export type NoticeKind = "mention" | "assigned" | "due" | "comment";

/** `notes: false` en Telegram y WhatsApp: las menciones en notas no salen por ahí (ver notifyNoteMentions). */
export function noticeLabels(t: T, { notes = true }: { notes?: boolean } = {}): [NoticeKind, string][] {
  return [
    ["mention", notes ? t("Menciones en tareas y notas") : t("Menciones en tareas")],
    ["assigned", t("Tareas que me asignan")],
    ["due", t("Cambios de fecha límite y recordatorios")],
    ["comment", t("Comentarios y respuestas en tareas que sigo")],
  ];
}
