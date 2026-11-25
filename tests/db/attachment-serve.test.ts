// Ruta /api/attachments/[id] con sus cachés (acceso y metadatos del adjunto) contra PostgreSQL real: el 304 de las
// miniaturas es barato, pero nunca se sirve (ni se confirma con 304) un adjunto a quien no tiene acceso o que ya no existe.
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import sharp from "sharp";
import { db, loginAs, logout, makeProject, makeTask, makeUser } from "./helpers";
import { deleteAttachment, deleteTask } from "../../src/actions/tasks";
import { removeProjectMember } from "../../src/actions/projects";
import { revokeProject, revokeUser } from "../../src/lib/revoke";
import { flushLogs } from "../../src/lib/log";
import { purgeProject } from "../../src/lib/project-delete";
import { attachmentPath } from "../../src/lib/uploads";
import { GET } from "../../src/app/api/attachments/[attachmentId]/route";
import { POST as attachRoute } from "../../src/app/api/tasks/[taskId]/attachments/route";
import { resetRateLimit } from "../../src/lib/rate-limit";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-att-serve-"));

async function makeAttachment(f: Awaited<ReturnType<typeof makeProject>>, opts: { isImage?: boolean } = {}) {
  const task = await makeTask(f);
  const isImage = opts.isImage ?? true;
  const att = await db.taskAttachment.create({ data: { taskId: task.id, originalName: "foto.png", size: 8, isImage, mimeType: isImage ? "image/webp" : "application/pdf" } });
  if (isImage) {
    await writeFile(attachmentPath(att.id, "full"), "full-img");
    await writeFile(attachmentPath(att.id, "thumb"), "thumb-im");
  } else {
    await writeFile(attachmentPath(att.id, "file"), "pdf-data");
  }
  return { task, att };
}

function get(id: string, opts: { thumb?: boolean; etag?: string | null; download?: boolean; dest?: string } = {}) {
  const qs = new URLSearchParams();
  if (opts.thumb) qs.set("thumb", "1");
  if (opts.download) qs.set("download", "1");
  const headers: Record<string, string> = opts.etag ? { "if-none-match": opts.etag } : {};
  if (opts.dest) headers["sec-fetch-dest"] = opts.dest;
  return GET(new Request(`http://localhost/api/attachments/${id}?${qs}`, { headers }), { params: Promise.resolve({ attachmentId: id }) });
}

/** Primera petición (200) y revalidación (304), como hace el navegador con cada miniatura. */
async function warm(id: string) {
  const first = await get(id, { thumb: true });
  assert.equal(first.status, 200);
  await first.arrayBuffer();
  const etag = first.headers.get("etag")!;
  assert.ok(etag);
  assert.equal((await get(id, { thumb: true, etag })).status, 304);
  return etag;
}

