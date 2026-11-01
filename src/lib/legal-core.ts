// Parte pura (sin base de datos) de los textos legales editables (/privacy y /terms): claves, textos por defecto,
// sustitución de {responsable} y {email} y la regla de qué texto se muestra según el idioma.
import { translate, type Locale } from "@/i18n/core";
import { LEGAL_DEFAULTS } from "./legal-defaults";

export type LegalKind = "privacy" | "terms";
export const LEGAL_KINDS: readonly LegalKind[] = ["privacy", "terms"];
/** Máximo de caracteres de cada texto (Markdown). */
export const LEGAL_MAX = 50_000;
/** Máximo del nombre del responsable. */
export const LEGAL_RESPONSIBLE_MAX = 200;

export const LEGAL_RESPONSIBLE_KEY = "legal.responsible";
export const legalTextKey = (kind: LegalKind, locale: Locale) => `legal.${kind}.${locale}`;
export const legalUpdatedKey = (kind: LegalKind) => `legal.${kind}.updatedAt`;

export const isLegalKind = (v: unknown): v is LegalKind => v === "privacy" || v === "terms";

/** Texto por defecto (Markdown, con {responsable} y {email} sin sustituir) en el idioma pedido. */
export function defaultLegalMarkdown(kind: LegalKind, locale: Locale): string {
  return LEGAL_DEFAULTS[kind][locale];
}

/** Sustituye {responsable} y {email}; sin ellos usa «el administrador de esta instalación». Si falta el email se nombra al responsable. */
export function fillLegalPlaceholders(text: string, locale: Locale, responsible: string, email: string): string {
  const admin = translate(locale, "el administrador de esta instalación");
  const resp = responsible.trim() || admin;
  const mail = email.trim() || responsible.trim() || admin;
  return text.replace(/\{(responsable|email)\}/g, (_m, k: string) => (k === "responsable" ? resp : mail));
}

export interface LegalTexts {
  es: string;
  en: string;
}

/**
 * Qué texto se muestra: el propio del idioma si existe; en inglés sin texto inglés pero con texto español propio, el español
 * (el texto legal del responsable manda sobre el genérico); si no, el texto por defecto.
 */
export function pickLegalText(custom: LegalTexts, locale: Locale): { source: "custom" | "custom-es-fallback" | "default"; text: string; locale: Locale } {
  const own = custom[locale].trim();
  if (own) return { source: "custom", text: own, locale };
  if (locale === "en" && custom.es.trim()) return { source: "custom-es-fallback", text: custom.es.trim(), locale: "es" };
  return { source: "default", text: "", locale };
}

/** Valida un texto legal: cadena de hasta LEGAL_MAX caracteres. Devuelve el texto (sin espacios en los extremos) o un error. */
export function validateLegalText(v: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof v !== "string") return { ok: false, error: "El texto no es válido." };
  if (v.length > LEGAL_MAX) return { ok: false, error: "El texto es demasiado largo (máximo 50 000 caracteres)." };
  return { ok: true, value: v.replace(/\r\n/g, "\n").trim() };
}
