import type { MetadataRoute } from "next";

/** Manifiesto para instalar Tablón como app en Android, iPhone y escritorio. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tablón",
    short_name: "Tablón",
    description: "Kanban ligero y generador de release notes.",
    lang: "es",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b1020",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
