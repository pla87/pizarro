// Notas de Documentación («Nueva nota») contra PostgreSQL real: crear, guardar con su versión, cambio simultáneo de dos
// personas, tope de caracteres, cuota y máximo de documentos, papelera, descarga como .md, búsqueda en el texto (sin
// mayúsculas ni tildes) y fijar arriba.
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { asUser, db, expectFail, expectOk, loginAs, makeProject, makeUser, NOT_FOUND } from "./helpers";
import { createNote, deleteDocument, deleteDocumentForever, getNote, renameDocument, restoreDocument, saveNote, searchNotes, setDocumentPinned } from "../../src/actions/documents";
import { DOCUMENTS_MAX_PER_PROJECT, NOTE_MAX_CHARS } from "../../src/lib/document-kind";
import { listProjectDocumentsOf, listTrashedDocumentsOf, purgeTrashedDocuments } from "../../src/lib/documents";
import { storageUsage } from "../../src/lib/storage-usage";
import { saveDocumentFile } from "../../src/lib/uploads";
import { flushLogs } from "../../src/lib/log";
import { GET as fileRoute, HEAD as fileHead } from "../../src/app/api/documents/[documentId]/route";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-docs-notes-"));
const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

const doc = (id: string) => db.projectDocument.findUniqueOrThrow({ where: { id } });
const fetchDoc = (id: string, query = "", headers: Record<string, string> = {}) =>
  fileRoute(new Request(`http://localhost/api/documents/${id}${query}`, { headers }), { params: Promise.resolve({ documentId: id }) });

async function withQuota<T>(mb: number, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.UPLOAD_QUOTA_MB_PER_PROJECT;
  process.env.UPLOAD_QUOTA_MB_PER_PROJECT = String(mb);
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.UPLOAD_QUOTA_MB_PER_PROJECT;
    else process.env.UPLOAD_QUOTA_MB_PER_PROJECT = prev;
  }
}

