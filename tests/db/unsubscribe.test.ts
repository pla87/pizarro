// Baja en un clic (RFC 8058) de los emails de avisos, del resumen diario y del informe semanal, contra PostgreSQL real y
// con el buzón de pruebas (MAIL_OUTBOX_DIR): enlace al pie y cabeceras, POST sin sesión que apaga solo ese tipo de email,
// GET que nunca da de baja, tokens que no valen y límite de intentos.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { afterDone, db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { saveReportSchedule } from "../../src/actions/report-schedule";
import { retargetReportSchedules } from "../../src/lib/report-recipient";
import { deliver } from "../../src/lib/notify";
import { sendDueDigests } from "../../src/lib/periodic-mail";
import { applyUnsubscribe, resolveUnsubscribe } from "../../src/lib/unsubscribe";
import { unsubscribeLinks } from "../../src/lib/unsubscribe-links";
import { unsubscribeToken } from "../../src/lib/unsubscribe-core";
import { GET, POST } from "../../src/app/api/unsubscribe/[token]/route";

let outbox = "";
const prevOutbox = process.env.MAIL_OUTBOX_DIR;
before(async () => {
  outbox = await mkdtemp(path.join(tmpdir(), "pz-unsub-"));
  process.env.MAIL_OUTBOX_DIR = outbox;
});
after(async () => {
  if (prevOutbox === undefined) delete process.env.MAIL_OUTBOX_DIR;
  else process.env.MAIL_OUTBOX_DIR = prevOutbox;
  await rm(outbox, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const f of await readdir(outbox)) await rm(path.join(outbox, f), { force: true });
});

type Mail = { to: string; subject: string; text: string; html: string; headers: Record<string, string> };
async function mails(): Promise<Mail[]> {
  const files = (await readdir(outbox)).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(outbox, f), "utf8")) as Mail));
}

