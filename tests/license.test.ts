// LICENSE.md (fuente) y src/lib/license-text.ts (generado para la página /licencia) no deben desincronizarse.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { LICENSE_EN, LICENSE_ES } from "../src/lib/license-text";

const md = readFileSync(new URL("../LICENSE.md", import.meta.url), "utf8").replace(/\r\n/g, "\n").trimEnd();

describe("licencia", () => {
  test("el módulo coincide con LICENSE.md (si falla: npm run license:sync)", () => {
    assert.equal(md, `${LICENSE_ES}\n\n---\n\n${LICENSE_EN}`);
  });
  test("contiene lo esencial en los dos idiomas y ningún dato personal", () => {
    assert.match(LICENSE_ES, /^# Licencia de Pizarro/);
    assert.match(LICENSE_EN, /^# Pizarro License/);
    assert.match(LICENSE_ES, /En resumen/);
    assert.match(LICENSE_EN, /Spanish version prevails/);
    assert.match(LICENSE_ES, /una sola vez por cada instalación/);
    assert.match(LICENSE_ES, /propiedad intelectual/);
    assert.doesNotMatch(md, /@|https?:\/\//);
  });
});
