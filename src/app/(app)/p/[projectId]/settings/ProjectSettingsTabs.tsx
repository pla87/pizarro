"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { useT } from "@/i18n/client";
import { availableProjectTabs, SECTION_TAB, type ProjectSettingsTab } from "./project-settings-tabs";

/** Pestañas de «Ajustes del proyecto» (mismo estilo que administración y el perfil); la activa va en `?tab=`. */
export function ProjectSettingsTabs({ projectId, active, canManage }: { projectId: string; active: ProjectSettingsTab; canManage: boolean }) {
  const t = useT();
  const router = useRouter();
  const navRef = useRef<HTMLElement>(null);
  // En móvil la fila puede desplazarse en horizontal: se deja a la vista la pestaña activa (sin mover la página).
  useEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav && el) nav.scrollLeft = Math.max(0, el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2);
  }, [active]);
  // Enlaces antiguos o externos con ancla (`/settings#labels`) sin `?tab=`: se abre la pestaña de esa sección.
  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    const tab = SECTION_TAB[anchor];
    if (tab && tab !== active && !new URLSearchParams(window.location.search).has("tab")) {
      router.replace(`/p/${projectId}/settings?tab=${tab}#${anchor}`);
    }
  }, [active, projectId, router]);
  return (
    <nav ref={navRef} className="flex gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-slate-200 [scrollbar-width:none] dark:border-slate-800 [&::-webkit-scrollbar]:hidden" aria-label={t("Secciones del proyecto")}>
      {availableProjectTabs(canManage).map((tab) => {
        const on = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={`/p/${projectId}/settings?tab=${tab.id}`}
            replace
            aria-current={on ? "page" : undefined}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-offset-[-3px]",
              on
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
