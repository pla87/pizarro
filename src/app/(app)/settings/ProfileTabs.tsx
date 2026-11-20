"use client";

import { ScrollTabs, UnknownTabNote } from "@/components/ui/ScrollTabs";
import { useT } from "@/i18n/client";
import { PROFILE_TABS, type ProfileTab } from "./profile-tabs";

/**
 * Pestañas de «Mi perfil» (mismo estilo que las de administración); la activa va en `?tab=`. `unknown`: la pestaña pedida
 * en la dirección, si no es ninguna (se abre «Cuenta» y se avisa).
 */
export function ProfileTabs({ active, unknown }: { active: ProfileTab; unknown?: string }) {
  const t = useT();
  const shown = PROFILE_TABS.find((tab) => tab.id === active)!;
  return (
    <ScrollTabs
      label={t("Secciones del perfil")}
      replace
      tabs={PROFILE_TABS.map((tab) => ({ key: tab.id, href: `/settings?tab=${tab.id}`, label: t(tab.label), active: tab.id === active }))}
      note={unknown !== undefined && <UnknownTabNote>{t("No hay ninguna sección «{tab}»: se muestra «{shown}».", { tab: unknown, shown: t(shown.label) })}</UnknownTabNote>}
    />
  );
}