describe("notas: crear y guardar", () => {
  test("«Nueva nota» crea un Markdown sin fichero que sale en la lista como nota; guardar sube la versión y el tamaño", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    await loginAs(m);
    const created = expectOk(await createNote(f.project.id));
    assert.equal(created.name, "Nota sin título");
    assert.equal(created.note, true);
    assert.equal(created.kind, "MARKDOWN");
    const row = await doc(created.id);
    assert.deepEqual([row.noteContent, row.noteVersion, row.size, row.mimeType], ["", 0, 0, "text/markdown"]);
    // Sin fichero en el disco.
    assert.deepEqual(await readdir(process.env.UPLOAD_DIR!).catch(() => []), []);

    const text = "# Acta\n\nAcordado: **sí** — ñandú";
    const saved = expectOk(await saveNote(created.id, text, 0));
    // El primer guardado le pone de nombre su primera línea (título automático, v1.77).
    assert.deepEqual(saved, { status: "saved", version: 1, size: Buffer.byteLength(text), name: "Acta" });
    assert.deepEqual(expectOk(await getNote(created.id)), { content: text, version: 1, trashed: false });
    // El mismo texto otra vez (el guardado al cerrar) no cambia nada.
    assert.deepEqual(expectOk(await saveNote(created.id, text, 1)), { status: "saved", version: 1, size: Buffer.byteLength(text) });
    assert.equal((await doc(created.id)).noteVersion, 1);

    const listed = (await listProjectDocumentsOf(f.project.id)).find((d) => d.id === created.id)!;
    assert.equal(listed.note, true);
    assert.equal(listed.size, Buffer.byteLength(text));
    assert.equal((await storageUsage(f.project.id)).project, Buffer.byteLength(text));
    // Renombrar como cualquier documento.
    expectOk(await renameDocument(created.id, "Acta de la reunión"));
    assert.equal((await doc(created.id)).name, "Acta de la reunión");
    // Los Logs: crear con plantilla; los guardados automáticos no dejan rastro.
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { action: { startsWith: "documents." }, projectId: f.project.id }, select: { action: true } });
    assert.ok(logs.some((l) => l.action === "documents.createNote"));
    assert.ok(!logs.some((l) => l.action === "documents.saveNote"));
  });

  test("dos personas a la vez: el guardado con una versión vieja no pisa nada y devuelve el texto de la otra", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const f = await makeProject({ members: [a, b] });
    const note = await asUser(a, async () => expectOk(await createNote(f.project.id)));
    // Las dos abren la nota en la versión 0.
    await asUser(a, async () => assert.equal(expectOk(await saveNote(note.id, "Texto de A", 0)).status, "saved"));
    const conflict = await asUser(b, async () => expectOk(await saveNote(note.id, "Texto de B", 0)));
    assert.deepEqual(conflict, { status: "conflict", version: 1, content: "Texto de A" });
    assert.equal((await doc(note.id)).noteContent, "Texto de A");
    // «Quedarme con la mía»: B guarda sobre la versión que acaba de ver.
    await asUser(b, async () => assert.deepEqual(expectOk(await saveNote(note.id, "Texto de B", 1)), { status: "saved", version: 2, size: 10, name: "Texto de B" }));
    // A, que seguía en la versión 1, ahora es quien recibe el aviso.
    await asUser(a, async () => assert.equal(expectOk(await saveNote(note.id, "Texto de A, segunda", 1)).status, "conflict"));
  });

  test("un guardado que se hizo pero cuya respuesta se perdió: el reintento con la versión vieja es un éxito, no un conflicto", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    await loginAs(m);
    const note = expectOk(await createNote(f.project.id));
    expectOk(await saveNote(note.id, "uno", 0));
    // El navegador no recibió la respuesta y reintenta lo mismo sobre la versión 0.
    assert.deepEqual(expectOk(await saveNote(note.id, "uno", 0)), { status: "saved", version: 1, size: 3 });
    assert.equal((await doc(note.id)).noteVersion, 1);
    // Con otro texto, sí es un conflicto.
    assert.equal(expectOk(await saveNote(note.id, "dos", 0)).status, "conflict");
  });

  test("guardados simultáneos sobre la misma versión: solo uno entra", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    await loginAs(m);
    const note = expectOk(await createNote(f.project.id));
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => saveNote(note.id, `versión ${i}`, 0)));
    const out = results.map(expectOk);
    assert.equal(out.filter((r) => r.status === "saved").length, 1);
    assert.equal(out.filter((r) => r.status === "conflict").length, 4);
    assert.equal((await doc(note.id)).noteVersion, 1);
  });

  test("tope de caracteres, cuota y máximo de documentos", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    await loginAs(m);
    const note = expectOk(await createNote(f.project.id));
    expectFail(await saveNote(note.id, "x".repeat(NOTE_MAX_CHARS + 1), 0), /200\.000 caracteres/);
    assert.equal((await doc(note.id)).noteVersion, 0);
    assert.equal(expectOk(await saveNote(note.id, "x".repeat(NOTE_MAX_CHARS), 0)).status, "saved");

    // Cuota: con el proyecto casi lleno la nota no puede crecer más de lo que queda, pero sí acortarse.
    const q = await makeProject({ members: [m] });
    const small = expectOk(await createNote(q.project.id));
    await db.projectDocument.create({ data: { projectId: q.project.id, name: "grande.bin", mimeType: "application/octet-stream", size: 1 * MB - 100, kind: "OTHER", createdById: m.id } });
    await withQuota(1, async () => {
      assert.equal(expectOk(await saveNote(small.id, "a".repeat(80), 0)).status, "saved");
      expectFail(await saveNote(small.id, "a".repeat(200), 1), /[Cc]uota/);
      assert.equal((await doc(small.id)).noteContent, "a".repeat(80));
      // Lo que ya ocupaba cuenta: crecer hasta el límite sí cabe, y acortar siempre.
      assert.equal(expectOk(await saveNote(small.id, "a".repeat(100), 1)).status, "saved");
      assert.equal(expectOk(await saveNote(small.id, "corta", 2)).status, "saved");
      // «Nueva nota» con la cuota llena: se crea vacía (0 bytes), como cabe.
      expectOk(await createNote(q.project.id));
    });

    // Máximo de documentos: «Nueva nota» da el mismo error que una subida.
    const g = await makeProject({ members: [m] });
    await db.projectDocument.createMany({ data: Array.from({ length: DOCUMENTS_MAX_PER_PROJECT }, () => ({ projectId: g.project.id, name: "n.txt", mimeType: "text/plain", size: 1, kind: "TEXT" as const, createdById: m.id })) });
    expectFail(await createNote(g.project.id), /máximo de 200 archivos/);
  });

  test("un ajeno no puede crear, leer, guardar, fijar ni buscar", async () => {
    const m = await makeUser();
    const outsider = await makeUser();
    const f = await makeProject({ visibility: "PRIVATE", owner: m });
    const note = await asUser(m, async () => {
      const n = expectOk(await createNote(f.project.id));
      expectOk(await saveNote(n.id, "secreto", 0));
      return n;
    });
    await loginAs(outsider);
    expectFail(await createNote(f.project.id), NOT_FOUND);
    expectFail(await getNote(note.id), NOT_FOUND);
    expectFail(await saveNote(note.id, "pisado", 1), NOT_FOUND);
    expectFail(await setDocumentPinned(note.id, true), NOT_FOUND);
    expectFail(await searchNotes(f.project.id, "secreto"), NOT_FOUND);
    assert.equal((await fetchDoc(note.id)).status, 404);
    assert.equal((await doc(note.id)).noteContent, "secreto");
  });
});

