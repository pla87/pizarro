// Invitaciones: idioma de la persona invitada (el de la instalación por defecto, el elegido en «Nuevo usuario» o, con
// «Invitar por email» desde un proyecto, el de quien invita), «Reenviar invitación» para quien aún no ha entrado y la
// marca «Invitación pendiente». Contra PostgreSQL real, con el buzón de pruebas (MAIL_OUTBOX_DIR).
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { flushLogs } from "../../src/lib/log";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, logout, makeProject, makeUser, withSmtpDown } from "./helpers";
import { findUsableToken } from "../../src/lib/auth-token";
import { INSTANCE_LOCALE_KEY, INSTANCE_ORG_KEY, invalidateInstance } from "../../src/lib/instance";
import { getLocale } from "../../src/i18n/server";
import { AUTH_LINK_HEADER } from "../../src/lib/auth-link-path";
import { createSession } from "../../src/lib/session";
import { invitePendingFrom } from "../../src/lib/user-entered";
import { verifyPassword } from "../../src/lib/password";
import { resetPassword } from "../../src/actions/auth";

// El tope de usuarios se lee al cargar el módulo: los demás ficheros ya han creado muchos.
process.env.MAX_USERS = "100000";
const { generateInviteLink, createUser, inviteToProject, resendInvite } = await import("../../src/actions/users");

let outbox = "";
const prevOutbox = process.env.MAIL_OUTBOX_DIR;
before(async () => {
  outbox = await mkdtemp(path.join(tmpdir(), "pz-invite-"));
  process.env.MAIL_OUTBOX_DIR = outbox;
});
after(async () => {
  if (prevOutbox === undefined) delete process.env.MAIL_OUTBOX_DIR;
  else process.env.MAIL_OUTBOX_DIR = prevOutbox;
  await rm(outbox, { recursive: true, force: true });
  await db.appState.deleteMany({ where: { key: { in: [INSTANCE_LOCALE_KEY, INSTANCE_ORG_KEY] } } });
  invalidateInstance();
});

const setInstanceLocale = async (locale: "es" | "en") => {
  await db.appState.upsert({ where: { key: INSTANCE_LOCALE_KEY }, create: { key: INSTANCE_LOCALE_KEY, value: locale }, update: { value: locale } });
  invalidateInstance();
};

/** Emails guardados para `to`, del más antiguo al más reciente. */
async function mailsTo(to: string): Promise<{ subject: string; text: string }[]> {
  const files = (await readdir(outbox)).filter((f) => f.endsWith(".json")).sort();
  const all = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(outbox, f), "utf8")) as { to: string; subject: string; text: string }));
  return all.filter((m) => m.to === to);
}
const tokenOf = (text: string) => /\/reset\/([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";
const email = (tag: string) => `${tag}-${Date.now().toString(36)}@example.com`;

describe("idioma de la persona invitada", () => {
  test("sin elegir, el de la instalación; el email de invitación sale en ese idioma", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    await setInstanceLocale("en");
    const to = email("invitada-en");
    expectOk(await createUser({ name: "Invitada", email: to, role: "MEMBER" }));
    assert.equal((await db.user.findUniqueOrThrow({ where: { email: to } })).locale, "EN");
    const [mail] = await mailsTo(to);
    assert.equal(mail?.subject, "You've been invited to Pizarro");

    await setInstanceLocale("es");
    const to2 = email("invitada-es");
    expectOk(await createUser({ name: "Invitada", email: to2, role: "MEMBER" }));
    assert.equal((await db.user.findUniqueOrThrow({ where: { email: to2 } })).locale, "ES");
    assert.equal((await mailsTo(to2))[0]?.subject, "Te han invitado a Pizarro");
  });

  test("el idioma elegido en «Nuevo usuario» manda sobre el de la instalación", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    await setInstanceLocale("es");
    const to = email("elegido-en");
    expectOk(await createUser({ name: "Elegido", email: to, role: "MEMBER", locale: "EN" }));
    assert.equal((await db.user.findUniqueOrThrow({ where: { email: to } })).locale, "EN");
    assert.equal((await mailsTo(to))[0]?.subject, "You've been invited to Pizarro");
  });
});

