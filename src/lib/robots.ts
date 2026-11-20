// Indexación de una instalación. Una instalación de Pizarro es privada: /robots.txt pide a los buscadores que no rastreen
// nada y todas las páginas llevan <meta name="robots" content="noindex"> (layout raíz). La única excepción es quien sirve
// la presentación del producto en su raíz (LANDING_AT_ROOT=1): entonces «/», /presentacion y /licencia sí se pueden
// indexar; el resto sigue cerrado. La web del producto (getpizarro.com, site/) tiene su propio robots.txt.
import type { MetadataRoute } from "next";

/** Con LANDING_AT_ROOT=1 la instalación hace también de web pública del producto. */
export function landingIsPublic(env: string | undefined = process.env.LANDING_AT_ROOT): boolean {
  return env === "1";
}

/** Contenido de /robots.txt. */
export function robotsRules(landingPublic: boolean): MetadataRoute.Robots {
  if (!landingPublic) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: ["/$", "/presentacion", "/licencia"], disallow: "/" } };
}

/** Metadatos de indexación de /presentacion y /licencia (las demás páginas heredan el noindex del layout raíz). */
export function productPageRobots(landingPublic: boolean) {
  return landingPublic ? { index: true, follow: true } : { index: false, follow: false };
}
