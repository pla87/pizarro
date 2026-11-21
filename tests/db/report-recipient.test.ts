// Destinatario del informe semanal: se elige de la lista de personas del proyecto por su nombre (nadie escribe el email
// de otra persona), una dirección externa solo la pone un administrador y a quien no lo es se le enseña enmascarada. La
// respuesta no dice si una dirección es de alguien: un miembro no puede probar emails.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { confirmAccountChange } from "../../src/actions/auth";
import { saveReportSchedule } from "../../src/actions/report-schedule";
import { deleteUser, updateUser } from "../../src/actions/users";
import { issueAuthToken } from "../../src/lib/auth-token-issue";
import { flushLogs } from "../../src/lib/log";
import { reportRecipientPeople, reportRecipientView } from "../../src/lib/report-recipient";
import { db, expectFail, expectOk, loginAs, makeProject, makeUser } from "./helpers";

const NOT_ALLOWED = "El destinatario debe ser alguien con acceso al proyecto.";
const week = { enabled: true, weekday: 2, hour: 9 };
const stored = async (projectId: string) => (await db.reportSchedule.findUniqueOrThrow({ where: { projectId } })).recipient;

describe("destinatario del informe semanal", () => {
  test("la lista: miembros activos y, en un proyecto de equipo, administradores; sin inactivos ni ajenos", async () => {
    const [member, other, inactive, admin] = [await makeUser(), await makeUser(), await makeUser({ active: false }), await makeUser({ role: "ADMIN" })];
    const team = await makeProject({ members: [member, inactive] });
    const ids = (await reportRecipientPeople(team.project.id)).map((p) => p.id);
    assert.ok(ids.includes(member.id) && ids.includes(admin.id));
    assert.ok(!ids.includes(other.id) && !ids.includes(inactive.id));
    const priv = await makeProject({ visibility: "PRIVATE", owner: member });
    assert.deepEqual((await reportRecipientPeople(priv.project.id)).map((p) => p.id), [member.id]);
  });

  test("un miembro elige a una persona por su id; la misma respuesta para alguien ajeno que para un id que no existe", async () => {
    const [member, mate, outsider] = [await makeUser(), await makeUser(), await makeUser()];
    const f = await makeProject({ members: [member, mate] });
    await loginAs(member);
    expectOk(await saveReportSchedule(f.project.id, { ...week, recipient: { userId: mate.id } }));
    assert.equal(await stored(f.project.id), mate.email);
    const foreign = expectFail(await saveReportSchedule(f.project.id, { ...week, recipient: { userId: outsider.id } }));
    const missing = expectFail(await saveReportSchedule(f.project.id, { ...week, recipient: { userId: "c" + "0".repeat(24) } }));
    assert.equal(foreign, NOT_ALLOWED);
    assert.equal(missing, NOT_ALLOWED);
    assert.equal(await stored(f.project.id), mate.email, "no cambia");
  });

  test("un miembro no escribe direcciones: ni de alguien del proyecto, ni externas (mismo error)", async () => {
    const [member, mate] = [await makeUser(), await makeUser()];
    const f = await makeProject({ members: [member, mate] });
    await loginAs(member);
    const a = expectFail(await saveReportSchedule(f.project.id, { ...week, recipient: { email: mate.email } }));
    const b = expectFail(await saveReportSchedule(f.project.id, { ...week, recipient: { email: "nadie@example.com" } }));
    assert.equal(a, b);
    assert.equal(await db.reportSchedule.count({ where: { projectId: f.project.id } }), 0);
  });

  test("un administrador pone una dirección externa; un miembro la ve enmascarada y no puede conservarla como suya", async () => {
    const [admin, member] = [await makeUser({ role: "ADMIN" }), await makeUser()];
    const f = await makeProject({ members: [member] });
    await loginAs(admin);
    expectOk(await saveReportSchedule(f.project.id, { ...week, recipient: { email: "Fuera@Example.com" } }));
    assert.equal(await stored(f.project.id), "fuera@example.com");
    const people = await reportRecipientPeople(f.project.id);
    assert.deepEqual(reportRecipientView("fuera@example.com", people, true), { kind: "external", shown: "fuera@example.com" });
    const masked = reportRecipientView("fuera@example.com", people, false);
    assert.equal(masked.kind, "external");
    assert.ok(masked.kind === "external" && !masked.shown.includes("fuera") && masked.shown.endsWith("@example.com"), JSON.stringify(masked));
    // Una persona del proyecto se ve como persona (por su id), nunca con su email.
    assert.deepEqual(reportRecipientView(member.email.toUpperCase(), people, false), { kind: "user", userId: member.id });

    await loginAs(member);
    // Cambiar solo la hora: el motivo es que la dirección es externa (no «ya no vale»).
    expectFail(await saveReportSchedule(f.project.id, { ...week, hour: 10, recipient: { keep: true } }), /^Solo un administrador puede mantener una dirección externa: elige a una persona del proyecto\.$/);
    // Desactivarlo sí puede (el destinatario se conserva).
    expectOk(await saveReportSchedule(f.project.id, { ...week, enabled: false, recipient: { keep: true } }));
    assert.equal(await stored(f.project.id), "fuera@example.com");
    await loginAs(admin);
    expectOk(await saveReportSchedule(f.project.id, { ...week, recipient: { keep: true } }));
  });

  test("proyecto privado: ni siquiera un administrador pone una dirección externa", async () => {
    const [admin, owner] = [await makeUser({ role: "ADMIN" }), await makeUser()];
    const f = await makeProject({ visibility: "PRIVATE", owner, members: [admin] });
    await loginAs(admin);
    expectFail(await saveReportSchedule(f.project.id, { ...week, recipient: { email: "fuera@example.com" } }), NOT_ALLOWED);
    expectOk(await saveReportSchedule(f.project.id, { ...week, recipient: { userId: owner.id } }));
    assert.equal(await stored(f.project.id), owner.email);
  });

  test("una persona que ya no vale (salió del proyecto): el mensaje de siempre, «ya no vale»", async () => {
    const [member, mate] = [await makeUser(), await makeUser()];
    const f = await makeProject({ members: [member, mate] });
    await loginAs(member);
    expectOk(await saveReportSchedule(f.project.id, { ...week, recipient: { userId: mate.id } }));
    await db.projectMember.deleteMany({ where: { projectId: f.project.id, userId: mate.id } });
    expectFail(await saveReportSchedule(f.project.id, { ...week, hour: 11, recipient: { keep: true } }), /^El destinatario guardado ya no vale/);
  });

  test("petición forjada con dos destinos a la vez: error de validación traducido, no «Invalid input»", async () => {
    const [member, mate] = [await makeUser(), await makeUser()];
    await db.user.update({ where: { id: member.id }, data: { locale: "EN" } });
    const f = await makeProject({ members: [member, mate] });
    await loginAs(member);
    const forged = { ...week, recipient: { userId: mate.id, email: "fuera@example.com" } } as never;
    assert.equal(expectFail(await saveReportSchedule(f.project.id, forged)), "Invalid data.");
    await db.user.update({ where: { id: member.id }, data: { locale: "ES" } });
    assert.equal(expectFail(await saveReportSchedule(f.project.id, forged)), "Datos no válidos.");
  });
});

