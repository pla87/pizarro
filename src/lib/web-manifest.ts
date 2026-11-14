import type { MetadataRoute } from "next";
import { makeT, type Locale } from "../i18n/core";
import { appIconColor, appIconUrl, appNames, DEFAULT_APP_ICON, type AppIconAccent } from "./app-icon-core";

/**
 * Manifiesto para instalar Pizarro como app (Android, iPhone, escritorio) en el idioma indicado: el de la instalación.
 * No puede ser el de cada persona: el navegador lo pide sin cookies (sin sesión) y lo guarda al instalar la app. Por lo
 * mismo, el icono va en el color elegido para la instalación (Administración → Ajustes → «Icono de la app») y el nombre
 * bajo el icono es el de la organización: dos instalaciones en el mismo móvil se distinguen.
 */
export function webManifest(locale: Locale, opts: { orgName?: string; appIcon?: AppIconAccent } = {}): MetadataRoute.Manifest {
  const t = makeT(locale);
  const icon = opts.appIcon ?? DEFAULT_APP_ICON;
  const { name, shortName } = appNames(opts.orgName ?? "");
  const small = { src: appIconUrl(icon, "icon-192.png"), sizes: "192x192", type: "image/png" };
  return {
    // Identidad fija: la app instalada sigue siendo la misma aunque cambien el nombre o el icono (se actualiza, no se duplica).
    id: "/",
    name,
    short_name: shortName,
    description: t("Kanban ligero y generador de release notes."),
    lang: locale,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b1020",
    theme_color: appIconColor(icon),
    // Accesos directos al mantener pulsado el icono de la app instalada.
    shortcuts: [
      { name: t("Mis tareas"), short_name: t("Mis tareas"), url: "/my-tasks", icons: [small] },
      { name: t("Avisos"), short_name: t("Avisos"), url: "/notifications", icons: [small] },
    ],
    icons: [
      small,
      { src: appIconUrl(icon, "icon-512.png"), sizes: "512x512", type: "image/png" },
      { src: appIconUrl(icon, "icon-maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
