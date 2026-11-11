import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://none:none@localhost:5432/none";
const { PDF_OUT_OF_MEMORY_MESSAGE, pdfWorkerMaxMb, pdfWorkerSpec, renderInWorker, stopPdfWorker } = await import("../src/lib/report-render");
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

  test("tope de memoria del worker: 256 MB por defecto, ajustable con PDF_WORKER_MAX_MB (64–4096)", () => {
    assert.equal(pdfWorkerMaxMb({}), 256);
    assert.equal(pdfWorkerMaxMb({ PDF_WORKER_MAX_MB: "512" }), 512);
    assert.equal(pdfWorkerMaxMb({ PDF_WORKER_MAX_MB: "8" }), 64);
    assert.equal(pdfWorkerMaxMb({ PDF_WORKER_MAX_MB: "99999" }), 4096);
    assert.equal(pdfWorkerMaxMb({ PDF_WORKER_MAX_MB: "mucho" }), 256);
  });

  test("sin memoria: solo cae el worker, el PDF falla con un error normal y el siguiente arranca otro", async () => {
    stopPdfWorker(); // el siguiente worker arranca con el tope de abajo
    const prev = process.env.PDF_WORKER_MAX_MB;
    process.env.PDF_WORKER_MAX_MB = "64";
    try {
      // Unas 4000 tarjetas con títulos de miles de caracteres: el maquetado pasa de 64 MB enseguida.
      await assert.rejects(renderInWorker(delivery(4000, "Tarea larga ".repeat(200))), (err: Error) => {
        assert.ok(err.message.startsWith(PDF_OUT_OF_MEMORY_MESSAGE), err.message);
        assert.equal((err.cause as { code?: string }).code, "ERR_WORKER_OUT_OF_MEMORY");
        return true;
      });
    } finally {
      if (prev === undefined) delete process.env.PDF_WORKER_MAX_MB;
      else process.env.PDF_WORKER_MAX_MB = prev;
    }
    assert.ok(isPdf(await renderInWorker(delivery(2))));
  });

  test("con la señal ya abortada no se arranca nada", async () => {
    const ctrl = new AbortController();
    ctrl.abort(new Error("cancelado"));
    await assert.rejects(renderInWorker(delivery(1), ctrl.signal), /cancelado/);
  });
});
