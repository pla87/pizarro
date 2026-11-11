// Subidas (adjuntos de tareas y documentación): comprobación previa de cuota, tope por tarea y máximo de documentos antes
// de escribir el fichero (con el mismo mensaje que la definitiva, que sigue dentro de la transacción), y disco lleno
// (ENOSPC) al escribir: 507 con un mensaje claro y anotado en el registro del sistema, en vez del 500 genérico.
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, mock, test } from "node:test";
import { db, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { POST as attachRoute } from "../../src/app/api/tasks/[taskId]/attachments/route";
import { POST as documentsRoute } from "../../src/app/api/projects/[projectId]/documents/route";
import { flushLogs } from "../../src/lib/log";
import { resetRateLimit } from "../../src/lib/rate-limit";

const ORIGIN = "http://localhost";
const KB = 1024;
const ok = await mkdtemp(path.join(tmpdir(), "pz-precheck-"));
// Una «carpeta» de subidas que es un fichero: cualquier intento de escribir en ella falla (ENOTDIR, también como root).
// Si la subida responde con el error de cuota, es que se rechazó antes de tocar el disco.
const blocker = path.join(ok, "no-es-carpeta");
await writeFile(blocker, "x");
const unwritable = path.join(blocker, "subidas");

afterEach(() => {
  process.env.UPLOAD_DIR = ok;
  mock.restoreAll();
  syncBuiltinESMExports();
});

const upload = (url: string, bytes: number, name = "datos.bin") => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes).fill(3)], name, { type: "application/octet-stream" }));
  return new Request(url, { method: "POST", body: form, headers: { origin: ORIGIN, host: "localhost" } });
};
const attach = (taskId: string, bytes: number) => attachRoute(upload(`${ORIGIN}/api/tasks/${taskId}/attachments`, bytes), { params: Promise.resolve({ taskId }) });
const addDocument = (projectId: string, bytes: number) =>
  documentsRoute(upload(`${ORIGIN}/api/projects/${projectId}/documents`, bytes, "notas.txt"), { params: Promise.resolve({ projectId }) });

/** Fila de adjunto sin fichero: solo cuenta en las sumas. */
const fakeAttachment = (taskId: string, size: number) =>
  db.taskAttachment.create({ data: { taskId, originalName: "previo.bin", mimeType: "application/octet-stream", isImage: false, size } });

async function setup() {
  const m = await makeUser();
  const f = await makeProject({ members: [m] });
  const task = await makeTask(f);
  await loginAs(m);
  resetRateLimit(`upload:${m.id}`);
  return { m, f, task };
}

