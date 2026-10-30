// Envío de emails configurado por un administrador: guardado cifrado, precedencia de SMTP_*, email de prueba.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, makeUser } from "./helpers";
import { saveMailSettings, sendMailTest } from "../../src/actions/mail-settings";
import { decryptSecret } from "../../src/lib/crypto";
import { flushLogs } from "../../src/lib/log";
import { emailEnabled } from "../../src/lib/mail";
import { getMailSettingsView, refreshMailConfig, loadMailConfig } from "../../src/lib/mail-config";

const form = { host: "smtp.example.com", port: 465, secure: true, user: "buzon@example.com", fromName: "Pizarro", fromAddress: "pizarro@example.com" };
const savedPass = async () => (await db.appState.findUnique({ where: { key: "mail.passEnc" } }))?.value ?? null;
const ENV_KEYS = ["SMTP_HOST", "SMTP_FROM", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_OUTBOX_DIR"] as const;

async function clean() {
  for (const k of ENV_KEYS) process.env[k] = "";
  await db.appState.deleteMany({ where: { key: { startsWith: "mail." } } });
  await refreshMailConfig();
}
afterEach(clean);

async function admin() {
  const a = await makeUser({ role: "ADMIN" });
  await loginAs(a);
  return a;
}

describe("ajustes de email", () => {
  test("solo administradores", async () => {
    await clean();
    await loginAs(await makeUser());
    expectFail(await saveMailSettings({ ...form, password: "x" }), FORBIDDEN);
    expectFail(await sendMailTest(), FORBIDDEN);
    assert.equal(emailEnabled(), false);
  });

  test("guarda cifrada la contraseña, no la devuelve y activa emailEnabled", async () => {
    await clean();
    await admin();
    assert.equal(emailEnabled(), false);
    const res = expectOk(await saveMailSettings({ ...form, password: "clave-secreta-123" }));
    assert.equal(JSON.stringify(res).includes("clave-secreta-123"), false);
    assert.equal(res.settings.hasPassword, true);
    const stored = await savedPass();
    assert.ok(stored && stored.startsWith("v2.") && !stored.includes("clave-secreta-123"));
    assert.equal(decryptSecret(stored), "clave-secreta-123");
    const view = await getMailSettingsView(false);
    assert.equal(JSON.stringify(view).includes("clave-secreta-123"), false);
    assert.equal(view.settings.host, "smtp.example.com");
    assert.equal(view.env, null);
    assert.equal(emailEnabled(), true);
    const cfg = await loadMailConfig();
    assert.equal(cfg.source, "db");
    assert.equal(cfg.pass, "clave-secreta-123");
    assert.equal(cfg.from, '"Pizarro" <pizarro@example.com>');
    // El registro de auditoría lleva el cambio pero nunca la contraseña.
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { action: "settings.saveMail" }, select: { message: true, details: true } });
    assert.ok(logs.length >= 1);
    assert.equal(JSON.stringify(logs).includes("clave-secreta-123"), false);
    assert.match(JSON.stringify(logs), /"authChange":"set"/);
  });

  test("contraseña vacía conserva la guardada; reemplazar y quitar", async () => {
    await clean();
    await admin();
    expectOk(await saveMailSettings({ ...form, password: "primera" }));
    expectOk(await saveMailSettings({ ...form, port: 587, secure: false, password: "" }));
    assert.equal(decryptSecret((await savedPass())!), "primera");
    const cfg = await loadMailConfig();
    assert.equal(cfg.port, 587);
    assert.equal(cfg.secure, false);
    assert.equal(cfg.requireTLS, true);
    expectOk(await saveMailSettings({ ...form, password: "segunda" }));
    assert.equal(decryptSecret((await savedPass())!), "segunda");
    const cleared = expectOk(await saveMailSettings({ ...form, clearPassword: true }));
    assert.equal(cleared.settings.hasPassword, false);
    assert.equal(await savedPass(), null);
  });

  test("valida los datos y host vacío desactiva el envío", async () => {
    await clean();
    await admin();
    expectFail(await saveMailSettings({ ...form, host: "no valido!" }), /servidor SMTP/);
    expectFail(await saveMailSettings({ ...form, port: 70000 }), /puerto/);
    expectFail(await saveMailSettings({ ...form, fromAddress: "sin-arroba" }), /remitente/);
    expectOk(await saveMailSettings({ ...form, password: "x1234" }));
    assert.equal(emailEnabled(), true);
    expectOk(await saveMailSettings({ ...form, host: "" }));
    assert.equal(emailEnabled(), false);
    assert.equal(await savedPass(), null);
  });

  test("las variables SMTP_* del servidor mandan y la pantalla es de solo lectura", async () => {
    await clean();
    await admin();
    expectOk(await saveMailSettings({ ...form, password: "de-la-bd" }));
    process.env.SMTP_HOST = "smtp.servidor.example";
    process.env.SMTP_FROM = "Servidor <no-reply@example.com>";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_PASS = "de-entorno";
    const cfg = await loadMailConfig();
    assert.equal(cfg.source, "env");
    assert.equal(cfg.host, "smtp.servidor.example");
    assert.equal(cfg.pass, "de-entorno");
    assert.equal(emailEnabled(), true);
    const view = await getMailSettingsView(false);
    assert.equal(view.env?.host, "smtp.servidor.example");
    assert.equal(JSON.stringify(view).includes("de-entorno"), false);
    expectFail(await saveMailSettings({ ...form }), /configurado en el servidor/);
    // Sin variables vuelve a mandar lo guardado.
    process.env.SMTP_HOST = "";
    process.env.SMTP_FROM = "";
    assert.equal((await loadMailConfig()).source, "db");
  });

  test("email de prueba al propio administrador con el buzón de pruebas", async () => {
    await clean();
    const dir = await mkdtemp(join(tmpdir(), "pz-mail-"));
    try {
      const a = await admin();
      expectOk(await saveMailSettings({ ...form, password: "x1234" }));
      process.env.MAIL_OUTBOX_DIR = dir;
      const res = expectOk(await sendMailTest());
      assert.equal(res.to, a.email);
      const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
      assert.equal(files.length, 1);
      const mail = JSON.parse(await readFile(join(dir, files[0]!), "utf8"));
      assert.equal(mail.to, a.email);
      assert.equal(mail.from, '"Pizarro" <pizarro@example.com>');
      assert.match(mail.subject, /Pizarro/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("si el servidor SMTP falla, el error se muestra sin contraseña ni usuario", async () => {
    await clean();
    await admin();
    // Puerto cerrado: la conexión se rechaza al instante.
    expectOk(await saveMailSettings({ ...form, host: "127.0.0.1", port: 1, secure: false, user: "usuario-secreto", password: "clave-secreta-123" }));
    const error = expectFail(await sendMailTest(), /No se pudo enviar el email de prueba/);
    assert.equal(error.includes("clave-secreta-123"), false);
    assert.equal(error.includes("usuario-secreto"), false);
    assert.ok(error.length < 450);
  });
});
