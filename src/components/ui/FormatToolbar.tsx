"use client";

import { MoreHorizontal } from "lucide-react";
import { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "./cn";

/** Botón de la barra de formato: `title` en español (con el atajo entre paréntesis). */
export interface FormatItem {
  title: string;
  icon: LucideIcon;
  pressed?: boolean;
  run: () => void;
}

/** `null` separa grupos de botones. */
export type FormatItems = (FormatItem | null)[];

/** Orden en que se van quedando botones fuera cuando falta sitio: los últimos de la lista pasan antes a «Más formatos». */
const PRIORITY = [
  "Negrita",
  "Cursiva",
  "Subrayado",
  "Título",
  "Subtítulo",
  "Texto normal",
  "Lista",
  "Lista numerada",
  "Aumentar sangría",
  "Reducir sangría",
  "Enlace",
  "Cita",
  "Código",
  "Bloque de código",
  "Línea horizontal",
  "Tachado",
];
const baseTitle = (title: string) => title.replace(/ \(.*\)$/, "");
const priorityOf = (title: string, index: number) => {
  const p = PRIORITY.indexOf(baseTitle(title));
  return p < 0 ? PRIORITY.length + index : p;
};

// Medidas de la fila (px): botón h-7 w-7, hueco gap-0.5 y separador de 1px con mx-1.
const BTN = 28;
const GAP = 2;
const SEP = 9;

/**
 * Barra de formato compartida por el editor con barra (TipTap) y por el modo Markdown. Siempre ocupa una sola línea: según
 * el ancho disponible (ResizeObserver) muestra los botones más importantes y el resto pasa al menú «Más formatos». Los
 * botones quedan fuera del orden de Tab (Título → descripción directo): se alcanzan con Alt+F10 y las flechas, o con el
 * ratón. Tab o Escape devuelven el foco al texto (`onLeave`).
 */
export function FormatToolbar({ items, onLeave, className }: { items: FormatItems; onLeave: () => void; className?: string }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ right: number; top: number } | null>(null);

  const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;
  useIsoLayout(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setWidth(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Botones visibles: se admiten por prioridad mientras la fila (con el botón de desbordamiento si sobra alguno) quepa.
  const { shown, hidden } = useMemo(() => {
    const buttons = items.map((b, i) => ({ b, i })).filter((x): x is { b: FormatItem; i: number } => x.b !== null);
    const all = new Set(buttons.map((x) => x.i));
    if (width === null) return { shown: all, hidden: [] as FormatItem[] };
    const groupOf = new Map<number, number>();
    let g = 0;
    items.forEach((b, i) => (b === null ? g++ : groupOf.set(i, g)));
    const fits = (set: Set<number>, more: boolean) => {
      const groups = new Set([...set].map((i) => groupOf.get(i))).size;
      const count = set.size + (more ? 1 : 0);
      const elements = count + Math.max(0, groups - 1);
      if (elements === 0) return true;
      return count * BTN + Math.max(0, groups - 1) * SEP + (elements - 1) * GAP <= width;
    };
    if (fits(all, false)) return { shown: all, hidden: [] as FormatItem[] };
    const order = [...buttons].sort((a, b) => priorityOf(a.b.title, a.i) - priorityOf(b.b.title, b.i));
    const set = new Set<number>();
    for (const x of order) {
      const next = new Set(set).add(x.i);
      if (!fits(next, true)) break;
      set.add(x.i);
    }
    return { shown: set, hidden: buttons.filter((x) => !set.has(x.i)).map((x) => x.b) };
  }, [items, width]);

  const closeMenu = (focusMore = false) => {
    setOpen(false);
    if (focusMore) moreRef.current?.focus();
  };

  // El menú se cierra al hacer clic fuera; se recoloca al desplazarse o cambiar el tamaño.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = moreRef.current?.getBoundingClientRect();
      if (r) setPos({ right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 4 });
    };
    place();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || moreRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  // Al abrirse el menú, el foco pasa a su primera opción.
  useEffect(() => {
    if (open && pos) menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    // solo al abrir (pos pasa de null a un valor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos === null]);
  useEffect(() => {
    if (hidden.length === 0) setOpen(false);
  }, [hidden.length]);

  const hiddenPressed = hidden.some((b) => b.pressed);
  // Separadores: solo entre dos grupos que tengan algún botón visible.
  const rendered: ReactNode[] = [];
  let pendingSep = false;
  let any = false;
  items.forEach((b, i) => {
    if (b === null) {
      pendingSep = any;
      return;
    }
    if (!shown.has(i)) return;
    if (pendingSep) rendered.push(<span key={`s${i}`} className="mx-1 h-5 w-px shrink-0 bg-slate-200 dark:bg-slate-700" aria-hidden />);
    pendingSep = false;
    any = true;
    rendered.push(
      <button
        key={b.title}
        type="button"
        title={t(b.title)}
        aria-label={baseTitle(t(b.title))}
        aria-pressed={b.pressed === undefined ? undefined : b.pressed}
        tabIndex={-1}
        // mousedown no debe quitar el foco al texto
        onMouseDown={(e) => e.preventDefault()}
        onClick={b.run}
        className={cn("btn-icon h-7 w-7 shrink-0", b.pressed && "bg-brand-50 text-brand-700 dark:bg-brand-500/20 dark:text-brand-100")}
      >
        {createElement(b.icon, { size: 15 })}
      </button>,
    );
  });

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={t("Formato")}
      className={cn("flex flex-nowrap items-center gap-0.5 overflow-hidden", className)}
      onKeyDown={(e) => {
        // Se recorren los botones de la barra, incluido el de «Más formatos».
        const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          buttons[(index + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length]!.focus();
        } else if (e.key === "ArrowDown" && document.activeElement === moreRef.current) {
          e.preventDefault();
          setOpen(true);
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          buttons[e.key === "Home" ? 0 : buttons.length - 1]!.focus();
        } else if (e.key === "Escape" || (e.key === "Tab" && !e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          onLeave();
        }
      }}
    >
      {rendered}
      {hidden.length > 0 && (
        <button
          ref={moreRef}
          type="button"
          title={t("Más formatos")}
          aria-label={t("Más formatos")}
          aria-haspopup="menu"
          aria-expanded={open}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
          className={cn("btn-icon h-7 w-7 shrink-0", (open || hiddenPressed) && "bg-slate-100 dark:bg-slate-800", hiddenPressed && "text-brand-700 dark:text-brand-100")}
        >
          <MoreHorizontal size={15} />
        </button>
      )}
      {open && hidden.length > 0 && pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={t("Más formatos")}
            style={{ right: pos.right, top: pos.top }}
            className="fixed z-[80] max-h-[70vh] min-w-44 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-slate-800 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            onMouseDown={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              // Los eventos de un portal burbujean al React padre: se atienden aquí y no llegan a la barra ni al diálogo.
              const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                e.stopPropagation();
                buttons[(index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]!.focus();
              } else if (e.key === "Home" || e.key === "End") {
                e.preventDefault();
                e.stopPropagation();
                buttons[e.key === "Home" ? 0 : buttons.length - 1]!.focus();
              } else if (e.key === "Escape" || e.key === "ArrowLeft") {
                e.preventDefault();
                e.stopPropagation();
                closeMenu(true);
              } else if (e.key === "Tab") {
                e.preventDefault();
                e.stopPropagation();
                closeMenu();
                onLeave();
              } else {
                e.stopPropagation();
              }
            }}
          >
            {hidden.map((b) => (
              <button
                key={b.title}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  setOpen(false);
                  b.run();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800",
                  b.pressed && "text-brand-700 dark:text-brand-100",
                )}
              >
                {createElement(b.icon, { size: 15, className: "shrink-0" })}
                <span className="truncate">{t(b.title)}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
