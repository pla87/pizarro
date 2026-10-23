import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SESSION_SECRET = "x".repeat(48);

const { issueBackupDownloadToken, consumeBackupDownloadToken } = await import("../src/lib/backup-download");

test("token de descarga: un solo uso", () => {
  const token = issueBackupDownloadToken("u1");
  assert.equal(consumeBackupDownloadToken(token, "u1"), true);
  assert.equal(consumeBackupDownloadToken(token, "u1"), false);
});

test("token de descarga: ligado a la persona y sin token no hay acceso", () => {
  const token = issueBackupDownloadToken("u1");
  assert.equal(consumeBackupDownloadToken(token, "u2"), false);
  assert.equal(consumeBackupDownloadToken(token, "u1"), false, "un intento ajeno también lo gasta");
  assert.equal(consumeBackupDownloadToken("inventado", "u1"), false);
});

test("token de descarga: caduca a los 60 s", (t) => {
  const real = Date.now;
  const now = real();
  t.after(() => (Date.now = real));
  const token = issueBackupDownloadToken("u1");
  Date.now = () => now + 61_000;
  assert.equal(consumeBackupDownloadToken(token, "u1"), false);
});
