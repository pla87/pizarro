import type { T } from "@/i18n/core";

/**
 * Texto del aviso tras deshacer o rehacer: el propio de la acción si el servidor lo da (`done`, p. ej. «Deshecho el cambio
 * de tipo de «X»»); si no, «Deshecho: {etiqueta}». Con `skipped`, que parte ya no existía.
 */
export function undoneText(t: T, res: { label: string; done?: string; skipped?: number }, redo = false): string {
  const { label, done, skipped } = res;
  if (done) return skipped ? t("{text} (parte ya no existía)", { text: done }) : done;
  if (redo) return skipped ? t("Rehecho: {label} (parte ya no existía)", { label }) : t("Rehecho: {label}", { label });
  return skipped ? t("Deshecho: {label} (parte ya no existía)", { label }) : t("Deshecho: {label}", { label });
}