describe("el destinatario cambia de email", () => {
  test("al confirmar el cambio en Mi perfil, sus informes pasan a la dirección nueva (también con otras mayúsculas)", async () => {
    const [admin, member] = [await makeUser({ role: "ADMIN" }), await makeUser()];
    const a = await makeProject({ members: [member] });
    const b = await makeProject({ members: [member] });
    const other = await makeProject({ members: [member] });
    // Uno lo programa un administrador, otro un miembro; el tercero va a otra dirección y no se toca.
    await loginAs(admin);
    expectOk(await saveReportSchedule(a.project.id, { ...week, recipient: { userId: member.id } }));
    expectOk(await saveReportSchedule(other.project.id, { ...week, recipient: { email: "fuera@example.com" } }));
    await loginAs(member);
    expectOk(await saveReportSchedule(b.project.id, { ...week, recipient: { userId: member.id } }));
    await db.reportSchedule.update({ where: { projectId: b.project.id }, data: { recipient: member.email.toUpperCase() } });
    const newEmail = `nueva-${Date.now().toString(36)}@example.com`;
    const token = await issueAuthToken(member.id, "EMAIL_CHANGE", { newEmail });
    expectOk(await confirmAccountChange(token));
    assert.equal(await stored(a.project.id), newEmail);
    assert.equal(await stored(b.project.id), newEmail);
    assert.equal(await stored(other.project.id), "fuera@example.com");
    // Y en Ajustes se sigue viendo como la persona, no como «Dirección externa».
    assert.deepEqual(reportRecipientView(await stored(a.project.id), await reportRecipientPeople(a.project.id), false), { kind: "user", userId: member.id });
    assert.equal((await db.reportSchedule.findUniqueOrThrow({ where: { projectId: b.project.id } })).enabled, true);
  });

  test("al editarle el email un administrador en Administración → Usuarios, igual", async () => {
    const [admin, member] = [await makeUser({ role: "ADMIN" }), await makeUser()];
    const f = await makeProject({ members: [member] });
    await loginAs(member);
    expectOk(await saveReportSchedule(f.project.id, { ...week, recipient: { userId: member.id } }));
    await loginAs(admin);
    const newEmail = `editada-${Date.now().toString(36)}@example.com`;
    expectOk(await updateUser(member.id, { name: member.name, email: newEmail, role: "MEMBER", active: true, expected: { name: member.name, email: member.email, role: "MEMBER", active: true } }));
    assert.equal(await stored(f.project.id), newEmail);
    // Sin cambio de email, nada cambia.
    expectOk(await updateUser(member.id, { name: "Otro nombre", email: newEmail, role: "MEMBER", active: true, expected: { name: member.name, email: newEmail, role: "MEMBER", active: true } }));
    assert.equal(await stored(f.project.id), newEmail);
  });
});

