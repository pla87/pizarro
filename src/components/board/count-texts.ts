// Textos con un número que también salen con 1 («1 tarjeta», no «1 tarjetas»).
import type { T } from "@/i18n/shared";

/** Contador de tarjetas del tablero y de la vista de lista. */
export const cardCount = (t: T, n: number): string => (n === 1 ? t("1 tarjeta") : t("{n} tarjetas", { n }));

/** Aviso al pegar o añadir subtareas que no caben todas (`added` añadidas, `skipped` fuera por el máximo `max`). */
export function subtasksDidNotFit(t: T, added: number, skipped: number, max: number): string {
  if (added === 1) {
    return skipped === 1 ? t("Se añadió 1 subtarea; 1 no cabe (máximo {max} por tarea).", { max }) : t("Se añadió 1 subtarea; {m} no caben (máximo {max} por tarea).", { m: skipped, max });
  }
  return skipped === 1
    ? t("Se añadieron {n} subtareas; 1 no cabe (máximo {max} por tarea).", { n: added, max })
    : t("Se añadieron {n} subtareas; {m} no caben (máximo {max} por tarea).", { n: added, m: skipped, max });
}
