// Orden de los proyectos de cada usuario en el selector de la barra lateral y en sus listas (Mi perfil → Preferencias).
// Funciones puras: sin base de datos ni zod (también las usa el navegador).

export const PROJECT_ORDER_VALUES = ["RECENT", "ALPHABETICAL"] as const;

export type ProjectOrderValue = (typeof PROJECT_ORDER_VALUES)[number];

const collators = new Map<string, Intl.Collator>();
function collator(locale: string): Intl.Collator {
  let c = collators.get(locale);
  if (!c) {
    // Sin distinguir mayúsculas ni acentos («árbol» junto a «Arco»); los números, por su valor («Fase 2» antes que «Fase 10»).
    c = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    collators.set(locale, c);
  }
  return c;
}

/**
 * Ordena los proyectos según la preferencia. `rows` llega en el orden de siempre (posición y fecha de creación), que es
 * el desempate: con «Usados recientemente» primero el abierto hace menos y después, en ese orden, los que nunca se han
 * abierto (una cuenta sin visitas ve la lista como antes); con «Alfabético», por nombre en el idioma de la interfaz.
 */
export function sortProjects<T extends { name: string; visitedAt?: Date | null }>(rows: readonly T[], order: ProjectOrderValue, locale: string): T[] {
  const indexed = rows.map((row, i) => ({ row, i }));
  if (order === "ALPHABETICAL") {
    const c = collator(locale);
    indexed.sort((a, b) => c.compare(a.row.name.trim(), b.row.name.trim()) || a.i - b.i);
  } else {
    const time = (r: T) => r.visitedAt?.getTime() ?? -Infinity;
    indexed.sort((a, b) => time(b.row) - time(a.row) || a.i - b.i);
  }
  return indexed.map((x) => x.row);
}
