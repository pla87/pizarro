// «Compartir fuera» contra PostgreSQL real: activar y apagar en el proyecto, convertir la columna, generar y actualizar
// la web, caducidad y los 30 días de «ha caducado», revocar, las acciones desde fuera (con historial, aviso, deshacer y
// topes), adjuntos ajenos (404), proyecto apagado, otra columna, quitar la función o borrar la columna, el informe y
// exportar/importar sin el token. Arreglos de la revisión: la dirección se vuelve a ver (token cifrado, rotar claves), el
// selector de caducidad no resucita, borrar la cuenta de quien la generó, comentarios publicados, recuento de Ajustes y
// deshacer o rehacer sin resucitar un enlace.
import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ADMIN_EXPORT, db, expectApplied, expectFail, expectOk, FORBIDDEN, loginAs, makeProject, makeTask, makeUser, waitForLockWaiter } from "./helpers";
import { deleteColumn, setColumnAssignee, setColumnRole, setColumnShareOut } from "../../src/actions/columns";
import { generateShareWeb, getShareLink, revokeShareLink, setProjectShareOut, setShareExpiry } from "../../src/actions/share-out";
import { archiveTask, deleteAttachment, moveTask } from "../../src/actions/tasks";
import { redoChecked, undoLast } from "../../src/actions/undo";
import { rehashShareTokens, rotateEncryptedSecrets, type RotationDb } from "../../src/lib/key-rotation";
import { flushLogs } from "../../src/lib/log";
import { subscribeProject } from "../../src/lib/realtime";
import { eraseUser } from "../../src/lib/user-delete";
import { externalNotice } from "../../src/lib/notification-text";
import { buildProjectExport } from "../../src/lib/project-export/export";
import { importProjectFile } from "../../src/lib/project-export/import";
import { rateLimit } from "../../src/lib/rate-limit";
import { shareReportStatus } from "../../src/lib/report-build";
import { boardShareOf, SHARE_BOARD_SELECT } from "../../src/lib/share-out-board";
import { countActiveShares, purgeEndedShares, revokeProjectShares } from "../../src/lib/share-out";
import { hashShareToken, MAX_SHARE_PAGE_COMMENTS, revokeUnsharedLinks, SHARE_LIMITS, shareKeyOf } from "../../src/lib/share-out-core";
import { attachmentPath } from "../../src/lib/uploads";
import { streamZip } from "../../src/lib/zip-stream";
import { makeT } from "../../src/i18n/core";
import { GET as pageGet, HEAD as pageHeadRoute } from "../../src/app/x/[token]/route";
import { POST as actionPost } from "../../src/app/x/[token]/t/[taskId]/route";
import { GET as fileGet, HEAD as fileHeadRoute } from "../../src/app/x/[token]/a/[attachmentId]/route";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-share-out-"));
const work = await mkdtemp(path.join(tmpdir(), "pz-share-out-zip-"));
after(() => rm(work, { recursive: true, force: true }));

const DAY = 86_400_000;
let ipSeq = 0;
const ip = () => `198.51.100.${(ipSeq++ % 250) + 1}`;

