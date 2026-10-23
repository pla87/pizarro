import assert from "node:assert/strict";
import { test } from "node:test";
import { maskEmail, maskEmailsIn } from "../src/lib/mask-email";

test("maskEmail deja la primera letra y el dominio", () => {
  assert.equal(maskEmail("paco@example.com"), "p***@example.com");
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
  assert.equal(maskEmailsIn("Recipient rejected: <paco@example.com>, retry"), "Recipient rejected: <p***@example.com>, retry");
  assert.equal(maskEmailsIn("a@x.com y b@y.org"), "a***@x.com y b***@y.org");
  assert.equal(maskEmailsIn("sin direcciones"), "sin direcciones");
});
