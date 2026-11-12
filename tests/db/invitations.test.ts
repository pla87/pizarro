// Invitaciones: idioma de la persona invitada (el de la instalación por defecto, o el elegido en «Nuevo usuario») y
// «Reenviar invitación» para quien aún no ha entrado. Contra PostgreSQL real, con el buzón de pruebas (MAIL_OUTBOX_DIR).
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { flushLogs } from "../../src/lib/log";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, makeUser } from "./helpers";
import { findUsableToken } from "../../src/lib/auth-token";
import { INSTANCE_LOCALE_KEY, invalidateInstance } from "../../src/lib/instance";

// El tope de usuarios se lee al cargar el módulo: los demás ficheros ya han creado muchos.
process.env.MAX_USERS = "100000";
const { createUser, resendInvite } = await import("../../src/actions/users");

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
  await db.appState.deleteMany({ where: { key: INSTANCE_LOCALE_KEY } });
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

  test("solo administradores", async () => {
    const member = await makeUser();
    const pending = await makeUser();
    await db.user.update({ where: { id: pending.id }, data: { mustChangePassword: true } });
    await loginAs(member);
    expectFail(await resendInvite(pending.id), FORBIDDEN);
  });
});
