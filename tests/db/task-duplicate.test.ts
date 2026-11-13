// Duplicar una tarea con sus adjuntos (R48C1): cada copia con su propio fichero (y miniatura), borrado independiente,
// topes y cuotas (la copia se crea y avisa de lo que no cupo), fichero ausente, documentos de Google enlazados y deshacer
// sin ficheros huérfanos. Contra PostgreSQL real y con ficheros de verdad en una carpeta temporal.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { deleteAttachment, deleteTask, duplicateTask, updateTask } from "../../src/actions/tasks";
import { redoLast, undoLast } from "../../src/actions/undo";
import { createAttachmentWithinLimit } from "../../src/lib/attachment-limit";
import { cleanOrphanFiles } from "../../src/lib/orphan-files";
import { invalidateQuotaSettings } from "../../src/lib/quota-settings";
import { discardUndo } from "../../src/lib/undo";
import { attachmentPath, saveAttachmentFiles, saveRawAttachmentFile } from "../../src/lib/uploads";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-dup-"));
const MB = 1024 * 1024;
const exists = (file: string) => stat(file).then(() => true, () => false);

afterEach(() => {
  delete process.env.UPLOAD_QUOTA_MB_PER_PROJECT;
  delete process.env.DISK_MIN_FREE_MB;
  invalidateQuotaSettings();
});

/** Adjunto con fichero real: imagen (WebP + miniatura) o archivo. El contenido lleva `tag` para comprobar la copia. */
async function attach(taskId: string, name: string, size: number, opts: { image?: boolean; tag?: number } = {}) {
  const r = await createAttachmentWithinLimit(
    { taskId, originalName: name, mimeType: opts.image ? "image/webp" : "application/pdf", isImage: !!opts.image, width: opts.image ? 10 : null, height: opts.image ? 8 : null, size },
    { id: true },
  );
  assert.ok(r.ok);
  const id = r.attachment.id;
  const body = Buffer.alloc(size, opts.tag ?? 1);
  if (opts.image) await saveAttachmentFiles(id, { full: body, thumb: Buffer.from(`thumb-${id}`), width: 10, height: 8 });
  else await saveRawAttachmentFile(id, body);
  return id;
}