describe("notas: descarga, papelera y búsqueda", () => {
  test("la ruta del documento sirve el texto (descarga .md) con un ETag que cambia con cada guardado", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    await loginAs(m);
    const note = expectOk(await createNote(f.project.id));
    expectOk(await saveNote(note.id, "Hola ñ", 0));
    const res = await fetchDoc(note.id);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(await res.text(), "Hola ñ");
    const etag = res.headers.get("etag")!;
    assert.equal((await fetchDoc(note.id, "", { "if-none-match": etag })).status, 304);
    const dl = await fetchDoc(note.id, "?download=1");
    // Con el nombre que tomó de su primera línea.
    assert.match(dl.headers.get("content-disposition")!, /^attachment; filename\*=UTF-8''Hola%20%C3%B1\.md$/);
    assert.equal(dl.headers.get("content-length"), String(Buffer.byteLength("Hola ñ")));
    const head = await fileHead(new Request(`http://localhost/api/documents/${note.id}`, { method: "HEAD" }), { params: Promise.resolve({ documentId: note.id }) });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    expectOk(await saveNote(note.id, "Hola ñ y más", 1));
    assert.equal((await fetchDoc(note.id, "", { "if-none-match": etag })).status, 200);
  });

  test("pedido por un <img>: solo se sirve una imagen y nunca cuenta como descarga", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    await loginAs(m);
    const zip = await db.projectDocument.create({ data: { projectId: f.project.id, name: "datos.zip", mimeType: "application/zip", size: 3, kind: "OTHER", createdById: m.id } });
    const png = await db.projectDocument.create({ data: { projectId: f.project.id, name: "foto.webp", mimeType: "image/webp", size: 3, kind: "IMAGE", createdById: m.id } });
    await saveDocumentFile(zip.id, Buffer.from("zip"));
    await saveDocumentFile(png.id, Buffer.from("img"));
    const img = { "sec-fetch-dest": "image" };
    assert.equal((await fetchDoc(zip.id, "", img)).status, 404);
    const ok = await fetchDoc(png.id, "?download=1", img);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-disposition")!, /^inline;/);
    await flushLogs();
    assert.equal(await db.appLog.count({ where: { action: "documents.download", projectId: f.project.id } }), 0);
    // Sin la cabecera, el .zip sigue siendo una descarga registrada.
    assert.equal((await fetchDoc(zip.id)).status, 200);
    await flushLogs();
    assert.equal(await db.appLog.count({ where: { action: "documents.download", projectId: f.project.id } }), 1);
  });

  test("papelera: no se guarda mientras está ahí; se ve, se restaura y se borra para siempre como las demás", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    await loginAs(m);
    const note = expectOk(await createNote(f.project.id));
    expectOk(await saveNote(note.id, "texto", 0));
    expectOk(await deleteDocument(note.id));
    const inTrash = await saveNote(note.id, "texto nuevo", 1);
    expectFail(inTrash, /en la papelera/);
    // Con su código: el editor deja de guardar solo (no reintenta en cada pausa).
    assert.equal(!inTrash.ok && "code" in inTrash ? inTrash.code : null, "note_trashed");
    assert.deepEqual(expectOk(await getNote(note.id)), { content: "texto", version: 1, trashed: true });
    assert.equal((await listTrashedDocumentsOf(f.project.id)).find((d) => d.id === note.id)?.note, true);
    assert.equal((await fetchDoc(note.id)).status, 200); // vista previa desde la papelera
    expectOk(await restoreDocument(note.id));
    assert.equal(expectOk(await saveNote(note.id, "texto nuevo", 1)).status, "saved");
    expectOk(await deleteDocument(note.id));
    expectOk(await deleteDocumentForever(note.id));
    assert.equal(await db.projectDocument.count({ where: { id: note.id } }), 0);
  });

  test("la purga de la papelera borra también las notas (sin fichero que borrar)", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    await loginAs(m);
    const note = expectOk(await createNote(f.project.id));
    expectOk(await deleteDocument(note.id));
    await db.projectDocument.update({ where: { id: note.id }, data: { deletedAt: new Date(Date.now() - 8 * DAY) } });
    assert.ok((await purgeTrashedDocuments()) >= 1);
    assert.equal(await db.projectDocument.count({ where: { id: note.id } }), 0);
  });

  test("buscar en el texto: sin distinguir mayúsculas ni tildes, solo notas vivas del proyecto", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const other = await makeProject({ members: [m] });
    await loginAs(m);
    const a = expectOk(await createNote(f.project.id));
    expectOk(await saveNote(a.id, "Reunión con el CLIENTE sobre la canción", 0));
    const b = expectOk(await createNote(f.project.id));
    expectOk(await saveNote(b.id, "Lista de la compra", 0));
    const trashed = expectOk(await createNote(f.project.id));
    expectOk(await saveNote(trashed.id, "cancion borrada", 0));
    expectOk(await deleteDocument(trashed.id));
    const elsewhere = expectOk(await createNote(other.project.id));
    expectOk(await saveNote(elsewhere.id, "cancion de otro proyecto", 0));
    // Un .md subido no es una nota: su texto no se busca (está en el disco).
    await db.projectDocument.create({ data: { projectId: f.project.id, name: "cancion.md", mimeType: "text/markdown", size: 3, kind: "MARKDOWN", createdById: m.id } });

    assert.deepEqual(expectOk(await searchNotes(f.project.id, "CANCIÓN")), [a.id]);
    assert.deepEqual(expectOk(await searchNotes(f.project.id, "reunion cliente")), []);
    assert.deepEqual(expectOk(await searchNotes(f.project.id, "cliente")), [a.id]);
    assert.deepEqual(expectOk(await searchNotes(f.project.id, "  ")), []);
    // Con una sola letra no se busca en el texto (casi todo coincidiría).
    assert.deepEqual(expectOk(await searchNotes(f.project.id, "c")), []);
    assert.deepEqual(expectOk(await searchNotes(f.project.id, "cl")), [a.id]);
    // «%» y «_» son letras, no comodines.
    assert.deepEqual(expectOk(await searchNotes(f.project.id, "%")), []);
  });

  test("fijar y desfijar: solo documentos vivos; fijarlo dos veces no cambia su sitio", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    await loginAs(m);
    const note = expectOk(await createNote(f.project.id));
    const upload = await db.projectDocument.create({ data: { projectId: f.project.id, name: "guia.pdf", mimeType: "application/pdf", size: 3, kind: "PDF", createdById: m.id } });
    expectOk(await setDocumentPinned(note.id, true));
    const first = (await doc(note.id)).pinnedAt!;
    expectOk(await setDocumentPinned(note.id, true));
    assert.equal((await doc(note.id)).pinnedAt!.getTime(), first.getTime());
    // También un documento subido.
    expectOk(await setDocumentPinned(upload.id, true));
    const listed = await listProjectDocumentsOf(f.project.id);
    assert.deepEqual(listed.filter((d) => d.pinnedAt).map((d) => d.id).sort(), [note.id, upload.id].sort());
    expectOk(await setDocumentPinned(note.id, false));
    assert.equal((await doc(note.id)).pinnedAt, null);
    expectOk(await deleteDocument(upload.id));
    expectFail(await setDocumentPinned(upload.id, false), NOT_FOUND);
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { action: "documents.setDocumentPinned", projectId: f.project.id } });
    assert.ok(logs.length >= 3);
  });
});

