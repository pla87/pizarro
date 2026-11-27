// Informe semanal por email, contra PostgreSQL real y con el buzón de pruebas (MAIL_OUTBOX_DIR): idioma, organización,
// quién lo configuró, el fallo por falta de memoria y los recuentos sobre todas las tareas. El PDF lo sustituye una
// función de prueba (`generate`): aquí se prueba el envío, no el dibujo.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { db, makeProject, makeTask, makeUser, withSmtpDown, withSmtpRejecting } from "./helpers";
import { INSTANCE_ORG_KEY, invalidateInstance } from "../../src/lib/instance";
import { flushLogs } from "../../src/lib/log";
import { appTimeZone } from "../../src/lib/format";
import { sendDueReports } from "../../src/lib/periodic-mail";
import { generateProjectReportPdf, reportCounts } from "../../src/lib/report-build";
import { PDF_OUT_OF_MEMORY_MESSAGE } from "../../src/lib/report-render";
import { localParts } from "../../src/lib/schedule";
import { REPORT_MAX_TASKS, WEEKLY_REPORT_LIST_LIMIT } from "../../src/lib/report";

let outbox = "";
const prevOutbox = process.env.MAIL_OUTBOX_DIR;
before(async () => {
  outbox = await mkdtemp(path.join(tmpdir(), "pz-report-"));
  process.env.MAIL_OUTBOX_DIR = outbox;
});
after(async () => {
  if (prevOutbox === undefined) delete process.env.MAIL_OUTBOX_DIR;
  else process.env.MAIL_OUTBOX_DIR = prevOutbox;
  await rm(outbox, { recursive: true, force: true });
  await db.appState.deleteMany({ where: { key: INSTANCE_ORG_KEY } });
  invalidateInstance();
});
// Cada prueba con el buzón vacío y solo su informe pendiente (los de otras pruebas, no).
beforeEach(async () => {
  for (const f of await readdir(outbox)) await rm(path.join(outbox, f), { force: true });
  await db.reportSchedule.updateMany({ data: { enabled: false } });
});

/** Texto de un mensaje SMTP en bruto con quoted-printable (el de nodemailer con tildes o comillas tipográficas). */
function decodeQuotedPrintable(raw: string): string {
  const joined = raw.replace(/=\r?\n/g, "");
  return Buffer.from(joined.replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
}

type Mail = { to: string; subject: string; text: string; html: string; attachments?: { filename: string }[]; headers?: Record<string, string> };
async function mails(): Promise<Mail[]> {
  const files = (await readdir(outbox)).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(outbox, f), "utf8")) as Mail));
}

/** Informe de `f` programado para hoy a las 0:00 (ya toca), configurado por `creator` hacia `recipient`. */
async function schedule(f: { project: { id: string } }, creator: { id: string }, recipient: string) {
  const weekday = localParts(new Date(), appTimeZone()).weekday;
  await db.reportSchedule.upsert({
    where: { projectId: f.project.id },
    create: { projectId: f.project.id, recipient, weekday, hour: 0, createdById: creator.id },
    update: { recipient, weekday, hour: 0, createdById: creator.id, enabled: true, lastSentAt: null },
  });
}

const fakePdf = (calls: string[]) => async (projectId: string, opts: { locale: string }) => {
  calls.push(opts.locale);
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, name: true } });
  return { project: p, pdf: new Uint8Array([37, 80, 68, 70]), today: "2026-11-21", filename: "informe.pdf", taskCount: 0 };
};

