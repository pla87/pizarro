// Rutas que reciben archivos (fuera del proxy de Next): tope real al leer el cuerpo aunque no haya Content-Length,
// mismo tope de subidas por minuto (con Retry-After) en adjuntos y documentos, etiqueta de deshacer traducible y
// el informe de errores del navegador con su cuerpo acotado.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { db, loginAs, logout, makeProject, makeTask, makeUser } from "./helpers";
import { POST as attachRoute } from "../../src/app/api/tasks/[taskId]/attachments/route";
import { POST as documentsRoute } from "../../src/app/api/projects/[projectId]/documents/route";
import { POST as clientErrorsRoute } from "../../src/app/api/client-errors/route";
import { rateLimit, resetRateLimit } from "../../src/lib/rate-limit";
import { decodeLabel } from "../../src/lib/undo-label";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-upl-"));
const MB = 1024 * 1024;
const ORIGIN = "http://localhost";

/** Multipart con un archivo, enviado por trozos y SIN Content-Length (como tras un proxy que la quita). */
async function chunkedUpload(url: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const encoded = new Request(url, { method: "POST", body: form });
  const type = encoded.headers.get("content-type")!;
  const raw = new Uint8Array(await encoded.arrayBuffer());
  let chunksRead = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      const at = chunksRead++ * 64 * 1024;
      if (at >= raw.length) c.close();
      else c.enqueue(raw.slice(at, at + 64 * 1024));
    },
  }, { highWaterMark: 0 }); // solo se genera un trozo cuando alguien lo lee
  const req = new Request(url, { method: "POST", body, headers: { origin: ORIGIN, host: "localhost", "content-type": type }, duplex: "half" } as RequestInit);
  assert.equal(req.headers.get("content-length"), null);
  return { req, total: raw.length, chunksRead: () => chunksRead };
}

const formUpload = (url: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return new Request(url, { method: "POST", body: form, headers: { origin: ORIGIN, host: "localhost" } });
};