describe("subidas: comprobación previa antes de escribir el fichero", () => {
  test("adjunto que no cabe en la cuota del proyecto: 413 con el mensaje de cuota, sin escribir nada", async () => {
    const { f, task } = await setup();
    await db.project.update({ where: { id: f.project.id }, data: { storageQuotaMb: 1 } });
    await fakeAttachment((await makeTask(f)).id, 900 * KB);
    process.env.UPLOAD_DIR = unwritable;
    const res = await attach(task.id, 200 * KB);
    const body = await res.json();
    assert.equal(res.status, 413, JSON.stringify(body));
    assert.equal(body.code, "quota_project");
    assert.match(body.error, /^Cuota de almacenamiento del proyecto superada \(.* de 1 MB\)/);
    assert.equal(await db.taskAttachment.count({ where: { taskId: task.id } }), 0);
    // Lo que sí cabe pasa la comprobación previa y la definitiva.
    process.env.UPLOAD_DIR = ok;
    assert.equal((await attach(task.id, 50 * KB)).status, 201);
  });

  test("adjunto que supera el tope por tarea: 413 con el mensaje del tope, sin escribir nada", async () => {
    const { f, task } = await setup();
    await db.project.update({ where: { id: f.project.id }, data: { taskAttachMaxMb: 1, fileMaxMb: 1 } });
    await fakeAttachment(task.id, 900 * KB);
    process.env.UPLOAD_DIR = unwritable;
    const res = await attach(task.id, 200 * KB);
    const body = await res.json();
    assert.equal(res.status, 413, JSON.stringify(body));
    assert.equal(body.code, "task_total");
    assert.match(body.error, /^Los adjuntos de la tarea superarían el máximo del proyecto \(1 MB por tarea; ya tiene 0,9 MB\)/);
    assert.equal(await db.taskAttachment.count({ where: { taskId: task.id } }), 1);
  });

  test("documento que no cabe en la cuota del proyecto: 413 con el mensaje de cuota, sin escribir nada", async () => {
    const { f, task } = await setup();
    await db.project.update({ where: { id: f.project.id }, data: { storageQuotaMb: 1 } });
    await fakeAttachment(task.id, 900 * KB);
    process.env.UPLOAD_DIR = unwritable;
    const res = await addDocument(f.project.id, 200 * KB);
    const body = await res.json();
    assert.equal(res.status, 413, JSON.stringify(body));
    assert.equal(body.code, "quota_project");
    assert.match(body.error, /^Cuota de almacenamiento del proyecto superada \(.* de 1 MB\)/);
    assert.equal(await db.projectDocument.count({ where: { projectId: f.project.id } }), 0);
  });
});

describe("subidas: disco lleno al escribir", () => {
  /** Toda escritura de fichero falla como con el disco lleno. */
  function diskFull() {
    mock.method(fsp, "writeFile", async () => {
      throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC", errno: -28, syscall: "write" });
    });
    syncBuiltinESMExports(); // los `import { writeFile }` de uploads.ts ven la versión simulada
  }
  const noSpaceLogs = (action: string) => db.appLog.findMany({ where: { action }, select: { level: true, category: true, details: true } });

  test("adjunto: 507 con «El servidor no tiene espacio…», sin fila ni ficheros, y anotado en el registro del sistema", async () => {
    const { task } = await setup();
    process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-enospc-"));
    diskFull();
    const res = await attach(task.id, 30 * KB);
    const body = await res.json();
    assert.equal(res.status, 507, JSON.stringify(body));
    assert.equal(body.error, "El servidor no tiene espacio para guardar el archivo.");
    assert.equal(body.code, "disk_full");
    assert.equal(await db.taskAttachment.count({ where: { taskId: task.id } }), 0);
    assert.deepEqual(await readdir(process.env.UPLOAD_DIR), [], "no quedan temporales");
    await flushLogs();
    const logs = (await noSpaceLogs("attachments.noSpace")).filter((l) => (l.details as { taskId?: string }).taskId === task.id);
    assert.equal(logs.length, 1);
    assert.deepEqual([logs[0]!.level, logs[0]!.category], ["error", "system"]);
  });

  test("documento: 507 con el mismo mensaje y anotado en el registro del sistema", async () => {
    const { f } = await setup();
    process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-enospc-"));
    diskFull();
    const res = await addDocument(f.project.id, 30 * KB);
    const body = await res.json();
    assert.equal(res.status, 507, JSON.stringify(body));
    assert.equal(body.error, "El servidor no tiene espacio para guardar el archivo.");
    assert.equal(await db.projectDocument.count({ where: { projectId: f.project.id } }), 0);
    await flushLogs();
    const logs = (await noSpaceLogs("documents.noSpace")).filter((l) => (l.details as { projectId?: string }).projectId === f.project.id);
    assert.equal(logs.length, 1);
    assert.deepEqual([logs[0]!.level, logs[0]!.category], ["error", "system"]);
  });

  test("otro error al escribir sigue siendo el 500 genérico", async () => {
    const { task } = await setup();
    process.env.UPLOAD_DIR = unwritable;
    const res = await attach(task.id, 30 * KB);
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, "No se pudo procesar el archivo.");
  });
});
