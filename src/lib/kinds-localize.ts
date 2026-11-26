/**
 * Tipos de tarea generales de serie en el idioma del usuario. Se guardan en español (migraciones v1.2 y v1.8);
 * quien usa la interfaz en inglés los ve en inglés mientras el valor guardado siga siendo el de serie.
 * Si un administrador los renombró o cambió sus plantillas, se muestra lo que él escribió.
 * Solo para mostrar: el editor de tipos y los ajustes del proyecto trabajan con los valores guardados. Un tipo traducido
 * lleva su nombre guardado en `codeName`.
 */
import type { Locale } from "@/i18n/core";

interface SeedKind {
  name: string;
  titleTemplate: string;
  descriptionTemplate: string;
}

/**
 * Textos de serie que se corrigieron (errata): las instalaciones anteriores a la ronda 69 guardan el viejo («de mi»), que
 * se sigue reconociendo como el de serie (una migración lo pasa al nuevo si nadie lo tocó).
 */
const OLD_DESCRIPTIONS: Record<string, string> = {
  kind_respuesta: "Respondo a las preguntas y lo que necesitas de mi:",
};

/**
 * El texto con el viejo de serie (errata) al principio puesto al nuevo: una tarea creada antes de la ronda 69 empieza por «de mi»
 * y el tipo ya dice «de mí»; así se reconoce como la plantilla del tipo (al cambiar de tipo se quita y al volver a elegirlo
 * no se duplica). El resto del texto no cambia.
 */
export function withCurrentSeedText(text: string): string {
  const start = text.trimStart();
  for (const [id, old] of Object.entries(OLD_DESCRIPTIONS)) {
    if (start.startsWith(old)) return SEEDS[id]!.es.descriptionTemplate + start.slice(old.length);
  }
  return text;
}

const SEEDS: Record<string, { es: SeedKind; en: SeedKind }> = {
  kind_funcionalidad: {
    es: { name: "Funcionalidad", titleTemplate: "", descriptionTemplate: "" },
    en: { name: "Feature", titleTemplate: "", descriptionTemplate: "" },
  },
  kind_correccion: {
    es: { name: "Corrección", titleTemplate: "", descriptionTemplate: "" },
    en: { name: "Bug fix", titleTemplate: "", descriptionTemplate: "" },
  },
  kind_respuesta: {
    es: { name: "Respuesta", titleTemplate: "Respuesta", descriptionTemplate: "Respondo a las preguntas y lo que necesitas de mí:" },
    en: { name: "Reply", titleTemplate: "Reply", descriptionTemplate: "I answer the questions and what you need from me:" },
  },
};

/** Un tipo (con id) traducido; los campos que no coinciden con el valor de serie se dejan tal cual. */
export function localizeGeneralKind<K extends { id: string; name: string }>(kind: K, locale: Locale): K {
  if (locale !== "en") return kind;
  const seed = SEEDS[kind.id];
  if (!seed || kind.name !== seed.es.name) return kind;
  // `codeName`: el nombre guardado, para lo que no debe depender del idioma de quien lo usa (códigos de release, ver
  // computeReleaseCodes).
  const out: Record<string, unknown> = { ...kind, name: seed.en.name, codeName: kind.name };
  const k = kind as Partial<SeedKind>;
  if (k.titleTemplate === seed.es.titleTemplate) out.titleTemplate = seed.en.titleTemplate;
  if (k.descriptionTemplate === seed.es.descriptionTemplate || k.descriptionTemplate === OLD_DESCRIPTIONS[kind.id]) out.descriptionTemplate = seed.en.descriptionTemplate;
  return out as K;
}

/**
 * Nombres de un tipo general de serie en los dos idiomas («Corrección» y «Bug fix»), si su nombre guardado sigue siendo el
 * de serie; [] si no es de serie o un administrador lo renombró. Sirve para reconocerlo al importar una tarea exportada con
 * la interfaz en el otro idioma. Vale con el tipo guardado o con el ya traducido (lleva el guardado en `codeName`).
 */
export function generalKindNames(kind: { id: string; name: string; codeName?: string }): string[] {
  const seed = SEEDS[kind.id];
  if (!seed || (kind.codeName ?? kind.name) !== seed.es.name) return [];
  return [seed.es.name, seed.en.name];
}

export function localizeGeneralKinds<K extends { id: string; name: string }>(kinds: K[], locale: Locale): K[] {
  return locale === "en" ? kinds.map((k) => localizeGeneralKind(k, locale)) : kinds;
}
