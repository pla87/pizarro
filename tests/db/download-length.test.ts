// Tamaño de las descargas a través de un servidor HTTP real: Next quita el Content-Length al copiar la respuesta de una
// ruta (send-response.js) y sin él el navegador no enseña el progreso. Cada ruta de descarga lo declara en la cabecera
// interna y el gancho de response-length.ts lo repone. Se comprueba con el mismo sendResponse de Next: adjuntos (también
// la miniatura y el 304), documentos y exportaciones (también la 206 de un rango).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readlink, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { NodeNextRequest, NodeNextResponse } from "next/dist/server/base-http/node.js";
import { sendResponse } from "next/dist/server/send-response.js";
import { db, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { backupFileName } from "../../src/lib/backup-core";
import { backupDownloadTokenValid, issueBackupDownloadToken } from "../../src/lib/backup-download";
import { flushLogs } from "../../src/lib/log";
import { stageShare } from "../../src/lib/share-inbox";
import { backupsDir } from "../../src/lib/upload-dir";
import { DECLARED_LENGTH_HEADER, installDeclaredLength } from "../../src/lib/response-length";
import { createExportJob, runNextTransferJob } from "../../src/lib/transfer-jobs";
import { attachmentPath, documentPath, saveDocumentFile } from "../../src/lib/uploads";
import { GET as attachmentGet, HEAD as attachmentHead } from "../../src/app/api/attachments/[attachmentId]/route";
import { GET as documentGet, HEAD as documentHead } from "../../src/app/api/documents/[documentId]/route";
import { GET as backupGet, HEAD as backupHead } from "../../src/app/api/admin/backups/latest/route";
import { GET as sharedGet, HEAD as sharedHead } from "../../src/app/api/share/[shareId]/[index]/route";
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
function fetchRaw(route: Handler, headers: Record<string, string> = {}, method = "GET"): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  handler = route;
  return new Promise((resolve, reject) => {
    http.request(`${base}/x`, { headers, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject).end();
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

/** Descriptores de este proceso abiertos sobre `file` (Linux: /proc/self/fd). */
async function openDescriptors(file: string): Promise<number> {
  let n = 0;
  for (const fd of await readdir("/proc/self/fd").catch(() => [] as string[])) {
    if ((await readlink(`/proc/self/fd/${fd}`).catch(() => "")) === file) n++;
  }
  return n;
}

/**
 * Ficheros de 1 MB: uno pequeño se lee entero al abrirlo (el búfer del flujo) y su descriptor se cierra solo; con uno
 * más grande que ese búfer, el flujo que nadie lee lo deja abierto.
 */
const BIG = 1024 * 1024;

/** Deja correr la apertura asíncrona del fichero que hubiera empezado un createReadStream. */
const settle = () => new Promise((r) => setTimeout(r, 50));

/** Cabeceras de una respuesta, sin las que dependen de la fecha. */
const headersOf = (res: Response) => Object.fromEntries([...res.headers].filter(([k]) => k !== "date"));

const downloads = (userId: string, since: Date) => flushLogs().then(() => db.appLog.count({ where: { userId, action: { in: ["attachments.download", "documents.download", "backups.download"] }, createdAt: { gte: since } } }));

// Next responde a HEAD con el GET si la ruta no lo exporta: abría el flujo del fichero, tiraba el cuerpo y el descriptor
// se quedaba abierto (además de anotar la descarga y, en la copia de seguridad, gastar el token de un solo uso).
describe("HEAD de las descargas", { skip: process.platform !== "linux" && "solo en Linux (/proc/self/fd)" }, () => {
  test("adjunto y documento: las mismas cabeceras que GET, sin cuerpo, sin abrir el fichero ni registrar la descarga", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const task = await makeTask(f);
    await loginAs(member);
    const pdf = await db.taskAttachment.create({ data: { taskId: task.id, originalName: "informe.pdf", size: BIG, isImage: false, mimeType: "application/pdf" } });
    await writeFile(attachmentPath(pdf.id, "file"), Buffer.alloc(BIG, 1));
    const doc = await db.projectDocument.create({ data: { projectId: f.project.id, name: "doc.pdf", mimeType: "application/pdf", size: BIG, kind: "PDF", createdById: member.id } });
    await saveDocumentFile(doc.id, Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(BIG - 9, 32)]));
    const cases = [
      { file: attachmentPath(pdf.id, "file"), call: (h: typeof attachmentGet) => h(new Request(`http://localhost/api/attachments/${pdf.id}?download=1`), { params: Promise.resolve({ attachmentId: pdf.id }) }), get: attachmentGet, head: attachmentHead },
      { file: documentPath(doc.id), call: (h: typeof documentGet) => h(new Request(`http://localhost/api/documents/${doc.id}?download=1`), { params: Promise.resolve({ documentId: doc.id }) }), get: documentGet, head: documentHead },
    ] as const;
    for (const c of cases) {
      const since = new Date();
      const head = await (c.call as (h: typeof c.head) => Promise<Response>)(c.head);
      await settle();
      assert.equal(head.status, 200);
      assert.equal(head.body, null);
      assert.equal(await openDescriptors(c.file), 0, "HEAD no abre el fichero");
      assert.equal(await downloads(member.id, since), 0, "HEAD no cuenta como descarga");
      const get = await (c.call as (h: typeof c.get) => Promise<Response>)(c.get);
      assert.deepEqual(headersOf(head), headersOf(get));
      for (const h of ["content-type", "content-length", "etag", "content-disposition"]) assert.ok(head.headers.get(h), h);
      assert.equal(await downloads(member.id, since), 1);
      // Comprobación de la propia prueba: el GET sí tiene el fichero abierto hasta que se lee o se cancela.
      await settle();
      assert.equal(await openDescriptors(c.file), 1);
      await get.body!.cancel();
      await settle();
      assert.equal(await openDescriptors(c.file), 0);
    }
    // A través de un servidor HTTP real: el Content-Length llega al cliente y no hay cuerpo.
    const real = await fetchRaw((req) => attachmentHead(new Request(`http://localhost/api/attachments/${pdf.id}`, { headers: req.headers }), { params: Promise.resolve({ attachmentId: pdf.id }) }), {}, "HEAD");
    assert.equal(real.status, 200);
    assert.equal(real.headers["content-length"], String(BIG));
    assert.equal(real.body.length, 0);
    await settle();
    assert.equal(await openDescriptors(attachmentPath(pdf.id, "file")), 0);
  });

  test("lo compartido y la copia de seguridad: HEAD no abre el fichero ni gasta el token de un solo uso", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const shareId = await stageShare(admin.id, { title: "", text: "", url: "" }, [{ name: "a.bin", type: "application/octet-stream", data: Buffer.alloc(BIG, 2) }]);
    const sharedFile = path.join(process.env.UPLOAD_DIR!, "shared", admin.id, shareId, "0.bin");
    const ctx = { params: Promise.resolve({ shareId, index: "0" }) };
    const sHead = await sharedHead(new Request("http://localhost/x"), ctx);
    await settle();
    assert.equal(sHead.status, 200);
    assert.equal(sHead.headers.get("content-length"), String(BIG));
    assert.equal(await openDescriptors(sharedFile), 0);
    const sGet = await sharedGet(new Request("http://localhost/x"), ctx);
    assert.deepEqual(headersOf(sHead), headersOf(sGet));
    assert.equal((await sGet.arrayBuffer()).byteLength, BIG);

    await mkdir(backupsDir(), { recursive: true });
    const name = backupFileName(new Date());
    const dump = path.join(backupsDir(), name);
    await writeFile(dump, Buffer.alloc(BIG, 3));
    const token = issueBackupDownloadToken(admin.id);
    const url = `http://localhost/api/admin/backups/latest?token=${encodeURIComponent(token)}`;
    const since = new Date();
    const bHead = await backupHead(new Request(url));
    await settle();
    assert.equal(bHead.status, 200);
    assert.equal(bHead.headers.get("content-length"), String(BIG));
    assert.equal(bHead.headers.get("content-disposition"), `attachment; filename="${name}"`);
    assert.equal(await openDescriptors(dump), 0);
    assert.equal(backupDownloadTokenValid(token, admin.id), true, "el token sigue sin gastar");
    assert.equal(await downloads(admin.id, since), 0);
    const bGet = await backupGet(new Request(url));
    assert.equal(bGet.status, 200);
    assert.deepEqual(headersOf(bHead), headersOf(bGet));
    assert.equal((await bGet.arrayBuffer()).byteLength, BIG);
    assert.equal(backupDownloadTokenValid(token, admin.id), false, "el GET sí lo gasta");
    assert.equal(await downloads(admin.id, since), 1);
  });
});
