import assert from "node:assert/strict";
import { test } from "node:test";
import { linkUrl, email, id } from "../src/lib/validation";
import { newFileId } from "../src/lib/uploads";

test("solo admite enlaces http(s)", () => {
  assert.equal(linkUrl.parse("https://github.com/org/repo/pull/1"), "https://github.com/org/repo/pull/1");
  assert.equal(linkUrl.parse("  "), null);
  assert.equal(linkUrl.parse(null), null);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x", "https://a b"]) {
    assert.equal(linkUrl.safeParse(bad).success, false, bad);
  }
});

test("normaliza emails", () => {
  assert.equal(email.parse("  Admin@Example.COM "), "admin@example.com");
  assert.equal(email.safeParse("no-es-email").success, false);
});

test("ids: cuid, newFileId y los de las pruebas; nada de caracteres que PostgreSQL rechaza", () => {
  for (const good of ["cmhx1q2w30000abcd1234efgh", newFileId(), "no-existe", "a_b-C9", "x".repeat(40)]) {
    assert.equal(id.parse(good), good, good);
  }
  for (const bad of ["", "x".repeat(41), "abc\u0000def", "\u0000", "a b", "a/b", "a.b", "ñ", "a😀"]) {
    const r = id.safeParse(bad);
    assert.equal(r.success, false, JSON.stringify(bad));
    assert.equal(r.error?.issues[0]?.message, "No encontrado o sin acceso.");
  }
});
