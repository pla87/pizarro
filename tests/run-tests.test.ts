// `npm test` (scripts/run-tests.mjs): las mismas pruebas de siempre, sin --max-old-space-size en NODE_OPTIONS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// @ts-expect-error: script .mjs sin tipos
import { TEST_ARGS, withoutHeapFlag } from "../scripts/run-tests.mjs";

test("quita --max-old-space-size de NODE_OPTIONS (en todas sus formas) y conserva lo demás", () => {
  const strip = withoutHeapFlag as (v: string | undefined) => string | undefined;
  assert.equal(strip("--use-openssl-ca --max-old-space-size=8192"), "--use-openssl-ca");
  assert.equal(strip("--max_old_space_size=640 --use-openssl-ca"), "--use-openssl-ca");
  assert.equal(strip("--max-old-space-size 4096 --enable-source-maps"), "--enable-source-maps");
  assert.equal(strip("--max-old-space-size=8192"), undefined);
  assert.equal(strip("  --use-openssl-ca   --trace-warnings "), "--use-openssl-ca --trace-warnings");
  // Otros flags de memoria no se tocan (no anulan el resourceLimits del worker de PDF).
  assert.equal(strip("--max-semi-space-size=16"), "--max-semi-space-size=16");
  assert.equal(strip(""), "");
  assert.equal(strip(undefined), undefined);
});

test("npm test lanza el envoltorio, con las mismas opciones de antes y sin shell (también en Windows)", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts.test, "node scripts/run-tests.mjs");
  assert.deepEqual(TEST_ARGS, ["--conditions=react-server", "--import", "tsx", "--test", "--test-timeout=120000", "tests/*.test.ts"]);
  const src = readFileSync("scripts/run-tests.mjs", "utf8");
  assert.match(src, /spawn\(process\.execPath,/);
  assert.doesNotMatch(src, /shell:\s*true/);
  // Sin --test-force-exit (GUARDAS, «Pruebas y código sin uso»).
  assert.doesNotMatch(src, /--test-force-exit/);
});