describe("email del informe semanal", () => {
  test("a una persona de Pizarro, en su idioma; dice la organización y quién lo configuró, y que no se responda", async () => {
    const creator = await makeUser({ role: "ADMIN", name: "Carla Configura" });
    const reader = await makeUser({ name: "Bob" });
    await db.user.update({ where: { id: reader.id }, data: { locale: "EN" } });
    const f = await makeProject({ members: [creator, reader] });
    const { email } = await db.user.findUniqueOrThrow({ where: { id: reader.id }, select: { email: true } });
    await schedule(f, creator, email.toUpperCase());
    await db.appState.upsert({ where: { key: INSTANCE_ORG_KEY }, create: { key: INSTANCE_ORG_KEY, value: "Acme" }, update: { value: "Acme" } });
    invalidateInstance();
    const calls: string[] = [];
    assert.equal(await sendDueReports(new Date(), { generate: fakePdf(calls) }), 1);
    assert.deepEqual(calls, ["en"], "el PDF, en el idioma de quien lo recibe (antes, en el de quien lo configuró)");
    const [mail] = await mails();
    assert.equal(mail!.subject, `Weekly report for “${f.project.name}”`);
    assert.ok(mail!.text.includes(`Attached is the status PDF report for the project “${f.project.name}” at Acme.`), mail!.text);
    for (const body of [mail!.text, mail!.html]) {
      assert.ok(body.includes("because Carla Configura set up the weekly report"), body);
      assert.ok(body.includes("reply in Pizarro."), body);
    }
    assert.deepEqual(mail!.attachments?.map((a) => a.filename), ["informe.pdf"]);
    // Con su baja al pie (apaga este informe; ver tests/db/unsubscribe.test.ts). Sin https no van las cabeceras.
    assert.match(mail!.text, /\nStop receiving these emails: http:\/\/localhost:3000\/unsubscribe\/r[^\s]+\n/);
    assert.match(mail!.html, />Stop receiving these emails<\/a>/);
    assert.deepEqual(mail!.headers, { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" });
    await db.appState.deleteMany({ where: { key: INSTANCE_ORG_KEY } });
    invalidateInstance();
  });

  test("a una dirección externa, en el idioma de quien lo configuró", async () => {
    const creator = await makeUser({ role: "ADMIN" });
    await db.user.update({ where: { id: creator.id }, data: { locale: "EN" } });
    const f = await makeProject({ members: [creator] });
    await schedule(f, creator, `fuera-${Date.now()}@example.com`);
    const calls: string[] = [];
    assert.equal(await sendDueReports(new Date(), { generate: fakePdf(calls) }), 1);
    assert.deepEqual(calls, ["en"]);
    assert.match((await mails())[0]!.subject, /^Weekly report/);
  });

  // Antes un informe que no cabía en la memoria del generador se reintentaba cada hora todo el día (ocupando la cola de
  // los PDF) y nadie se enteraba.
  test("sin memoria para el PDF: no se reintenta y quien lo configuró recibe un aviso, una sola vez", async () => {
    const creator = await makeUser({ role: "ADMIN", name: "Carla" });
    const f = await makeProject({ members: [creator] });
    const { email } = await db.user.findUniqueOrThrow({ where: { id: creator.id }, select: { email: true } });
    await schedule(f, creator, `jefa-${Date.now()}@example.com`);
    let tries = 0;
    const oom = async () => {
      tries++;
      throw new Error(`${PDF_OUT_OF_MEMORY_MESSAGE} (límite 256 MB, PDF_WORKER_MAX_MB)`);
    };
    const now = new Date();
    assert.equal(await sendDueReports(now, { generate: oom }), 0);
    // Una hora después (la siguiente pasada del mantenimiento) y otra más: ni se vuelve a generar ni se repite el aviso.
    assert.equal(await sendDueReports(new Date(now.getTime() + 3_600_000), { generate: oom }), 0);
    assert.equal(await sendDueReports(new Date(now.getTime() + 7_200_000), { generate: oom }), 0);
    assert.equal(tries, 1);
    const sent = await mails();
    assert.deepEqual(sent.map((m) => m.to), [email], "solo el aviso a quien lo configuró; al destinatario no le llega nada");
    const [notice] = sent;
    assert.equal(notice!.subject, `No se ha podido enviar el informe semanal de «${f.project.name}»`);
    for (const body of [notice!.text, notice!.html]) {
      assert.ok(body.includes("no cabe en la memoria"), body);
      assert.ok(body.includes("archiva las tareas cerradas"), body);
      assert.ok(body.includes("No respondas a este email: contesta en Pizarro."), body);
    }
    // Queda la reserva de esta semana (el próximo, el día y la hora de siempre).
    const row = await db.reportSchedule.findUniqueOrThrow({ where: { projectId: f.project.id } });
    assert.equal(row.lastSentAt?.getTime(), now.getTime());
    assert.equal(row.enabled, true);
  });

  test("otro fallo (SMTP, proyecto…) devuelve la reserva y no avisa a nadie", async () => {
    const creator = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [creator] });
    await schedule(f, creator, `x-${Date.now()}@example.com`);
    const now = new Date();
    assert.equal(await sendDueReports(now, { generate: async () => { throw new Error("se cayó"); } }), 0);
    assert.equal((await db.reportSchedule.findUniqueOrThrow({ where: { projectId: f.project.id } })).lastSentAt, null);
    assert.deepEqual(await mails(), []);
  });

  // Antes, con el SMTP caído, cada pasada generaba el PDF de cada informe pendiente para después no poder enviarlo.
  test("con el SMTP caído se corta la pasada al primer error: no se generan los PDF de los demás", async () => {
    const creator = await makeUser({ role: "ADMIN" });
    const projects = [await makeProject({ members: [creator] }), await makeProject({ members: [creator] })];
    for (const f of projects) await schedule(f, creator, `caido-${Date.now()}@example.com`);
    const calls: string[] = [];
    assert.equal(await withSmtpDown(() => sendDueReports(new Date(), { generate: fakePdf(calls) })), 0);
    assert.equal(calls.length, 1, "un solo PDF");
    const rows = await db.reportSchedule.findMany({ where: { projectId: { in: projects.map((f) => f.project.id) } } });
    assert.deepEqual(rows.map((r) => r.lastSentAt), [null, null], "los dos siguen pendientes para la pasada siguiente");
  });
  // Antes, con una dirección que el servidor de correo rechaza para siempre (un buzón que ya no existe), se volvía a generar
  // el PDF y a intentar el envío cada hora hasta medianoche, todas las semanas.
  test("un rechazo permanente del servidor de correo (550) no se reintenta hasta el próximo envío", async () => {
    const creator = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [creator] });
    await schedule(f, creator, `no-existe-${Date.now()}@example.com`);
    const calls: string[] = [];
    const now = new Date();
    await withSmtpRejecting(async () => {
      for (const h of [0, 1, 2]) assert.equal(await sendDueReports(new Date(now.getTime() + h * 3_600_000), { generate: fakePdf(calls) }), 0);
    });
    assert.equal(calls.length, 1, "un solo PDF");
    const row = await db.reportSchedule.findUniqueOrThrow({ where: { projectId: f.project.id } });
    assert.equal(row.lastSentAt?.getTime(), now.getTime(), "queda la reserva de esta semana");
    assert.equal(row.enabled, true);
    await flushLogs();
    const log = await db.appLog.findFirst({ where: { projectId: f.project.id, action: "report.scheduledRejected" } });
    assert.ok(log, "deja un error en Logs");
  });
  // Antes nadie se enteraba (solo quedaba en Logs): el informe dejaba de llegar cada semana sin aviso.
  test("con el destinatario rechazado se avisa a quien lo configuró, en su idioma y como mucho una vez por semana", async () => {
    const creator = await makeUser({ role: "ADMIN", name: "Carla Configura" });
    await db.user.update({ where: { id: creator.id }, data: { locale: "EN" } });
    const reader = await makeUser({ name: "Bob Buzón" });
    const f = await makeProject({ members: [creator, reader] });
    const { email } = await db.user.findUniqueOrThrow({ where: { id: reader.id }, select: { email: true } });
    const creatorEmail = (await db.user.findUniqueOrThrow({ where: { id: creator.id }, select: { email: true } })).email;
    await schedule(f, creator, email);
    const calls: string[] = [];
    // Las pasadas de abajo van a +1 h y +2 h: deben caer el mismo día local que el informe programado (hoy), o pasadas las
    // 22:00 la última ya no le toca y la prueba fallaba según la hora. Si es tarde, «ahora» se adelanta a las 20:xx de hoy.
    const hourNow = localParts(new Date(), appTimeZone()).hour;
    const now = new Date(Date.now() - Math.max(0, hourNow - 20) * 3_600_000);
    const again = async (at: Date) => {
      await flushLogs();
      await db.reportSchedule.update({ where: { projectId: f.project.id }, data: { lastSentAt: null } });
      assert.equal(await sendDueReports(at, { generate: fakePdf(calls) }), 0);
    };
    const only = new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const delivered = await withSmtpRejecting(async (delivered) => {
      assert.equal(await sendDueReports(now, { generate: fakePdf(calls) }), 0);
      // Otro rechazo en la misma semana (p. ej. tras cambiar el día del informe): sin otro aviso.
      await again(new Date(now.getTime() + 3_600_000));
      assert.equal(delivered.length, 1);
      // Pasada una semana desde el aviso, otro.
      await flushLogs();
      await db.appLog.updateMany({ where: { projectId: f.project.id, action: "report.rejectedNotified" }, data: { createdAt: new Date(now.getTime() - 8 * 86_400_000) } });
      await again(new Date(now.getTime() + 2 * 3_600_000));
      return [...delivered];
    }, "RCPT TO", { only });
    assert.equal(calls.length, 3);
    assert.equal(delivered.length, 2);
    assert.deepEqual(delivered[0]!.to, [creatorEmail]);
    const body = decodeQuotedPrintable(delivered[0]!.data);
    assert.ok(body.includes(`The weekly report for the project “${f.project.name}” was not sent this time: the mail server doesn't accept the address of Bob Buzón.`), body);
    assert.ok(body.includes("Check the recipient in the project settings"), body);
    // Sin el email del destinatario (quien lo configuró puede no verlo) ni la respuesta del servidor de correo.
    assert.ok(!body.toLowerCase().includes(email.toLowerCase()), body);
    assert.ok(!body.includes("5.1.1") && !body.includes("No existe ese buzón"), body);
    await flushLogs();
    assert.equal(await db.appLog.count({ where: { projectId: f.project.id, action: "report.rejectedNotified" } }), 2);
  });

  // Antes, quien se programaba el informe a sí mismo recibía el aviso en la misma dirección rechazada: volvía a fallar y
  // dejaba un error en Logs cada semana.
  test("si el destinatario rechazado es quien lo configuró, no se le avisa a esa misma dirección", async () => {
    const creator = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [creator] });
    const { email } = await db.user.findUniqueOrThrow({ where: { id: creator.id }, select: { email: true } });
    await schedule(f, creator, ` ${email.toUpperCase()} `.trim());
    const delivered = await withSmtpRejecting(async (delivered) => {
      assert.equal(await sendDueReports(new Date(), { generate: fakePdf([]) }), 0);
      return [...delivered];
    }, "RCPT TO");
    assert.equal(delivered.length, 0);
    await flushLogs();
    const actions = (await db.appLog.findMany({ where: { projectId: f.project.id, action: { startsWith: "report." } }, select: { action: true } })).map((l) => l.action);
    assert.ok(actions.includes("report.scheduledRejected"));
    assert.ok(!actions.includes("report.rejectedNotified") && !actions.includes("report.rejectedNotifyFailed"), actions.join());
  });

  test("a una dirección externa rechazada, el aviso dice la dirección (solo la pone un administrador)", async () => {
    const creator = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [creator] });
    const external = `externa-${Date.now()}@example.com`;
    await schedule(f, creator, external);
    const delivered = await withSmtpRejecting(async (delivered) => {
      assert.equal(await sendDueReports(new Date(), { generate: fakePdf([]) }), 0);
      return [...delivered];
    }, "RCPT TO", { only: /^externa-/ });
    assert.equal(delivered.length, 1);
    const body = decodeQuotedPrintable(delivered[0]!.data);
    assert.ok(body.includes(`el servidor de correo no acepta la dirección de ${external}.`), body);
  });

  // Antes también se daba por perdido el informe de la semana si el servidor rechazaba el remitente (un SMTP_FROM que no
  // admite) o el mensaje: son fallos de la instalación y, arreglados, el informe debe salir en el reintento de la hora.
  for (const at of ["MAIL FROM", "DATA"] as const) {
    test(`un rechazo en ${at} (de la instalación, no del destinatario) se reintenta a la hora`, async () => {
      const creator = await makeUser({ role: "ADMIN" });
      const f = await makeProject({ members: [creator] });
      await schedule(f, creator, `rechazo-${Date.now()}@example.com`);
      const calls: string[] = [];
      const now = new Date();
      await withSmtpRejecting(async () => {
        for (const h of [0, 1]) assert.equal(await sendDueReports(new Date(now.getTime() + h * 3_600_000), { generate: fakePdf(calls) }), 0);
      }, at);
      assert.equal(calls.length, 2, "se vuelve a intentar a la hora");
      const row = await db.reportSchedule.findUniqueOrThrow({ where: { projectId: f.project.id } });
      assert.equal(row.lastSentAt, null, "la reserva se devuelve");
      await flushLogs();
      assert.equal(await db.appLog.count({ where: { projectId: f.project.id, action: "report.scheduledRejected" } }), 0);
      assert.equal(await db.appLog.count({ where: { projectId: f.project.id, action: "report.scheduledFailed" } }), 2);
    });
  }
});

