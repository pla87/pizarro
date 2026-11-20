import assert from "node:assert/strict";
import { describe, test } from "node:test";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://none:none@localhost:5432/none";
const { queuedRender, PdfAbortedError, PdfTimeoutError, PDF_MAX_WAITING } = await import("../src/lib/report-build");

describe("cola de renders PDF", () => {
  test("los renders se ejecutan de uno en uno y en orden", async () => {
    const log: string[] = [];
    const job = (name: string, ms: number) => () => new Promise<string>((r) => { log.push(`start ${name}`); setTimeout(() => { log.push(`end ${name}`); r(name); }, ms); });
    const out = await Promise.all([queuedRender(job("a", 30)), queuedRender(job("b", 5))]);
    assert.deepEqual(out, ["a", "b"]);
    assert.deepEqual(log, ["start a", "end a", "start b", "end b"]);
  });

  test("un render atascado da error claro a los 'timeoutMs' y no bloquea el siguiente", async () => {
    const stuck = queuedRender(() => new Promise<string>(() => {}), 40);
    const next = queuedRender(async () => "ok", 1000);
    await assert.rejects(stuck, (err: Error) => err instanceof PdfTimeoutError && err.message === "El PDF tardó demasiado; inténtalo de nuevo" && (err as InstanceType<typeof PdfTimeoutError>).status === 504);
    assert.equal(await next, "ok");
  });

  test("un render que falla no bloquea la cola", async () => {
    await assert.rejects(queuedRender(async () => { throw new Error("boom"); }), /boom/);
    assert.equal(await queuedRender(async () => 7), 7);
  });

  test("con 5 renders esperando, el siguiente se rechaza al instante con 503", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const blocker = queuedRender(() => gate.then(() => "primero"), 5000);
    await new Promise((r) => setTimeout(r, 5)); // el primero ya ocupa el turno: no cuenta como espera
    const waiting = Array.from({ length: PDF_MAX_WAITING }, (_, i) => queuedRender(async () => i, 5000));
    await assert.rejects(queuedRender(async () => "sobra"), (err: Error) => (err as Error & { status: number }).status === 503 && err.message === "Hay muchos PDF generándose; inténtalo en un momento.");
    release();
    assert.equal(await blocker, "primero");
    assert.deepEqual(await Promise.all(waiting), [0, 1, 2, 3, 4]);
    // Vacía la cola, vuelve a aceptar.
    assert.equal(await queuedRender(async () => "otra"), "otra");
  });
});

describe("cola de renders PDF: petición cancelada (req.signal)", () => {
  const isAborted = (err: Error) => err instanceof PdfAbortedError && (err as InstanceType<typeof PdfAbortedError>).status === 499;

  test("con la petición ya abortada se rechaza al instante, sin hacer cola", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let ran = false;
    await assert.rejects(queuedRender(async () => { ran = true; }, 1000, ctrl.signal), isAborted);
    assert.equal(ran, false);
  });

  test("abortada mientras espera turno: sale de la cola sin pintarse y deja libre su sitio", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const blocker = queuedRender(() => gate.then(() => "primero"), 5000);
    await new Promise((r) => setTimeout(r, 5)); // el primero ya ocupa el turno
    const ctrl = new AbortController();
    let ran = false;
    const cancelled = queuedRender(async () => { ran = true; return "no"; }, 5000, ctrl.signal);
    ctrl.abort();
    await assert.rejects(cancelled, isAborted); // sin esperar a que termine el primero
    // Su sitio entre los PDF_MAX_WAITING queda libre: caben otros tantos.
    const waiting = Array.from({ length: PDF_MAX_WAITING }, (_, i) => queuedRender(async () => i, 5000));
    release();
    assert.equal(await blocker, "primero");
    assert.deepEqual(await Promise.all(waiting), [0, 1, 2, 3, 4]);
    assert.equal(ran, false);
  });

  test("abortada mientras se pinta: se para el render (su señal se aborta) y la cola sigue", async () => {
    const ctrl = new AbortController();
    let renderSignal!: AbortSignal;
    const running = queuedRender((signal) => { renderSignal = signal; return new Promise<string>(() => {}); }, 5000, ctrl.signal);
    await new Promise((r) => setTimeout(r, 5));
    ctrl.abort();
    await assert.rejects(running, isAborted);
    assert.ok(renderSignal.aborted);
    assert.equal(await queuedRender(async () => "sigue", 1000), "sigue");
  });

  test("una petición que acaba bien no deja nada colgado de su señal", async () => {
    const ctrl = new AbortController();
    assert.equal(await queuedRender(async () => "hecho", 1000, ctrl.signal), "hecho");
    ctrl.abort(); // tarde: no pasa nada
    assert.equal(await queuedRender(async () => "otra", 1000), "otra");
  });
});

describe("isPdfQueueError", () => {
  test("reconoce el tiempo agotado, la cola llena y la petición cancelada, y no otros errores", async () => {
    const { isPdfQueueError } = await import("../src/lib/report-build");
    const { AppError } = await import("../src/lib/errors");
    assert.equal(isPdfQueueError(new PdfTimeoutError()), true);
    assert.equal(isPdfQueueError(new PdfAbortedError()), true);
    assert.equal(isPdfQueueError(new AppError("x", 503, "pdf_busy")), true);
    assert.equal(isPdfQueueError(new AppError("x", 400)), false);
    assert.equal(isPdfQueueError(new Error("boom")), false);
  });
});
