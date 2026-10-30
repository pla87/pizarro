import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { detectMailPreset, MAIL_PRESETS, parseMailSettings } from "../src/lib/mail-settings-core";

describe("preajustes de proveedores de correo", () => {
  test("detecta el proveedor por servidor y puerto (SES con cualquier región)", () => {
    assert.equal(detectMailPreset("smtp.sendgrid.net", 587)?.user, "apikey");
    assert.equal(detectMailPreset("email-smtp.us-east-1.amazonaws.com", 587)?.id, "ses");
    assert.equal(detectMailPreset("smtp-relay.gmail.com", 587)?.id, "workspace-relay");
    assert.equal(detectMailPreset("smtp.example.com", 587), null);
    assert.ok(MAIL_PRESETS.every((p) => p.hint && p.host && p.port));
  });

  test("el modo se deduce del servidor si no se guardó", () => {
    assert.equal(parseMailSettings([{ key: "mail.host", value: "smtp.gmail.com" }]).mode, "gmail");
    assert.equal(parseMailSettings([{ key: "mail.host", value: "smtp.brevo.example" }]).mode, "company");
    assert.equal(parseMailSettings([{ key: "mail.host", value: "smtp.gmail.com" }, { key: "mail.mode", value: "company" }]).mode, "company");
  });
});