let ipSeq = 0;
/** Cada petición desde una IP distinta (salvo que se diga), para no tropezar con el límite por IP entre pruebas. */
const call = (method: "GET" | "POST", token: string, body?: string, ip = `203.0.113.${(ipSeq++ % 250) + 1}`) => {
  const req = new Request(`http://localhost:3000/api/unsubscribe/${token}`, {
    method,
    headers: { "x-real-ip": ip, ...(body !== undefined ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body,
  });
  return (method === "GET" ? GET : POST)(req, { params: Promise.resolve({ token }) });
};
const ONE_CLICK = "List-Unsubscribe=One-Click";

/** APP_URL con https durante `fn` (sin https no van las cabeceras de la baja en un clic). */
async function withHttps<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.APP_URL;
  process.env.APP_URL = "https://pizarro.example.com";
  try {
    return await fn();
  } finally {
    process.env.APP_URL = prev;
  }
}

describe("baja en un clic", () => {
  test("aviso de comentario: enlace al pie y cabeceras; el POST apaga solo los comentarios, sin sesión", async () => {
    const author = await makeUser({ name: "Autora" });
    const reader = await makeUser();
    await db.user.update({ where: { id: reader.id }, data: { notifyCommentEmail: true, notifyDueEmail: true } });
    const f = await makeProject({ members: [author, reader] });
    const task = await makeTask(f);
    const n = await db.notification.create({ data: { userId: reader.id, actorId: author.id, taskId: task.id, type: "COMMENT", excerpt: "Hola" } });
    await withHttps(() => deliver([n.id]));
    const [mail] = await mails();
    const page = /https:\/\/pizarro\.example\.com\/unsubscribe\/([A-Za-z0-9_.-]+)/.exec(mail!.text);
    assert.ok(page, mail!.text);
    const token = page[1]!;
    assert.ok(mail!.html.includes(`href="https://pizarro.example.com/unsubscribe/${token}"`));
    assert.equal(mail!.headers["List-Unsubscribe"], `<https://pizarro.example.com/api/unsubscribe/${token}>`);
    assert.equal(mail!.headers["List-Unsubscribe-Post"], ONE_CLICK);
    assert.equal(mail!.headers["Auto-Submitted"], "auto-generated", "se mantienen las cabeceras de siempre");
    // Abrir el enlace (GET) nunca da de baja: lleva a la página de confirmación.
    const get = await call("GET", token);
    assert.equal(get.status, 303);
    assert.equal(get.headers.get("location"), `/unsubscribe/${token}`);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: reader.id } })).notifyCommentEmail, true);
    // Un POST sin el cuerpo de la baja en un clic tampoco.
    assert.equal((await call("POST", token, "x=1")).status, 400);
    // La baja en un clic (el gestor de correo, sin cookies).
    const res = await call("POST", token, ONE_CLICK);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const after1 = await db.user.findUniqueOrThrow({ where: { id: reader.id }, select: { notifyCommentEmail: true, notifyDueEmail: true, notifyEmail: true, notifyAssignedEmail: true } });
    assert.deepEqual(after1, { notifyCommentEmail: false, notifyDueEmail: true, notifyEmail: true, notifyAssignedEmail: false }, "solo ese tipo de aviso");
    // Repetirla no falla (ya estaba apagado) y la página lo dice.
    assert.equal((await call("POST", token, ONE_CLICK)).status, 200);
    assert.equal((await resolveUnsubscribe(token))?.receiving, false);
    // La respuesta no dice a quién iba el email.
    assert.doesNotMatch(await (await call("POST", token, ONE_CLICK)).text(), /@/);
  });

  test("el botón de la página (formulario) da de baja y vuelve a la página; cada recordatorio apaga su casilla", async () => {
    const u = await makeUser();
    await db.user.update({ where: { id: u.id }, data: { notifyDueEmail: true, dailyDigest: true } });
    const { email } = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { email: true } });
    // Los recordatorios de «Esperando» y los cambios de fecha comparten la casilla de las fechas límite.
    const token = unsubscribeToken("due", u.id, email);
    const res = await call("POST", token, "confirm=1");
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), `/unsubscribe/${token}`);
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { notifyDueEmail: true, dailyDigest: true } });
    assert.deepEqual(row, { notifyDueEmail: false, dailyDigest: true });
  });

  test("resumen diario: el email lleva su baja, que apaga solo el resumen", async () => {
    const u = await makeUser();
    const f = await makeProject({ members: [u] });
    await makeTask(f, { createdById: null });
    await db.user.update({ where: { id: u.id }, data: { dailyDigest: true, digestHour: 0, lastDigestAt: null } });
    // Solo el de esta persona (el resto de pruebas pudo dejar a otras con el resumen activado).
    await db.user.updateMany({ where: { id: { not: u.id }, dailyDigest: true }, data: { dailyDigest: false } });
    await withHttps(() => sendDueDigests(new Date()));
    const mine = (await mails()).filter((m) => m.subject.includes("resumen diario"));
    assert.equal(mine.length, 1);
    const header = /<https:\/\/pizarro\.example\.com\/api\/unsubscribe\/([^>]+)>/.exec(mine[0]!.headers["List-Unsubscribe"] ?? "");
    assert.ok(header, JSON.stringify(mine[0]!.headers));
    assert.ok(mine[0]!.text.includes("Dejar de recibir estos emails: https://pizarro.example.com/unsubscribe/"));
    assert.equal((await call("POST", header[1]!, ONE_CLICK)).status, 200);
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { dailyDigest: true, notifyEmail: true } });
    assert.deepEqual(row, { dailyDigest: false, notifyEmail: true });
  });

  test("informe semanal: la baja la hace su destinatario (sin cuenta) y deja de valer si cambia la dirección", async () => {
    const creator = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [creator] });
    const recipient = `Jefa-${Date.now()}@Example.com`;
    await db.reportSchedule.create({ data: { projectId: f.project.id, recipient, createdById: creator.id } });
    const links = await withHttps(async () => unsubscribeLinks("report", f.project.id, recipient));
    const token = links.page.split("/").pop()!;
    assert.match(links.headers["List-Unsubscribe"]!, /^<https:\/\/pizarro\.example\.com\/api\/unsubscribe\/r/);
    const target = await resolveUnsubscribe(token);
    assert.deepEqual([target?.kind, target?.projectName, target?.receiving], ["report", f.project.name, true]);
    // Otra dirección configurada después: el enlace del email anterior ya no vale.
    await db.reportSchedule.update({ where: { projectId: f.project.id }, data: { recipient: `otra-${Date.now()}@example.com` } });
    assert.equal((await call("POST", token, ONE_CLICK)).status, 404);
    assert.equal((await db.reportSchedule.findUniqueOrThrow({ where: { projectId: f.project.id } })).enabled, true);
    await db.reportSchedule.update({ where: { projectId: f.project.id }, data: { recipient } });
    assert.equal((await call("POST", token, ONE_CLICK)).status, 200);
    assert.equal((await db.reportSchedule.findUniqueOrThrow({ where: { projectId: f.project.id } })).enabled, false);
  });

  test("tokens que no valen (inventado, de otro tipo, de otra persona) y límite de intentos", async () => {
    const u = await makeUser();
    const { email } = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { email: true } });
    const good = unsubscribeToken("mention", u.id, email);
    for (const bad of ["x", `a${good.slice(1)}`, unsubscribeToken("mention", u.id, "otra@example.com"), `${good.slice(0, -4)}0000`]) {
      assert.equal((await call("POST", bad, ONE_CLICK)).status, 404, bad);
    }
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).notifyEmail, true);
    // Muchas seguidas con el mismo token (o desde la misma IP): 429.
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await call("POST", good, "x=1")).status);
    assert.ok(statuses.includes(429), statuses.join(","));
    const fromOneIp: number[] = [];
    for (let i = 0; i < 32; i++) fromOneIp.push((await call("POST", `m${i}x.${"0".repeat(32)}`, ONE_CLICK, "198.51.100.7")).status);
    assert.equal(fromOneIp.at(-1), 429);
  });
});