describe("informe semanal de un proyecto enorme", () => {
  // Antes el PDF listaba todas las tareas leídas (hasta 2.000): decenas de páginas adjuntas cada semana. Ahora, como mucho
  // WEEKLY_REPORT_LIST_LIMIT por listado, con «… y N más» y un enlace al tablero; la descarga desde la app sigue entera.
  test("el email sale con un PDF corto, mucho más pequeño que el informe completo", async () => {
    const creator = await makeUser({ role: "ADMIN", name: "Carla" });
    const f = await makeProject({ members: [creator] });
    const n = 900;
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
    await db.task.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        projectId: f.project.id, columnId: i % 3 === 0 ? f.columns.doing : f.columns.todo, kindId: f.kindId, position: i + 1,
        title: `Tarea ${i} con un título de longitud normal para que ocupe una línea de la tabla`,
        dueDate: i % 5 === 0 ? day(-10) : i % 5 === 1 ? day(5) : null,
      })),
    });
    await schedule(f, creator, `jefa-${Date.now()}@example.com`);
    const calls: { listLimit?: number; boardUrl?: string }[] = [];
    const t0 = performance.now();
    assert.equal(await sendDueReports(new Date(), { generate: (id, opts) => (calls.push(opts), generateProjectReportPdf(id, opts)) }), 1);
    const weeklyMs = performance.now() - t0;
    assert.deepEqual(calls.map((c) => [c.listLimit, c.boardUrl]), [[WEEKLY_REPORT_LIST_LIMIT, `${process.env.APP_URL}/p/${f.project.id}`]]);
    const [mail] = await mails();
    const pdfBytes = (mail!.attachments as unknown as { bytes: number }[])[0]!.bytes;
    // Tamaño del email: el texto, el HTML y el PDF en base64 (4/3 de su tamaño).
    const emailBytes = Buffer.byteLength(mail!.text) + Buffer.byteLength(mail!.html) + Math.ceil(pdfBytes / 3) * 4;
    const full = await generateProjectReportPdf(f.project.id, { generatedBy: "Carla", locale: "es" });
    const fullBytes = full!.pdf.length;
    console.log(`[informe semanal] ${n} tareas: email ${Math.round(emailBytes / 1024)} KB (PDF ${Math.round(pdfBytes / 1024)} KB, ${Math.round(weeklyMs)} ms); informe completo ${Math.round(fullBytes / 1024)} KB`);
    assert.ok(emailBytes < 150 * 1024, `el email del informe semanal pesa ${emailBytes} bytes`);
    assert.ok(pdfBytes * 4 < fullBytes, `semanal ${pdfBytes} bytes, completo ${fullBytes} bytes`);
  });
});

