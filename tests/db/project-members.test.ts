// Miembros de un proyecto: administradores asignados a uno de equipo, aviso por email al añadir a alguien, «Invitar por
// email» (cuenta nueva como invitación, ya dentro del proyecto) y el enlace para pasarlo a mano. Contra PostgreSQL real,
// con el buzón de pruebas (MAIL_OUTBOX_DIR).
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { flushLogs } from "../../src/lib/log";
import { afterDone, db, expectFail, expectOk, FORBIDDEN, loginAs, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { addProjectMember, removeProjectMember, setProjectVisibility } from "../../src/actions/projects";
import { findUsableToken, purgeExpiredTokens } from "../../src/lib/auth-token";
import { workingProjectsWhere } from "../../src/lib/access";
import { outsideListProject } from "../../src/lib/project-visit";
import type { CurrentUser } from "../../src/lib/session";

// El tope de usuarios se lee al cargar el módulo: los demás ficheros ya han creado muchos.
process.env.MAX_USERS = "100000";
const { inviteToProject, resendInvite, updateUser } = await import("../../src/actions/users");

let outbox = "";
const prevOutbox = process.env.MAIL_OUTBOX_DIR;
before(async () => {
  outbox = await mkdtemp(path.join(tmpdir(), "pz-members-"));
  process.env.MAIL_OUTBOX_DIR = outbox;
});
after(async () => {
  if (prevOutbox === undefined) delete process.env.MAIL_OUTBOX_DIR;
  else process.env.MAIL_OUTBOX_DIR = prevOutbox;
  await rm(outbox, { recursive: true, force: true });
});

type Mail = { to: string; subject: string; text: string; html: string };
/** Emails guardados para `to`, del más antiguo al más reciente (espera a los que salen en segundo plano). */
async function mailsTo(to: string): Promise<Mail[]> {
  await afterDone();
  const files = (await readdir(outbox)).filter((f) => f.endsWith(".json")).sort();
  const all = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(outbox, f), "utf8")) as Mail));
  return all.filter((m) => m.to === to);
}
const tokenOf = (text: string) => /\/reset\/([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";
const address = (tag: string) => `${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@example.com`;
const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const isMember = async (projectId: string, userId: string) => !!(await db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } }));
const isPicked = async (projectId: string, userId: string) => !!(await db.adminProjectPick.findUnique({ where: { projectId_userId: { projectId, userId } } }));
const working = async (user: { id: string; role: "ADMIN" | "MEMBER" }, projectId: string) =>
  (await db.project.count({ where: { id: projectId, ...workingProjectsWhere(user as CurrentUser) } })) > 0;

