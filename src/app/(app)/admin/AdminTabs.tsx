"use client";

import { usePathname } from "next/navigation";
import { ScrollTabs } from "@/components/ui/ScrollTabs";
import { useT } from "@/i18n/client";

const TABS = [
  { href: "/admin/users", label: "Usuarios" },
  { href: "/admin/projects", label: "Proyectos" },
  { href: "/admin/templates", label: "Tipos y plantillas" },
  { href: "/admin/backups", label: "Copias de seguridad" },
  { href: "/admin/logs", label: "Logs" },
  { href: "/admin/legal", label: "Textos legales" },
  { href: "/admin/settings", label: "Ajustes" },
  { href: "/admin/license", label: "Licencia" },
];

/** Pestañas de la sección de administración; la activa se deduce de la ruta (una ruta que no existe da la página 404). */
export function AdminTabs() {
  const pathname = usePathname();
  const t = useT();
  return <ScrollTabs label={t("Administración")} tabs={TABS.map((tab) => ({ key: tab.href, href: tab.href, label: t(tab.label), active: pathname.startsWith(tab.href) }))} />;
}
