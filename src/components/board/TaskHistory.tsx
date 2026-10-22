"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getTaskHistory } from "@/actions/tasks";
import { useIntlLocale, useT } from "@/i18n/client";
import { formatDate } from "@/lib/format";
import type { TaskHistoryItem } from "@/lib/task-events";
import { cn } from "../ui/cn";

/** Historial de cambios de la tarea: cerrado por defecto y se carga al abrirlo. */
export function TaskHistory({ taskId }: { taskId: string }) {
  const t = useT();
  const locale = useIntlLocale();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TaskHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Se vuelve a leer cada vez que se abre (los cambios recientes no estarían en una copia vieja).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    getTaskHistory(taskId).then((res) => {
      if (!alive) return;
      setError(res.ok ? null : res.error);
      if (res.ok) setItems(res.data);
    });
    return () => {
      alive = false;
    };
  }, [open, taskId]);

  return (
    <section>
      <button type="button" className="flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-brand-600 dark:text-slate-300" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ChevronRight size={15} className={cn("transition-transform", open && "rotate-90")} /> {t("Historial")}
      </button>
      {open && (
        <div className="mt-2">
          {error ? (
            <p className="text-xs text-red-600">{error}</p>
          ) : items === null ? (
            <p className="flex items-center gap-1.5 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" /> {t("Cargando…")}</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-slate-400">{t("Aún no hay cambios registrados.")}</p>
          ) : (
            <ul className="space-y-1.5 border-l-2 border-slate-200 pl-3 text-xs dark:border-slate-700">
              {items.map((e) => (
                <li key={e.id}>
                  <span className="font-medium">{e.userName}</span> <span className="text-slate-600 dark:text-slate-300">{e.text}</span>
                  <time className="ml-1.5 text-slate-400">{formatDate(e.createdAt, "dateTimeShort", locale)}</time>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