/** Nombre que devuelve un guardado (solo si se lo cambió); «conflicto» si no se guardó. */
const nameOf = (res: Awaited<ReturnType<typeof saveNote>>) => {
  const out = expectOk(res);
  return out.status === "saved" ? out.name : "conflicto";
};

describe("notas: título automático (v1.77)", () => {
  test("«Nota sin título» toma su primera línea al guardarse y la sigue mientras nadie la renombre", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    await loginAs(m);
    const note = expectOk(await createNote(f.project.id));
    assert.equal((await doc(note.id)).noteAutoName, true);
    assert.equal(nameOf(await saveNote(note.id, "Ac", 0)), "Ac");
    assert.equal(nameOf(await saveNote(note.id, "## Acta **semanal**\n\nTexto", 1)), "Acta semanal");
    // Si el guardado no cambia la primera línea, no devuelve nombre.
    assert.equal(nameOf(await saveNote(note.id, "## Acta **semanal**\n\nTexto y más", 2)), undefined);
    // Sin texto vuelve al nombre por defecto (y lo sigue tomando después).
    assert.equal(nameOf(await saveNote(note.id, "  \n\n", 3)), "Nota sin título");
    assert.equal(nameOf(await saveNote(note.id, "Otra cosa", 4)), "Otra cosa");
    assert.equal((await listProjectDocumentsOf(f.project.id)).find((d) => d.id === note.id)?.name, "Otra cosa");
    // Renombrada a mano: ya no cambia sola.
    expectOk(await renameDocument(note.id, "Mi nombre"));
    assert.equal((await doc(note.id)).noteAutoName, false);
    assert.equal(nameOf(await saveNote(note.id, "Primera línea distinta", 5)), undefined);
    assert.equal((await doc(note.id)).name, "Mi nombre");
  });

  test("renombrada desde una versión que no conoce la columna (la v1.76) o que no es «Nueva nota»: no cambia sola", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    await loginAs(m);
    const note = expectOk(await createNote(f.project.id));
    expectOk(await saveNote(note.id, "Primera", 0));
    // La v1.76 renombra sin tocar noteAutoName: el nombre ya no es ni el por defecto ni el de su texto.
    await db.projectDocument.update({ where: { id: note.id }, data: { name: "Puesto en la v1.76" } });
    assert.equal(nameOf(await saveNote(note.id, "Segunda", 1)), undefined);
    assert.equal((await doc(note.id)).name, "Puesto en la v1.76");
    // Una nota que no se creó con «Nueva nota» (importada, de la v1.76) se queda con su nombre.
    const other = expectOk(await createNote(f.project.id));
    await db.projectDocument.update({ where: { id: other.id }, data: { noteAutoName: false } });
    assert.equal(nameOf(await saveNote(other.id, "Texto", 0)), undefined);
    assert.equal((await doc(other.id)).name, "Nota sin título");
  });

  test("en inglés: «Untitled note» también toma su primera línea, y sin texto vuelve a «Untitled note»", async () => {
    const m = await makeUser();
    await db.user.update({ where: { id: m.id }, data: { locale: "EN" } });
    const f = await makeProject({ members: [m] });
    await loginAs(m);
    const note = expectOk(await createNote(f.project.id));
    assert.equal(note.name, "Untitled note");
    assert.equal(nameOf(await saveNote(note.id, "Weekly sync", 0)), "Weekly sync");
    assert.equal(nameOf(await saveNote(note.id, "", 1)), "Untitled note");
  });
});
