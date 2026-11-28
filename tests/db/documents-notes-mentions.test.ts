// Menciones en notas de Documentación (v1.77) contra PostgreSQL real: aviso en la campana solo por las menciones nuevas
// de cada guardado (sin repetir en guardados seguidos, ni a uno mismo, ni a quien no ve el proyecto), el email según la
// opción de Mi perfil (al momento, en el resumen diario o no), la baja desde el email y borrar la nota.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { afterDone, asUser, db, expectOk, loginAs, makeProject, makeUser } from "./helpers";
import { createNote, deleteDocument, deleteDocumentForever, saveNote } from "../../src/actions/documents";
import { updateEmailPrefs } from "../../src/actions/collab-prefs";
import { mentionToken } from "../../src/lib/mentions";
import { unreadCount, visibleNotificationsWhere } from "../../src/lib/notification-access";
import { gatherDigest } from "../../src/lib/periodic-mail";
import { buildDigest, digestEmail } from "../../src/lib/digest";
import { applyUnsubscribe, resolveUnsubscribe } from "../../src/lib/unsubscribe";
import { unsubscribeToken } from "../../src/lib/unsubscribe-core";
import { makeT } from "../../src/i18n/core";
import type { CurrentUser } from "../../src/lib/session";

const at = (u: { id: string; name: string }) => mentionToken(u.name, u.id);
const noticesOf = (documentId: string) => db.notification.findMany({ where: { documentId }, orderBy: { createdAt: "asc" }, select: { userId: true, actorId: true, type: true, taskId: true, projectId: true, excerpt: true } });

/** Guarda `text` en la nota como `user`, sobre la versión que tenga ahora (como el editor tras cada guardado). */
async function save(user: { id: string }, noteId: string, text: string) {
  const { noteVersion } = await db.projectDocument.findUniqueOrThrow({ where: { id: noteId }, select: { noteVersion: true } });
  const res = await asUser(user, async () => expectOk(await saveNote(noteId, text, noteVersion)));
  assert.equal(res.status, "saved");
  await afterDone();
  return res;
}

/** Emails escritos en la bandeja de pruebas (MAIL_OUTBOX_DIR) durante `fn`. */
async function withOutbox(fn: () => Promise<void>): Promise<{ to: string; subject: string; text: string; html: string }[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "pz-outbox-notes-"));
  const prev = process.env.MAIL_OUTBOX_DIR;
  process.env.MAIL_OUTBOX_DIR = dir;
  try {
    await fn();
    await afterDone();
  } finally {
    if (prev === undefined) delete process.env.MAIL_OUTBOX_DIR;
    else process.env.MAIL_OUTBOX_DIR = prev;
  }
  const files = (await readdir(dir)).filter((n) => n.endsWith(".json"));
  const mails = await Promise.all(files.map(async (n) => JSON.parse(await readFile(path.join(dir, n), "utf8"))));
  await rm(dir, { recursive: true, force: true });
  return mails.map((m) => ({ to: String(m.to), subject: String(m.subject), text: String(m.text), html: String(m.html) }));
}