describe("«Invitar por email» desde un proyecto: idioma de quien invita", () => {
  const request = (globalThis as unknown as { __pzTestRequest: { headers?: Record<string, string> } }).__pzTestRequest;

  /** Invita con un administrador en `adminLocale` y una instalación en `instance`; devuelve la cuenta, el email y el idioma de /reset. */
  async function inviteAs(adminLocale: "ES" | "EN", instance: "es" | "en") {
    await setInstanceLocale(instance);
    const admin = await makeUser({ role: "ADMIN", name: "Ann Admin" });
    await db.user.update({ where: { id: admin.id }, data: { locale: adminLocale } });
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    const to = email(`proyecto-${adminLocale.toLowerCase()}`);
    const res = expectOk(await inviteToProject(f.project.id, to));
    const user = await db.user.findUniqueOrThrow({ where: { email: to } });
    const [mail] = await mailsTo(to);
    logout();
    request.headers = { [AUTH_LINK_HEADER]: new URL(res.link).pathname };
    try {
      return { user, mail, project: f.project.name, resetLocale: await getLocale() };
    } finally {
      delete request.headers;
    }
  }

  test("la cuenta, el email y la pantalla de elegir contraseña, en el idioma de quien invita (no en el de la instalación)", async () => {
    const en = await inviteAs("EN", "es");
    assert.equal(en.user.locale, "EN");
    assert.equal(en.mail?.subject, `Ann Admin has invited you to the “${en.project}” project in Pizarro`);
    assert.equal(en.resetLocale, "en");

    const es = await inviteAs("ES", "en");
    assert.equal(es.user.locale, "ES");
    assert.equal(es.mail?.subject, `Ann Admin te ha invitado al proyecto «${es.project}» en Pizarro`);
    assert.equal(es.resetLocale, "es");
    await setInstanceLocale("es");
  });

  test("«Reenviar invitación» la manda en ese mismo idioma y devuelve el enlace nuevo (para «Copiar enlace»)", async () => {
    const { user } = await inviteAs("EN", "es");
    const admin = await makeUser({ role: "ADMIN" }); // otro administrador, en español
    await loginAs(admin);
    const res = expectOk(await resendInvite(user.id));
    const mails = await mailsTo(user.email);
    assert.equal(mails.length, 2);
    assert.match(mails[1]!.subject, /has invited you to the/);
    assert.ok(res.link.endsWith(`/reset/${tokenOf(mails[1]!.text)}`), "el enlace devuelto es el del email");
    assert.ok(await findUsableToken(tokenOf(mails[1]!.text), ["INVITE"]));
  });

  test("«Invitación pendiente» hasta que entra por primera vez", async () => {
    const { user } = await inviteAs("ES", "es");
    const pending = () => db.user.findUniqueOrThrow({ where: { id: user.id }, select: { mustChangePassword: true, googleSub: true, _count: { select: { sessions: true, knownDevices: true } } } }).then(invitePendingFrom);
    assert.equal(await pending(), true);
    await createSession(user.id, { mustChangePassword: true });
    assert.equal(await pending(), false, "ya ha entrado");
  });
});

describe("organización en la invitación", () => {
  // Antes la invitación decía solo «Pizarro»: quien la recibía no sabía de qué empresa venía.
  test("con nombre de organización en Ajustes, el asunto y el texto la nombran, en el idioma de la persona", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    await db.appState.upsert({ where: { key: INSTANCE_ORG_KEY }, create: { key: INSTANCE_ORG_KEY, value: "Acme" }, update: { value: "Acme" } });
    invalidateInstance();
    try {
      const es = email("org-es");
      expectOk(await createUser({ name: "Invitada", email: es, role: "MEMBER", locale: "ES" }));
      const [mail] = await mailsTo(es);
      assert.equal(mail?.subject, "Te han invitado al Pizarro de Acme");
      assert.match(mail?.text ?? "", /te ha dado de alta en el Pizarro de Acme\./);
      const en = email("org-en");
      expectOk(await createUser({ name: "Invited", email: en, role: "MEMBER", locale: "EN" }));
      assert.equal((await mailsTo(en))[0]?.subject, "You've been invited to Acme's Pizarro");
    } finally {
      await db.appState.deleteMany({ where: { key: INSTANCE_ORG_KEY } });
      invalidateInstance();
    }
  });
});

