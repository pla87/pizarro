import assert from "node:assert/strict";
import { test } from "node:test";
import { logMailError, maskEmail, maskEmailsIn } from "../src/lib/mask-email";

test("maskEmail deja la primera letra y el dominio", () => {
  assert.equal(maskEmail("ana@example.com"), "a***@example.com");
  assert.equal(maskEmail("  Ana.Lopez@mail.example.org "), "A***@mail.example.org");
});

test("maskEmail: vacío, sin @, una letra y parte local vacía", () => {
  assert.equal(maskEmail(""), "");
  assert.equal(maskEmail(null), "");
  assert.equal(maskEmail(undefined), "");
  assert.equal(maskEmail("sin-arroba"), "***");
  assert.equal(maskEmail("a@example.com"), "a***@example.com");
  assert.equal(maskEmail("@example.com"), "***@example.com");
  // Con varias @ manda la última (el dominio).
  assert.equal(maskEmail("a@b@example.com"), "a***@example.com");
});

test("maskEmailsIn enmascara direcciones dentro de un texto", () => {
  assert.equal(maskEmailsIn("Recipient rejected: <ana@example.com>, retry"), "Recipient rejected: <a***@example.com>, retry");
  assert.equal(maskEmailsIn("a@x.com y b@y.org"), "a***@x.com y b***@y.org");
  assert.equal(maskEmailsIn("sin direcciones"), "sin direcciones");
});

test("logMailError registra el error de nodemailer sin las direcciones", (t) => {
  const lines: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => void lines.push(args));
  const err = Object.assign(new Error("Can't send mail - all recipients were rejected: 550 <ana@example.com> unknown"), {
    code: "EENVELOPE",
    response: "550 5.1.1 <ana@example.com>: user unknown (from bob@example.org)",
  });
  logMailError("[users] invitación", err);
  logMailError("[x]", "texto suelto con carla@example.net");
  const out = JSON.stringify(lines);
  assert.ok(!/ana@|bob@|carla@/.test(out), out);
  assert.match(String(lines[0]![1]), /a\*\*\*@example\.com.*b\*\*\*@example\.org.*\(EENVELOPE\)/);
  assert.equal(lines[0]![0], "[users] invitación");
  assert.equal(lines[1]![1], "texto suelto con c***@example.net");
});
