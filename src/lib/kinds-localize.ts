/**
 * Tipos de tarea generales de serie en el idioma del usuario. Se guardan en español (migraciones v1.2 y v1.8);
 * quien usa la interfaz en inglés los ve en inglés mientras el valor guardado siga siendo el de serie.
 * Si un administrador los renombró o cambió sus plantillas, se muestra lo que él escribió.
 * Solo para mostrar: el editor de tipos y los ajustes del proyecto trabajan con los valores guardados.
 */
import type { Locale } from "@/i18n/core";

interface SeedKind {
  name: string;
  titleTemplate: string;
  descriptionTemplate: string;
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
    es: { name: "Respuesta", titleTemplate: "Respuesta", descriptionTemplate: "Respondo a las preguntas y lo que necesitas de mi:" },
    en: { name: "Reply", titleTemplate: "Reply", descriptionTemplate: "I answer the questions and what you need from me:" },
  },
};

/** Un tipo (con id) traducido; los campos que no coinciden con el valor de serie se dejan tal cual. */
export function localizeGeneralKind<K extends { id: string; name: string }>(kind: K, locale: Locale): K {
  if (locale !== "en") return kind;
  const seed = SEEDS[kind.id];
  if (!seed || kind.name !== seed.es.name) return kind;
  const out: Record<string, unknown> = { ...kind, name: seed.en.name };
  const k = kind as Partial<SeedKind>;
  if (k.titleTemplate === seed.es.titleTemplate) out.titleTemplate = seed.en.titleTemplate;
  if (k.descriptionTemplate === seed.es.descriptionTemplate) out.descriptionTemplate = seed.en.descriptionTemplate;
  return out as K;
}

export function localizeGeneralKinds<K extends { id: string; name: string }>(kinds: K[], locale: Locale): K[] {
  return locale === "en" ? kinds.map((k) => localizeGeneralKind(k, locale)) : kinds;
}
