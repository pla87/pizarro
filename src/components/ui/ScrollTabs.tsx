"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "./cn";

export interface ScrollTab {
  key: string;
  href: string;
  label: string;
  active: boolean;
}

/**
 * Fila de pestañas (Mi perfil, Ajustes del proyecto, Administración). En el móvil se desplaza en horizontal sin barra
 * visible: al abrirla se deja a la vista la activa y, si quedan pestañas fuera, un degradado con una flecha en ese borde
 * lo indica (desaparece al llegar al final). `note`: aviso bajo la fila (p. ej. una pestaña pedida que no existe).
 */
export function ScrollTabs({ label, tabs, replace = false, note }: { label: string; tabs: ScrollTab[]; replace?: boolean; note?: React.ReactNode }) {
  const navRef = useRef<HTMLElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const activeKey = tabs.find((t) => t.active)?.key;
  // La activa a la vista (sin mover la página).
  useEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && el) nav.scrollLeft = Math.max(0, el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2);
  }, [activeKey]);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const update = () => {
      const left = nav.scrollLeft > 1;
      const right = nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1;
      setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
    };
    update();
    nav.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(nav);
    return () => {
      nav.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  const hint = "pointer-events-none absolute top-0 bottom-px flex w-10 items-center text-slate-400 dark:text-slate-500";
  return (
    <div>
      <div className="relative">
        {/* Solo desplazamiento horizontal: sin barra visible ni desplazamiento vertical (el subrayado de la activa no se recorta). */}
        <nav ref={navRef} className="flex gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-slate-200 [scrollbar-width:none] dark:border-slate-800 [&::-webkit-scrollbar]:hidden" aria-label={label}>
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              replace={replace}
              aria-current={tab.active ? "page" : undefined}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-offset-[-3px]",
                tab.active
                  ? "border-brand-600 text-brand-700 dark:text-brand-100"
                  : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white",
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        {more.left && (
          <span aria-hidden data-scroll-hint="left" className={cn(hint, "left-0 justify-start bg-linear-to-r from-slate-50 from-40% to-transparent dark:from-slate-950")}>
            <ChevronLeft size={16} />
          </span>
        )}
        {more.right && (
          <span aria-hidden data-scroll-hint="right" className={cn(hint, "right-0 justify-end bg-linear-to-l from-slate-50 from-40% to-transparent dark:from-slate-950")}>
            <ChevronRight size={16} />
          </span>
        )}
      </div>
      {note}
    </div>
  );
}

/** Aviso bajo las pestañas cuando la dirección pide una que no existe (o que esta persona no tiene). */
export function UnknownTabNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" data-testid="unknown-tab" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
      {children}
    </p>
  );
}
