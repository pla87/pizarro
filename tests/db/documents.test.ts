// Documentación del proyecto contra PostgreSQL real: acceso (miembros, ajenos, privados), límites (número, cuota,
// tamaño de archivo), subida por la ruta API, descarga y borrado (acción y borrado del proyecto).
import assert from "node:assert/strict";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { asUser, db, expectFail, expectOk, loginAs, logout, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { deleteDocument, renameDocument } from "../../src/actions/documents";
import { DOCUMENTS_MAX_PER_PROJECT } from "../../src/lib/document-kind";
import { createDocumentWithinLimit, findDocumentForUser, listProjectDocuments } from "../../src/lib/documents";
import { createAttachmentWithinLimit } from "../../src/lib/attachment-limit";
import { purgeProject } from "../../src/lib/project-delete";
import { storageUsage } from "../../src/lib/storage-usage";
import { documentPath, saveDocumentFile } from "../../src/lib/uploads";
import { POST as uploadRoute } from "../../src/app/api/projects/[projectId]/documents/route";
import { GET as fileRoute } from "../../src/app/api/documents/[documentId]/route";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-docs-"));
const MB = 1024 * 1024;

const row = (projectId: string, createdById: string, size = 10, name = "nota.txt") =>
  ({ projectId, name, mimeType: "text/plain", size, kind: "TEXT" as const, createdById });

async function userOf(id: string) {
  return { ...(await db.user.findUniqueOrThrow({ where: { id } })), theme: "SYSTEM", accent: "BLUE", locale: "ES" } as never;
}

function uploadReq(projectId: string, file: File | null, headers: Record<string, string> = {}) {
  const body = new FormData();
  if (file) body.append("file", file);
  return new Request(`http://localhost/api/projects/${projectId}/documents`, { method: "POST", body, headers: { origin: "http://localhost", host: "localhost", ...headers } });
}
const params = (projectId: string) => ({ params: Promise.resolve({ projectId }) });

describe("documentación: acceso", () => {
  test("un ajeno al proyecto no puede listar, leer, subir, renombrar ni borrar", async () => {
    const member = await makeUser();
    const outsider = await makeUser();
    const f = await makeProject({ members: [member] });
    const doc = await db.projectDocument.create({ data: row(f.project.id, member.id) });
    await saveDocumentFile(doc.id, Buffer.from("hola"));

    assert.equal((await listProjectDocuments(await userOf(member.id), f.project.id)).length, 1);
    await assert.rejects(listProjectDocuments(await userOf(outsider.id), f.project.id), NOT_FOUND);
    assert.equal(await findDocumentForUser(await userOf(outsider.id), doc.id), null);
    assert.ok(await findDocumentForUser(await userOf(member.id), doc.id));

    // Ruta de descarga: 404 al ajeno (no se distingue de «no existe») y 401 sin sesión.
    await loginAs(outsider);
    assert.equal((await fileRoute(new Request(`http://localhost/api/documents/${doc.id}`), { params: Promise.resolve({ documentId: doc.id }) })).status, 404);
    logout();
    assert.equal((await fileRoute(new Request(`http://localhost/api/documents/${doc.id}`), { params: Promise.resolve({ documentId: doc.id }) })).status, 401);

    // Subida: el ajeno recibe 404 y no se crea nada.
    await loginAs(outsider);
    const res = await uploadRoute(uploadReq(f.project.id, new File(["x"], "a.txt", { type: "text/plain" })), params(f.project.id));
    assert.equal(res.status, 404);
    assert.equal(await db.projectDocument.count({ where: { projectId: f.project.id } }), 1);

    expectFail(await deleteDocument(doc.id), NOT_FOUND);
    expectFail(await renameDocument(doc.id, "otro.txt"), NOT_FOUND);
    assert.equal(await db.projectDocument.count({ where: { id: doc.id } }), 1);
    await stat(documentPath(doc.id)); // el fichero sigue ahí
  });

  test("proyecto privado: ni otro administrador lo ve; el miembro sí; de equipo, los administradores sí", async () => {
    const owner = await makeUser({ role: "ADMIN" });
    const otherAdmin = await makeUser({ role: "ADMIN" });
    const priv = await makeProject({ visibility: "PRIVATE", owner });
    const team = await makeProject({ members: [] });
    await db.projectDocument.create({ data: row(priv.project.id, owner.id) });
    await db.projectDocument.create({ data: row(team.project.id, owner.id) });
    assert.equal((await listProjectDocuments(await userOf(owner.id), priv.project.id)).length, 1);
    await assert.rejects(listProjectDocuments(await userOf(otherAdmin.id), priv.project.id), NOT_FOUND);
    assert.equal((await listProjectDocuments(await userOf(otherAdmin.id), team.project.id)).length, 1);
  });

  test("la lista solo trae los documentos de su proyecto", async () => {
    const m = await makeUser();
    const a = await makeProject({ members: [m] });
    const b = await makeProject({ members: [m] });
    await db.projectDocument.create({ data: row(a.project.id, m.id, 1, "a.txt") });
    await db.projectDocument.create({ data: row(b.project.id, m.id, 1, "b.txt") });
    const list = await listProjectDocuments(await userOf(m.id), a.project.id);
    assert.deepEqual(list.map((d) => d.name), ["a.txt"]);
  });
});

describe("documentación: subida por la ruta API", () => {
  test("sube texto, Markdown, PDF e imagen; sirve cada uno con sus cabeceras; descarga solo con ?download=1", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    await loginAs(m);
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#f00" } }).png().toBuffer();
    const files: [File, string][] = [
      [new File(["hola"], "nota.txt", { type: "text/plain" }), "TEXT"],
      [new File(["# t"], "guia.md", { type: "text/markdown" }), "MARKDOWN"],
      [new File(["%PDF-1.4\n%%EOF"], "doc.pdf", { type: "application/pdf" }), "PDF"],
      [new File([new Uint8Array(png)], "img.png", { type: "image/png" }), "IMAGE"],
      [new File(["<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"], "x.svg", { type: "image/svg+xml" }), "OTHER"],
      [new File(["<html><script>alert(1)</script></html>"], "falso.pdf", { type: "application/pdf" }), "OTHER"],
      [new File([new Uint8Array([0, 1, 2, 3])], "bin.txt", { type: "text/plain" }), "OTHER"],
    ];
    const ids: Record<string, string> = {};
    for (const [file, kind] of files) {
      const res = await uploadRoute(uploadReq(f.project.id, file), params(f.project.id));
      assert.equal(res.status, 201, file.name);
      const json = (await res.json()) as { id: string; kind: string };
      assert.equal(json.kind, kind, file.name);
      ids[file.name] = json.id;
    }
    // Los ficheros viven en UPLOAD_DIR/documents/<id>.bin (nunca con el nombre del usuario).
    const names = await readdir(path.join(process.env.UPLOAD_DIR!, "documents"));
    for (const id of Object.values(ids)) assert.ok(names.includes(`${id}.bin`));
    assert.ok(!names.some((n) => /nota|guia|doc\.pdf|img/.test(n)));

    const get = (id: string, q = "", headers: Record<string, string> = {}) =>
      fileRoute(new Request(`http://localhost/api/documents/${id}${q}`, { headers }), { params: Promise.resolve({ documentId: id }) });
    const txt = await get(ids["nota.txt"]!);
    assert.equal(txt.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(txt.headers.get("x-content-type-options"), "nosniff");
    assert.match(txt.headers.get("content-disposition")!, /^inline/);
    assert.match(txt.headers.get("content-security-policy")!, /sandbox/);
    assert.equal(await txt.text(), "hola");
    const md = await get(ids["guia.md"]!);
    assert.equal(md.headers.get("content-type"), "text/plain; charset=utf-8");
    const pdf = await get(ids["doc.pdf"]!);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.match(pdf.headers.get("content-disposition")!, /^inline/);
    assert.match(pdf.headers.get("content-security-policy")!, /sandbox/);
    assert.equal(pdf.headers.get("x-frame-options"), "SAMEORIGIN");
    const img = await get(ids["img.png"]!);
    assert.equal(img.headers.get("content-type"), "image/webp");
    assert.equal((await db.projectDocument.findUniqueOrThrow({ where: { id: ids["img.png"]! } })).mimeType, "image/webp");
    // SVG y falsos PDF: nunca inline ni con su tipo (octet-stream, adjunto).
    for (const n of ["x.svg", "falso.pdf", "bin.txt"]) {
      const r = await get(ids[n]!);
      assert.equal(r.headers.get("content-type"), "application/octet-stream", n);
      assert.match(r.headers.get("content-disposition")!, /^attachment/, n);
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    }
    // Descarga explícita: adjunto; ETag y 304 con If-None-Match.
    const dl = await get(ids["nota.txt"]!, "?download=1");
    assert.match(dl.headers.get("content-disposition")!, /^attachment/);
    const etag = txt.headers.get("etag")!;
    assert.equal((await get(ids["nota.txt"]!, "", { "if-none-match": etag })).status, 304);
    assert.match(txt.headers.get("cache-control")!, /^private/);

    // Ver no deja rastro en el registro; subir y descargar, sí.
    const { flushLogs } = await import("../../src/lib/log");
    await flushLogs();
    const actions = (await db.appLog.findMany({ where: { action: { startsWith: "documents." }, userId: m.id }, select: { action: true } })).map((l) => l.action);
    assert.ok(actions.includes("documents.upload"));
    assert.ok(actions.includes("documents.download"));
  });

  test("origen distinto (CSRF), vacío, sin campo, y sin sesión se rechazan", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    await loginAs(m);
    const file = new File(["x"], "a.txt", { type: "text/plain" });
    assert.equal((await uploadRoute(uploadReq(f.project.id, file, { origin: "http://evil.example" }), params(f.project.id))).status, 403);
    assert.equal((await uploadRoute(uploadReq(f.project.id, new File([], "v.txt")), params(f.project.id))).status, 400);
    assert.equal((await uploadRoute(uploadReq(f.project.id, null), params(f.project.id))).status, 400);
    logout();
    assert.notEqual((await uploadRoute(uploadReq(f.project.id, file), params(f.project.id))).status, 201);
    assert.equal(await db.projectDocument.count({ where: { projectId: f.project.id } }), 0);
  });

  test("respeta el tamaño máximo de archivo del proyecto (y MAX_UPLOAD_MB)", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    await db.project.update({ where: { id: f.project.id }, data: { fileMaxMb: 1 } });
    await loginAs(m);
    const big = new File([new Uint8Array(MB + 10)], "grande.txt", { type: "text/plain" });
    assert.equal((await uploadRoute(uploadReq(f.project.id, big), params(f.project.id))).status, 413);
    // Con el tamaño declarado en la cabecera ya se rechaza antes de leer el cuerpo.
    assert.equal((await uploadRoute(uploadReq(f.project.id, new File(["x"], "a.txt"), { "content-length": String(5 * MB) }), params(f.project.id))).status, 413);
    assert.equal((await uploadRoute(uploadReq(f.project.id, new File([new Uint8Array(MB - 10)], "justo.txt", { type: "text/plain" })), params(f.project.id))).status, 201);
    const prev = process.env.MAX_UPLOAD_MB;
    process.env.MAX_UPLOAD_MB = "0.5";
    try {
      assert.equal((await uploadRoute(uploadReq(f.project.id, new File([new Uint8Array(MB - 10)], "otro.txt", { type: "text/plain" })), params(f.project.id))).status, 413);
    } finally {
      if (prev === undefined) delete process.env.MAX_UPLOAD_MB;
      else process.env.MAX_UPLOAD_MB = prev;
    }
  });
});

