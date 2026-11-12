// Orden de los adjuntos de una tarea al listarlos: alfabético por nombre, natural («foto 2» antes que «foto 10») y sin
// distinguir mayúsculas ni acentos. A igualdad de nombre, el orden de llegada (estable).

const collators = new Map<string, Intl.Collator>();
function collator(locale?: string): Intl.Collator {
  const key = locale ?? "";
  let c = collators.get(key);
  if (!c) {
    c = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    collators.set(key, c);
  }
  return c;
}

/** Compara dos nombres de archivo en orden natural, sin mayúsculas ni acentos. */
function compareFileNames(a: string, b: string, locale?: string): number {
  return collator(locale).compare(a, b);
}

/** Copia ordenada por nombre (`name` lo saca de cada elemento); no cambia la lista recibida. */
export function sortByFileName<T>(list: readonly T[], name: (item: T) => string, locale?: string): T[] {
  return list
    .map((item, i) => ({ item, i }))
    .sort((x, y) => compareFileNames(name(x.item), name(y.item), locale) || x.i - y.i)
    .map((x) => x.item);
}