describe("baja del informe semanal: recordada y avisada", () => {
  /** Proyecto de equipo con quien configura el informe (`setter`) y su destinatario (`reader`), con el informe activo. */
  async function scheduled() {
    const setter = await makeUser({ name: "Sergio Configura" });
    const reader = await makeUser({ name: "Rita Lectora" });
    const other = await makeUser({ name: "Otro Miembro" });
    const f = await makeProject({ members: [setter, reader, other] });
    await loginAs(setter);
    expectOk(await saveReportSchedule(f.project.id, { enabled: true, recipient: { userId: reader.id }, weekday: 1, hour: 8 }));
    const readerEmail = (await db.user.findUniqueOrThrow({ where: { id: reader.id } })).email;
    return { setter, reader, other, f, readerEmail, token: unsubscribeToken("report", f.project.id, readerEmail) };
  }
  const row = (projectId: string) => db.reportSchedule.findUniqueOrThrow({ where: { projectId }, select: { enabled: true, recipient: true, unsubscribedEmail: true, unsubscribedAt: true } });

  test("se apunta quién y cuándo, y quien lo configuró recibe el aviso en la campana y por email", async () => {
    const { setter, f, readerEmail, token } = await scheduled();
    const t0 = Date.now();
    assert.equal((await call("POST", token, ONE_CLICK)).status, 200);
    const r = await row(f.project.id);
    assert.equal(r.enabled, false);
    assert.equal(r.unsubscribedEmail, readerEmail);
    assert.ok(r.unsubscribedAt && r.unsubscribedAt.getTime() >= t0 - 1000);
    await afterDone();
    const notices = await db.notification.findMany({ where: { projectId: f.project.id, type: "REPORT_UNSUBSCRIBED" }, select: { userId: true, excerpt: true, taskId: true, emailSentAt: true } });
    assert.equal(notices.length, 1);
    assert.deepEqual([notices[0]!.userId, notices[0]!.excerpt, notices[0]!.taskId], [setter.id, "Rita Lectora", null]);
    assert.ok(notices[0]!.emailSentAt, "por email: tiene las menciones activadas (por defecto)");
    const setterEmail = (await db.user.findUniqueOrThrow({ where: { id: setter.id } })).email;
    const mail = (await mails()).find((m) => m.to === setterEmail);
    assert.equal(mail?.subject, `Rita Lectora se ha dado de baja del informe semanal de «${f.project.name}»`);
    assert.match(mail?.text ?? "", new RegExp(`/p/${f.project.id}/settings\\?tab=informes`));
    // Repetir la baja no vuelve a avisar.
    assert.equal((await call("POST", token, ONE_CLICK)).status, 200);
    assert.equal(await db.notification.count({ where: { projectId: f.project.id, type: "REPORT_UNSUBSCRIBED" } }), 1);
  });

  test("nadie más lo reactiva hacia esa persona (tampoco un administrador); otro destinatario sí, y ella misma también", async () => {
    const { setter, reader, other, f, readerEmail, token } = await scheduled();
    assert.equal((await call("POST", token, ONE_CLICK)).status, 200);
    await loginAs(setter);
    expectFail(await saveReportSchedule(f.project.id, { enabled: true, recipient: { userId: reader.id }, weekday: 1, hour: 8 }), /Rita Lectora se dio de baja de este informe/);
    expectFail(await saveReportSchedule(f.project.id, { enabled: true, recipient: { keep: true }, weekday: 2, hour: 9 }), /se dio de baja/);
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    expectFail(await saveReportSchedule(f.project.id, { enabled: true, recipient: { email: readerEmail.toUpperCase() }, weekday: 1, hour: 8 }), /se dio de baja/);
    assert.equal((await row(f.project.id)).enabled, false);
    // Guardarlo desactivado (cambiar el día) sí se puede, y la baja sigue apuntada.
    await loginAs(setter);
    expectOk(await saveReportSchedule(f.project.id, { enabled: false, recipient: { keep: true }, weekday: 3, hour: 9 }));
    // A otra persona: sí, y la baja se conserva (volver a la primera sigue sin poder hacerse).
    expectOk(await saveReportSchedule(f.project.id, { enabled: true, recipient: { userId: other.id }, weekday: 1, hour: 8 }));
    assert.equal((await row(f.project.id)).unsubscribedEmail, readerEmail);
    expectFail(await saveReportSchedule(f.project.id, { enabled: true, recipient: { userId: reader.id }, weekday: 1, hour: 8 }), /se dio de baja/);
    // Ella misma, con su sesión: lo activa para sí y la baja se olvida.
    await loginAs(reader);
    expectOk(await saveReportSchedule(f.project.id, { enabled: true, recipient: { userId: reader.id }, weekday: 1, hour: 8 }));
    const r = await row(f.project.id);
    assert.deepEqual([r.enabled, r.recipient, r.unsubscribedEmail, r.unsubscribedAt], [true, readerEmail, null, null]);
  });

  test("darse de baja de un informe ya desactivado también se apunta (sin aviso); si lo configuró ella misma, sin aviso", async () => {
    const { f, readerEmail, token } = await scheduled();
    await db.reportSchedule.update({ where: { projectId: f.project.id }, data: { enabled: false } });
    const done = await applyUnsubscribe(token, "page", "203.0.113.9");
    assert.equal(done?.changed, false);
    assert.equal((await row(f.project.id)).unsubscribedEmail, readerEmail);
    assert.equal(await db.notification.count({ where: { projectId: f.project.id, type: "REPORT_UNSUBSCRIBED" } }), 0);

    const self = await makeUser({ name: "Pilar Propia" });
    const g = await makeProject({ members: [self] });
    await loginAs(self);
    expectOk(await saveReportSchedule(g.project.id, { enabled: true, recipient: { userId: self.id }, weekday: 1, hour: 8 }));
    const selfEmail = (await db.user.findUniqueOrThrow({ where: { id: self.id } })).email;
    assert.equal((await call("POST", unsubscribeToken("report", g.project.id, selfEmail), ONE_CLICK)).status, 200);
    assert.equal(await db.notification.count({ where: { projectId: g.project.id, type: "REPORT_UNSUBSCRIBED" } }), 0, "no se avisa a sí misma");
  });

  test("al cambiar de email, la baja sigue valiendo con la dirección nueva", async () => {
    const { setter, reader, f, readerEmail, token } = await scheduled();
    assert.equal((await call("POST", token, ONE_CLICK)).status, 200);
    const fresh = `nueva-${Date.now()}@example.com`;
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: reader.id }, data: { email: fresh } });
      await retargetReportSchedules(tx, readerEmail, fresh);
    });
    assert.equal((await row(f.project.id)).unsubscribedEmail, fresh);
    await loginAs(setter);
    expectFail(await saveReportSchedule(f.project.id, { enabled: true, recipient: { userId: reader.id }, weekday: 1, hour: 8 }), /se dio de baja/);
  });
});
