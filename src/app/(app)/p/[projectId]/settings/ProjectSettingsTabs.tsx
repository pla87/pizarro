"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ScrollTabs, UnknownTabNote } from "@/components/ui/ScrollTabs";
import { useT } from "@/i18n/client";
import { availableProjectTabs, PROJECT_SETTINGS_TABS, SECTION_TAB, type ProjectSettingsTab } from "./project-settings-tabs";

/**
 * Pestañas de «Ajustes del proyecto» (mismo estilo que administración y el perfil); la activa va en `?tab=`. `unknown`:
 * la pestaña pedida en la dirección, si no es ninguna de las de esta persona (se abre la primera y se avisa).
 */
export function ProjectSettingsTabs({ projectId, active, canManage, unknown, restricted }: { projectId: string; active: ProjectSettingsTab; canManage: boolean; unknown?: string; restricted?: ProjectSettingsTab }) {
  const t = useT();
  const router = useRouter();
  // Enlaces antiguos o externos con ancla (`/settings#labels`) sin `?tab=`: se abre la pestaña de esa sección.
  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    const tab = SECTION_TAB[anchor];
    if (tab && tab !== active && !new URLSearchParams(window.location.search).has("tab")) {
      router.replace(`/p/${projectId}/settings?tab=${tab}#${anchor}`);
    }
  }, [active, projectId, router]);
  const tabs = availableProjectTabs(canManage);
  const shown = tabs.find((tab) => tab.id === active)!;
  return (
    <ScrollTabs
      label={t("Secciones del proyecto")}
      replace
      tabs={tabs.map((tab) => ({ key: tab.id, href: `/p/${projectId}/settings?tab=${tab.id}`, label: t(tab.label), active: tab.id === active }))}
      note={
        restricted ? (
          <UnknownTabNote>{t("«{tab}» solo la ve quien gestiona el proyecto: se muestra «{shown}».", { tab: t(PROJECT_SETTINGS_TABS.find((tab) => tab.id === restricted)!.label), shown: t(shown.label) })}</UnknownTabNote>
        ) : unknown !== undefined && (
          <UnknownTabNote>{t("No hay ninguna sección «{tab}»: se muestra «{shown}».", { tab: unknown, shown: t(shown.label) })}</UnknownTabNote>
        )
      }
    />
  );
}
