// Reparto de un PDF largo en varios <Page> («tramos»). El motor de paginación de @react-pdf vuelve a maquetar todo lo
// que queda del <Page> en cada salto de página: con un documento entero en un solo <Page>, el tiempo crece con el
// cuadrado de su longitud (una lista de 5.000 subtareas tardaba ~50 s y un programa de 100 sesiones largas pasaba del
// tiempo máximo). Con tramos de pocas páginas, cada <Page> solo pagina lo suyo y el tiempo crece en línea; el pie
// («N / M») sigue contando el total de páginas del documento.
//
// Cada <Page> empieza en una página nueva, así que:
// - Los documentos de hasta PDF_SINGLE_PAGE_UNITS (casi todos) siguen en un solo <Page>, exactamente como antes.
// - En los más largos, cada tramo se corta donde el documento entero saltaría de página: report-pdf.tsx maqueta una
//   ventana de bloques (unas 5 páginas), mira en qué página cae cada uno y corta con pickCut. Si ninguna página de la
//   ventana empieza con un bloque nuevo, la ventana crece con los bloques siguientes; si tampoco, se corta antes de un
//   bloque partido (ese salto adelanta un poco el del documento entero). Para que casi nunca haga falta, los bloques
//   son pequeños: filas de tabla, subtareas, tarjetas y, en el programa, cada párrafo, elemento de lista o línea de
//   código.
//
// Funciones puras: report-pdf.tsx las usa en el worker de PDF y las pruebas, sin cargar @react-pdf.

/** Unidad de tamaño: más o menos una línea de texto de 9 pt (unos 12 pt de alto). En una página A4 caben unas 60. */
const LINES_PER_PAGE = 60;
/** Hasta este tamaño estimado (unas 20 páginas) el documento va entero en un solo <Page>. */
export const PDF_SINGLE_PAGE_UNITS = 20 * LINES_PER_PAGE;
/**
 * Unas 5 páginas: la ventana que se maqueta para buscar dónde cortar cada tramo (y lo que crece si no hay dónde), y el
 * tamaño de cada tramo cuando no se puede medir dónde salta de página.
 */
export const PDF_CHUNK_UNITS = 5 * LINES_PER_PAGE;

export interface PdfBlockSize {
  /** Tamaño estimado del bloque (ver LINES_PER_PAGE). */
  units: number;
  /** Pide ir con el bloque siguiente (un título, la cabecera de una sesión): un corte no los separa. */
  keep?: boolean;
}

/** Líneas que ocupa un texto con `charsPerLine` caracteres por línea (al menos una por párrafo). */
export function textUnits(text: string, charsPerLine: number): number {
  let lines = 0;
  for (const part of text.split("\n")) lines += Math.max(1, Math.ceil(part.length / charsPerLine));
  return lines;
}

export function totalUnits(blocks: readonly PdfBlockSize[]): number {
  return blocks.reduce((n, b) => n + b.units, 0);
}

/** Trozos consecutivos de `items` de como mucho `max` unidades cada uno (al menos un elemento por trozo). */
function splitRuns<T>(items: readonly T[], units: (item: T) => number, max: number): T[][] {
  const runs: T[][] = [];
  let run: T[] = [];
  let size = 0;
  for (const item of items) {
    const u = units(item);
    if (run.length && size + u > max) {
      runs.push(run);
      run = [];
      size = 0;
    }
    run.push(item);
    size += u;
  }
  if (run.length || !runs.length) runs.push(run);
  return runs;
}

/**
 * Dónde cortar el tramo que empieza en una ventana maquetada. `pages[p]`: los elementos de la página p en orden, con el
 * número del bloque al que pertenecen si son su primer elemento, o -1 si son otro elemento del bloque anterior; un
 * elemento partido entre dos páginas sale en las dos. Devuelve cuántos bloques van en el tramo, o null si la ventana no
 * basta (hay que maquetar una mayor).
 *
 * Solo se mira hasta la penúltima página (la última puede estar incompleta o depender de lo que hay después de la
 * ventana). Lo bueno es la última página que empieza con un bloque entero: el tramo acaba justo donde el documento
 * entero salta de página. Si no hay ninguna, null (que la ventana crezca), salvo con `unclean`: entonces se corta antes
 * del bloque partido de la última de esas páginas, que pasa entero a la siguiente. Ese corte deja en blanco al pie lo que
 * el bloque ocupaba en ella (con bloques pequeños, unas líneas; con uno de varias páginas, casi toda) y se lleva consigo
 * los bloques de antes que piden ir con él (`keep`: un título no se queda solo al pie).
 */
export function pickCut(pages: readonly (readonly number[])[], opts: { unclean?: boolean; keep?: (block: number) => boolean } = {}): number | null {
  /** Bloque al que pertenece el primer elemento de la página p, y si empieza en ella. */
  const opening = (p: number): { block: number; starts: boolean } | null => {
    const first = pages[p]![0];
    if (first === undefined) return null;
    if (first >= 0) return { block: first, starts: !pages[p - 1]!.includes(first) };
    for (let q = p - 1; q >= 0; q--) {
      const owner = pages[q]!.findLast((b) => b >= 0);
      if (owner !== undefined) return { block: owner, starts: false };
    }
    return null;
  };
  for (let p = pages.length - 2; p >= 1; p--) {
    const o = opening(p);
    if (o?.starts && o.block > 0) return o.block;
  }
  if (!opts.unclean) return null;
  for (let p = pages.length - 2; p >= 1; p--) {
    const o = opening(p);
    if (!o || o.block <= 0) continue;
    let cut = o.block;
    while (cut > 1 && opts.keep?.(cut - 1)) cut--;
    return cut;
  }
  return null;
}

/** Tramos por tamaño estimado (de como mucho `max` unidades; un bloque mayor va solo en el suyo): si no se puede medir. */
export function chunkBlocks<B extends PdfBlockSize>(blocks: B[], max: number = PDF_CHUNK_UNITS): B[][] {
  return splitRuns(blocks, (b) => b.units, max);
}
