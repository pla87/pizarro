import type { MetadataRoute } from "next";
import { getInstanceSettings } from "@/lib/instance";
import { webManifest } from "@/lib/web-manifest";

// Se genera en cada petición (no al compilar): sale en el idioma de la instalación, que se elige en /setup y puede
// cambiarse después. Antes estaba fijo en español.
export const dynamic = "force-dynamic";

/** Manifiesto para instalar Pizarro como app en Android, iPhone y escritorio. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  return webManifest((await getInstanceSettings()).locale);
}
