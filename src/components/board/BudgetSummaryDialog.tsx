"use client";

import { useIntlLocale, useT } from "@/i18n/client";
import { budgetSummary, formatEuro } from "@/lib/task-fields";
import type { BoardColumn } from "@/lib/types";
import { Modal } from "../ui/Modal";
import { useTasks } from "./context";

/** Resumen de una columna «Presupuesto»: coste pagado, pendiente y total de sus tareas no archivadas. */
export function BudgetSummaryDialog({ column, onClose }: { column: BoardColumn; onClose: () => void }) {
  const t = useT();
  const locale = useIntlLocale();
  const tasks = useTasks();
  const sum = budgetSummary(tasks.filter((x) => x.columnId === column.id));
  const rows: { label: string; value: number; strong?: boolean }[] = [
    { label: t("Pagado"), value: sum.paid },
    { label: t("Pendiente"), value: sum.pending },
    { label: t("Total"), value: sum.total, strong: true },
  ];
  return (
    <Modal open onClose={onClose} size="sm" title={t("Resumen de presupuesto")} footer={<button type="button" className="btn-primary" onClick={onClose}>{t("Cerrar")}</button>}>
      <p className="mb-3 text-sm text-slate-500">{t("Tareas con coste en «{name}»: {n}", { name: column.name, n: sum.count })}</p>
      <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-3 py-2">
            <dt className={r.strong ? "font-semibold" : ""}>{r.label}</dt>
            <dd className={r.strong ? "font-semibold tabular-nums" : "tabular-nums"}>{formatEuro(r.value / 100, locale)}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