const page = (token: string, query = "") => pageGet(new Request(`http://localhost:3000/x/${token}${query}`, { headers: { "x-real-ip": ip() } }), { params: Promise.resolve({ token }) });
const post = (token: string, taskId: string, fields: Record<string, string>, headers: Record<string, string> = { "sec-fetch-site": "same-origin", origin: "null" }) =>
  actionPost(new Request(`http://localhost:3000/x/${token}/t/${taskId}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-real-ip": ip(), host: "localhost:3000", ...headers },
    body: new URLSearchParams(fields).toString(),
  }), { params: Promise.resolve({ token, taskId }) });
const file = (token: string, attachmentId: string, query = "") => fileGet(new Request(`http://localhost:3000/x/${token}/a/${attachmentId}${query}`, { headers: { "x-real-ip": ip() } }), { params: Promise.resolve({ token, attachmentId }) });
/** El aviso con el que vuelve un formulario (303 a la página con `?m=`). */
const noticeOf = (res: Response) => {
  assert.equal(res.status, 303);
  return new URL(res.headers.get("location")!, "http://localhost").searchParams.get("m");
};
const tokenOf = (url: string | null) => {
  assert.ok(url, "debería devolver la dirección al crear el enlace");
  return url.split("/x/")[1]!;
};

/** Proyecto con la función activada, «Por hacer» como columna «Compartir fuera» y dos tareas en ella (una de Ana). */
async function setup() {
  const admin = await makeUser({ role: "ADMIN" });
  const me = await makeUser({ name: "Marta Ruiz" });
  const ana = await makeUser({ name: "Ana López" });
  const f = await makeProject({ members: [me, ana] });
  await loginAs(admin);
  expectOk(await setProjectShareOut(f.project.id, true));
  await loginAs(me);
  expectOk(await setColumnShareOut(f.columns.todo));
  const t1 = await makeTask(f, { title: "Revisar planos", position: 1000 });
  const t2 = await makeTask(f, { title: "Pedir material", position: 2000 });
  await db.task.update({ where: { id: t1.id }, data: { assigneeId: ana.id } });
  return { admin, me, ana, f, t1, t2 };
}

async function generate(columnId: string, fresh = false) {
  return expectOk(await generateShareWeb(columnId, { fresh }));
}

describe("compartir fuera: activar y generar", () => {
  test("solo un administrador lo activa; apagado no se ofrece; el enlace se guarda solo como huella", async () => {
    const me = await makeUser();
    const f = await makeProject({ members: [me] });
    await loginAs(me);
    expectFail(await setProjectShareOut(f.project.id, true), FORBIDDEN);
    expectFail(await setColumnShareOut(f.columns.todo), /no está activado/);
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    expectOk(await setProjectShareOut(f.project.id, true));
    await loginAs(me);
    expectOk(await setColumnShareOut(f.columns.todo));
    await makeTask(f, { title: "Una" });
    const res = await generate(f.columns.todo);
    const token = tokenOf(res.url);
    assert.equal(res.published, 1);
    const row = await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.todo } });
    assert.equal(row.tokenHash, hashShareToken(token));
    assert.ok(!JSON.stringify(row).includes(token), "el token no se guarda");
    assert.equal(row.expiryDays, 30);
    assert.equal(res.info.state, "active");
  });

  test("la página: solo las tareas publicadas, con sus datos actuales y las cabeceras de no indexar ni guardar", async () => {
    const { f, t1, t2 } = await setup();
    const other = await makeTask(f, { title: "De otra columna", columnId: f.columns.doing });
    const token = tokenOf((await generate(f.columns.todo)).url);
    const res = await page(token);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok(!res.headers.get("content-security-policy")!.includes("script-src"));
    const html = await res.text();
    assert.ok(html.includes("Revisar planos") && html.includes("Pedir material"));
    assert.ok(!html.includes(other.title), "nada de otras columnas");
    assert.ok(html.includes("Responsable: Ana") && !html.includes("López"), "el responsable por su nombre de pila");
    assert.ok(!/<script/i.test(html));
    // Contenido actual: un cambio en la app se ve sin volver a generar.
    await db.task.update({ where: { id: t2.id }, data: { title: "Pedir material urgente" } });
    assert.ok((await (await page(token)).text()).includes("Pedir material urgente"));
    // Una que sale de la columna sigue hasta actualizar; archivada, nunca.
    await moveTask(t1.id, f.columns.doing, null, null);
    assert.ok((await (await page(token)).text()).includes("Revisar planos"));
    expectOk(await archiveTask(t2.id));
    assert.ok(!(await (await page(token)).text()).includes("Pedir material"));
    // Con el enlace activo, la columna vacía sí se actualiza: es la forma de despublicar lo que ya no está.
    const emptied = await generate(f.columns.todo);
    assert.equal(emptied.published, 0);
    assert.equal(tokenOf(emptied.url), token);
    assert.ok(!(await (await page(token)).text()).includes("Revisar planos"), "ya no sale la que se fue de la columna");
    // Sin enlace activo (o pidiendo uno nuevo), una columna vacía no se genera.
    expectFail(await generateShareWeb(f.columns.todo, { fresh: true }), /No hay tareas en esta columna/);
    await moveTask(t1.id, f.columns.todo, null, null);
    const again = await generate(f.columns.todo);
    assert.equal(tokenOf(again.url), token, "actualizar mantiene el mismo enlace y lo vuelve a enseñar");
    assert.equal(again.published, 1);
    assert.equal((await page(token)).status, 200);
    assert.ok((await (await page(token)).text()).includes("Revisar planos"));
  });

  test("caduca a los N días sin uso; 30 días dice «ha caducado» y después «no encontrado»", async () => {
    const { f } = await setup();
    const token = tokenOf((await generate(f.columns.todo)).url);
    expectOk(await setShareExpiry(f.columns.todo, 7));
    await db.columnShare.updateMany({ where: { columnId: f.columns.todo }, data: { lastUsedAt: new Date(Date.now() - 8 * DAY) } });
    const expired = await page(token);
    assert.equal(expired.status, 410);
    assert.ok((await expired.text()).includes("Esta lista de tareas ha caducado. Contacta con la persona que te ha dado el enlace."));
    await db.columnShare.updateMany({ where: { columnId: f.columns.todo }, data: { lastUsedAt: new Date(Date.now() - 38 * DAY) } });
    assert.equal((await page(token)).status, 404);
    // Generar otra vez crea un enlace nuevo; el viejo no revive.
    const fresh = tokenOf((await generate(f.columns.todo)).url);
    assert.notEqual(fresh, token);
    assert.equal((await page(fresh)).status, 200);
    assert.equal((await page(token)).status, 404);
    // El mantenimiento olvida el enlace anterior pasados los 30 días (ya era «no encontrado»).
    await db.columnShare.updateMany({ where: { columnId: f.columns.todo }, data: { oldEndedAt: new Date(Date.now() - 31 * DAY) } });
    assert.ok((await purgeEndedShares()) >= 1);
    assert.equal((await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.todo } })).oldTokenHash, null);
    // Abrir la página cuenta como uso.
    await db.columnShare.updateMany({ where: { columnId: f.columns.todo }, data: { lastUsedAt: new Date(Date.now() - 2 * DAY) } });
    await page(fresh);
    const row = await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.todo } });
    assert.ok(Date.now() - row.lastUsedAt!.getTime() < 60_000);
    expectFail(await setShareExpiry(f.columns.todo, 12), /Caducidad no válida/);
  });

  test("ronda 69: sin tareas no se genera, la página dice quién la comparte y ya no se escribe generatedByName", async () => {
    const { me, f, t1, t2 } = await setup();
    await db.task.updateMany({ where: { id: { in: [t1.id, t2.id] } }, data: { archivedAt: new Date() } });
    expectFail(await generateShareWeb(f.columns.todo), /No hay tareas en esta columna/);
    await db.task.updateMany({ where: { id: { in: [t1.id, t2.id] } }, data: { archivedAt: null } });
    const token = tokenOf((await generate(f.columns.todo)).url);
    const row = await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.todo } });
    assert.equal(row.generatedById, me.id);
    assert.equal(row.generatedByName, null, "el nombre se lee de la cuenta, no se guarda");
    const html = await (await page(token)).text();
    assert.ok(html.includes("Compartida por Marta desde Pizarro"), "el nombre de pila de quien generó la web");
    await db.user.update({ where: { id: me.id }, data: { name: "Lucía Nueva" } });
    assert.ok((await (await page(token)).text()).includes("Compartida por Lucía desde Pizarro"), "se lee de la cuenta de ahora");
    // Tras un formulario, el aviso sale en la tarjeta de su tarea (el aviso lleva `t`).
    const res = await post(token, t1.id, { op: "done" });
    const loc = new URL(res.headers.get("location")!, "http://localhost");
    assert.equal(loc.searchParams.get("t"), t1.id);
    assert.equal(loc.hash, `#t-${t1.id}`);
    const after = await (await page(token, loc.search)).text();
    assert.ok(after.includes("Tarea marcada como hecha.") || after.includes("Esa tarea ya no"), after.slice(0, 300));
  });

  test("ronda 69: quien revoca queda apuntado, su nombre sale en el tablero y la página dice «ya no está disponible»", async () => {
    const { ana, f, me } = await setup();
    const token = tokenOf((await generate(f.columns.todo)).url);
    await loginAs(ana);
    const info = expectOk(await revokeShareLink(f.columns.todo));
    assert.deepEqual([info.state, info.revoked, info.revokedBy], ["ended", true, "Ana López"]);
    const row = await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.todo } });
    assert.equal(row.revokedById, ana.id);
    const res = await page(token);
    assert.equal(res.status, 410);
    const html = await res.text();
    assert.ok(html.includes("ya no está disponible") && !html.includes("ha caducado"), html);
    // Quien generó el enlace lo ve en el tablero (getShareLink conserva el dato) y uno nuevo lo borra.
    await loginAs(me);
    assert.equal(expectOk(await getShareLink(f.columns.todo)).info.revokedBy, "Ana López");
    expectOk(await generateShareWeb(f.columns.todo));
    assert.equal((await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.todo } })).revokedById, null);
    // Uno caducado por tiempo sigue diciendo «ha caducado».
    const next = tokenOf((await generate(f.columns.todo, true)).url);
    await db.columnShare.updateMany({ where: { columnId: f.columns.todo }, data: { lastUsedAt: new Date(Date.now() - 40 * DAY) } });
    const old = await page(next);
    assert.equal(old.status, 410);
    assert.ok((await old.text()).includes("ha caducado"));
  });

  test("revocar: el enlace deja de funcionar al momento; uno nuevo deja el viejo en «ha caducado»", async () => {
    const { f } = await setup();
    const token = tokenOf((await generate(f.columns.todo)).url);
    expectOk(await revokeShareLink(f.columns.todo));
    assert.equal((await page(token)).status, 410);
    assert.equal(noticeOf(await post(token, "x", { op: "done" })), null, "un formulario de un enlace revocado vuelve a la página");
    const next = tokenOf((await generate(f.columns.todo)).url);
    assert.equal((await page(next)).status, 200);
    // «Crear un enlace nuevo» con uno activo: el anterior termina ya.
    const third = tokenOf((await generate(f.columns.todo, true)).url);
    assert.equal((await page(next)).status, 410);
    assert.equal((await page(third)).status, 200);
  });

  test("apagar la función en el proyecto revoca todos sus enlaces y no deja generar", async () => {
    const { admin, me, f } = await setup();
    const token = tokenOf((await generate(f.columns.todo)).url);
    // Otro enlace que ya caducó por tiempo (sin revocar): se cierra igual, pero no cuenta como «ha dejado de funcionar».
    expectOk(await setColumnShareOut(f.columns.doing));
    await makeTask(f, { title: "En curso", columnId: f.columns.doing });
    await generate(f.columns.doing);
    await db.columnShare.updateMany({ where: { columnId: f.columns.doing }, data: { lastUsedAt: new Date(Date.now() - 40 * DAY) } });
    await loginAs(admin);
    assert.equal(expectOk(await setProjectShareOut(f.project.id, false)).revoked, 1);
    assert.equal(await db.columnShare.count({ where: { projectId: f.project.id, revokedAt: null, tokenHash: { not: null } } }), 0, "todos cerrados");
    assert.equal((await page(token)).status, 410);
    await loginAs(me);
    expectFail(await generateShareWeb(f.columns.todo), /no está activado/);
    // Volver a encenderla no revive el enlace.
    await loginAs(admin);
    expectOk(await setProjectShareOut(f.project.id, true));
    assert.equal((await page(token)).status, 410);
  });

  test("quitar la función o borrar la columna revoca; «Asignación a persona» también la quita", async () => {
    const { me, ana, f } = await setup();
    const token = tokenOf((await generate(f.columns.todo)).url);
    expectOk(await setColumnRole(f.columns.todo, "NONE"));
    assert.equal(await db.columnShare.count({ where: { columnId: f.columns.todo } }), 0);
    assert.equal((await page(token)).status, 410);
    // Otra vez «Compartir fuera» y luego «Asignación a persona».
    expectOk(await setColumnShareOut(f.columns.todo));
    const t2 = tokenOf((await generate(f.columns.todo)).url);
    expectOk(await setColumnAssignee(f.columns.todo, { assigneeId: ana.id, dueDays: null }));
    assert.equal((await page(t2)).status, 410);
    // Borrar una columna «Compartir fuera» (vacía).
    await loginAs(me);
    expectOk(await setColumnShareOut(f.columns.doing));
    const waiting = await makeTask(f, { title: "En curso", columnId: f.columns.doing });
    const t3 = tokenOf((await generate(f.columns.doing)).url);
    await moveTask(waiting.id, f.columns.todo, null, null);
    expectOk(await deleteColumn(f.columns.doing));
    assert.equal((await page(t3)).status, 410);
    // Pasados los 30 días, el mantenimiento borra las filas sin columna.
    const loose = await db.columnShare.count({ where: { projectId: f.project.id, columnId: null } });
    assert.ok(loose >= 3);
    await db.columnShare.updateMany({ where: { projectId: f.project.id, columnId: null }, data: { revokedAt: new Date(Date.now() - 40 * DAY) } });
    await purgeEndedShares();
    assert.equal(await db.columnShare.count({ where: { projectId: f.project.id, columnId: null, oldTokenHash: null } }), 0);
    assert.equal((await page(t3)).status, 404);
  });
});

