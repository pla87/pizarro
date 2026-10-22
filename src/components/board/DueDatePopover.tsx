"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addDaysIso, nextWeekdayIso } from "@/lib/dates";
import { useT } from "@/i18n/client";

const WIDTH = 248;

/**
 * Selector de fecha límite junto a una tarjeta (Alt+D): campo de fecha y atajos Hoy / Mañana / Próximo lunes / Sin fecha.
 * Se dibuja en el cuerpo de la página (la tarjeta recorta lo que se sale). Escape o un clic fuera lo cierran sin cambiar nada.
 */
export function DueDatePopover({ anchor, value, today, onPick, onClose }: {
  anchor: HTMLElement;
  value: string | null;
  today: string;
  onPick: (day: string | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Debajo de la tarjeta (o encima si no cabe), sin salirse de la pantalla.
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 160;
    const top = r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6;
    setPos({ top, left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - WIDTH - 8)) });
  }, [anchor]);

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quick: { label: string; day: string | null }[] = [
    { label: t("Hoy"), day: today },
    { label: t("Mañana"), day: addDaysIso(today, 1) },
    { label: t("Próximo lunes"), day: nextWeekdayIso(today, 1) },
    { label: t("Sin fecha"), day: null },
  ];

  return createPortal(
    <div
      ref={ref}
      role="group"
      aria-label={t("Fecha límite")}
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width: WIDTH, visibility: pos ? "visible" : "hidden" }}
      className="fixed z-[60] space-y-2 rounded-lg border border-slate-200 bg-white p-2.5 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
      // Lo que se pulse aquí no debe llegar a la tarjeta (sus atajos, abrirla ni arrastrarla).
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
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
    </div>,
    document.body,
  );
}