describe("documentación: límites", () => {
  test("máximo de documentos por proyecto", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const other = await makeProject({ members: [m] });
    await db.projectDocument.createMany({ data: Array.from({ length: DOCUMENTS_MAX_PER_PROJECT - 1 }, () => row(f.project.id, m.id, 1)) });
    const base = { projectId: f.project.id, name: "n.txt", mimeType: "text/plain", size: 1, kind: "TEXT" as const, createdById: m.id };
    assert.equal((await createDocumentWithinLimit(base)).ok, true);
    const over = await createDocumentWithinLimit(base);
    assert.equal(over.ok, false);
    assert.ok(!over.ok && over.reason === "count" && over.limit === DOCUMENTS_MAX_PER_PROJECT);
    // Otro proyecto tiene su propia cuenta.
    assert.equal((await createDocumentWithinLimit({ ...base, projectId: other.project.id })).ok, true);
  });

  test("los documentos cuentan en la cuota del proyecto, junto con los adjuntos de tareas", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const task = await makeTask(f);
    const prev = process.env.UPLOAD_QUOTA_MB_PER_PROJECT;
    process.env.UPLOAD_QUOTA_MB_PER_PROJECT = "10";
    try {
      const doc = (size: number) => createDocumentWithinLimit({ projectId: f.project.id, name: "d.bin", mimeType: "application/octet-stream", size, kind: "OTHER", createdById: m.id });
      assert.equal((await doc(4 * MB)).ok, true);
      assert.equal((await storageUsage(f.project.id)).project, 4 * MB);
      assert.equal((await createAttachmentWithinLimit({ taskId: task.id, originalName: "a.bin", mimeType: "application/octet-stream", isImage: false, size: 4 * MB }, { id: true })).ok, true);
      assert.equal((await storageUsage(f.project.id)).project, 8 * MB);
      // Ya no caben 3 MB más, ni como documento ni como adjunto.
      const over = await doc(3 * MB);
      assert.ok(!over.ok && over.reason === "quota" && over.quota.scope === "project");
      const att = await createAttachmentWithinLimit({ taskId: task.id, originalName: "b.bin", mimeType: "application/octet-stream", isImage: false, size: 3 * MB }, { id: true });
      assert.ok(!att.ok && att.reason === "quota");
      assert.equal((await doc(2 * MB)).ok, true);
    } finally {
      if (prev === undefined) delete process.env.UPLOAD_QUOTA_MB_PER_PROJECT;
      else process.env.UPLOAD_QUOTA_MB_PER_PROJECT = prev;
    }
  });

  test("subidas simultáneas no pasan de la cuota entre todas", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const prev = process.env.UPLOAD_QUOTA_MB_PER_PROJECT;
    process.env.UPLOAD_QUOTA_MB_PER_PROJECT = "10";
    try {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => createDocumentWithinLimit({ projectId: f.project.id, name: "d.bin", mimeType: "application/octet-stream", size: 4 * MB, kind: "OTHER", createdById: m.id })),
      );
      assert.equal(results.filter((r) => r.ok).length, 2);
      assert.equal((await storageUsage(f.project.id)).project, 8 * MB);
    } finally {
      if (prev === undefined) delete process.env.UPLOAD_QUOTA_MB_PER_PROJECT;
      else process.env.UPLOAD_QUOTA_MB_PER_PROJECT = prev;
    }
  });
});