describe("compartir fuera: lo que se hace desde fuera", () => {
  test("marcar como hecha: arriba de la primera columna terminada, con historial, aviso al responsable y deshacer", async () => {
    const { ana, f, t1 } = await setup();
    const top = await makeTask(f, { title: "Ya hecha", columnId: f.columns.done, position: 500 });
    const token = tokenOf((await generate(f.columns.todo)).url);
    assert.equal(noticeOf(await post(token, t1.id, { op: "done" })), "done");
    const moved = await db.task.findUniqueOrThrow({ where: { id: t1.id }, select: { columnId: true, position: true } });
    assert.equal(moved.columnId, f.columns.done);
    const first = await db.task.findFirstOrThrow({ where: { columnId: f.columns.done }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true } });
    assert.equal(first.id, t1.id, "arriba, antes de las que ya estaban");
    assert.notEqual(first.id, top.id);
    const event = await db.taskEvent.findFirstOrThrow({ where: { taskId: t1.id, code: "done" } });
    assert.equal(event.userId, null);
    assert.equal(event.userName, "Por hacer (fuera)");
    const notice = await db.notification.findFirstOrThrow({ where: { userId: ana.id, taskId: t1.id } });
    assert.equal(notice.actorId, null);
    assert.equal(externalNotice(notice.excerpt)?.what, "done");
    // La página la enseña hecha (sigue en la web aunque haya salido de la columna).
    assert.ok((await (await page(token)).text()).includes(">Hecha<"));
    // Deshacer desde la app, como Ana (la responsable).
    await loginAs(ana);
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: t1.id } })).columnId, f.columns.todo);
    assert.equal(await db.taskEvent.count({ where: { taskId: t1.id, code: "done" } }), 0, "deshacer borra la línea del historial");
  });

  test("sin columna terminada no hay botón ni se puede marcar", async () => {
    const { f, t1 } = await setup();
    await db.column.update({ where: { id: f.columns.done }, data: { isDone: false } });
    const token = tokenOf((await generate(f.columns.todo)).url);
    assert.ok(!(await (await page(token)).text()).includes("Marcar como hecha"));
    assert.equal(noticeOf(await post(token, t1.id, { op: "done" })), "invalid");
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: t1.id } })).columnId, f.columns.todo);
  });

  test("cambiar la fecha y comentar: firmado «<columna> (fuera)», sin menciones de verdad, con tope de largo", async () => {
    const { me, ana, f, t1 } = await setup();
    const token = tokenOf((await generate(f.columns.todo)).url);
    assert.equal(noticeOf(await post(token, t1.id, { op: "due", due: "2026-12-03" })), "due");
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: t1.id } })).dueDate?.toISOString().slice(0, 10), "2026-12-03");
    assert.equal(noticeOf(await post(token, t1.id, { op: "due", due: "3/12/2026" })), "invalid");
    const due = await db.notification.findFirstOrThrow({ where: { userId: ana.id, type: "DUE_CHANGED", taskId: t1.id } });
    assert.equal(externalNotice(due.excerpt)?.author, "Por hacer (fuera)");
    assert.equal(noticeOf(await post(token, t1.id, { op: "comment", body: `Hola @[Marta Ruiz](user:${me.id})` })), "comment");
    const c = await db.taskComment.findFirstOrThrow({ where: { taskId: t1.id } });
    assert.equal(c.authorId, null);
    assert.equal(c.authorName, "Por hacer (fuera)");
    assert.equal(c.body, "Hola @Marta Ruiz", "la mención queda en texto plano");
    assert.equal(await db.notification.count({ where: { userId: me.id, type: "MENTION" } }), 0);
    assert.equal(noticeOf(await post(token, t1.id, { op: "comment", body: "x".repeat(2001) })), "invalid");
    assert.equal(noticeOf(await post(token, t1.id, { op: "comment", body: "   " })), "invalid");
    assert.ok((await (await page(token)).text()).includes("Hola @Marta Ruiz"));
    // Ana (responsable) puede deshacer el comentario.
    await loginAs(ana);
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.taskComment.count({ where: { taskId: t1.id } }), 0);
  });

  test("formularios de otro sitio (403), tope de cambios por enlace y hora, y tareas que no son de este enlace", async () => {
    const { f, t1 } = await setup();
    const token = tokenOf((await generate(f.columns.todo)).url);
    assert.equal((await post(token, t1.id, { op: "done" }, { "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await post(token, t1.id, { op: "done" }, { origin: "https://malo.example.com" })).status, 403);
    // Otra columna «Compartir fuera» con su propio enlace no toca las tareas de esta.
    const other = await makeTask(f, { title: "En curso", columnId: f.columns.doing });
    assert.equal(noticeOf(await post(token, other.id, { op: "comment", body: "hola" })), "gone");
    assert.equal(noticeOf(await post(token, "no$valido", { op: "comment", body: "hola" })), "gone");
    assert.equal(noticeOf(await post(token, t1.id, { op: "borrar" })), "invalid");
    // Tope: se agota el contador del enlace.
    for (let i = 0; i < SHARE_LIMITS.changes.limit; i++) rateLimit(`share-out:change:${shareKeyOf(token)}`, SHARE_LIMITS.changes.limit, SHARE_LIMITS.changes.windowMs);
    assert.equal(noticeOf(await post(token, t1.id, { op: "comment", body: "uno más" })), "rate");
    assert.equal(await db.taskComment.count({ where: { taskId: t1.id } }), 0);
  });

  test("adjuntos: los de una tarea publicada se descargan; los de otra (o archivada) dan 404", async () => {
    const { f, t1 } = await setup();
    const own = await db.taskAttachment.create({ data: { taskId: t1.id, originalName: "presupuesto.pdf", size: 8, isImage: false, mimeType: "application/pdf" } });
    await writeFile(attachmentPath(own.id, "file"), "pdf-data");
    const img = await db.taskAttachment.create({ data: { taskId: t1.id, originalName: "plano.png", size: 8, isImage: true, mimeType: "image/webp" } });
    await writeFile(attachmentPath(img.id, "full"), "img-data");
    await db.task.update({ where: { id: t1.id }, data: { description: `Mira ![plano](/api/attachments/${img.id})` } });
    const outside = await makeTask(f, { title: "Ajena", columnId: f.columns.doing });
    const foreign = await db.taskAttachment.create({ data: { taskId: outside.id, originalName: "secreto.pdf", size: 8, isImage: false, mimeType: "application/pdf" } });
    await writeFile(attachmentPath(foreign.id, "file"), "secreto!");
    const token = tokenOf((await generate(f.columns.todo)).url);
    const html = await (await page(token)).text();
    assert.ok(html.includes(`/x/${token}/a/${img.id}?inline=1`), "la imagen de la descripción, reescrita a la ruta de la página");
    assert.ok(!html.includes("/api/attachments/"));
    const res = await file(token, own.id);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition")!, /^attachment;/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await res.text(), "pdf-data");
    const inline = await file(token, img.id, "?inline=1");
    assert.match(inline.headers.get("content-disposition")!, /^inline;/);
    assert.equal(inline.headers.get("content-type"), "image/webp");
    assert.match((await file(token, own.id, "?inline=1")).headers.get("content-disposition")!, /^attachment;/, "lo que no es imagen, siempre descarga");
    assert.equal((await file(token, foreign.id)).status, 404);
    assert.equal((await file(token, "no$valido")).status, 404);
    // Ronda 69: la imagen adjunta sale con su miniatura (en línea) y el nombre como descarga.
    assert.ok(html.includes(`<li class="img"><a href="/x/${token}/a/${img.id}?inline=1"><img src="/x/${token}/a/${img.id}?inline=1"`), "miniatura");
    // Solo las descargas de verdad quedan en Logs (el PDF dos veces; la miniatura no), firmadas «<columna> (fuera)».
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { projectId: f.project.id, action: "shareOut.download" } });
    const col = await db.column.findUniqueOrThrow({ where: { id: f.columns.todo } });
    assert.deepEqual(logs.map((l) => l.userName), [`${col.name} (fuera)`, `${col.name} (fuera)`]);
    expectOk(await archiveTask(t1.id));
    assert.equal((await file(token, own.id)).status, 404);
  });
});

