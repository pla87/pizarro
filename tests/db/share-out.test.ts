// «Compartir fuera» contra PostgreSQL real: activar y apagar en el proyecto, convertir la columna, generar y actualizar
// la web, caducidad y los 30 días de «ha caducado», revocar, las acciones desde fuera (con historial, aviso, deshacer y
// topes), adjuntos ajenos (404), proyecto apagado, otra columna, quitar la función o borrar la columna, el informe y
// exportar/importar sin el token.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ADMIN_EXPORT, db, expectFail, expectOk, FORBIDDEN, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { deleteColumn, setColumnAssignee, setColumnRole, setColumnShareOut } from "../../src/actions/columns";
import { generateShareWeb, revokeShareLink, setProjectShareOut, setShareExpiry } from "../../src/actions/share-out";
import { archiveTask, moveTask } from "../../src/actions/tasks";
import { undoLast } from "../../src/actions/undo";
import { externalNotice } from "../../src/lib/notification-text";
import { buildProjectExport } from "../../src/lib/project-export/export";
import { importProjectFile } from "../../src/lib/project-export/import";
import { rateLimit } from "../../src/lib/rate-limit";
import { shareReportStatus } from "../../src/lib/report-build";
import { boardShareOf, SHARE_BOARD_SELECT } from "../../src/lib/share-out-board";
import { purgeEndedShares } from "../../src/lib/share-out";
import { hashShareToken, SHARE_LIMITS, shareKeyOf } from "../../src/lib/share-out-core";
import { attachmentPath } from "../../src/lib/uploads";
import { streamZip } from "../../src/lib/zip-stream";
import { makeT } from "../../src/i18n/core";
import { GET as pageGet } from "../../src/app/x/[token]/route";
import { POST as actionPost } from "../../src/app/x/[token]/t/[taskId]/route";
import { GET as fileGet } from "../../src/app/x/[token]/a/[attachmentId]/route";

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
    const again = await generate(f.columns.todo);
    assert.equal(again.url, null, "actualizar mantiene el mismo enlace (no se puede volver a enseñar)");
    assert.equal(again.published, 0);
    assert.equal((await page(token)).status, 200);
    assert.ok(!(await (await page(token)).text()).includes("Revisar planos"));
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
    await loginAs(admin);
    assert.equal(expectOk(await setProjectShareOut(f.project.id, false)).revoked, 1);
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
    const t3 = tokenOf((await generate(f.columns.doing)).url);
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
    assert.ok(!board.includes(token) && !board.includes(row.tokenHash!), "el tablero solo lleva una huella corta");
    expectOk(await revokeShareLink(f.columns.todo));
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
    assert.ok(!zip.includes(token) && !zip.includes(row.tokenHash!), "ni el token ni su huella en el ZIP");
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
