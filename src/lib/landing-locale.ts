// Idioma de la página pública de presentación: parámetro ?lang=, si no el del navegador (Accept-Language) y,
// si tampoco sirve, el de la instalación. Función pura para poder probarla.
import type { Locale } from "@/i18n/core";

/** Primer idioma admitido (es/en) de una cabecera Accept-Language, respetando el orden de preferencia. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const items = header
    .split(",")
    .map((part, i) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, i };
    })
    .filter((x) => x.tag && x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.i - b.i);
  for (const { tag } of items) {
    const base = tag.split("-")[0];
    if (base === "en") return "en";
    if (base === "es") return "es";
  }
  return null;
}

export function pickLandingLocale(input: { lang?: string | null; acceptLanguage?: string | null; fallback: Locale }): Locale {
  if (input.lang === "en" || input.lang === "es") return input.lang;
  return localeFromAcceptLanguage(input.acceptLanguage) ?? input.fallback;
}