describe("notas: avisos de mención", () => {
  test("solo las menciones nuevas de cada guardado, sin repetir, ni a uno mismo ni a quien no ve el proyecto", async () => {
    const ana = await makeUser({ name: "Ana Notas" });
    const bea = await makeUser({ name: "Bea Notas" });
    const carlos = await makeUser({ name: "Carlos Notas" });
    const outsider = await makeUser({ name: "Fuera Notas", role: "ADMIN" });
    const inactive = await makeUser({ name: "Baja Notas", active: false });
    const f = await makeProject({ visibility: "PRIVATE", owner: ana, members: [bea, carlos, inactive] });
    const note = await asUser(ana, async () => expectOk(await createNote(f.project.id)));

    await save(ana, note.id, `# Acta\n\nPrimer punto.\n\nRevisa esto ${at(bea)} y ${at(ana)} y ${at(outsider)} y ${at(inactive)}`);
    const first = await noticesOf(note.id);
    assert.deepEqual(first.map((n) => n.userId), [bea.id]);
    // MENTION con la nota, sin tarea ni proyecto (la v1.76 no los ve); el extracto es el párrafo de la mención.
    assert.deepEqual([first[0]!.type, first[0]!.actorId, first[0]!.taskId, first[0]!.projectId], ["MENTION", ana.id, null, null]);
    assert.equal(first[0]!.excerpt, "Revisa esto @Bea Notas y @Ana Notas y @Fuera Notas y @Baja Notas");

    // El guardado automático sigue con más texto: la mención de Bea ya estaba, nada nuevo.
    await save(ana, note.id, `# Acta\n\nPrimer punto y más.\n\nRevisa esto ${at(bea)} y ${at(ana)}`);
    assert.equal((await noticesOf(note.id)).length, 1);
    // Carlos, nuevo: solo él.
    await save(ana, note.id, `# Acta\n\nRevisa esto ${at(bea)} y ${at(carlos)}`);
    assert.deepEqual((await noticesOf(note.id)).map((n) => n.userId), [bea.id, carlos.id]);
    // Quitar a Carlos y volver a ponerlo enseguida (escribiendo): no recibe un segundo aviso en 10 minutos.
    await save(ana, note.id, `# Acta\n\nRevisa esto ${at(bea)}`);
    await save(ana, note.id, `# Acta\n\nRevisa esto ${at(bea)} y ${at(carlos)} otra vez`);
    assert.equal((await noticesOf(note.id)).length, 2);
    // Pasados los 10 minutos, sí.
    await db.notification.updateMany({ where: { documentId: note.id }, data: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    await save(ana, note.id, `# Acta\n\nRevisa esto ${at(bea)}`);
    await save(ana, note.id, `# Acta\n\nRevisa esto ${at(bea)} y ${at(carlos)}`);
    assert.deepEqual((await noticesOf(note.id)).map((n) => n.userId).sort(), [bea.id, carlos.id, carlos.id].sort());
    // Otra persona que escribe en la nota también avisa (a Ana), y no a sí misma.
    await save(bea, note.id, `# Acta\n\nRevisa esto ${at(bea)} y ${at(carlos)}\n\nHecho, ${at(ana)}`);
    const last = (await noticesOf(note.id)).at(-1)!;
    assert.deepEqual([last.userId, last.actorId, last.excerpt], [ana.id, bea.id, "Hecho, @Ana Notas"]);

    // En la campana de Bea (contador y lista), con su nota; Fuera, aunque sea admin, no tiene ninguno.
    assert.equal(await unreadCount(bea.id, "MEMBER"), 1);
    const visible = await db.notification.findMany({ where: visibleNotificationsWhere({ id: bea.id, role: "MEMBER" } as CurrentUser), select: { document: { select: { id: true, name: true } } } });
    assert.deepEqual(visible.map((v) => v.document), [{ id: note.id, name: "Acta" }]);
    assert.equal(await db.notification.count({ where: { userId: { in: [outsider.id, inactive.id] } } }), 0);
    // La campana de la v1.76 (si se vuelve atrás) solo lee los de una tarea o un proyecto visibles: este no le sale.
    const projects = { members: { some: { userId: bea.id } } };
    assert.equal(await db.notification.count({ where: { userId: bea.id, OR: [{ task: { project: projects } }, { taskId: null, project: projects }] } }), 0);
    // Si la sacan del proyecto, el aviso deja de verse.
    await db.projectMember.deleteMany({ where: { projectId: f.project.id, userId: bea.id } });
    assert.equal(await unreadCount(bea.id, "MEMBER"), 0);
  });

  test("email: «Al momento» lo envía, «Resumen diario» lo deja para el resumen y con las menciones o la casilla principal apagadas, nada", async () => {
    const author = await makeUser({ name: "Autora Email" });
    const now_ = await makeUser({ name: "Inmediata Email" });
    const digest = await makeUser({ name: "Resumen Email" });
    const off = await makeUser({ name: "Nada Email" });
    const master = await makeUser({ name: "Principal Email" });
    const f = await makeProject({ members: [author, now_, digest, off, master] });
    // Lo elige cada una en Mi perfil → Avisos (Menciones en tareas y notas + frecuencia).
    const prefs = { emailNotices: true, notifyEmail: true, notifyAssignedEmail: false, notifyDueEmail: false, notifyCommentEmail: false, digestHour: 8 };
    await asUser(now_, async () => expectOk(await updateEmailPrefs({ ...prefs, dailyDigest: false })));
    await asUser(digest, async () => expectOk(await updateEmailPrefs({ ...prefs, dailyDigest: true })));
    await asUser(off, async () => expectOk(await updateEmailPrefs({ ...prefs, notifyEmail: false, dailyDigest: false })));
    await asUser(master, async () => expectOk(await updateEmailPrefs({ ...prefs, emailNotices: false, dailyDigest: false })));

    const note = await asUser(author, async () => expectOk(await createNote(f.project.id)));
    const mails = await withOutbox(async () => {
      await save(author, note.id, `Reunión del lunes\n\nAvisad: ${at(now_)} ${at(digest)} ${at(off)} ${at(master)}`);
    });
    // En la campana, las cuatro.
    assert.equal((await noticesOf(note.id)).length, 4);
    // Por email al momento, solo la de «Al momento» con las menciones marcadas: «te ha mencionado en la nota», con enlace a la nota y la baja de las menciones.
    assert.equal(mails.length, 1);
    assert.equal(mails[0]!.subject, "Autora Email te ha mencionado en la nota «Reunión del lunes»");
    assert.ok(mails[0]!.text.includes(`/p/${f.project.id}/docs?doc=${note.id}`), mails[0]!.text);
    assert.ok(mails[0]!.text.includes("Abrir la nota"));
    assert.ok(mails[0]!.text.includes("Autora Email ha escrito:"));
    assert.ok(mails[0]!.text.includes(`/unsubscribe/${unsubscribeToken("mention", now_.id, (await db.user.findUniqueOrThrow({ where: { id: now_.id } })).email)}`));
    const sent = await db.notification.findMany({ where: { documentId: note.id, emailSentAt: { not: null } }, select: { userId: true } });
    assert.deepEqual(sent.map((s) => s.userId), [now_.id]);

    // El resumen diario trae las menciones en notas de quien las tiene marcadas (con cualquier frecuencia; solo se envía a quien lo eligió).
    const nowDate = new Date();
    const today = nowDate.toISOString().slice(0, 10);
    const digestOf = async (u: { id: string }) => {
      const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { id: true, role: true, notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true } });
      return gatherDigest(row, nowDate, today);
    };
    assert.deepEqual((await digestOf(digest)).notes?.map((i) => [i.docId, i.title, i.projectId]), [[note.id, "Reunión del lunes", f.project.id]]);
    assert.deepEqual((await digestOf(off)).notes, []);
    // Y en el correo del resumen, con su apartado y el enlace a la nota.
    const built = buildDigest(await digestOf(digest));
    assert.equal(built.empty, false);
    const mail = digestEmail(built, { name: "Resumen", baseUrl: "https://pizarro.example.com" }, makeT("es"));
    assert.ok(mail.text.includes("Te han mencionado en notas (1)"), mail.text);
    assert.ok(mail.text.includes(`«Reunión del lunes» https://pizarro.example.com/p/${f.project.id}/docs?doc=${note.id}`), mail.text);
    // Una nota en la papelera ya no sale en el resumen.
    await asUser(author, async () => expectOk(await deleteDocument(note.id)));
    assert.deepEqual((await digestOf(digest)).notes, []);
  });

  test("la baja de un email de menciones en notas enviado por la v1.77 («n») apaga «Menciones en tareas y notas»", async () => {
    const u = await makeUser({ name: "Baja Email Notas" });
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { email: true } });
    const token = unsubscribeToken("note", u.id, row.email);
    assert.equal((await resolveUnsubscribe(token))?.receiving, true);
    const res = await applyUnsubscribe(token, "page", "127.0.0.1");
    assert.equal(res?.changed, true);
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { notifyEmail: true, notifyAdminEmail: true, dailyDigest: true } });
    assert.deepEqual(after, { notifyEmail: false, notifyAdminEmail: true, dailyDigest: false });
    assert.equal((await resolveUnsubscribe(token))?.receiving, false);
    assert.equal((await applyUnsubscribe(token, "one-click", "127.0.0.1"))?.changed, false);
  });

  test("borrar la nota: en la papelera el aviso sigue (Documentación lo dice al abrirlo); borrada del todo, desaparece", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const f = await makeProject({ members: [a, b] });
    await loginAs(a);
    const note = expectOk(await createNote(f.project.id));
    await save(a, note.id, `Hola ${at(b)}`);
    assert.equal((await noticesOf(note.id)).length, 1);
    // Sin email configurado ni nada que enviar, y con la nota en la papelera, el aviso sigue en la campana.
    expectOk(await deleteDocument(note.id));
    assert.equal(await unreadCount(b.id, "MEMBER"), 1);
    expectOk(await deleteDocumentForever(note.id));
    assert.equal(await db.notification.count({ where: { userId: b.id } }), 0);
    assert.equal(await unreadCount(b.id, "MEMBER"), 0);
  });

  test("borrar el proyecto o la cuenta de quien menciona: los avisos se van con el proyecto y quedan sin autor", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const f = await makeProject({ members: [a, b] });
    await loginAs(a);
    const note = expectOk(await createNote(f.project.id));
    await save(a, note.id, `Hola ${at(b)}`);
    // Quien menciona se borra: el aviso queda, sin autor (SetNull), como los de las tareas.
    await db.user.delete({ where: { id: a.id } });
    assert.deepEqual((await noticesOf(note.id)).map((n) => [n.userId, n.actorId]), [[b.id, null]]);
    await db.project.delete({ where: { id: f.project.id } });
    assert.equal(await db.notification.count({ where: { userId: b.id } }), 0);
  });
});