describe("/api/attachments: caché y acceso", () => {
  test("con acceso: 200 con ETag, max-age=120 la miniatura, 10 la imagen en línea y 304 al revalidar", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const { att } = await makeAttachment(f);
    await loginAs(member);
    const res = await get(att.id, { thumb: true });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, max-age=120");
    assert.equal(await res.text(), "thumb-im");
    const full = await get(att.id);
    assert.equal(full.headers.get("cache-control"), "private, max-age=10");
    assert.equal(await full.text(), "full-img");
    // La descarga de la miniatura, como cualquier descarga.
    const thumbDl = await get(att.id, { thumb: true, download: true });
    assert.equal(thumbDl.headers.get("cache-control"), "private, no-cache");
    await thumbDl.arrayBuffer();
    // Un fichero que no es imagen no tiene miniatura: ?thumb=1 lo descarga, sin caché.
    const { att: pdf } = await makeAttachment(f, { isImage: false });
    const pdfRes = await get(pdf.id, { thumb: true });
    assert.equal(pdfRes.headers.get("cache-control"), "private, no-cache");
    await pdfRes.arrayBuffer();
    // La descarga explícita se revalida siempre (queda registrada).
    const dl = await get(att.id, { download: true });
    assert.equal(dl.headers.get("cache-control"), "private, no-cache");
    await dl.arrayBuffer();
    await warm(att.id);
  });

  test("sin sesión: 401; sin acceso al proyecto: 404 aunque el adjunto esté en caché", async () => {
    const member = await makeUser();
    const outsider = await makeUser();
    const f = await makeProject({ members: [member] });
    const { att } = await makeAttachment(f);
    await loginAs(member);
    const etag = await warm(att.id); // los metadatos ya están en la caché
    logout();
    assert.equal((await get(att.id, { thumb: true, etag })).status, 401);
    await loginAs(outsider);
    assert.equal((await get(att.id, { thumb: true })).status, 404);
    assert.equal((await get(att.id, { thumb: true, etag })).status, 404, "ni siquiera un 304");
  });

  test("tras quitar el acceso con la función real de revoke: 404 al momento", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const { att } = await makeAttachment(f);
    await loginAs(member);
    const etag = await warm(att.id);
    // Acción real (borra la pertenencia y llama a revokeProject).
    await loginAs(admin);
    await removeProjectMember(f.project.id, member.id);
    await loginAs(member);
    assert.equal((await get(att.id, { thumb: true, etag })).status, 404);
    assert.equal((await get(att.id, { thumb: true })).status, 404);
  });

  test("revokeProject y revokeUser cortan el acceso aunque la caché lo diera", async () => {
    const m1 = await makeUser();
    const m2 = await makeUser();
    const f = await makeProject({ members: [m1, m2] });
    const { att } = await makeAttachment(f);
    await loginAs(m1);
    await warm(att.id);
    await db.projectMember.deleteMany({ where: { projectId: f.project.id, userId: m1.id } });
    revokeProject(f.project.id);
    assert.equal((await get(att.id, { thumb: true })).status, 404);
    await loginAs(m2);
    await warm(att.id);
    await db.projectMember.deleteMany({ where: { projectId: f.project.id, userId: m2.id } });
    revokeUser(m2.id);
    assert.equal((await get(att.id, { thumb: true })).status, 404);
  });

  test("adjunto borrado (acción deleteAttachment, con el fichero retenido para deshacer): 404 al instante", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const { att } = await makeAttachment(f);
    await loginAs(member);
    const etag = await warm(att.id);
    await deleteAttachment(att.id);
    assert.equal((await get(att.id, { thumb: true, etag })).status, 404);
    assert.equal((await get(att.id, { thumb: true })).status, 404);
  });

  test("tarea borrada (deleteTask): sus adjuntos dan 404 al instante", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const { att, task } = await makeAttachment(f);
    await loginAs(member);
    const etag = await warm(att.id);
    await deleteTask(task.id);
    assert.equal((await get(att.id, { thumb: true, etag })).status, 404);
  });

  test("proyecto borrado (purgeProject): 404 al instante", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const { att } = await makeAttachment(f);
    await loginAs(member);
    const etag = await warm(att.id);
    await purgeProject(f.project.id);
    assert.equal((await get(att.id, { thumb: true, etag })).status, 404);
  });

  test("fichero desaparecido del disco con metadatos en caché: no se sirve el cuerpo (404)", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const { att } = await makeAttachment(f);
    await loginAs(member);
    await warm(att.id);
    await rm(attachmentPath(att.id, "thumb"));
    assert.equal((await get(att.id, { thumb: true })).status, 404);
  });

  test("adjunto nuevo: se ve al instante (los inexistentes no se cachean)", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const task = await makeTask(f);
    await loginAs(member);
    const created = await db.taskAttachment.create({ data: { taskId: task.id, originalName: "x.png", size: 8 } });
    assert.equal((await get(created.id, { thumb: true })).status, 404);
    await writeFile(attachmentPath(created.id, "thumb"), "thumb-im");
    assert.equal((await get(created.id, { thumb: true })).status, 200);
  });

  test("las descargas explícitas se siguen registrando, también al revalidar", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const { att } = await makeAttachment(f, { isImage: false });
    await loginAs(member);
    const res = await get(att.id);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition") ?? "", /^attachment/);
    await res.arrayBuffer();
    assert.equal((await get(att.id, { etag: res.headers.get("etag") })).status, 304);
    // logEvent escribe en segundo plano
    await flushLogs();
    assert.equal(await db.appLog.count({ where: { action: "attachments.download", projectId: f.project.id } }), 2);
  });

  test("una petición de imagen (<img> de una descripción) nunca cuenta como descarga, aunque lleve ?download=1", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const { att: img } = await makeAttachment(f);
    const { att: pdf } = await makeAttachment(f, { isImage: false });
    await loginAs(member);
    // `![x](/api/attachments/<id>?download=1)`: se sirve en línea, con la caché de una imagen, y no se registra.
    const res = await get(img.id, { download: true, dest: "image" });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition") ?? "", /^inline/);
    assert.equal(res.headers.get("cache-control"), "private, max-age=10");
    await res.arrayBuffer();
    assert.equal((await get(img.id, { download: true, dest: "image", etag: res.headers.get("etag") })).status, 304);
    // Un fichero que no es imagen pedido desde un <img>: sigue sin servirse en línea, pero tampoco se registra.
    const file = await get(pdf.id, { dest: "image" });
    assert.match(file.headers.get("content-disposition") ?? "", /^attachment/);
    await file.arrayBuffer();
    await flushLogs();
    assert.equal(await db.appLog.count({ where: { action: "attachments.download", projectId: f.project.id } }), 0);
    // La descarga de verdad (enlace con download: Sec-Fetch-Dest document o empty) sí.
    const dl = await get(img.id, { download: true, dest: "document" });
    assert.match(dl.headers.get("content-disposition") ?? "", /^attachment/);
    await dl.arrayBuffer();
    await flushLogs();
    assert.equal(await db.appLog.count({ where: { action: "attachments.download", projectId: f.project.id } }), 1);
  });

  test("formatos del material de un curso (.md, .pdf, .html, .docx, .pptx): se suben y se descargan; ninguno como página", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const task = await makeTask(f);
    await loginAs(member);
    resetRateLimit(`upload:${member.id}`);
    const files: [string, string, string, string][] = [
      // nombre, tipo que declara el navegador, contenido, Content-Type con el que se sirve
      ["guia.md", "text/markdown", "# Tema 1\n", "application/octet-stream"],
      ["tema.pdf", "application/pdf", "%PDF-1.4\n%%EOF", "application/pdf"],
      ["pagina.html", "text/html", "<!doctype html><script>localStorage.setItem('pz','1')</script>", "application/octet-stream"],
      ["tema.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "PK docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["clase.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "PK pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ];
    for (const [name, type, body, served] of files) {
      const form = new FormData();
      form.append("file", new File([body], name, { type }));
      const res = await attachRoute(new Request(`http://localhost/api/tasks/${task.id}/attachments`, { method: "POST", body: form, headers: { origin: "http://localhost", host: "localhost" } }), { params: Promise.resolve({ taskId: task.id }) });
      assert.equal(res.status, 201, `${name}: ${await res.clone().text()}`);
      const row = await db.taskAttachment.findFirstOrThrow({ where: { taskId: task.id, originalName: name } });
      assert.equal(row.isImage, false, name);
      // Ver o descargar, siempre como adjunto (nunca en línea) y sin que el navegador adivine el tipo.
      for (const download of [false, true]) {
        const r = await get(row.id, { download });
        assert.equal(r.status, 200, name);
        assert.equal(r.headers.get("content-type"), served, name);
        assert.match(r.headers.get("content-disposition")!, /^attachment; filename\*=UTF-8''/, name);
        assert.equal(decodeURIComponent(r.headers.get("content-disposition")!.replace(/^attachment; filename\*=UTF-8''/, "")), name);
        assert.equal(r.headers.get("x-content-type-options"), "nosniff", name);
        assert.equal(await r.text(), body, name);
      }
    }
  });

  test("imagen que llega sin tipo (una .avif en algunos Windows, lo compartido con «Compartir → Pizarro»): si sharp la lee, es imagen; si no, archivo", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const task = await makeTask(f);
    await loginAs(member);
    resetRateLimit(`upload:${member.id}`);
    const avif = new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: "#336699" } }).avif().toBuffer());
    const webp = new Uint8Array(await sharp({ create: { width: 40, height: 30, channels: 3, background: "#993366" } }).webp().toBuffer());
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>';
    const cases: [name: string, type: string, body: Uint8Array<ArrayBuffer> | string, isImage: boolean][] = [
      ["foto.avif", "", avif, true],
      ["foto.webp", "application/octet-stream", webp, true],
      // Extensión de imagen, pero no lo es: queda como archivo, como una imagen con tipo que sharp no entiende.
      ["roto.png", "", "no soy una imagen", false],
      // SVG nunca como imagen, aunque llegue sin tipo; y sin extensión de imagen no se prueba (aunque el contenido lo sea).
      ["logo.svg", "", svg, false],
      ["foto.bin", "", webp, false],
    ];
    for (const [name, type, body, isImage] of cases) {
      const form = new FormData();
      form.append("file", new File([body], name, { type }));
      const res = await attachRoute(new Request(`http://localhost/api/tasks/${task.id}/attachments`, { method: "POST", body: form, headers: { origin: "http://localhost", host: "localhost" } }), { params: Promise.resolve({ taskId: task.id }) });
      assert.equal(res.status, 201, `${name}: ${await res.clone().text()}`);
      const row = await db.taskAttachment.findFirstOrThrow({ where: { taskId: task.id, originalName: name } });
      assert.equal(row.isImage, isImage, name);
      if (isImage) {
        assert.equal(row.mimeType, "image/webp", name);
        assert.ok(row.width && row.height, name);
        assert.ok((await stat(attachmentPath(row.id, "thumb"))).size > 0, `${name}: miniatura`);
        const r = await get(row.id);
        assert.equal(r.headers.get("content-type"), "image/webp", name);
      } else {
        assert.equal(row.mimeType, "application/octet-stream", name);
        const r = await get(row.id);
        assert.match(r.headers.get("content-disposition")!, /^attachment;/, name);
      }
    }
  });
});
