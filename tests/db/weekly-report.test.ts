// Informe semanal por email, contra PostgreSQL real y con el buzón de pruebas (MAIL_OUTBOX_DIR): idioma, organización,
// quién lo configuró, el fallo por falta de memoria y los recuentos sobre todas las tareas. El PDF lo sustituye una
// función de prueba (`generate`): aquí se prueba el envío, no el dibujo.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { db, makeProject, makeTask, makeUser } from "./helpers";
import { INSTANCE_ORG_KEY, invalidateInstance } from "../../src/lib/instance";
import { appTimeZone } from "../../src/lib/format";
import { sendDueReports } from "../../src/lib/periodic-mail";
import { reportCounts } from "../../src/lib/report-build";
import { PDF_OUT_OF_MEMORY_MESSAGE } from "../../src/lib/report-render";
import { localParts } from "../../src/lib/schedule";
import { REPORT_MAX_TASKS } from "../../src/lib/report";

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
