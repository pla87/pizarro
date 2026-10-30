"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/components/ui/cn";
import { useT } from "@/i18n/client";

const TABS = [
  { href: "/admin/users", label: "Usuarios" },
  { href: "/admin/projects", label: "Proyectos" },
  { href: "/admin/types", label: "Tipos de tarea" },
  { href: "/admin/templates", label: "Plantillas de proyecto" },
  { href: "/admin/backups", label: "Copias de seguridad" },
  { href: "/admin/logs", label: "Logs" },
  { href: "/admin/legal", label: "Textos legales" },
  { href: "/admin/settings", label: "Ajustes" },
];

/** Pestañas de la sección de administración; la activa se deduce de la ruta. */
export function AdminTabs() {
  const pathname = usePathname();
  const t = useT();
  const navRef = useRef<HTMLElement>(null);
  // En móvil la fila se desplaza en horizontal: se deja a la vista la pestaña activa (sin mover la página).
  useEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && el) nav.scrollLeft = Math.max(0, el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2);
  }, [pathname]);
  return (
    // Solo desplazamiento horizontal: sin barra visible ni desplazamiento vertical (el subrayado de la activa no se recorta).
    <nav ref={navRef} className="flex gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-slate-200 [scrollbar-width:none] dark:border-slate-800 [&::-webkit-scrollbar]:hidden" aria-label={t("Administración")}>
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-offset-[-3px]",
              active
                ? "border-brand-600 text-brand-700 dark:text-brand-100"
                : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white",
            )}
          >
            {t(tab.label)}
          </Link>
        );
      })}
    </nav>
  );
}