describe("compartir fuera: informe y exportar", () => {
  test("el informe dice el estado de la columna sin nada del enlace", async () => {
    const { f } = await setup();
    const t = makeT("es");
    const read = () => db.column.findUniqueOrThrow({ where: { id: f.columns.todo }, select: { role: true, assigneeId: true, assignDueDays: true, share: { select: SHARE_BOARD_SELECT } } });
    assert.equal(shareReportStatus(await read(), t, "es-ES", "2026-11-25"), "web sin generar");
    const token = tokenOf((await generate(f.columns.todo)).url);
    const col = await read();
    const status = shareReportStatus(col, t, "es-ES", "2026-11-25")!;
    assert.match(status, /^enlace activo, caduca el /);
    const row = await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.todo } });
    for (const secret of [token, row.tokenHash!, row.tokenHash!.slice(0, 12)]) assert.ok(!status.includes(secret), "el texto del informe no lleva nada del enlace");
    assert.ok(!JSON.stringify(col).includes(token), "lo que lee el informe no trae el token");
    const board = JSON.stringify(boardShareOf(col.share!));
    assert.ok(!board.includes(token) && !board.includes(row.tokenHash!.slice(0, 12)) && !board.includes(row.tokenEnc!), "el tablero no lleva nada del enlace");
    assert.ok(!JSON.stringify(col).includes(row.tokenEnc!), "lo que lee el informe no trae el token cifrado");
    expectOk(await revokeShareLink(f.columns.todo));
    assert.equal(shareReportStatus(await read(), t, "es-ES", "2026-11-25"), "enlace revocado");
    // Uno que caduca por tiempo dice «caducado».
    await generate(f.columns.todo);
    await db.columnShare.updateMany({ where: { columnId: f.columns.todo }, data: { lastUsedAt: new Date(Date.now() - 40 * DAY) } });
    assert.equal(shareReportStatus(await read(), t, "es-ES", "2026-11-25"), "enlace caducado");
  });

  test("exportar lleva la marca y la caducidad, nunca el enlace; importar no la activa", async () => {
    const { admin, f } = await setup();
    const token = tokenOf((await generate(f.columns.todo)).url);
    expectOk(await setShareExpiry(f.columns.todo, 90));
    const row = await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.todo } });
    const exp = await buildProjectExport(f.project.id, { attachments: false, scope: "board" }, ADMIN_EXPORT);
    const parts: Buffer[] = [];
    for await (const c of streamZip(exp.entries)) parts.push(c);
    const zip = Buffer.concat(parts);
    assert.ok(!zip.includes(token) && !zip.includes(row.tokenHash!) && !zip.includes(row.tokenEnc!), "ni el token, ni su huella, ni el cifrado en el ZIP");
    const zipFile = path.join(work, `exp-${Math.random().toString(36).slice(2)}.zip`);
    await writeFile(zipFile, zip);
    const imported = await importProjectFile(zipFile, { id: admin.id, name: admin.name, email: admin.email, role: "ADMIN" }, { isPrivate: false });
    const project = await db.project.findUniqueOrThrow({ where: { id: imported.projectId }, select: { shareOutEnabled: true } });
    assert.equal(project.shareOutEnabled, false, "el proyecto importado nace con la función apagada");
    const col = await db.column.findFirstOrThrow({ where: { projectId: imported.projectId, name: "Por hacer" }, select: { share: true } });
    assert.ok(col.share, "la columna vuelve marcada");
    assert.equal(col.share.tokenHash, null);
    assert.equal(col.share.expiryDays, 90);
  });
});

