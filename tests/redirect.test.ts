import assert from "node:assert/strict";
import { test } from "node:test";
import { safeNextPath } from "../src/lib/redirect";

test("permite rutas internas", () => {
  assert.equal(safeNextPath("/p/abc?task=1"), "/p/abc?task=1");
  assert.equal(safeNextPath("/settings"), "/settings");
});

test("bloquea redirecciones externas", () => {
  for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "evil", "", "javascript:alert(1)"]) {
    assert.equal(safeNextPath(bad), "/", JSON.stringify(bad));
  }
});
