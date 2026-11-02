import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://none:none@localhost:5432/none";
const { pdfWorkerSpec, renderInWorker, stopPdfWorker } = await import("../src/lib/report-render");
const { queuedRender, PdfTimeoutError } = await import("../src/lib/report-build");
type PdfJob = import("../src/lib/report-pdf").PdfJob;

const delivery = (n: number, title = "Tarea"): PdfJob => ({
  kind: "delivery",
  locale: "es",
  input: {
    project: "Proyecto de prueba",
    column: "Entrega",
    today: "2026-11-02",
    tasks: Array.from({ length: n }, (_, i) => ({ title: `${title} ${i}`, kind: "Funcionalidad", dueDate: "2026-11-10", subtaskTotal: 2, doneSubtasks: ["Hecha"] })),
  },
});

const isPdf = (b: Uint8Array) => Buffer.from(b.subarray(0, 5)).toString("latin1") === "%PDF-";

after(() => stopPdfWorker());

describe("worker de PDF", () => {
  test("en producción usa el worker empaquetado; en desarrollo y tests, el código fuente con tsx", () => {
    assert.deepEqual(pdfWorkerSpec({ NODE_ENV: "production" }, "/app"), { file: "/app/dist/pdf-worker.mjs" });
    assert.deepEqual(pdfWorkerSpec({ NODE_ENV: "development" }, "/repo"), { file: "/repo/src/lib/report-pdf-worker.ts", execArgv: ["--import", "tsx"] });
  });

  test("genera el PDF fuera del proceso y reutiliza el mismo worker", async () => {
    const a = await renderInWorker(delivery(3));
    const b = await renderInWorker({ ...delivery(1), locale: "en" });
    assert.ok(a instanceof Uint8Array && isPdf(a) && a.length > 1000);
    assert.ok(isPdf(b));
  });

  test("un error del render llega como error y el worker sigue sirviendo", async () => {
    await assert.rejects(renderInWorker({ kind: "nada", locale: "es", input: {} } as unknown as PdfJob), /Tipo de PDF desconocido: nada/);
    assert.ok(isPdf(await renderInWorker(delivery(1))));
  });

  test("al agotarse el tiempo se termina el worker (504) y el siguiente PDF arranca otro", async () => {
    const started = performance.now();
    await assert.rejects(
      queuedRender((signal) => renderInWorker(delivery(3000, "Tarea larga"), signal), 300),
      (err: Error) => err instanceof PdfTimeoutError && (err as InstanceType<typeof PdfTimeoutError>).status === 504,
    );
    assert.ok(performance.now() - started < 5000);
    assert.ok(isPdf(await queuedRender((signal) => renderInWorker(delivery(2), signal))));
  });

  test("con la señal ya abortada no se arranca nada", async () => {
    const ctrl = new AbortController();
    ctrl.abort(new Error("cancelado"));
    await assert.rejects(renderInWorker(delivery(1), ctrl.signal), /cancelado/);
  });
});