/** Cambia variables de entorno mientras dura `fn` (las claves de cifrado). */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

describe("compartir fuera: volver a ver la dirección", () => {
  test("«Actualizar web» y el botón del enlace la enseñan a cualquiera del proyecto; cifrada en la base, se borra al revocar", async () => {
    const { ana, f } = await setup();
    const first = await generate(f.columns.todo);
    const token = tokenOf(first.url);
    const row = await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.todo } });
    assert.match(row.tokenEnc!, /^v2\./, "cifrado con ENCRYPTION_KEY");
    assert.ok(!row.tokenEnc!.includes(token));
    const again = await generate(f.columns.todo);
    assert.deepEqual([again.url, again.lost], [first.url, false]);
    // Otra persona del proyecto, que no la generó.
    await loginAs(ana);
    const link = expectOk(await getShareLink(f.columns.todo));
    assert.deepEqual([link.url, link.lost, link.info.state], [first.url, false, "active"]);
    // Quien no ve el proyecto, nada.
    await loginAs(await makeUser());
    expectFail(await getShareLink(f.columns.todo), /No encontrado/);
    await loginAs(ana);
    expectOk(await revokeShareLink(f.columns.todo));
    assert.equal((await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.todo } })).tokenEnc, null, "un enlace terminado no guarda el token");
    const gone = expectOk(await getShareLink(f.columns.todo));
    assert.deepEqual([gone.url, gone.info.state], [null, "ended"]);
  });

  test("con la clave de cifrado cambiada sin rotar, el enlace funciona pero se ofrece uno nuevo; rotar las claves lo recupera", async () => {
    const OLD = "o".repeat(48);
    const NEW = "n".repeat(48);
    const { f } = await setup();
    const url = await withEnv({ ENCRYPTION_KEY: OLD, ENCRYPTION_KEY_PREVIOUS: undefined }, async () => (await generate(f.columns.todo)).url);
    const token = tokenOf(url);
    await withEnv({ ENCRYPTION_KEY: NEW, ENCRYPTION_KEY_PREVIOUS: undefined }, async () => {
      const lost = expectOk(await getShareLink(f.columns.todo));
      assert.deepEqual([lost.url, lost.lost, lost.info.state], [null, true, "active"]);
      assert.equal((await page(token)).status, 200, "el enlace sigue funcionando (se busca por su huella)");
      const kept = await generate(f.columns.todo);
      assert.deepEqual([kept.url, kept.lost], [null, true], "«Actualizar web» tampoco puede enseñarla");
    });
    // Con la anterior configurada, la rotación la vuelve a cifrar con la actual.
    const counts = await withEnv({ ENCRYPTION_KEY: NEW, ENCRYPTION_KEY_PREVIOUS: OLD }, () => rotateEncryptedSecrets(db as unknown as RotationDb));
    assert.ok(counts.find((c) => c.label.startsWith("Compartir fuera"))!.rotated >= 1);
    await withEnv({ ENCRYPTION_KEY: NEW, ENCRYPTION_KEY_PREVIOUS: undefined }, async () => {
      const back = expectOk(await getShareLink(f.columns.todo));
      assert.deepEqual([back.url, back.lost], [url, false]);
      // «Crear un enlace nuevo»: otro token, cifrado con la actual; el anterior, «ha caducado».
      const fresh = await generate(f.columns.todo, true);
      assert.notEqual(fresh.url, url);
      assert.equal((await page(token)).status, 410);
      assert.equal(expectOk(await getShareLink(f.columns.todo)).url, fresh.url);
    });
  });
});

