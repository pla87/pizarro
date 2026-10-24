// Reparto de los adjuntos de una release en varios paquetes ZIP, cada uno dentro del tope del proyecto.

export interface PlanItem {
  /** Posición del fichero en el orden original (se conserva dentro de cada paquete). */
  index: number;
  /** Peso en bytes (tamaño del fichero más el estimado de cabeceras del ZIP). */
  size: number;
}

export interface ZipPackage {
  /** Índices originales de los ficheros, en su orden original. */
  items: number[];
  bytes: number;
  /** Un único fichero mayor que el tope: va solo en su paquete. */
  oversize: boolean;
}

/** Bytes que añade el ZIP por fichero (cabecera local + entrada del directorio central), para el reparto. */
export function zipEntryOverhead(name: string): number {
  return 30 + 46 + 2 * new TextEncoder().encode(name).length;
}

/**
 * First-fit decreasing: los ficheros se ordenan de mayor a menor y cada uno va al primer paquete donde cabe;
 * si no cabe en ninguno se abre otro. Un fichero mayor que el tope va solo y se marca `oversize`.
 * Es determinista (a igual tamaño, manda el orden original), así que repetirlo da siempre el mismo reparto.
 */
export function planPackages(items: PlanItem[], maxBytes: number): ZipPackage[] {
  const packages: ZipPackage[] = [];
  const sorted = [...items].sort((a, b) => b.size - a.size || a.index - b.index);
  for (const it of sorted) {
    if (it.size > maxBytes) {
      packages.push({ items: [it.index], bytes: it.size, oversize: true });
      continue;
    }
    const target = packages.find((p) => !p.oversize && p.bytes + it.size <= maxBytes);
    if (target) {
      target.items.push(it.index);
      target.bytes += it.size;
    } else packages.push({ items: [it.index], bytes: it.size, oversize: false });
  }
  for (const p of packages) p.items.sort((a, b) => a - b);
  // Orden estable de los paquetes: por el primer fichero que contienen.
  packages.sort((a, b) => a.items[0]! - b.items[0]!);
  return packages;
}

/** Sufijo «-1de3» de los paquetes cuando hay más de uno; vacío con un solo paquete. */
export function partSuffix(part: number, total: number): string {
  return total > 1 ? `-${part}de${total}` : "";
}