describe("el destinatario borra su cuenta", () => {
  test("al borrarse la cuenta se desactivan los informes que iban a su email (sin distinguir mayúsculas), con su anotación", async () => {
    const [admin, member] = [await makeUser({ role: "ADMIN" }), await makeUser()];
    const a = await makeProject({ members: [member] });
    const b = await makeProject({ members: [member] });
    const other = await makeProject({ members: [member] });
    await loginAs(admin);
    expectOk(await saveReportSchedule(a.project.id, { ...week, recipient: { userId: member.id } }));
    expectOk(await saveReportSchedule(b.project.id, { ...week, recipient: { userId: member.id } }));
    expectOk(await saveReportSchedule(other.project.id, { ...week, recipient: { email: "fuera@example.com" } }));
    await db.reportSchedule.update({ where: { projectId: b.project.id }, data: { recipient: member.email.toUpperCase() } });
    expectOk(await deleteUser(member.id));
    const enabled = async (projectId: string) => (await db.reportSchedule.findUniqueOrThrow({ where: { projectId } })).enabled;
    assert.equal(await enabled(a.project.id), false, "ya no sale hacia la dirección de una cuenta borrada");
    assert.equal(await enabled(b.project.id), false);
    assert.equal(await enabled(other.project.id), true, "la dirección externa no se toca");
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { action: "report.scheduleDisabled", projectId: { in: [a.project.id, b.project.id] } } });
    assert.equal(logs.length, 2);
    assert.equal(logs[0]!.userId, admin.id);
  });
});

describe("cambiar el día o la hora del informe", () => {
  test("tras el envío de esta semana, ni cambiar el día o la hora ni desactivarlo y activarlo reinician el «ya enviado»", async () => {
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    await loginAs(member);
    expectOk(await saveReportSchedule(f.project.id, { ...week, recipient: { userId: member.id } }));
    const sent = new Date();
    await db.reportSchedule.update({ where: { projectId: f.project.id }, data: { lastSentAt: sent } });
    expectOk(await saveReportSchedule(f.project.id, { enabled: true, weekday: 5, hour: 18, recipient: { keep: true } }));
    const row = await db.reportSchedule.findUniqueOrThrow({ where: { projectId: f.project.id } });
    assert.deepEqual([row.weekday, row.hour, row.lastSentAt?.getTime()], [5, 18, sent.getTime()]);
    expectOk(await saveReportSchedule(f.project.id, { enabled: false, weekday: 5, hour: 18, recipient: { keep: true } }));
    assert.equal((await db.reportSchedule.findUniqueOrThrow({ where: { projectId: f.project.id } })).lastSentAt?.getTime(), sent.getTime());
    expectOk(await saveReportSchedule(f.project.id, { enabled: true, weekday: 5, hour: 18, recipient: { keep: true } }));
    // Volver a activarlo la misma semana no lo reinicia (antes se ponía a null y el informe salía otra vez).
    assert.equal((await db.reportSchedule.findUniqueOrThrow({ where: { projectId: f.project.id } })).lastSentAt?.getTime(), sent.getTime());
  });
});
