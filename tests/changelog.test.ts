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

test("Historial de versiones: anclas #v1.2.3, orden SemVer y la lista del navegador sin zod", async () => {
  const { compareVersionsDesc, versionAnchor, versionFromHash } = await import("../src/lib/changelog-core");
  assert.equal(versionAnchor("1.68.0"), "v1.68.0");
  assert.equal(versionFromHash("#v1.2.3"), "1.2.3");
  assert.equal(versionFromHash("v10.0.12"), "10.0.12");
  for (const bad of ["", "#", "#v1.2", "#1.2.3", "#v1.2.3x", "#nuevas"]) assert.equal(versionFromHash(bad), null, bad);
  assert.deepEqual(["1.9.0", "1.10.0", "1.10.2", "0.99.9"].sort(compareVersionsDesc), ["1.10.2", "1.10.0", "1.9.0", "0.99.9"]);
  // El componente cliente solo importa lo que no lleva zod (changelog.ts valida changelog.json en el servidor).
  const list = readFileSync("src/app/(app)/changelog/ChangelogList.tsx", "utf8");
  assert.doesNotMatch(list, /from "@\/lib\/changelog"|from "zod"/);
  assert.doesNotMatch(readFileSync("src/lib/changelog-core.ts", "utf8"), /^import /m);
});