describe("administradores asignados a un proyecto de equipo", () => {
  test("asignar a un admin lo hace miembro y lo marca como elegido; quitarlo no le quita ni el acceso, ni la elección, ni sus tarjetas", async () => {
    const boss = await makeUser({ role: "ADMIN" });
    const helper = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const task = await makeTask(f);
    await db.task.update({ where: { id: task.id }, data: { assigneeId: helper.id } });
    await loginAs(boss);
    const res = expectOk(await addProjectMember(f.project.id, helper.id));
    assert.equal(res.link, `${appUrl()}/p/${f.project.id}`);
    assert.ok(await isMember(f.project.id, helper.id));
    assert.ok(await isPicked(f.project.id, helper.id));
    assert.ok(await working(helper, f.project.id), "le sale en sus selectores");
    // Repetir la asignación no falla ni duplica nada.
    expectOk(await addProjectMember(f.project.id, helper.id));
    assert.equal(await db.projectMember.count({ where: { projectId: f.project.id } }), 1);

    expectOk(await removeProjectMember(f.project.id, helper.id));
    assert.equal(await isMember(f.project.id, helper.id), false);
    assert.ok(await isPicked(f.project.id, helper.id), "la elección sigue: solo la quita él");
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId, helper.id, "sigue viéndolo: su tarjeta no se desasigna");
  });

  test("un admin asignado que quita el proyecto de los suyos deja de verlo en sus selectores aunque siga asignado", async () => {
    const boss = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    await loginAs(boss);
    expectOk(await addProjectMember(f.project.id, boss.id));
    await db.adminProjectPick.deleteMany({ where: { projectId: f.project.id, userId: boss.id } });
    assert.equal(await working(boss, f.project.id), false);
    assert.ok(await isMember(f.project.id, boss.id));
    // Al abrirlo, el selector lo marca «No está en tus proyectos», como a cualquier otro sin elegir.
    assert.deepEqual(await outsideListProject(boss, f.project.id), { id: f.project.id, name: f.project.name });
  });

  test("en un privado los administradores siguen siendo miembros como antes (sin elección); al pasar a equipo siguen asignados y además lo eligen", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const other = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    const p = await makeProject({ visibility: "PRIVATE", owner: member });
    await loginAs(member);
    expectOk(await addProjectMember(p.project.id, admin.id));
    assert.ok(await isMember(p.project.id, admin.id));
    assert.equal(await isPicked(p.project.id, admin.id), false);
    assert.ok(await working(admin, p.project.id));
    // Otro admin no miembro sigue sin verlo.
    await loginAs(other);
    expectFail(await addProjectMember(p.project.id, other.id), NOT_FOUND);

    await loginAs(admin);
    expectOk(await setProjectVisibility(p.project.id, "TEAM"));
    assert.ok(await isMember(p.project.id, admin.id), "sigue asignado");
    assert.ok(await isPicked(p.project.id, admin.id));
    assert.ok(await isMember(p.project.id, member.id));
    // Y de vuelta a privado, el admin asignado conserva el acceso como miembro.
    expectOk(await setProjectVisibility(p.project.id, "PRIVATE"));
    assert.ok(await isMember(p.project.id, admin.id));
  });

  test("pasar a administrador conserva sus asignaciones y las marca como elegidas", async () => {
    const boss = await makeUser({ role: "ADMIN" });
    const u = await makeUser();
    const f = await makeProject({ members: [u] });
    await loginAs(boss);
    expectOk(await updateUser(u.id, { name: u.name, email: u.email, role: "ADMIN", active: true, expected: { name: u.name, email: u.email, role: "MEMBER", active: true } }));
    assert.ok(await isMember(f.project.id, u.id));
    assert.ok(await isPicked(f.project.id, u.id));
    // Y al volver a miembro, sigue asignado (no pierde el acceso).
    expectOk(await updateUser(u.id, { name: u.name, email: u.email, role: "MEMBER", active: true, expected: { name: u.name, email: u.email, role: "ADMIN", active: true } }));
    assert.ok(await isMember(f.project.id, u.id));
    assert.equal(await isPicked(f.project.id, u.id), false);
  });

  test("solo quien gestiona el proyecto asigna: un miembro de uno de equipo no puede, un ajeno ni lo ve", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    await loginAs(member);
    expectFail(await addProjectMember(f.project.id, admin.id), FORBIDDEN);
    await loginAs(await makeUser());
    expectFail(await addProjectMember(f.project.id, admin.id), NOT_FOUND);
    assert.equal(await isMember(f.project.id, admin.id), false);
  });
});

