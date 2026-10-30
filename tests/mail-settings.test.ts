import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  envMailConfig, formatFrom, GMAIL_PRESET, parseMailSettings, resolveMailConfig, sanitizeSmtpError, validateMailSettings, EMPTY_MAIL_SETTINGS,
} from "../src/lib/mail-settings-core";

const saved = { ...EMPTY_MAIL_SETTINGS, host: "smtp.example.com", port: 587, secure: false, user: "u@example.com", fromName: "Pizarro", fromAddress: "p@example.com", hasPassword: true };

describe("ajustes de email (parte pura)", () => {
  test("preajuste de Gmail", () => {
    assert.deepEqual({ ...GMAIL_PRESET }, { host: "smtp.gmail.com", port: 465, secure: true });
  });

  test("precedencia: SMTP_* del servidor gana a lo guardado", () => {
    const env = { SMTP_HOST: "smtp.srv.example", SMTP_FROM: "a@example.com", SMTP_PORT: "465", SMTP_PASS: "e" };
    assert.equal(envMailConfig({ SMTP_HOST: "x" }), null);
    const cfg = resolveMailConfig(env, saved, "bd");
    assert.equal(cfg.source, "env");
    assert.equal(cfg.host, "smtp.srv.example");
    assert.equal(cfg.pass, "e");
    assert.equal(cfg.secure, true);
    const db = resolveMailConfig({}, saved, "bd");
    assert.equal(db.source, "db");
    assert.equal(db.pass, "bd");
    assert.equal(db.requireTLS, true);
    assert.equal(db.from, '"Pizarro" <p@example.com>');
    assert.equal(resolveMailConfig({}, EMPTY_MAIL_SETTINGS, "").source, "none");
  });

  test("lee los ajustes guardados con valores por defecto sensatos", () => {
    const s = parseMailSettings([{ key: "mail.host", value: " smtp.example.com " }, { key: "mail.port", value: "abc" }, { key: "mail.passEnc", value: "v2.x" }]);
    assert.equal(s.host, "smtp.example.com");
    assert.equal(s.port, 465);
    assert.equal(s.secure, true);
    assert.equal(s.hasPassword, true);
  });

  test("el nombre del remitente no puede inyectar cabeceras", () => {
    assert.equal(formatFrom('Evil"\r\nBcc: x@example.com <', "p@example.com"), '"Evil Bcc: x@example.com" <p@example.com>');
    assert.equal(formatFrom("", "p@example.com"), "p@example.com");
  });

  test("validación", () => {
    const ok = { host: "smtp.example.com", port: 465, secure: true, user: "", fromName: "", fromAddress: "p@example.com" };
    assert.equal(validateMailSettings(ok).ok, true);
    assert.equal(validateMailSettings({ ...ok, host: "a b" }).ok, false);
    assert.equal(validateMailSettings({ ...ok, port: 0 }).ok, false);
    assert.equal(validateMailSettings({ ...ok, fromAddress: "x" }).ok, false);
    assert.deepEqual(validateMailSettings({ ...ok, host: "" }), { ok: true, value: { host: "", port: 465, secure: true, user: "", fromName: "", fromAddress: "", mode: "gmail" } });
  });

  test("el error de SMTP se limpia: sin secretos, una línea y acotado", () => {
    const msg = sanitizeSmtpError(Object.assign(new Error("Invalid login: clave-123\nfor usuario-x"), { response: "535 5.7.8 clave-123" }), ["clave-123", "usuario-x"]);
    assert.equal(msg.includes("clave-123"), false);
    assert.equal(msg.includes("usuario-x"), false);
    assert.equal(msg.includes("\n"), false);
    assert.ok(sanitizeSmtpError(new Error("x".repeat(1000))).length <= 301);
  });
});
