"use client";

import { useIntlLocale, useT } from "@/i18n/client";
import type { RecurrenceRule } from "@/lib/recurrence-date";
import { cn } from "../ui/cn";
import { weekdayName } from "./recurrence-ui";

/**
 * Selector «Repetir» (no se repite, cada día, cada semana o cada mes) y, en las dos últimas, el día de la semana o del mes.
 * Lo usan el detalle de la tarea y «Nueva tarea». `id` va al primer selector (para su <label>).
 */
export function RecurrencePicker({
  id,
  rule,
  day,
  onRule,
  onDay,
  disabled,
  className = "flex gap-1",
  selectClassName,
}: {
  id?: string;
  rule: RecurrenceRule;
  day: number | null;
  onRule: (rule: RecurrenceRule) => void;
  onDay: (day: number) => void;
  disabled?: boolean;
  /** Contenedor de los dos selectores (por defecto, en fila). */
  className?: string;
  selectClassName?: string;
}) {
  const t = useT();
  const locale = useIntlLocale();
  return (
    <div className={className}>
      <select id={id} className={cn("input min-w-0", selectClassName)} value={rule} disabled={disabled} onChange={(e) => onRule(e.target.value as RecurrenceRule)}>
        <option value="NONE">{t("No se repite")}</option>
        <option value="DAILY">{t("Cada día")}</option>
        <option value="WEEKLY">{t("Cada semana")}</option>
        <option value="MONTHLY">{t("Cada mes")}</option>
      </select>
      {rule === "WEEKLY" && (
        <select className={cn("input min-w-0", selectClassName)} value={day ?? 1} disabled={disabled} onChange={(e) => onDay(Number(e.target.value))} aria-label={t("Día de la semana")}>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{weekdayName(d, locale)}</option>)}
        </select>
      )}
      {rule === "MONTHLY" && (
        <select className={cn("input min-w-0", selectClassName)} value={day ?? 1} disabled={disabled} onChange={(e) => onDay(Number(e.target.value))} aria-label={t("Día del mes")}>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{t("día {n}", { n: d })}</option>)}
        </select>
      )}
    </div>
  );
}
