// Destinatario del informe semanal: se elige de la lista de personas del proyecto por su nombre (nadie escribe el email
// de otra persona), una dirección externa solo la pone un administrador y a quien no lo es se le enseña enmascarada. La
// respuesta no dice si una dirección es de alguien: un miembro no puede probar emails.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { saveReportSchedule } from "../../src/actions/report-schedule";
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
    expectFail(await saveReportSchedule(f.project.id, { ...week, hour: 10, recipient: { keep: true } }), /ya no vale/);
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
});
