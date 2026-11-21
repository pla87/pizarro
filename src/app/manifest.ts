import type { MetadataRoute } from "next";
import { getAppIcon, getAppShortName } from "@/lib/app-icon";
import { getInstanceSettings } from "@/lib/instance";
import { webManifest } from "@/lib/web-manifest";

// Se genera en cada petición (no al compilar): sale en el idioma de la instalación, que se elige en /setup y puede
// cambiarse después, con el nombre de la organización y el color del icono elegidos en Administración → Ajustes.
export const dynamic = "force-dynamic";

/** Manifiesto para instalar Pizarro como app en Android, iPhone y escritorio. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const [instance, appIcon, shortName] = await Promise.all([getInstanceSettings(), getAppIcon(), getAppShortName()]);
  return webManifest(instance.locale, { orgName: instance.orgName, appIcon, shortName });
}