describe("aviso por email al añadir a alguien a un proyecto", () => {
  test("le llega en su idioma, con el botón al tablero; no al repetir, ni al añadirse uno mismo, ni con sus avisos por email apagados", async () => {
    const admin = await makeUser({ role: "ADMIN", name: "Ana Admin" });
    const target = await makeUser({ name: "Berta" });
    await db.user.update({ where: { id: target.id }, data: { email: address("berta"), locale: "EN" } });
    const to = (await db.user.findUniqueOrThrow({ where: { id: target.id } })).email;
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    const res = expectOk(await addProjectMember(f.project.id, target.id));
    assert.equal(res.emailed, true);
    const [mail, ...rest] = await mailsTo(to);
    assert.equal(rest.length, 0);
    assert.equal(mail?.subject, `Ana Admin has added you to the “${f.project.name}” project`);
    assert.ok(mail!.text.includes(`${appUrl()}/p/${f.project.id}`), "lleva el enlace al tablero");
    assert.match(mail!.html, /Open the board/);

    // Ya era miembro: no se repite el aviso.
    expectOk(await addProjectMember(f.project.id, target.id));
    assert.equal((await mailsTo(to)).length, 1);

    // Asignarse uno mismo: sin email.
    const self = expectOk(await addProjectMember(f.project.id, admin.id));
    assert.equal(self.emailed, false);
    assert.equal((await mailsTo(admin.email)).length, 0);

    // Con los avisos por email de menciones (y administración) desactivados, tampoco.
    const quiet = await makeUser();
    await db.user.update({ where: { id: quiet.id }, data: { notifyEmail: false } });
    assert.equal(expectOk(await addProjectMember(f.project.id, quiet.id)).emailed, false);
    assert.equal((await mailsTo(quiet.email)).length, 0);
    await flushLogs();
    const log = await db.appLog.findFirst({ where: { action: "projects.addProjectMember", userId: admin.id }, orderBy: { createdAt: "asc" } });
    assert.match(log?.message ?? "", /Añadió a «Berta» al proyecto .* \(avisado por email\)/);
  });

  test("añadir, quitar y volver a añadir: un solo email al día por quien añade, persona y proyecto (el alta se hace igual)", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const other = await makeUser({ role: "ADMIN" });
    const target = await makeUser();
    const f = await makeProject({ members: [] });
    const g = await makeProject({ members: [] });
    await loginAs(admin);
    assert.equal(expectOk(await addProjectMember(f.project.id, target.id)).emailed, true);
    for (let i = 0; i < 3; i++) {
      expectOk(await removeProjectMember(f.project.id, target.id));
      assert.equal(await isMember(f.project.id, target.id), false);
      assert.equal(expectOk(await addProjectMember(f.project.id, target.id)).emailed, false, `vuelta ${i + 1}: sin email`);
      assert.equal(await isMember(f.project.id, target.id), true, `vuelta ${i + 1}: añadida igual`);
    }
    assert.equal((await mailsTo(target.email)).length, 1);
    // Otro proyecto, u otra persona que la añade, sí avisan.
    assert.equal(expectOk(await addProjectMember(g.project.id, target.id)).emailed, true);
    await loginAs(other);
    expectOk(await removeProjectMember(f.project.id, target.id));
    assert.equal(expectOk(await addProjectMember(f.project.id, target.id)).emailed, true);
    assert.equal((await mailsTo(target.email)).length, 3);
  });

  test("sin email configurado se añade igual y no se envía nada", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const target = await makeUser();
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    delete process.env.MAIL_OUTBOX_DIR;
    try {
      const res = expectOk(await addProjectMember(f.project.id, target.id));
      assert.equal(res.emailed, false);
      assert.equal(res.link, `${appUrl()}/p/${f.project.id}`);
    } finally {
      process.env.MAIL_OUTBOX_DIR = outbox;
    }
    assert.ok(await isMember(f.project.id, target.id));
    assert.equal((await mailsTo(target.email)).length, 0);
  });

  test("en un privado lo puede añadir cualquier miembro, y el aviso sale en español por defecto", async () => {
    const owner = await makeUser({ name: "Dueña" });
    const friend = await makeUser();
    const p = await makeProject({ visibility: "PRIVATE", owner });
    await loginAs(owner);
    expectOk(await addProjectMember(p.project.id, friend.id));
    const [mail] = await mailsTo(friend.email);
    assert.equal(mail?.subject, `Dueña te ha añadido al proyecto «${p.project.name}»`);
  });
});

