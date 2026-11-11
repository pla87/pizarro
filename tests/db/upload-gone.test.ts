// Subida a una tarea (o a la documentación de un proyecto) que se borra mientras llega el archivo: 404 «La tarea ya no
// existe» (o «El proyecto ya no existe»), registrado como aviso y sin dejar el fichero en el disco. Antes, el alta de la
// fila fallaba con la clave ajena (P2003 TaskAttachment_taskId_fkey) o con P2025 en la comprobación previa: 500 y error.
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { Prisma } from "../../src/generated/prisma/client";
import { db, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { POST as attachRoute } from "../../src/app/api/tasks/[taskId]/attachments/route";
import { POST as documentsRoute } from "../../src/app/api/projects/[projectId]/documents/route";
import { createAttachmentWithinLimit } from "../../src/lib/attachment-limit";
import { createDocumentWithinLimit } from "../../src/lib/documents";
import { AppError } from "../../src/lib/errors";
import { flushLogs } from "../../src/lib/log";
import { resetRateLimit } from "../../src/lib/rate-limit";

const ORIGIN = "http://localhost";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ejecuta `fn` en una transacción que queda abierta (borrado en curso) hasta llamar a `commit`. */
async function pendingTx(fn: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let ready!: () => void;
  const started = new Promise<void>((r) => (ready = r));
  const done = db.$transaction(async (tx) => {
    await fn(tx);
    ready();
    await gate;
  }, { timeout: 30_000 });
  await started;
  return { commit: async () => (release(), await done) };
}

/** Ficheros que quedan bajo la carpeta de subidas. */
async function filesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

/** Petición multipart cuyo cuerpo llega en flujo: `beforeBody` se ejecuta justo antes de enviarlo (la subida «a medias»). */
async function streamedUpload(url: string, name: string, beforeBody?: () => Promise<void>): Promise<Request> {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(20 * 1024).fill(7)], name, { type: "application/octet-stream" }));
  const encoded = new Response(form);
  const contentType = encoded.headers.get("content-type")!;
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(c) {
      if (sent) return c.close();
      sent = true;
      await beforeBody?.();
      c.enqueue(bytes);
    },
  }, { highWaterMark: 0 }); // sin leer por adelantado: el cuerpo empieza a llegar cuando la ruta lo lee
  return new Request(url, { method: "POST", body, headers: { origin: ORIGIN, host: "localhost", "content-type": contentType }, duplex: "half" } as RequestInit);
}

async function setup() {
  const m = await makeUser();
  const f = await makeProject({ members: [m] });
  const task = await makeTask(f);
  await loginAs(m);
  resetRateLimit(`upload:${m.id}`);
  process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-gone-"));
  return { m, f, task, dir: process.env.UPLOAD_DIR };
}

const lastLog = async (action: string, key: "taskId" | "projectId", id: string) => {
  await flushLogs();
  const rows = await db.appLog.findMany({ where: { action }, orderBy: { createdAt: "desc" }, select: { level: true, message: true, details: true } });
  return rows.find((r) => (r.details as Record<string, unknown>)[key] === id);
};

const isGone = (code: string) => (err: unknown) => err instanceof AppError && err.status === 404 && err.code === code;
const sel = { id: true } as const;
const attData = (taskId: string) => ({ taskId, originalName: "f.bin", mimeType: "application/octet-stream", isImage: false, size: 10 });