describe("documentación: borrar y renombrar", () => {
  test("borrar quita la fila y el fichero; renombrar solo cambia el nombre mostrado", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const doc = await db.projectDocument.create({ data: row(f.project.id, m.id, 4, "viejo.md") });
    await saveDocumentFile(doc.id, Buffer.from("hola"));
    await asUser(m, async () => {
      const r = expectOk(await renameDocument(doc.id, "../nuevo<x>.md"));
      assert.equal(r.name, "nuevo_x_.md");
      const after = await db.projectDocument.findUniqueOrThrow({ where: { id: doc.id } });
      assert.equal(after.name, "nuevo_x_.md");
      assert.equal(after.kind, "TEXT"); // el tipo se decidió al subir y no cambia con el nombre
      expectOk(await deleteDocument(doc.id));
      expectFail(await deleteDocument(doc.id), NOT_FOUND); // ya no existe
    });
    assert.equal(await db.projectDocument.count({ where: { id: doc.id } }), 0);
    await assert.rejects(stat(documentPath(doc.id)));
  });

  test("borrar el proyecto elimina sus documentos y sus ficheros, y no toca los de otros", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const keep = await makeProject({ members: [m] });
    const a = await db.projectDocument.create({ data: row(f.project.id, m.id) });
    const b = await db.projectDocument.create({ data: row(keep.project.id, m.id) });
    await saveDocumentFile(a.id, Buffer.from("a"));
    await saveDocumentFile(b.id, Buffer.from("b"));
    await purgeProject(f.project.id);
    assert.equal(await db.projectDocument.count({ where: { id: a.id } }), 0);
    await assert.rejects(stat(documentPath(a.id)));
    await stat(documentPath(b.id));
    assert.equal(await db.projectDocument.count({ where: { id: b.id } }), 1);
  });

  test("borrar al autor deja el documento sin autor (no se pierde)", async () => {
    const author = await makeUser();
    const f = await makeProject({ members: [author] });
    const doc = await db.projectDocument.create({ data: row(f.project.id, author.id) });
    await db.user.delete({ where: { id: author.id } });
    assert.equal((await db.projectDocument.findUniqueOrThrow({ where: { id: doc.id } })).createdById, null);
  });
});