describe("Invitar por email desde un proyecto", () => {
  test("añadir a quien no ha aceptado su invitación: al administrador se le dice si sigue valiendo (no el enlace al tablero)", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const first = await makeProject({ members: [] });
    const second = await makeProject({ members: [] });
    await loginAs(admin);
    const to = address("pendiente");
    expectOk(await inviteToProject(first.project.id, to));
    const user = await db.user.findUniqueOrThrow({ where: { email: to } });
    const res = expectOk(await addProjectMember(second.project.id, user.id));
    assert.equal(res.invite?.userId, user.id);
    assert.ok(res.invite?.expiresAt && new Date(res.invite.expiresAt).getTime() > Date.now(), "con la invitación vigente, hasta cuándo vale");
    // Caducada: sin fecha (la interfaz ofrece «Generar enlace de invitación nuevo»).
    await db.authToken.updateMany({ where: { userId: user.id, purpose: "INVITE" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expectOk(await removeProjectMember(second.project.id, user.id));
    assert.deepEqual(expectOk(await addProjectMember(second.project.id, user.id)).invite, { userId: user.id, expiresAt: null });
    // Quien ya ha entrado alguna vez: el enlace al tablero, como siempre.
    const known = await makeUser();
    assert.equal(expectOk(await addProjectMember(second.project.id, known.id)).invite, null);
    // Un miembro que no es administrador (proyecto privado) no ve el estado de la invitación.
    const owner = await makeUser();
    const priv = await makeProject({ visibility: "PRIVATE", owner });
    await loginAs(owner);
    assert.equal(expectOk(await addProjectMember(priv.project.id, user.id)).invite, null);
  });

  test("crea la invitación ya dentro del proyecto, envía el email y devuelve el enlace (que lleva el proyecto)", async () => {
    const admin = await makeUser({ role: "ADMIN", name: "Ana Admin" });
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    const to = address("nueva.persona");
    const res = expectOk(await inviteToProject(f.project.id, to.toUpperCase()));
    assert.equal(res.emailed, true);
    // El nombre provisional sale del email (en minúsculas: el email se guarda así).
    assert.ok(res.name.startsWith("Nueva Persona "), res.name);
    const user = await db.user.findUniqueOrThrow({ where: { email: to } });
    assert.equal(user.role, "MEMBER");
    assert.equal(user.mustChangePassword, true);
    assert.ok(await isMember(f.project.id, user.id));
    const [mail] = await mailsTo(to);
    assert.equal(mail?.subject, `Ana Admin te ha invitado al proyecto «${f.project.name}» en Pizarro`);
    const token = tokenOf(mail!.text);
    assert.ok(res.link.endsWith(`/reset/${token}`), "el enlace copiado es el mismo del email");
    const row = await findUsableToken(token, ["INVITE"]);
    assert.deepEqual(row?.data, { projectId: f.project.id });
    await flushLogs();
    const log = await db.appLog.findFirst({ where: { action: "users.inviteToProject", userId: admin.id }, orderBy: { createdAt: "desc" } });
    assert.match(log?.message ?? "", /Invitó a «.+» al proyecto .* \(por email\)/);
    assert.doesNotMatch(JSON.stringify(log ?? {}), new RegExp(token), "el token no queda en el registro");
  });

  test("sin email configurado: la cuenta se crea igual y el enlace se pasa a mano", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    const to = address("sin-email");
    delete process.env.MAIL_OUTBOX_DIR;
    let link = "";
    try {
      const res = expectOk(await inviteToProject(f.project.id, to));
      assert.equal(res.emailed, false);
      link = res.link;
    } finally {
      process.env.MAIL_OUTBOX_DIR = outbox;
    }
    assert.equal((await mailsTo(to)).length, 0);
    const row = await findUsableToken(/\/reset\/(.+)$/.exec(link)![1]!, ["INVITE"]);
    assert.equal(row?.user.email, to);
  });

  test("«Reenviar invitación» conserva el proyecto de la invitación", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    const to = address("reenvio");
    expectOk(await inviteToProject(f.project.id, to));
    const user = await db.user.findUniqueOrThrow({ where: { email: to } });
    expectOk(await resendInvite(user.id));
    const mails = await mailsTo(to);
    assert.equal(mails.length, 2);
    assert.deepEqual((await findUsableToken(tokenOf(mails[1]!.text), ["INVITE"]))?.data, { projectId: f.project.id });
  });

  test("«Reenviar invitación» cuando ya caducó y el mantenimiento la borró: su único proyecto, con el email de la invitación al proyecto", async () => {
    const admin = await makeUser({ role: "ADMIN", name: "Ana Admin" });
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    const to = address("caducada");
    expectOk(await inviteToProject(f.project.id, to));
    const user = await db.user.findUniqueOrThrow({ where: { email: to } });
    await db.authToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await purgeExpiredTokens();
    assert.equal(await db.authToken.count({ where: { userId: user.id } }), 0, "la invitación caducada ya no está");
    expectOk(await resendInvite(user.id));
    const mails = await mailsTo(to);
    assert.equal(mails.length, 2);
    assert.equal(mails[1]!.subject, `Ana Admin te ha invitado al proyecto «${f.project.name}» en Pizarro`);
    assert.deepEqual((await findUsableToken(tokenOf(mails[1]!.text), ["INVITE"]))?.data, { projectId: f.project.id });
  });

  test("«Reenviar invitación» sin invitación pendiente y en varios proyectos (o en ninguno): la invitación genérica", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const g = await makeProject({ members: [] });
    await loginAs(admin);
    const to = address("varios");
    expectOk(await inviteToProject(f.project.id, to));
    const user = await db.user.findUniqueOrThrow({ where: { email: to } });
    await db.projectMember.create({ data: { projectId: g.project.id, userId: user.id } });
    await db.authToken.deleteMany({ where: { userId: user.id } });
    expectOk(await resendInvite(user.id));
    let mails = await mailsTo(to);
    assert.equal(mails[1]!.subject, "Te han invitado a Pizarro");
    assert.equal((await findUsableToken(tokenOf(mails[1]!.text), ["INVITE"]))?.data ?? null, null);
    // Sin ningún proyecto, igual.
    await db.projectMember.deleteMany({ where: { userId: user.id } });
    await db.authToken.deleteMany({ where: { userId: user.id } });
    expectOk(await resendInvite(user.id));
    mails = await mailsTo(to);
    assert.equal(mails[2]!.subject, "Te han invitado a Pizarro");
  });

  test("invitar el email de una cuenta desactivada: dice que hay que activarla (no que se añada con «Añadir miembro…»)", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const off = await makeUser();
    await db.user.update({ where: { id: off.id }, data: { active: false } });
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    expectFail(await inviteToProject(f.project.id, off.email.toUpperCase()), /^Hay una cuenta desactivada con ese email: actívala en Administración → Usuarios\.$/);
    assert.equal(await isMember(f.project.id, off.id), false);
  });

  test("solo administradores que gestionan el proyecto; un email que ya tiene cuenta se rechaza", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const owner = await makeUser();
    const priv = await makeProject({ visibility: "PRIVATE", owner });
    const team = await makeProject({ members: [owner] });
    // Quien no es administrador no crea cuentas, ni siquiera en su proyecto privado.
    await loginAs(owner);
    expectFail(await inviteToProject(priv.project.id, address("x")), FORBIDDEN);
    expectFail(await inviteToProject(team.project.id, address("x")), FORBIDDEN);
    // Un administrador no puede invitar a un privado del que no es miembro (ni lo ve).
    await loginAs(admin);
    const to = address("ajeno");
    expectFail(await inviteToProject(priv.project.id, to), NOT_FOUND);
    assert.equal(await db.user.count({ where: { email: to } }), 0);
    expectFail(await inviteToProject(team.project.id, owner.email), /Ya hay una cuenta con ese email/);
    expectFail(await inviteToProject(team.project.id, "no-es-un-email"), /Email no válido/);
  });

  test("límite de ritmo: 20 invitaciones por hora y administrador", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    delete process.env.MAIL_OUTBOX_DIR;
    try {
      for (let i = 0; i < 20; i++) expectOk(await inviteToProject(f.project.id, address(`ritmo${i}`)));
      const last = address("ritmo-ultima");
      expectFail(await inviteToProject(f.project.id, last), /Demasiados intentos/);
      assert.equal(await db.user.count({ where: { email: last } }), 0);
    } finally {
      process.env.MAIL_OUTBOX_DIR = outbox;
    }
  });
});