describe("compartir fuera: arreglos de la revisión", () => {
  test("caducidad: elegir más días no resucita un enlace caducado; con uno activo, cambiarla cuenta como uso", async () => {
    const { f } = await setup();
    const token = tokenOf((await generate(f.columns.todo)).url);
    expectOk(await setShareExpiry(f.columns.todo, 7));
    // Sin usar en 10 días: con 7, caducado.
    await db.columnShare.updateMany({ where: { columnId: f.columns.todo }, data: { lastUsedAt: new Date(Date.now() - 10 * DAY) } });
    assert.equal((await page(token)).status, 410);
    const info = expectOk(await setShareExpiry(f.columns.todo, 30));
    assert.equal(info.state, "ended", "pasar a «1 mes» no lo revive");
    assert.equal((await page(token)).status, 410);
    assert.equal(expectOk(await setShareExpiry(f.columns.todo, 90)).state, "ended");
    const frozen = await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.todo } });
    assert.ok(frozen.revokedAt && Math.abs(frozen.revokedAt.getTime() - (Date.now() - 3 * DAY)) < 60_000, "se congela cuando terminó");
    assert.equal(frozen.tokenEnc, null);
    // Uno activo sin usar en 10 días (con 30): pasar por «7 días» no lo caduca, porque cuenta como uso.
    const next = tokenOf((await generate(f.columns.todo)).url);
    expectOk(await setShareExpiry(f.columns.todo, 30));
    await db.columnShare.updateMany({ where: { columnId: f.columns.todo }, data: { lastUsedAt: new Date(Date.now() - 10 * DAY) } });
    assert.equal(expectOk(await setShareExpiry(f.columns.todo, 7)).state, "active");
    assert.equal((await page(next)).status, 200);
  });

  test("borrar la cuenta de quien generó la web: ni su id ni su nombre; marcar hecha una tarea fija desde fuera no da 500", async () => {
    const { me, f } = await setup();
    const fixed = await makeTask(f, { title: "Revisión semanal", recurrence: "WEEKLY", dueDate: new Date("2026-12-07T00:00:00Z"), position: 3000 });
    const token = tokenOf((await generate(f.columns.todo)).url);
    const res = await eraseUser(me.id, { self: true });
    assert.ok(res);
    const row = await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.todo } });
    assert.equal(row.generatedById, null);
    assert.equal(row.generatedByName, null, "como en el historial, no queda su nombre");
    assert.equal(noticeOf(await post(token, fixed.id, { op: "done" })), "done");
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: fixed.id } })).columnId, f.columns.done);
    const spawned = await db.task.findFirst({ where: { recurrenceFromId: fixed.id } });
    assert.ok(spawned, "la siguiente aparición nace igual");
    assert.equal(spawned.createdById, null);
  });

  test("quien generó la web y ya no ve el proyecto no recibe el deshacer ni el aviso", async () => {
    const { me, f, t2 } = await setup();
    const token = tokenOf((await generate(f.columns.todo)).url);
    await db.user.update({ where: { id: me.id }, data: { active: false } });
    assert.equal(noticeOf(await post(token, t2.id, { op: "comment", body: "Hecho por fuera" })), "comment");
    assert.equal(await db.notification.count({ where: { userId: me.id, taskId: t2.id } }), 0);
    assert.equal(await db.undoEntry.count({ where: { userId: me.id, projectId: f.project.id, kind: "UNDO", taskId: t2.id } }), 0);
  });

  test("la página publica los últimos comentarios de cada tarea y dice cuántos anteriores no salen", async () => {
    const { f, t1 } = await setup();
    const n = MAX_SHARE_PAGE_COMMENTS + 5;
    await db.taskComment.createMany({ data: Array.from({ length: n }, (_, i) => ({ taskId: t1.id, authorName: "Alguien", body: `Comentario número ${i + 1}.`, createdAt: new Date(Date.now() - (n - i) * 60_000) })) });
    const html = await (await page(tokenOf((await generate(f.columns.todo)).url))).text();
    assert.ok(html.includes(`Comentario número ${n}.`) && html.includes("Comentario número 6.") && !html.includes("Comentario número 5."));
    assert.ok(html.includes("Hay 5 comentarios anteriores que no se muestran."));
  });

  test("Ajustes: cuenta solo los enlaces que funcionan (sin los caducados por tiempo)", async () => {
    const { f } = await setup();
    assert.equal(await countActiveShares(f.project.id), 0);
    await generate(f.columns.todo);
    expectOk(await setColumnShareOut(f.columns.doing));
    await makeTask(f, { title: "En curso", columnId: f.columns.doing });
    await generate(f.columns.doing);
    assert.equal(await countActiveShares(f.project.id), 2);
    await db.columnShare.updateMany({ where: { columnId: f.columns.doing }, data: { lastUsedAt: new Date(Date.now() - 40 * DAY) } });
    assert.equal(await countActiveShares(f.project.id), 1, "el caducado por tiempo no cuenta");
  });

  test("deshacer y rehacer el cambio de rol no resucitan un enlace: solo «Generar web» crea otro", async () => {
    const { f } = await setup();
    expectOk(await setColumnRole(f.columns.doing, "WAITING"));
    expectOk(await setColumnShareOut(f.columns.doing));
    await makeTask(f, { title: "En espera", columnId: f.columns.doing });
    const token = tokenOf((await generate(f.columns.doing)).url);
    assert.equal((await page(token)).status, 200);
    // Deshacer: vuelve a «Esperando» y el enlace se revoca (antes seguía vivo en la fila).
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.doing } })).role, "WAITING");
    const revoked = await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.doing } });
    assert.ok(revoked.revokedAt);
    assert.equal(revoked.tokenEnc, null);
    // Rehacer: otra vez «Compartir fuera», con el enlace terminado (sale «Generar web»).
    expectApplied(await redoChecked(f.project.id));
    assert.equal((await db.column.findUniqueOrThrow({ where: { id: f.columns.doing } })).role, "NONE");
    assert.equal((await page(token)).status, 410, "el enlace viejo no vuelve");
    const col = await db.column.findUniqueOrThrow({ where: { id: f.columns.doing }, select: { share: { select: SHARE_BOARD_SELECT } } });
    assert.equal(boardShareOf(col.share!).state, "ended");
    const fresh = tokenOf((await generate(f.columns.doing)).url);
    assert.notEqual(fresh, token);
    assert.equal((await page(fresh)).status, 200);
  });

  test("una plantilla (o cualquier cambio sin endColumnShare) que da otro rol a la columna revoca su enlace", async () => {
    const { f } = await setup();
    const token = tokenOf((await generate(f.columns.todo)).url);
    await db.column.update({ where: { id: f.columns.todo }, data: { role: "WAITING" } });
    assert.equal(await revokeUnsharedLinks(db, f.project.id), 1);
    await db.column.update({ where: { id: f.columns.todo }, data: { role: "NONE" } });
    assert.equal((await page(token)).status, 410);
    assert.equal(await revokeUnsharedLinks(db, f.project.id), 0, "sin nada más que revocar");
  });
});

