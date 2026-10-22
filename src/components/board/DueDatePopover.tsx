"use client";

import { addDaysIso, nextWeekdayIso } from "@/lib/dates";
import { useT } from "@/i18n/client";
import { PopoverPanel } from "../ui/Popover";

/**
 * Selector de fecha límite junto a una tarjeta (Alt+D): campo de fecha y atajos Hoy / Mañana / Próximo lunes / Sin fecha.
 * Panel flotante común (ui/Popover): se dibuja en el cuerpo de la página (la tarjeta recorta lo que se sale). Escape o un
 * clic fuera lo cierran sin cambiar nada.
 */
export function DueDatePopover({ anchor, value, today, onPick, onClose }: {
  anchor: HTMLElement;
  value: string | null;
  today: string;
  onPick: (day: string | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const quick: { label: string; day: string | null }[] = [
    { label: t("Hoy"), day: today },
    { label: t("Mañana"), day: addDaysIso(today, 1) },
    { label: t("Próximo lunes"), day: nextWeekdayIso(today, 1) },
    { label: t("Sin fecha"), day: null },
  ];

  return (
    <PopoverPanel
      anchor={anchor}
      role="group"
      aria-label={t("Fecha límite")}
      gap={6}
      modal={false}
      // Lo que se pulse aquí no debe llegar a la tarjeta (sus atajos, abrirla ni arrastrarla).
      isolate
      initialFocus={(panel) => panel.querySelector("input")}
      onClose={onClose}
      className="w-[248px] space-y-2 rounded-lg border border-slate-200 bg-white p-2.5 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
    >
      <input
        type="date"
        className="input py-1"
        value={value ?? ""}
        aria-label={t("Fecha límite")}
        onChange={(e) => {
          // Al teclear el año, Chrome emite 0002, 0020… : solo se guarda una fecha completa y válida.
          const v = e.target.value;
          if (v && v.slice(0, 4) >= "1900") onPick(v);
        }}
      />
      <div className="grid grid-cols-2 gap-1.5">
        {quick.map((q) => (
          <button key={q.label} type="button" className="btn-secondary justify-center py-1 text-xs" onClick={() => onPick(q.day)}>
            {q.label}
          </button>
        ))}
      </div>
    </PopoverPanel>
  );
}
