"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { useT } from "@/i18n/client";

const TABS = [
  { href: "/admin/users", label: "Usuarios" },
  { href: "/admin/projects", label: "Proyectos" },
  { href: "/admin/types", label: "Tipos de tarea" },
  { href: "/admin/templates", label: "Plantillas" },
  { href: "/admin/backups", label: "Copias de seguridad" },
  { href: "/admin/logs", label: "Logs" },
];

/** Pestañas de la sección de administración; la activa se deduce de la ruta. */
export function AdminTabs() {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800" aria-label={t("Administración")}>
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
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