describe("compartir fuera: segunda vuelta de la revisión", () => {
  const pageHead = (token: string) => pageHeadRoute(new Request(`http://localhost:3000/x/${token}`, { method: "HEAD", headers: { "x-real-ip": ip() } }), { params: Promise.resolve({ token }) });
  const fileHead = (token: string, attachmentId: string) =>
    fileHeadRoute(new Request(`http://localhost:3000/x/${token}/a/${attachmentId}`, { method: "HEAD", headers: { "x-real-ip": ip() } }), { params: Promise.resolve({ token, attachmentId }) });

  test("HEAD de la página y de un adjunto: mismas cabeceras sin cuerpo, sin contar como uso ni descarga y sin registrar", async () => {
    const { f, t1 } = await setup();
    const att = await db.taskAttachment.create({ data: { taskId: t1.id, originalName: "presupuesto.pdf", size: 8, isImage: false, mimeType: "application/pdf" } });
    await writeFile(attachmentPath(att.id, "file"), "pdf-data");
    const token = tokenOf((await generate(f.columns.todo)).url);
    const old = new Date(Date.now() - 2 * 60 * 60_000);
    await db.columnShare.updateMany({ where: { columnId: f.columns.todo }, data: { lastUsedAt: old } });
    const head = await pageHead(token);
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("cache-control"), "no-store");
    assert.ok(head.headers.get("content-security-policy"));
    assert.equal(await head.text(), "");
    assert.equal((await pageHead("x".repeat(43))).status, 404);
    // Se agota el cupo de descargas del enlace: HEAD no lo necesita (ni lo gasta); GET, sí.
    for (let i = 0; i < SHARE_LIMITS.downloads.limit; i++) rateLimit(`share-out:dl:${shareKeyOf(token)}`, SHARE_LIMITS.downloads.limit, SHARE_LIMITS.downloads.windowMs);
    const fh = await fileHead(token, att.id);
    assert.equal(fh.status, 200);
    assert.equal(fh.headers.get("content-length"), "8");
    assert.match(fh.headers.get("content-disposition")!, /^attachment;/);
    assert.equal(await fh.text(), "");
    assert.equal((await fileHead(token, "noexiste1")).status, 404);
    assert.equal((await file(token, att.id)).status, 429);
    await flushLogs();
    assert.equal((await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.todo } })).lastUsedAt?.getTime(), old.getTime(), "no cuenta como uso");
    assert.equal(await db.appLog.count({ where: { projectId: f.project.id, action: { in: ["shareOut.open", "shareOut.download"] } } }), 0);
  });

  test("formulario multipart mal formado: vuelve con «no se ha podido» (sin 500 ni error en Logs)", async () => {
    const { f, t1 } = await setup();
    const token = tokenOf((await generate(f.columns.todo)).url);
    const res = await actionPost(new Request(`http://localhost:3000/x/${token}/t/${t1.id}`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "x-real-ip": ip(), host: "localhost:3000", "sec-fetch-site": "same-origin" },
      body: "esto no es un formulario",
    }), { params: Promise.resolve({ token, taskId: t1.id }) });
    assert.equal(noticeOf(res), "invalid");
    await flushLogs();
    assert.equal(await db.appLog.count({ where: { projectId: f.project.id, level: "error" } }), 0);
  });

  test("lo de fuera no vacía la pila de deshacer del responsable: como mucho una entrada de fuera, que sustituye a la anterior", async () => {
    const { ana, f, t1, t2 } = await setup();
    const token = tokenOf((await generate(f.columns.todo)).url);
    await loginAs(ana);
    // Su primera entrada guarda un adjunto borrado (el fichero se conserva mientras se pueda deshacer).
    const att = await db.taskAttachment.create({ data: { taskId: t2.id, originalName: "plano.pdf", size: 8, isImage: false, mimeType: "application/pdf" } });
    await writeFile(attachmentPath(att.id, "file"), "pdf-data");
    expectOk(await deleteAttachment(att.id));
    for (let i = 0; i < 9; i++) expectOk(await moveTask(t2.id, i % 2 ? f.columns.todo : f.columns.doing, null, null));
    const mine = { userId: ana.id, projectId: f.project.id, kind: "UNDO" as const };
    assert.equal(await db.undoEntry.count({ where: mine }), 10);
    for (let i = 0; i < 5; i++) assert.equal(noticeOf(await post(token, t1.id, { op: "comment", body: `Desde fuera ${i}` })), "comment");
    assert.equal(noticeOf(await post(token, t1.id, { op: "due", due: "2026-12-03" })), "due");
    const entries = await db.undoEntry.findMany({ where: mine, orderBy: { createdAt: "desc" }, select: { label: true, ops: true } });
    assert.equal(entries.length, 11, "sus 10 y una de fuera");
    assert.equal(entries.filter((e) => e.label.startsWith('{"k":"{who}:')).length, 1);
    assert.ok(entries[0]!.label.includes("cambió la fecha"), "la de fuera es la última");
    assert.ok(entries.some((e) => JSON.stringify(e.ops).includes(att.id)), "la del adjunto sigue");
    await access(attachmentPath(att.id, "file"));
    // Deshacer: primero lo último de fuera (la fecha); los comentarios anteriores ya no están en la pila y se quedan.
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: t1.id } })).dueDate, null);
    assert.equal(await db.taskComment.count({ where: { taskId: t1.id } }), 5);
    assert.equal(await db.undoEntry.count({ where: mine }), 10, "quedan las suyas");
  });

  test("«Generar web» mientras se apaga la función: espera al apagado y no deja un enlace que reviva al encenderla", async () => {
    const { admin, me, f } = await setup();
    const token = tokenOf((await generate(f.columns.todo)).url);
    expectOk(await revokeShareLink(f.columns.todo));
    // El apagado (la misma transacción que setProjectShareOut) se queda a medias con la fila del proyecto escrita.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const off = db.$transaction(async (tx) => {
      await tx.project.update({ where: { id: f.project.id }, data: { shareOutEnabled: false } });
      locked();
      await held;
      await revokeProjectShares(f.project.id, new Date(), tx);
    }, { timeout: 20_000 });
    await isLocked;
    await loginAs(me);
    const racing = generateShareWeb(f.columns.todo, {});
    await waitForLockWaiter();
    release();
    await off;
    expectFail(await racing, /no está activado/);
    await loginAs(admin);
    expectOk(await setProjectShareOut(f.project.id, true));
    const row = await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.todo } });
    assert.ok(row.revokedAt, "sin enlace vivo");
    assert.equal(row.tokenHash, hashShareToken(token));
    assert.equal((await page(token)).status, 410);
  });

  test("abrir el botón del enlace no avisa a los tableros abiertos (no los recarga)", async () => {
    const { f } = await setup();
    await generate(f.columns.todo);
    const seen: string[] = [];
    const unsub = subscribeProject(f.project.id, (ch) => seen.push(ch.action));
    try {
      assert.ok(expectOk(await getShareLink(f.columns.todo)).url);
    } finally {
      unsub();
    }
    assert.deepEqual(seen, []);
  });

  test("comentario de fuera: el extracto del aviso no trae caracteres de control", async () => {
    const { ana, f, t1 } = await setup();
    const token = tokenOf((await generate(f.columns.todo)).url);
    assert.equal(noticeOf(await post(token, t1.id, { op: "comment", body: "hola\u001Edone\u001Eadiós" })), "comment");
    const n = await db.notification.findFirstOrThrow({ where: { userId: ana.id, taskId: t1.id, type: "COMMENT" } });
    assert.deepEqual(externalNotice(n.excerpt), { author: "Por hacer (fuera)", what: "comment", text: "holadoneadiós" });
  });

  // Al final del fichero: cambiar TOKEN_SECRET rehace las huellas de todas las filas de esta base.
  test("sin pasar rotate-keys, el botón del enlace rehace la huella antes de dar la dirección (no entrega una muerta)", async () => {
    const A = "a".repeat(48);
    const B = "b".repeat(48);
    const { f } = await setup();
    const url = await withEnv({ TOKEN_SECRET: A, TOKEN_SECRET_PREVIOUS: undefined }, async () => (await generate(f.columns.todo)).url);
    const token = tokenOf(url);
    await withEnv({ TOKEN_SECRET: B, TOKEN_SECRET_PREVIOUS: undefined }, async () => {
      assert.equal((await page(token)).status, 404, "con otra clave y sin la anterior, la huella guardada no casa");
      const link = expectOk(await getShareLink(f.columns.todo));
      assert.deepEqual([link.url, link.lost], [url, false]);
      assert.equal((await page(token)).status, 200, "la dirección que entrega funciona");
    });
  });

  test("cambiar TOKEN_SECRET: rotate-keys rehace la huella desde el token cifrado y el enlace sigue funcionando", async () => {
    const A = "c".repeat(48);
    const B = "d".repeat(48);
    const { f } = await setup();
    const token = await withEnv({ TOKEN_SECRET: A, TOKEN_SECRET_PREVIOUS: undefined }, async () => tokenOf((await generate(f.columns.todo)).url));
    const rowHash = async () => (await db.columnShare.findUniqueOrThrow({ where: { columnId: f.columns.todo } })).tokenHash;
    await withEnv({ TOKEN_SECRET: B, TOKEN_SECRET_PREVIOUS: A }, async () => {
      const before = await rowHash();
      const dry = await rehashShareTokens(db as unknown as RotationDb, { dryRun: true });
      assert.ok(dry.rotated >= 1);
      assert.equal(await rowHash(), before, "en seco no se toca");
      const done = await rehashShareTokens(db as unknown as RotationDb);
      assert.ok(done.rotated >= 1);
      assert.equal(await rowHash(), hashShareToken(token));
      assert.equal((await rehashShareTokens(db as unknown as RotationDb)).rotated, 0, "repetirlo no cambia nada");
    });
    // Ya sin la anterior: la dirección sigue funcionando.
    await withEnv({ TOKEN_SECRET: B, TOKEN_SECRET_PREVIOUS: undefined }, async () => {
      assert.equal((await page(token)).status, 200);
    });
  });
});
