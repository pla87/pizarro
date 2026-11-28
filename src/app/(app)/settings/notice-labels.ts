import type { T } from "@/i18n/shared";

/** Las cuatro clases de aviso, con el mismo texto y orden en email, dispositivo y Telegram/WhatsApp. */
export type NoticeKind = "mention" | "assigned" | "due" | "comment";

export function noticeLabels(t: T): [NoticeKind, string][] {
  return [
    ["mention", t("Menciones en tareas y notas")],
    ["assigned", t("Tareas que me asignan")],
    ["due", t("Cambios de fecha límite y recordatorios")],
    ["comment", t("Comentarios y respuestas en tareas que sigo")],
  ];
}
