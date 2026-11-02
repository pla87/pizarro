// Hilo aparte (worker_thread) que genera los PDF con @react-pdf/renderer. El proceso web prepara los datos (consultas,
// permisos) y le manda un objeto serializable (PdfJob); aquí solo se pinta el PDF y se devuelve el fichero. Así el
// render, que con miles de tareas ocupa la CPU varios segundos, no frena el tablero ni el resto de peticiones.
// En producción se ejecuta empaquetado (dist/pdf-worker.mjs, ver scripts/postbuild.mjs); en desarrollo y en los
// tests, desde este fichero con tsx (ver report-render.ts).
import { parentPort } from "node:worker_threads";
import { renderPdfJob, type PdfJob } from "./report-pdf";

export interface PdfWorkerRequest {
  id: number;
  job: PdfJob;
}

export type PdfWorkerResponse = { id: number; ok: true; pdf: ArrayBuffer } | { id: number; ok: false; error: string };

const port = parentPort;
if (!port) throw new Error("report-pdf-worker solo se ejecuta como worker_thread");

port.on("message", async ({ id, job }: PdfWorkerRequest) => {
  let reply: PdfWorkerResponse;
  try {
    // Copia propia del contenido para transferirla al proceso web sin volver a copiarla.
    const pdf = new Uint8Array(await renderPdfJob(job)).buffer;
    reply = { id, ok: true, pdf };
    port.postMessage(reply, [pdf]);
  } catch (err) {
    reply = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    port.postMessage(reply);
  }
});
