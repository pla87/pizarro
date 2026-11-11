import type { MetadataRoute } from "next";
import { makeT, type Locale } from "../i18n/core";

/**
 * Manifiesto para instalar Pizarro como app (Android, iPhone, escritorio) en el idioma indicado: el de la instalación.
 * No puede ser el de cada persona: el navegador lo pide sin cookies (sin sesión) y lo guarda al instalar la app.
 */
export function webManifest(locale: Locale): MetadataRoute.Manifest {
  const t = makeT(locale);
  return {
    name: "Pizarro",
    short_name: "Pizarro",
    description: t("Kanban ligero y generador de release notes."),
    lang: locale,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b1020",
    theme_color: "#4f46e5",
    // Accesos directos al mantener pulsado el icono de la app instalada.
    shortcuts: [
      { name: t("Mis tareas"), short_name: t("Mis tareas"), url: "/my-tasks", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: t("Avisos"), short_name: t("Avisos"), url: "/notifications", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