describe("subidas fuera del proxy", () => {
  test("sin Content-Length, un cuerpo mayor que el máximo del proyecto se corta al leerlo (413) en adjuntos y documentos", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    await db.project.update({ where: { id: f.project.id }, data: { fileMaxMb: 1 } });
    const task = await makeTask(f);
    await loginAs(m);
    const big = () => new File([new Uint8Array(3 * MB).fill(7)], "grande.bin", { type: "application/octet-stream" });

    const a = await chunkedUpload(`${ORIGIN}/api/tasks/${task.id}/attachments`, big());
    const resA = await attachRoute(a.req, { params: Promise.resolve({ taskId: task.id }) });
    assert.equal(resA.status, 413);
    assert.match((await resA.json()).error, /tamaño máximo del proyecto \(1 MB/);
    assert.ok(a.chunksRead() * 64 * 1024 < a.total, `deja de leer antes del final (${a.chunksRead()} trozos de ${Math.ceil(a.total / 65536)})`);

    const d = await chunkedUpload(`${ORIGIN}/api/projects/${f.project.id}/documents`, big());
    const resD = await documentsRoute(d.req, { params: Promise.resolve({ projectId: f.project.id }) });
    assert.equal(resD.status, 413);
    assert.ok(d.chunksRead() * 64 * 1024 < d.total);

    // Dentro del máximo, por trozos también funciona.
    const ok = await chunkedUpload(`${ORIGIN}/api/tasks/${task.id}/attachments`, new File([new Uint8Array(200_000).fill(1)], "ok.bin"));
    assert.equal((await attachRoute(ok.req, { params: Promise.resolve({ taskId: task.id }) })).status, 201);
    assert.equal(await db.taskAttachment.count({ where: { taskId: task.id } }), 1);
  });

  test("sin sesión o desde otro origen se rechaza antes de leer el cuerpo", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const task = await makeTask(f);
    logout();
    const a = await chunkedUpload(`${ORIGIN}/api/tasks/${task.id}/attachments`, new File([new Uint8Array(MB)], "x.bin"));
    assert.equal((await attachRoute(a.req, { params: Promise.resolve({ taskId: task.id }) })).status, 401);
    assert.equal(a.chunksRead(), 0, "no ha leído nada");
    await loginAs(m);
    const evil = new Request(`${ORIGIN}/api/projects/${f.project.id}/documents`, { method: "POST", body: new FormData(), headers: { origin: "http://evil.example", host: "localhost" } });
    assert.equal((await documentsRoute(evil, { params: Promise.resolve({ projectId: f.project.id }) })).status, 403);
    // Con la contraseña pendiente de cambiar (lo que también cortaba el proxy), tampoco.
    await db.user.update({ where: { id: m.id }, data: { mustChangePassword: true } });
    const pending = await attachRoute(formUpload(`${ORIGIN}/api/tasks/${task.id}/attachments`, new File(["x"], "x.txt")), { params: Promise.resolve({ taskId: task.id }) });
    assert.equal(pending.status, 403);
  });

  test("adjuntos y documentos comparten el tope de subidas por minuto (300) y ambos responden 429 con Retry-After y code", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const task = await makeTask(f);
    await loginAs(m);
    const key = `upload:${m.id}`;
    resetRateLimit(key);
    for (let i = 0; i < 299; i++) assert.ok(rateLimit(key, 300, 60_000));
    // La subida número 300 (un documento) aún entra; la siguiente, sea adjunto o documento, no.
    assert.equal((await documentsRoute(formUpload(`${ORIGIN}/api/projects/${f.project.id}/documents`, new File(["hola"], "a.txt", { type: "text/plain" })), { params: Promise.resolve({ projectId: f.project.id }) })).status, 201);
    for (const res of [
      await documentsRoute(formUpload(`${ORIGIN}/api/projects/${f.project.id}/documents`, new File(["hola"], "b.txt", { type: "text/plain" })), { params: Promise.resolve({ projectId: f.project.id }) }),
      await attachRoute(formUpload(`${ORIGIN}/api/tasks/${task.id}/attachments`, new File(["hola"], "c.txt")), { params: Promise.resolve({ taskId: task.id }) }),
    ]) {
      assert.equal(res.status, 429);
      assert.ok(Number(res.headers.get("Retry-After")) > 0);
      assert.equal((await res.json()).code, "rate_limited");
    }
    resetRateLimit(key);
  });

  test("la entrada de deshacer de una subida se guarda como plantilla traducible", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const task = await makeTask(f);
    await loginAs(m);
    const res = await attachRoute(formUpload(`${ORIGIN}/api/tasks/${task.id}/attachments`, new File(["x"], "informe.txt")), { params: Promise.resolve({ taskId: task.id }) });
    assert.equal(res.status, 201);
    const entry = await db.undoEntry.findFirstOrThrow({ where: { userId: m.id, taskId: task.id }, orderBy: { createdAt: "desc" } });
    assert.deepEqual(decodeLabel(entry.label), { k: "Subió «{name}»", p: { name: "informe.txt" } });
  });
});

describe("/api/client-errors sin Content-Length", () => {
  test("un cuerpo por trozos mayor que el tope responde 413 sin leerlo entero", async () => {
    resetRateLimit("client-errors:ip:10.9.8.6");
    resetRateLimit("client-errors:anon:10.9.8.6");
    logout();
    let chunksRead = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (chunksRead++ >= 100) c.close();
        else c.enqueue(new Uint8Array(4096).fill(32));
      },
    }, { highWaterMark: 0 });
    const origin = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
    const req = new Request(`${origin}/api/client-errors`, { method: "POST", body, headers: { origin, "x-real-ip": "10.9.8.6", "content-type": "application/json" }, duplex: "half" } as RequestInit);
    assert.equal((await clientErrorsRoute(req)).status, 413);
    assert.ok(chunksRead < 10, `leídos ${chunksRead} trozos de 4 KB (tope anónimo 8 KB)`);
  });
});