describe("Reenviar invitación", () => {
  test("emite un enlace nuevo, el anterior deja de valer y se envía en su idioma", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const to = email("reenvio");
    expectOk(await createUser({ name: "Reenvío", email: to, role: "MEMBER", locale: "EN" }));
    const first = tokenOf((await mailsTo(to))[0]!.text);
    assert.ok(await findUsableToken(first, ["INVITE"]), "la primera invitación vale");

    const user = await db.user.findUniqueOrThrow({ where: { email: to } });
    expectOk(await resendInvite(user.id));
    const mails = await mailsTo(to);
    assert.equal(mails.length, 2);
    assert.equal(mails[1]!.subject, "You've been invited to Pizarro");
    const second = tokenOf(mails[1]!.text);
    assert.notEqual(second, first);
    assert.equal(await findUsableToken(first, ["INVITE"]), null, "el enlace anterior ya no vale");
    assert.ok(await findUsableToken(second, ["INVITE"]), "el nuevo sí");
    assert.equal(await db.authToken.count({ where: { userId: user.id, purpose: "INVITE" } }), 1);
    await flushLogs();
    const log = await db.appLog.findFirst({ where: { action: "users.resendInvite", userId: admin.id }, orderBy: { createdAt: "desc" } });
    assert.match(log?.message ?? "", /Reenvió la invitación a «Reenvío»/);
    assert.doesNotMatch(JSON.stringify(log?.details ?? {}), new RegExp(second), "el token no queda en el registro");
  });

  test("quien ya ha entrado alguna vez, desactivado o sin email: no se reenvía", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const entered = await makeUser();
    await db.user.update({ where: { id: entered.id }, data: { mustChangePassword: true } });
    await db.knownDevice.create({ data: { userId: entered.id, deviceHash: `d-${entered.id}` } });
    expectFail(await resendInvite(entered.id), /ya ha entrado alguna vez/);

    const chosen = await makeUser(); // eligió ya su contraseña (mustChangePassword false)
    expectFail(await resendInvite(chosen.id), /ya ha entrado alguna vez/);

    const off = await makeUser({ active: false });
    await db.user.update({ where: { id: off.id }, data: { mustChangePassword: true } });
    expectFail(await resendInvite(off.id), /desactivada/);

    const pending = await makeUser();
    await db.user.update({ where: { id: pending.id }, data: { mustChangePassword: true } });
    delete process.env.MAIL_OUTBOX_DIR;
    try {
      expectFail(await resendInvite(pending.id), /no está configurado/);
    } finally {
      process.env.MAIL_OUTBOX_DIR = outbox;
    }
    expectOk(await resendInvite(pending.id));
  });

  // Antes, al añadirla a otro proyecto y reenviar desde sus ajustes, la invitación seguía llevando al primero.
  test("desde Ajustes de otro proyecto, la invitación lleva a ese proyecto (si es miembro)", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const a = await makeProject({ members: [] });
    const b = await makeProject({ members: [] });
    const outside = await makeProject({ members: [] });
    await loginAs(admin);
    const to = email("otro-proyecto");
    expectOk(await inviteToProject(a.project.id, to));
    const user = await db.user.findUniqueOrThrow({ where: { email: to } });
    await db.projectMember.create({ data: { projectId: b.project.id, userId: user.id } });
    const projectOf = async () => (await db.authToken.findFirstOrThrow({ where: { userId: user.id, purpose: "INVITE" }, select: { data: true } })).data;

    expectOk(await resendInvite(user.id, b.project.id));
    assert.match((await mailsTo(to)).at(-1)!.subject, new RegExp(`«${b.project.name}»`));
    assert.deepEqual(await projectOf(), { projectId: b.project.id });
    // Un proyecto del que no es miembro no cuenta: sigue con el de la última invitación.
    expectOk(await generateInviteLink(user.id, outside.project.id));
    assert.deepEqual(await projectOf(), { projectId: b.project.id });
    expectOk(await generateInviteLink(user.id, a.project.id));
    assert.deepEqual(await projectOf(), { projectId: a.project.id });
  });

  test("solo administradores", async () => {
    const member = await makeUser();
    const pending = await makeUser();
    await db.user.update({ where: { id: pending.id }, data: { mustChangePassword: true } });
    await loginAs(member);
    expectFail(await resendInvite(pending.id), FORBIDDEN);
  });
});

