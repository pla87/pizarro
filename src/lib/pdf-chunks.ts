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
//   ventana empieza con un bloque nuevo (p. ej. sesiones del programa que siempre se parten entre dos páginas), corta
//   antes del último bloque que empieza en una página: ese salto adelanta un poco el del documento entero.
//
// Funciones puras: report-pdf.tsx las usa en el worker de PDF y las pruebas, sin cargar @react-pdf.

/** Unidad de tamaño: más o menos una línea de texto de 9 pt (unos 12 pt de alto). En una página A4 caben unas 60. */
const LINES_PER_PAGE = 60;
/** Hasta este tamaño estimado (unas 20 páginas) el documento va entero en un solo <Page>. */
export const PDF_SINGLE_PAGE_UNITS = 20 * LINES_PER_PAGE;
/** Tamaño de cada tramo cuando no se puede medir dónde salta de página (unas 5 páginas). */
const PDF_CHUNK_UNITS = 5 * LINES_PER_PAGE;

export interface PdfBlockSize {
  /** Tamaño estimado del bloque (ver LINES_PER_PAGE). */
  units: number;
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
 * ventana). Lo mejor es la última página que empieza con un bloque entero: el tramo acaba justo donde el documento
 * entero salta de página. Si no hay ninguna (todas empiezan con el resto de un bloque partido), antes del bloque partido
 * de la última de esas páginas: ese bloque pasa entero a la página siguiente y deja en blanco lo poco que ocupaba al pie.
 */
export function pickCut(pages: readonly (readonly number[])[]): number | null {
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
  for (let p = pages.length - 2; p >= 1; p--) {
    const o = opening(p);
    if (o && o.block > 0) return o.block;
  }
  return null;
}

/** Tramos por tamaño estimado (de como mucho `max` unidades; un bloque mayor va solo en el suyo): si no se puede medir. */
export function chunkBlocks<B extends PdfBlockSize>(blocks: B[], max: number = PDF_CHUNK_UNITS): B[][] {
  return splitRuns(blocks, (b) => b.units, max);
}
