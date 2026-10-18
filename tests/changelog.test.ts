import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import pkg from "../package.json" with { type: "json" };
import { changelogSchema } from "../src/lib/changelog";

test("changelog.json es válido y contiene la versión actual", () => {
  const data = changelogSchema.parse(JSON.parse(readFileSync("changelog.json", "utf8")));
  assert.ok(data.versions.some((v) => v.version === pkg.version), `falta ${pkg.version} en changelog.json`);
  const versions = data.versions.map((v) => v.version);
  assert.equal(new Set(versions).size, versions.length, "versiones duplicadas");
});
