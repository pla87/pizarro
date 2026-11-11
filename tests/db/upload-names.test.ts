// Nombres de los archivos subidos (adjuntos y documentos): se conservan paréntesis, comas, &, + y #; al recortar un
// nombre largo se conserva la extensión; la descarga los manda bien codificados (RFC 5987). Y los megas de los mensajes
// de límite llevan la coma decimal en español.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { db, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { POST as attachRoute } from "../../src/app/api/tasks/[taskId]/attachments/route";
import { POST as documentsRoute } from "../../src/app/api/projects/[projectId]/documents/route";
import { GET as attachmentGet } from "../../src/app/api/attachments/[attachmentId]/route";
import { resetRateLimit } from "../../src/lib/rate-limit";

const ORIGIN = "http://localhost";
process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-names-"));

const upload = (url: string, name: string, bytes = 64) => {
  const form = new FormData();
  // Empieza como un PDF de verdad (el tipo de documento se confirma por el contenido).
  const data = new Uint8Array(bytes).fill(65);
  data.set(new TextEncoder().encode("%PDF-1.4\n"));
  form.append("file", new File([data], name, { type: "application/pdf" }));
  return new Request(url, { method: "POST", body: form, headers: { origin: ORIGIN, host: "localhost" } });
};

async function setup() {
  const m = await makeUser();
  const f = await makeProject({ members: [m] });
  const task = await makeTask(f);
  await loginAs(m);
  resetRateLimit(`upload:${m.id}`);
  return { m, f, task };
}

const LONG = `Informe trimestral de resultados (versión final), revisado & aprobado+anexos #3 ${"x".repeat(150)}.pdf`;

describe("nombres de archivos subidos", () => {
  test("adjunto: conserva los caracteres normales y la extensión al recortar; la descarga lo codifica", async () => {
    const { task } = await setup();
    const res = await attachRoute(upload(`${ORIGIN}/api/tasks/${task.id}/attachments`, "informe (final), v2 & anexo+1 #3.pdf"), { params: Promise.resolve({ taskId: task.id }) });
    assert.equal(res.status, 201, await res.clone().text());
    const row = await db.taskAttachment.findFirstOrThrow({ where: { taskId: task.id } });
    assert.equal(row.originalName, "informe (final), v2 & anexo+1 #3.pdf");
    const dl = await attachmentGet(new Request(`${ORIGIN}/api/attachments/${row.id}?download=1`), { params: Promise.resolve({ attachmentId: row.id }) });
    const cd = dl.headers.get("content-disposition") ?? "";
    assert.match(cd, /^attachment; filename\*=UTF-8''/);
    // Sin caracteres que rompan la cabecera, y vuelve al nombre exacto al decodificar.
    const encoded = cd.replace(/^attachment; filename\*=UTF-8''/, "");
    assert.match(encoded, /^[A-Za-z0-9!#$&+.^_`|~%-]+$/);
    assert.equal(decodeURIComponent(encoded), row.originalName);

    const res2 = await attachRoute(upload(`${ORIGIN}/api/tasks/${task.id}/attachments`, LONG), { params: Promise.resolve({ taskId: task.id }) });
    assert.equal(res2.status, 201);
    const long = await db.taskAttachment.findFirstOrThrow({ where: { taskId: task.id, NOT: { id: row.id } } });
    assert.equal(long.originalName.length, 120);
    assert.ok(long.originalName.endsWith("x.pdf"), long.originalName);
    assert.ok(long.originalName.startsWith("Informe trimestral de resultados (versión final), revisado & aprobado+anexos #3"));
  });

  test("documento: el nombre largo conserva la extensión (y con ella el tipo)", async () => {
    const { f } = await setup();
    const res = await documentsRoute(upload(`${ORIGIN}/api/projects/${f.project.id}/documents`, LONG), { params: Promise.resolve({ projectId: f.project.id }) });
    assert.equal(res.status, 201, await res.clone().text());
    const doc = await db.projectDocument.findFirstOrThrow({ where: { projectId: f.project.id } });
    assert.equal(doc.name.length, 120);
    assert.ok(doc.name.endsWith(".pdf"));
    assert.equal(doc.kind, "PDF");
  });

  test("el mensaje del tope de adjuntos de la tarea lleva la coma decimal en español", async () => {
    const { f, task } = await setup();
    await db.project.update({ where: { id: f.project.id }, data: { taskAttachMaxMb: 1 } });
    await db.taskAttachment.create({ data: { taskId: task.id, originalName: "previo.bin", mimeType: "application/octet-stream", isImage: false, size: 943718 } });
    const res = await attachRoute(upload(`${ORIGIN}/api/tasks/${task.id}/attachments`, "otro.pdf", 200 * 1024), { params: Promise.resolve({ taskId: task.id }) });
    assert.equal(res.status, 413);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /ya tiene 0,9 MB/);
    assert.doesNotMatch(body.error, /\d\.\d MB/);
  });
});