describe("Generar enlace de invitación nuevo (sin email)", () => {
  test("emite un enlace nuevo al mismo proyecto, el anterior deja de valer, no se envía y no queda en el registro", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    const to = email("enlace-a-mano");
    delete process.env.MAIL_OUTBOX_DIR;
    let first: string;
    let second: string;
    try {
      const invited = expectOk(await inviteToProject(f.project.id, to));
      assert.equal(invited.emailed, false);
      first = tokenOf(invited.link);
      const user = await db.user.findUniqueOrThrow({ where: { email: to } });
      const res = expectOk(await generateInviteLink(user.id));
      second = tokenOf(res.link);
    } finally {
      process.env.MAIL_OUTBOX_DIR = outbox;
    }
    assert.notEqual(second, first);
    assert.equal(await findUsableToken(first, ["INVITE"]), null, "el enlace anterior ya no vale");
    const fresh = await findUsableToken(second, ["INVITE"]);
    assert.ok(fresh, "el nuevo sí");
    assert.match(JSON.stringify(fresh.data ?? {}), new RegExp(f.project.id), "lleva al mismo proyecto");
    assert.equal((await mailsTo(to)).length, 0, "no se envía nada");
    await flushLogs();
    const log = await db.appLog.findFirst({ where: { action: "users.generateInviteLink", userId: admin.id }, orderBy: { createdAt: "desc" } });
    assert.match(log?.message ?? "", /Generó un enlace de invitación nuevo para «.+» \(sin enviarlo/);
    assert.doesNotMatch(JSON.stringify(log ?? {}), new RegExp(second), "el token no queda en el registro");
  });

  test("solo administradores y solo para quien aún no ha entrado (y está activo)", async () => {
    const member = await makeUser();
    const pending = await makeUser();
    await db.user.update({ where: { id: pending.id }, data: { mustChangePassword: true } });
    await loginAs(member);
    expectFail(await generateInviteLink(pending.id), FORBIDDEN);
    assert.equal(await db.authToken.count({ where: { userId: pending.id, purpose: "INVITE" } }), 0);

    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const chosen = await makeUser();
    expectFail(await generateInviteLink(chosen.id), /ya ha entrado alguna vez/);
    const off = await makeUser({ active: false });
    await db.user.update({ where: { id: off.id }, data: { mustChangePassword: true } });
    expectFail(await generateInviteLink(off.id), /desactivada/);
    expectOk(await generateInviteLink(pending.id));
    assert.equal(await db.authToken.count({ where: { userId: pending.id, purpose: "INVITE" } }), 1);
  });
});

