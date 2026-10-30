// Parte pura (sin base de datos) de los textos legales editables (/privacy y /terms): claves, textos por defecto,
// sustitución de {responsable} y {email} y la regla de qué texto se muestra según el idioma.
import { translate, type Locale } from "@/i18n/core";

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
  const t = (text: string, vars?: Record<string, string>) => translate(locale, text, vars);
  const vars = { responsable: "{responsable}", contact: "{email}" };
  const sections: [string, string][] =
    kind === "privacy"
      ? [
          [t("Quién trata tus datos"), t("Esta instalación de Pizarro la gestiona {responsable}, no sus desarrolladores. Para cualquier duda sobre tus datos, contacta con {contact}.", vars)],
          [t("Qué datos se guardan"), t("Tu cuenta (nombre, email y contraseña cifrada), las tareas, comentarios y archivos que tú o tu equipo añadís, y un registro de actividad para la seguridad y el soporte.")],
          [t("Acceso con Google"), t("Si entras con Google, Pizarro solo lee tu nombre, tu email y tu perfil básico para reconocer tu cuenta. Si conectas Google Docs o Sheets, el permiso de Drive se limita a los archivos que crea la propia aplicación; Pizarro no ve el resto de tu Drive.")],
          [t("Uso y venta de datos"), t("Tus datos no se venden ni se ceden a terceros ni se usan para publicidad. Solo se usan para que la aplicación funcione para ti y tu equipo.")],
          [t("Tus derechos"), t("Contactando con {contact}, puedes pedir que te muestren, corrijan o eliminen tus datos.", vars)],
        ]
      : [
          [t("Uso del servicio"), t("Pizarro es una herramienta de trabajo en equipo que opera su administrador. Solo pueden usarla las personas a las que el administrador ha dado de alta.")],
          [t("Tu responsabilidad"), t("Guarda tus credenciales con cuidado y no subas contenido ilegal ni de terceros sin permiso. El administrador puede suspender cuentas que incumplan estas condiciones.")],
          [t("Disponibilidad"), t("El servicio se ofrece tal cual, sin garantía de disponibilidad continua. El administrador hace copias de seguridad, pero conviene conservar una copia de lo importante.")],
          [t("Datos personales"), t("El tratamiento de tus datos se describe en la política de privacidad de esta instalación.")],
          [t("Contacto"), t("Para cualquier duda, contacta con {contact}.", vars)],
        ];
  return sections.map(([h, body]) => `## ${h}\n\n${body}`).join("\n\n");
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
