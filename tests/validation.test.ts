import assert from "node:assert/strict";
import { test } from "node:test";
import { linkUrl, email } from "../src/lib/validation";

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