describe("«Nuevo usuario» siempre como invitación", () => {
  // Antes, sin email, el administrador escribía una contraseña inicial (y la conocía); además, «Generar enlace de
  // invitación nuevo» no la anulaba, así que la persona acababa con dos formas de entrar.
  test("sin email: no pide contraseña, devuelve el enlace de invitación y la contraseña provisional no la conoce nadie", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const to = email("sin-email");
    delete process.env.MAIL_OUTBOX_DIR;
    let res: { emailed: boolean; mailFailed: boolean; link: string | null };
    try {
      // Una contraseña colada en la petición se descarta (el esquema ya no la tiene).
      res = expectOk(await createUser({ name: "Sin email", email: to, role: "MEMBER", password: "una-clave-larga-1" } as never));
    } finally {
      process.env.MAIL_OUTBOX_DIR = outbox;
    }
    assert.equal(res.emailed, false);
    assert.equal(res.mailFailed, false);
    const token = tokenOf(res.link ?? "");
    assert.ok(await findUsableToken(token, ["INVITE"]), "el enlace devuelto es una invitación válida");
    const user = await db.user.findUniqueOrThrow({ where: { email: to } });
    assert.equal(user.mustChangePassword, true);
    assert.equal(await verifyPassword("una-clave-larga-1", user.passwordHash), false);
    assert.equal((await mailsTo(to)).length, 0);
    await flushLogs();
    const log = await db.appLog.findFirst({ where: { action: "users.createUser", userId: admin.id }, orderBy: { createdAt: "desc" } });
    assert.doesNotMatch(JSON.stringify(log ?? {}), new RegExp(token), "el token no queda en el registro");
    // Con el enlace elige su contraseña.
    logout();
    expectOk(await resetPassword(token, "la-que-elige-ella-1"));
    assert.equal(await verifyPassword("la-que-elige-ella-1", (await db.user.findUniqueOrThrow({ where: { email: to } })).passwordHash), true);
  });

  test("con email: se envía y no se devuelve el enlace", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const to = email("con-email");
    const res = expectOk(await createUser({ name: "Con email", email: to, role: "MEMBER" }));
    assert.deepEqual([res.emailed, res.mailFailed, res.link], [true, false, null]);
    assert.equal((await mailsTo(to)).length, 1);
  });

  // Antes la acción respondía con error con la cuenta ya creada: el diálogo seguía abierto, al reintentar salía «Ya existe
  // un usuario con ese email» y el enlace no lo veía nadie.
  test("con el SMTP caído: la cuenta queda creada y se devuelve el enlace para pasarlo a mano", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const to = email("smtp-caido");
    const res = expectOk(await withSmtpDown(() => createUser({ name: "SMTP caído", email: to, role: "MEMBER" })));
    assert.equal(res.emailed, false);
    assert.equal(res.mailFailed, true);
    assert.ok(await findUsableToken(tokenOf(res.link ?? ""), ["INVITE"]));
    assert.equal(await db.user.count({ where: { email: to } }), 1);
  });

  // Antes «Reenviar invitación» lanzaba con el enlace anterior ya borrado: la persona se quedaba sin ninguno válido.
  test("«Reenviar invitación» con el SMTP caído devuelve el enlace nuevo (el anterior ya no vale)", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const to = email("reenvio-caido");
    expectOk(await createUser({ name: "Reenvío caído", email: to, role: "MEMBER" }));
    const first = tokenOf((await mailsTo(to))[0]!.text);
    const user = await db.user.findUniqueOrThrow({ where: { email: to } });
    const res = expectOk(await withSmtpDown(() => resendInvite(user.id)));
    assert.equal(res.mailFailed, true);
    assert.equal(await findUsableToken(first, ["INVITE"]), null);
    assert.ok(await findUsableToken(tokenOf(res.link), ["INVITE"]), "el enlace devuelto vale");
  });
});

describe("avisos por email de las cuentas nuevas", () => {
  test("traen marcada de serie la casilla de fechas límite y «Esperando»; las demás, como antes", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const to = email("serie");
    expectOk(await createUser({ name: "De serie", email: to, role: "MEMBER" }));
    const f = await makeProject({ members: [] });
    const invited = email("serie-proyecto");
    expectOk(await inviteToProject(f.project.id, invited));
    const prefs = { notifyEmail: true, notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true, dailyDigest: true };
    const select = Object.fromEntries(Object.keys(prefs).map((k) => [k, true])) as Record<keyof typeof prefs, true>;
    for (const address of [to, invited]) {
      assert.deepEqual(await db.user.findUniqueOrThrow({ where: { email: address }, select }), {
        notifyEmail: true, notifyAssignedEmail: false, notifyDueEmail: true, notifyCommentEmail: false, dailyDigest: false,
      }, address);
    }
  });
});