describe("recuentos del informe", () => {
  // Antes el informe leía las primeras 2.000 tareas y con ellas calculaba el avance, las vencidas y la carga por persona.
  test("cuentan todas las tareas activas, no solo las que se listan; sin archivadas y con las fijas aparte", async () => {
    const ana = await makeUser({ name: "Ana" });
    const f = await makeProject({ members: [ana] });
    const today = "2026-11-21";
    const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
    const n = REPORT_MAX_TASKS + 50;
    await db.task.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        projectId: f.project.id, columnId: i % 4 === 0 ? f.columns.done : f.columns.todo, kindId: f.kindId, title: `T${i}`, position: i + 1,
        assigneeId: i % 2 ? ana.id : null,
        // Vencida, en 3 días, dentro de 20 días o sin plazo.
        dueDate: [day("2026-11-10"), day("2026-11-24"), day("2026-12-11"), null][i % 4 === 0 ? 3 : i % 3]!,
      })),
    });
    await makeTask(f, { title: "Archivada" }).then((t) => db.task.update({ where: { id: t.id }, data: { archivedAt: new Date() } }));
    await makeTask(f, { title: "Fija" }).then((t) => db.task.update({ where: { id: t.id }, data: { evergreen: true } }));
    const counts = await reportCounts(f.project.id, today, "es");
    const sum = (pick: (r: (typeof counts.rows)[number]) => number, only = (_: (typeof counts.rows)[number]) => true) => counts.rows.filter(only).reduce((s, r) => s + pick(r), 0);
    assert.equal(sum((r) => r.count), n);
    assert.equal(counts.fixed, 1);
    const tasks = Array.from({ length: n }, (_, i) => i);
    const open = tasks.filter((i) => i % 4 !== 0);
    const openOf = (pick: number) => open.filter((i) => i % 3 === pick).length;
    const isOpen = (r: (typeof counts.rows)[number]) => r.columnId === f.columns.todo;
    assert.equal(sum((r) => r.overdue, isOpen), openOf(0));
    assert.equal(sum((r) => r.dueSoon, isOpen), openOf(1));
    assert.equal(sum((r) => r.withoutDue), tasks.filter((i) => i % 4 === 0).length);
    assert.equal(sum((r) => r.count, (r) => r.assigneeName === "Ana"), tasks.filter((i) => i % 2).length);
  });
});
