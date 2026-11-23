// Ayuda de las pruebas de paginación de los PDF largos (report-pages*.test.ts): textos de relleno, el texto de cada
// página y la comparación entre el documento en un solo <Page> y en tramos. Repartidas en dos ficheros para que
// `node --test` las lance en paralelo (cada fichero con su propio worker de PDF).
import assert from "node:assert/strict";
import { after } from "node:test";
import { pdfPageRuns } from "./pdf-runs";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://none:none@localhost:5432/none";
export const { renderInWorker, stopPdfWorker } = await import("../src/lib/report-render");
export type PdfJob = import("../src/lib/report-pdf").PdfJob;

after(() => stopPdfWorker());

export const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua";
export const words = (i: number, n: number) => lorem.split(" ").slice(0, 2 + ((i * 7) % n)).join(" ");

/** Texto de cada página del PDF. */
export const pagesText = async (job: PdfJob) => pdfPageRuns(await renderInWorker(job)).map((runs) => runs.join(""));

/** El pie de cada página dice «N / total», seguidos. */
export function assertFooters(pages: string[]) {
  pages.forEach((text, i) => assert.ok(text.includes(`${i + 1} / ${pages.length}`), `página ${i + 1}: falta «${i + 1} / ${pages.length}»`));
}

/**
 * El mismo documento en un solo <Page> (como antes) y en tramos (forzados con `singlePageUnits: 0`, para no necesitar
 * documentos de más de 20 páginas): mismas páginas con el mismo texto. Devuelve las páginas en tramos, para no volver
 * a generarlas.
 */
export async function assertSamePages(job: PdfJob, minPages: number): Promise<string[]> {
  const single = await pagesText({ ...job, singlePageUnits: Infinity });
  const chunked = await pagesText({ ...job, singlePageUnits: 0 });
  assert.ok(single.length >= minPages, `${single.length} páginas: el documento de la prueba debería ser más largo`);
  assert.equal(chunked.length, single.length);
  chunked.forEach((text, i) => assert.equal(text, single[i], `página ${i + 1} distinta`));
  assertFooters(chunked);
  return chunked;
}
