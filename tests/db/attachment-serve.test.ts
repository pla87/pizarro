// Ruta /api/attachments/[id] con sus cachés (acceso y metadatos del adjunto) contra PostgreSQL real: el 304 de las
// miniaturas es barato, pero nunca se sirve (ni se confirma con 304) un adjunto a quien no tiene acceso o que ya no existe.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { db, loginAs, logout, makeProject, makeTask, makeUser } from "./helpers";
import { deleteAttachment, deleteTask } from "../../src/actions/tasks";
import { removeProjectMember } from "../../src/actions/projects";
import { revokeProject, revokeUser } from "../../src/lib/revoke";
import { flushLogs } from "../../src/lib/log";
import { purgeProject } from "../../src/lib/project-delete";
import { attachmentPath } from "../../src/lib/uploads";
import { GET } from "../../src/app/api/attachments/[attachmentId]/route";

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

function get(id: string, opts: { thumb?: boolean; etag?: string | null; download?: boolean } = {}) {
  const qs = new URLSearchParams();
  if (opts.thumb) qs.set("thumb", "1");
  if (opts.download) qs.set("download", "1");
  const headers: Record<string, string> = opts.etag ? { "if-none-match": opts.etag } : {};
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
  test("con acceso: 200 con ETag, max-age=10 en línea y 304 al revalidar", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    const { att } = await makeAttachment(f);
    await loginAs(member);
    const res = await get(att.id, { thumb: true });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, max-age=10");
    assert.equal(await res.text(), "thumb-im");
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
});
