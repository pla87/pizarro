import { undoEntry } from "@/actions/undo";
import { formatDay } from "@/lib/dates";
import { undoneText } from "../undo-text";
import type { T } from "@/i18n/shared";

/** Lo que el servidor puso a las tarjetas que entraron en una columna «Asignación a persona» (AssignedPatch). */
type Assigned = { id: string; assigneeId: string; dueDate: string | null };

interface NoticeContext {
  users: readonly { id: string; name: string }[];
  today: string;
  locale: string;
  t: T;
  toast: (message: string, kind?: "success" | "error" | "undo", action?: { label: string; onClick: () => void }) => void;
  track: <R>(p: Promise<R>) => Promise<R>;
  refresh: () => void;
}

/**
 * Tras mover tarjetas a una columna «Asignación a persona» (arrastrar, Alt+flechas, «Mover a…»): «Asignada a Ana · vence el
 * 27 nov», con «Deshacer» (`undoId`: la entrada del movimiento, que devuelve también el responsable y la fecha de antes).
 * Así no pasa inadvertido que la tarjeta ha cambiado de manos. Devuelve si ha avisado (si no, quien llama da su aviso).
 */
export function showAssignedNotice(assigned: readonly Assigned[], undoId: string | undefined, ctx: NoticeContext): boolean {
  const first = assigned[0];
  if (!first) return false;
  const { t } = ctx;
  const name = ctx.users.find((u) => u.id === first.assigneeId)?.name ?? "?";
  const message = assigned.length > 1
    ? t("{n} tarjetas asignadas a {name}", { n: assigned.length, name })
    : first.dueDate
      ? t("Asignada a {name} · vence el {date}", { name, date: formatDay(first.dueDate, ctx.today, ctx.locale) })
      : t("Asignada a {name}", { name });
  const undo = undoId
    ? {
        label: t("Deshacer"),
        onClick: () => void ctx.track(undoEntry(undoId)).then((res) => {
          if (!res.ok) return ctx.toast(res.error, "error");
          ctx.toast(undoneText(t, res.data), "undo");
          ctx.refresh();
        }),
      }
    : undefined;
  ctx.toast(message, "undo", undo);
  return true;
}