describe("subida a una tarea borrada durante la subida", () => {
  test("alta definitiva mientras se borra la tarea (borrado aún sin confirmar): 404, no el fallo de clave ajena", async () => {
    const { task } = await setup();
    const del = await pendingTx((tx) => tx.task.delete({ where: { id: task.id } }));
    const create = createAttachmentWithinLimit(attData(task.id), sel);
    await sleep(300); // el alta espera al borrado
    await del.commit();
    await assert.rejects(create, isGone("task_gone"));
    assert.equal(await db.taskAttachment.count({ where: { taskId: task.id } }), 0);
  });

  test("tarea ya borrada: 404 también en la comprobación previa y en la definitiva", async () => {
    const { task } = await setup();
    await db.task.delete({ where: { id: task.id } });
    await assert.rejects(createAttachmentWithinLimit(attData(task.id), sel), isGone("task_gone"));
  });

  test("borrada mientras llega el archivo: 404 «La tarea ya no existe.», aviso en el registro y nada en el disco", async () => {
    const { task, dir } = await setup();
    const req = await streamedUpload(`${ORIGIN}/api/tasks/${task.id}/attachments`, "datos.bin", async () => {
      await db.task.delete({ where: { id: task.id } });
    });
    const res = await attachRoute(req, { params: Promise.resolve({ taskId: task.id }) });
    const body = await res.json();
    assert.equal(res.status, 404, JSON.stringify(body));
    assert.equal(body.error, "La tarea ya no existe.");
    assert.deepEqual(await filesIn(dir), []);
    const log = await lastLog("attachments.uploadFailed", "taskId", task.id);
    assert.equal(log?.level, "warn");
  });

  test("borrada con el fichero ya escrito (esperando al alta): 404 y se borra el fichero", async () => {
    const { task, dir } = await setup();
    const del = await pendingTx((tx) => tx.task.delete({ where: { id: task.id } }));
    const req = await streamedUpload(`${ORIGIN}/api/tasks/${task.id}/attachments`, "datos.bin");
    const pending = attachRoute(req, { params: Promise.resolve({ taskId: task.id }) });
    // El fichero se escribe antes del alta; el alta espera a que termine el borrado.
    for (let i = 0; i < 100 && !(await filesIn(dir)).length; i++) await sleep(30);
    assert.equal((await filesIn(dir)).length, 1, "el fichero llegó a escribirse");
    await sleep(100);
    await del.commit();
    const res = await pending;
    const body = await res.json();
    assert.equal(res.status, 404, JSON.stringify(body));
    assert.equal(body.error, "La tarea ya no existe.");
    assert.deepEqual(await filesIn(dir), []);
    assert.equal((await lastLog("attachments.uploadFailed", "taskId", task.id))?.level, "warn");
  });
});

describe("documento subido a un proyecto que se borra durante la subida", () => {
  test("alta definitiva mientras se borra el proyecto: 404, no el fallo de clave ajena", async () => {
    const { m, f } = await setup();
    const del = await pendingTx((tx) => tx.project.delete({ where: { id: f.project.id } }));
    const create = createDocumentWithinLimit({ projectId: f.project.id, name: "notas.txt", mimeType: "text/plain", size: 10, kind: "TEXT", createdById: m.id });
    await sleep(300);
    await del.commit();
    await assert.rejects(create, isGone("project_gone"));
  });

  test("borrado con el fichero ya escrito: 404 «El proyecto ya no existe.» y se borra el fichero", async () => {
    const { f, dir } = await setup();
    const del = await pendingTx((tx) => tx.project.delete({ where: { id: f.project.id } }));
    const req = await streamedUpload(`${ORIGIN}/api/projects/${f.project.id}/documents`, "notas.txt");
    const pending = documentsRoute(req, { params: Promise.resolve({ projectId: f.project.id }) });
    for (let i = 0; i < 100 && !(await filesIn(dir)).length; i++) await sleep(30);
    assert.equal((await filesIn(dir)).length, 1, "el fichero llegó a escribirse");
    await sleep(100);
    await del.commit();
    const res = await pending;
    const body = await res.json();
    assert.equal(res.status, 404, JSON.stringify(body));
    assert.equal(body.error, "El proyecto ya no existe.");
    assert.deepEqual(await filesIn(dir), []);
    assert.equal((await lastLog("documents.uploadFailed", "projectId", f.project.id))?.level, "warn");
  });
});
