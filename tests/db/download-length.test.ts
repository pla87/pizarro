// Tamaño de las descargas a través de un servidor HTTP real: Next quita el Content-Length al copiar la respuesta de una
// ruta (send-response.js) y sin él el navegador no enseña el progreso. Cada ruta de descarga lo declara en la cabecera
// interna y el gancho de response-length.ts lo repone. Se comprueba con el mismo sendResponse de Next: adjuntos (también
// la miniatura y el 304), documentos y exportaciones (también la 206 de un rango).
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { NodeNextRequest, NodeNextResponse } from "next/dist/server/base-http/node.js";
import { sendResponse } from "next/dist/server/send-response.js";
import { db, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { DECLARED_LENGTH_HEADER, installDeclaredLength } from "../../src/lib/response-length";
import { createExportJob, runNextTransferJob } from "../../src/lib/transfer-jobs";
import { attachmentPath, saveDocumentFile } from "../../src/lib/uploads";
import { GET as attachmentGet } from "../../src/app/api/attachments/[attachmentId]/route";
import { GET as documentGet } from "../../src/app/api/documents/[documentId]/route";
import { GET as exportGet } from "../../src/app/api/transfer-jobs/[id]/download/route";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-dl-length-"));

type Handler = (req: Request) => Promise<Response>;
let handler: Handler = async () => new Response(null, { status: 404 });
let server: http.Server;
let base = "";

before(async () => {
  installDeclaredLength();
  server = http.createServer(async (req, res) => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const response = await handler(new Request(`http://localhost${req.url}`, { headers }));
    await sendResponse(new NodeNextRequest(req as never), new NodeNextResponse(res as never), response);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

/** Petición real al servidor: cabeceras tal como salen y el cuerpo. */
function fetchRaw(route: Handler, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  handler = route;
  return new Promise((resolve, reject) => {
    http.get(`${base}/x`, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
}

function assertLength(got: { headers: http.IncomingHttpHeaders; body: Buffer }, expected: number) {
  assert.equal(got.body.length, expected);
  assert.equal(got.headers["content-length"], String(expected));
  assert.equal(got.headers["transfer-encoding"], undefined);
  assert.equal(got.headers[DECLARED_LENGTH_HEADER], undefined, "la cabecera interna no sale");
}

describe("tamaño de las descargas", () => {
  test("adjunto: imagen, miniatura y fichero con Content-Length; el 304, sin cuerpo", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const task = await makeTask(f);
    await loginAs(member);
    const img = await db.taskAttachment.create({ data: { taskId: task.id, originalName: "foto.png", size: 9, isImage: true, mimeType: "image/webp" } });
    await writeFile(attachmentPath(img.id, "full"), "full-image");
    await writeFile(attachmentPath(img.id, "thumb"), "mini");
    const pdf = await db.taskAttachment.create({ data: { taskId: task.id, originalName: "a.pdf", size: 7, isImage: false, mimeType: "application/pdf" } });
    await writeFile(attachmentPath(pdf.id, "file"), "pdf-1234567");
    const route = (id: string, q = ""): Handler => (req) => attachmentGet(new Request(`http://localhost/api/attachments/${id}${q}`, { headers: req.headers }), { params: Promise.resolve({ attachmentId: id }) });
    const full = await fetchRaw(route(img.id));
    assert.equal(full.status, 200);
    assertLength(full, "full-image".length);
    const thumb = await fetchRaw(route(img.id, "?thumb=1"));
    assertLength(thumb, "mini".length);
    assert.equal(thumb.body.toString(), "mini");
    const notModified = await fetchRaw(route(img.id, "?thumb=1"), { "if-none-match": String(thumb.headers.etag) });
    assert.equal(notModified.status, 304);
    assert.equal(notModified.body.length, 0);
    assert.equal(notModified.headers[DECLARED_LENGTH_HEADER], undefined);
    assertLength(await fetchRaw(route(pdf.id, "?download=1")), "pdf-1234567".length);
  });

  test("documento con Content-Length", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    await loginAs(member);
    const doc = await db.projectDocument.create({ data: { projectId: f.project.id, name: "doc.pdf", mimeType: "application/pdf", size: 14, kind: "PDF", createdById: member.id } });
    await saveDocumentFile(doc.id, Buffer.from("%PDF-1.4\n%%EOF"));
    const got = await fetchRaw((req) => documentGet(new Request(`http://localhost/api/documents/${doc.id}`, { headers: req.headers }), { params: Promise.resolve({ documentId: doc.id }) }));
    assert.equal(got.status, 200);
    assertLength(got, 14);
  });

  test("exportación: entera y por rangos (206 con la longitud del rango)", async () => {
    const owner = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner });
    await makeTask(f);
    await db.projectTransferJob.deleteMany({ where: { status: { in: ["QUEUED", "RUNNING"] } } });
    const job = await createExportJob(owner.id, f.project.id, { attachments: false, scope: "all" });
    assert.equal(await runNextTransferJob(), job.id);
    await loginAs(owner);
    const route: Handler = (req) => exportGet(new Request("http://localhost/x", { headers: req.headers }), { params: Promise.resolve({ id: job.id }) });
    const whole = await fetchRaw(route, { "sec-fetch-site": "same-origin" });
    assert.equal(whole.status, 200);
    assert.ok(whole.body.length > 100);
    assertLength(whole, whole.body.length);
    const part = await fetchRaw(route, { "sec-fetch-site": "same-origin", range: "bytes=2-9" });
    assert.equal(part.status, 206);
    assertLength(part, 8);
    assert.deepEqual(part.body, whole.body.subarray(2, 10));
  });
});
