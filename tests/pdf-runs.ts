// Ayuda de las pruebas: textos que pinta un PDF generado (para comprobar su contenido sin herramientas externas).
import { inflateSync } from "node:zlib";

/** Textos que pinta un PDF de @react-pdf: cada operador TJ (cadenas hexadecimales en WinAnsi) de los flujos comprimidos. */
export function pdfRuns(pdf: Uint8Array): string[] {
  return pdfPageRuns(pdf).flat();
}

/** Lo mismo, por página (cada página de @react-pdf es un flujo; los que no pintan texto, como las fuentes, no cuentan). */
export function pdfPageRuns(pdf: Uint8Array): string[][] {
  const buf = Buffer.from(pdf);
  const raw = buf.toString("latin1");
  const dec = new TextDecoder("windows-1252");
  const pages: string[][] = [];
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    let content: string;
    try {
      content = inflateSync(buf.subarray(start, raw.indexOf("endstream", start))).toString("latin1");
    } catch {
      continue;
    }
    const runs: string[] = [];
    for (const tj of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const hex = [...tj[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join("");
      runs.push(dec.decode(Buffer.from(hex, "hex")));
    }
    if (runs.length) pages.push(runs);
  }
  return pages;
}
