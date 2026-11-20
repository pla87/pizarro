import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

type Map = { always: string[]; all: string[]; common: { suites: string[]; files: string[] }; suites: Record<string, string[]> };
type Mod = {
  globToRegExp: (glob: string) => RegExp;
  selectSuites: (files: string[], map: Map) => { suites: string[] };
  loadMap: () => Map;
  mapProblems: (map: Map) => { missing: string[]; extra: string[] };
};
const { globToRegExp, selectSuites, loadMap, mapProblems } = (await import(new URL("../scripts/e2e-affected.mjs", import.meta.url).href)) as Mod;
const map = loadMap();
const pick = (...files: string[]) => selectSuites(files, map).suites;

test("e2e/suites.json: cada suite de e2e/ tiene su entrada y cada entrada su fichero", () => {
  assert.deepEqual(mapProblems(map), { missing: [], extra: [] });
  for (const [s, globs] of Object.entries(map.suites)) {
    assert.ok(globs.length > 0, s);
    for (const g of globs) assert.ok(globToRegExp(g) instanceof RegExp, `${s}: ${g}`);
  }
});

test("patrones: ** cruza carpetas, * no, y los corchetes y paréntesis de Next son literales", () => {
  assert.ok(globToRegExp("src/i18n/**").test("src/i18n/en/board.ts"));
  assert.ok(globToRegExp("src/app/(app)/**/loading.tsx").test("src/app/(app)/loading.tsx"));
  assert.ok(globToRegExp("src/app/(app)/**/loading.tsx").test("src/app/(app)/p/[projectId]/loading.tsx"));
  assert.ok(globToRegExp("src/app/(app)/p/[projectId]/*").test("src/app/(app)/p/[projectId]/page.tsx"));
  assert.ok(!globToRegExp("src/app/(app)/p/[projectId]/*").test("src/app/(app)/p/[projectId]/docs/page.tsx"));
  assert.ok(!globToRegExp("src/app/(app)/p/[projectId]/*").test("src/app/(app)/p/x/page.tsx"));
  assert.ok(globToRegExp("src/lib/task-json*.ts").test("src/lib/task-json-resolve.ts"));
  assert.ok(globToRegExp("src/app/icon.{png,svg}").test("src/app/icon.svg"));
});

test("selección: la QA siempre; comunes → tablero; cada fichero, sus suites; de fuera de la app, solo la QA", () => {
  assert.deepEqual(pick("docs/HANDOFF.md"), ["qa"]);
  assert.deepEqual(pick("src/app/globals.css"), ["qa", "board-e2e"]);
  assert.deepEqual(pick("src/lib/action.ts"), ["qa", "board-e2e"]);
  assert.deepEqual(pick("src/lib/un-modulo-nuevo.ts"), ["qa", "board-e2e"], "sin mapa cuenta como común");
  assert.deepEqual(pick("e2e/tablero-fijas-e2e.mjs"), ["qa", "tablero-fijas-e2e"]);
  assert.ok(pick("src/components/board/EvergreenPanel.tsx").includes("tablero-fijas-e2e"));
  assert.ok(pick("src/lib/foreign-import/tasks.ts").includes("importar-exportar-e2e"));
  assert.ok(pick("src/app/(app)/p/[projectId]/docs/DocsManager.tsx").includes("documentacion-enlaces-e2e"));
  const all = pick("package-lock.json");
  assert.equal(all.length, Object.keys(map.suites).length + map.always.length);
  assert.equal(all[0], "qa");
  assert.equal(all.at(-1), "install-e2e", "la instalación, al final");
});

test("e2e/suites.json: cada patrón coincide con algún fichero del repositorio (sin rutas viejas ni erratas)", (t) => {
  let files: string[];
  try {
    files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n");
  } catch {
    return t.skip("sin git");
  }
  const globs = new Set([...map.all, ...map.common.files, ...Object.values(map.suites).flat()]);
  const stale = [...globs].filter((g) => { const r = globToRegExp(g); return !files.some((f) => r.test(f)); });
  assert.deepEqual(stale, []);
});