const filesOf = (a: { id: string; isImage: boolean }) => (a.isImage ? [attachmentPath(a.id, "full"), attachmentPath(a.id, "thumb")] : [attachmentPath(a.id, "file")]);
const attachmentsOf = (taskId: string) => db.taskAttachment.findMany({ where: { taskId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const uploadFiles = async () => (await readdir(process.env.UPLOAD_DIR!)).filter((n) => /\.(webp|bin)$/.test(n)).sort();

async function setup() {
  const user = await makeUser();
  const f = await makeProject({ members: [user] });
  await loginAs(user);
  const task = await makeTask(f, { title: "Con adjuntos" });
  return { user, f, task };
}

describe("duplicar una tarea copia sus adjuntos", () => {
  test("cada copia tiene su propio fichero (y miniatura), mismo nombre, tipo, tamaño y orden; también los enlaces de Google", async () => {
    const { task } = await setup();
    const img = await attach(task.id, "captura.png", 2000, { image: true, tag: 7 });
    const pdf = await attach(task.id, "informe.pdf", 3000, { tag: 9 });
    await db.taskLink.create({ data: { taskId: task.id, kind: "GOOGLE_DOC", title: "Notas", url: "https://docs.google.com/document/d/abc", externalId: "abc", shareStatus: "SHARED" } });

    const copy = expectOk(await duplicateTask(task.id));
    assert.equal(copy.copyNotice, undefined, "sin aviso: se copió todo");
    assert.equal(copy.imageCount, 1);
    assert.equal(copy.fileCount, 1);
    assert.equal(copy.attachBytes, 5000);
    assert.equal(copy.linkCount, 1);

    const original = await attachmentsOf(task.id);
    const copied = await attachmentsOf(copy.id);
    assert.deepEqual(copied.map((a) => [a.originalName, a.mimeType, a.isImage, a.size, a.width, a.height]), original.map((a) => [a.originalName, a.mimeType, a.isImage, a.size, a.width, a.height]));
    for (const [i, a] of copied.entries()) {
      assert.ok(![img, pdf].includes(a.id), "id nuevo");
      for (const [j, file] of filesOf(a).entries()) assert.deepEqual(await readFile(file), await readFile(filesOf(original[i]!)[j]!), "mismo contenido");
    }
    const link = await db.taskLink.findFirstOrThrow({ where: { taskId: copy.id } });
    assert.equal(link.url, "https://docs.google.com/document/d/abc");
    assert.equal(link.externalId, "abc");
  });

  test("borrar el adjunto o la tarea original no toca los ficheros de la copia (ni al revés)", async () => {
    const { user, f, task } = await setup();
    await attach(task.id, "a.png", 1000, { image: true });
    await attach(task.id, "b.pdf", 1000);
    const copy = expectOk(await duplicateTask(task.id));
    const copied = await attachmentsOf(copy.id);
    const original = await attachmentsOf(task.id);

    // Borrar un adjunto de la original y descartar su deshacer (borra su fichero de verdad).
    expectOk(await deleteAttachment(original[0]!.id));
    await discardUndo({ userId: user.id, projectId: f.project.id });
    for (const file of filesOf(original[0]!)) assert.equal(await exists(file), false, "el de la original se borra");
    for (const a of copied) for (const file of filesOf(a)) assert.ok(await exists(file), "los de la copia siguen");

    // Borrar la tarea original entera (y su deshacer): la copia conserva sus dos adjuntos.
    expectOk(await deleteTask(task.id));
    await discardUndo({ userId: user.id, projectId: f.project.id });
    for (const file of filesOf(original[1]!)) assert.equal(await exists(file), false);
    for (const a of copied) for (const file of filesOf(a)) assert.ok(await exists(file));
    assert.equal((await attachmentsOf(copy.id)).length, 2);

    // La limpieza de huérfanos (que mira las filas) no los toma por huérfanos.
    const known = { attachments: new Set((await db.taskAttachment.findMany({ select: { id: true } })).map((a) => a.id)), releaseAttachments: new Set<string>() };
    await cleanOrphanFiles(process.env.UPLOAD_DIR!, known, { minAgeMs: 0 });
    for (const a of copied) for (const file of filesOf(a)) assert.ok(await exists(file));

    // Y al revés: borrar la copia no toca nada de una segunda copia hecha de ella.
    const second = expectOk(await duplicateTask(copy.id));
    expectOk(await deleteTask(copy.id));
    await discardUndo({ userId: user.id, projectId: f.project.id });
    for (const a of copied) for (const file of filesOf(a)) assert.equal(await exists(file), false);
    for (const a of await attachmentsOf(second.id)) for (const file of filesOf(a)) assert.ok(await exists(file));
  });

  test("cuota del proyecto: la copia se crea con los que caben y avisa de los que no (sin dejar ficheros)", async () => {
    const { task } = await setup();
    await db.project.update({ where: { id: task.projectId }, data: { storageQuotaMb: 5 } });
    invalidateQuotaSettings();
    await attach(task.id, "grande.pdf", 2 * MB);
    await attach(task.id, "mediano.pdf", 1.5 * MB);
    await attach(task.id, "pequeño.pdf", 0.25 * MB);
    const before = await uploadFiles();
    // Usado: 3,75 MB de 5. Caben el pequeño (0,25) y no los otros dos (2 + 1,5 superan lo que queda): se copian en orden.
    const copy = expectOk(await duplicateTask(task.id));
    assert.deepEqual((await attachmentsOf(copy.id)).map((a) => a.originalName), ["pequeño.pdf"]);
    assert.match(copy.copyNotice ?? "", /No se han copiado 2 adjuntos: «grande\.pdf», «mediano\.pdf»\./);
    assert.match(copy.copyNotice ?? "", /Cuota de almacenamiento del proyecto superada/);
    assert.equal(copy.attachBytes, 0.25 * MB);
    assert.equal((await uploadFiles()).length, before.length + 1, "solo el fichero del copiado");
  });

  test("tope de adjuntos por tarea: los que no caben se omiten y se avisa con el tope", async () => {
    const { task } = await setup();
    await attach(task.id, "uno.pdf", 2 * MB);
    await attach(task.id, "dos.pdf", 2 * MB);
    // El tope se bajó después de subirlos: en la copia solo cabe uno.
    await db.project.update({ where: { id: task.projectId }, data: { taskAttachMaxMb: 3 } });
    const copy = expectOk(await duplicateTask(task.id));
    assert.deepEqual((await attachmentsOf(copy.id)).map((a) => a.originalName), ["uno.pdf"]);
    assert.match(copy.copyNotice ?? "", /No se ha copiado un adjunto: «dos\.pdf»\. No caben en el máximo de adjuntos por tarea del proyecto \(3 MB\)\./);
  });

  test("disco del servidor lleno: la copia se crea sin adjuntos, con un aviso claro y sin ficheros a medias", async () => {
    const { task } = await setup();
    await attach(task.id, "informe.pdf", 2000);
    await attach(task.id, "foto.png", 1000, { image: true });
    const before = await uploadFiles();
    // Un margen mínimo mayor que cualquier disco: assertDiskRoom lo da por lleno (como una subida o una exportación).
    process.env.DISK_MIN_FREE_MB = String(1024 * 1024 * 1024);
    const copy = expectOk(await duplicateTask(task.id));
    assert.equal((await attachmentsOf(copy.id)).length, 0);
    assert.match(copy.copyNotice ?? "", /No se han copiado 2 adjuntos: «informe\.pdf», «foto\.png»\. El disco del servidor está casi lleno: avisa a un administrador\./);
    assert.doesNotMatch(copy.copyNotice ?? "", /ENOSPC|inténtalo de nuevo/);
    assert.deepEqual(await uploadFiles(), before, "no se ha escrito ningún fichero");
    // Con espacio, la misma tarea se duplica con todo.
    delete process.env.DISK_MIN_FREE_MB;
    const again = expectOk(await duplicateTask(task.id));
    assert.equal((await attachmentsOf(again.id)).length, 2);
    assert.equal(again.copyNotice, undefined);
  });

  test("si falta el fichero de un adjunto, se copian los demás y se avisa", async () => {
    const { task } = await setup();
    const gone = await attach(task.id, "perdido.pdf", 100);
    await attach(task.id, "bueno.png", 100, { image: true });
    await rm(attachmentPath(gone, "file"));
    const copy = expectOk(await duplicateTask(task.id));
    assert.deepEqual((await attachmentsOf(copy.id)).map((a) => a.originalName), ["bueno.png"]);
    assert.match(copy.copyNotice ?? "", /«perdido\.pdf».*ya no estaba disponible/);
  });

  test("deshacer la copia la borra; rehacer la devuelve con sus adjuntos; y al vaciarse el rehacer no quedan ficheros", async () => {
    const { task } = await setup();
    await attach(task.id, "foto.png", 1500, { image: true });
    await attach(task.id, "doc.pdf", 1500);
    const before = await uploadFiles();
    const copy = expectOk(await duplicateTask(task.id));
    const copied = await attachmentsOf(copy.id);
    assert.equal((await uploadFiles()).length, before.length + 3, "imagen (2 ficheros) y archivo");

    expectOk(await undoLast(task.projectId));
    assert.equal(await db.task.count({ where: { id: copy.id } }), 0);
    // Mientras se pueda rehacer, los ficheros se conservan.
    for (const a of copied) for (const file of filesOf(a)) assert.ok(await exists(file));
    expectOk(await redoLast(task.projectId));
    assert.deepEqual((await attachmentsOf(copy.id)).map((a) => a.id), copied.map((a) => a.id));
    for (const a of copied) for (const file of filesOf(a)) assert.ok(await exists(file));

    // Deshacer otra vez y hacer otra cosa (vacía la pila de rehacer): los ficheros de la copia se borran.
    expectOk(await undoLast(task.projectId));
    expectOk(await updateTask(task.id, { title: "Otra cosa" }));
    for (const a of copied) for (const file of filesOf(a)) assert.equal(await exists(file), false);
    assert.deepEqual(await uploadFiles(), before, "ni un fichero de más");
  });

  test("las imágenes de la descripción apuntan a los adjuntos de la copia (borrar la original no las rompe)", async () => {
    const { user, f, task } = await setup();
    const img = await attach(task.id, "captura.png", 2000, { image: true, tag: 3 });
    const other = await makeTask(f, { title: "Otra" });
    const foreign = await attach(other.id, "ajena.png", 1000, { image: true, tag: 4 });
    const description = `Antes ![captura](/api/attachments/${img}) y [miniatura](/api/attachments/${img}?thumb=1)\n\n![ajena](/api/attachments/${foreign})`;
    await db.task.update({ where: { id: task.id }, data: { description } });

    const copy = expectOk(await duplicateTask(task.id));
    const [copied] = await attachmentsOf(copy.id);
    assert.ok(copied && copied.id !== img);
    const saved = (await db.task.findUniqueOrThrow({ where: { id: copy.id }, select: { description: true } })).description;
    assert.equal(saved, `Antes ![captura](/api/attachments/${copied.id}) y [miniatura](/api/attachments/${copied.id}?thumb=1)\n\n![ajena](/api/attachments/${foreign})`);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id }, select: { description: true } })).description, description, "la original no cambia");
    expectOk(await deleteTask(task.id));
    await discardUndo({ userId: user.id, projectId: f.project.id });
    assert.ok(await exists(attachmentPath(copied.id, "full")), "la imagen de la copia sigue");
  });

  test("sin adjuntos ni enlaces: la copia sale igual que antes, sin aviso", async () => {
    const { task } = await setup();
    const copy = expectOk(await duplicateTask(task.id));
    assert.equal(copy.copyNotice, undefined);
    assert.equal(await db.taskAttachment.count({ where: { taskId: copy.id } }), 0);
    assert.equal(await db.taskLink.count({ where: { taskId: copy.id } }), 0);
  });
});
