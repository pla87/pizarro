import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BUG_REPORT_TEMPLATE, buildCommit, bugReportFields, bugReportUrl, describeBrowser, formatTechInfo, officialBuild,
} from "../src/lib/bug-report-core";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("build oficial: imagen del workflow Release con la misma versión y un commit", () => {
  assert.equal(officialBuild({ OFFICIAL_BUILD: "1", RELEASE_VERSION: "1.49.0", GIT_SHA: SHA }, "1.49.0"), "docker");
  assert.equal(officialBuild({ OFFICIAL_BUILD: "1", RELEASE_VERSION: "v1.49.0", GIT_SHA: SHA }, "1.49.0"), "docker");
  // Versión distinta de package.json (código cambiado tras etiquetar), sin commit, sin la marca o preversión: no.
  assert.equal(officialBuild({ OFFICIAL_BUILD: "1", RELEASE_VERSION: "1.48.0", GIT_SHA: SHA }, "1.49.0"), null);
  assert.equal(officialBuild({ OFFICIAL_BUILD: "1", RELEASE_VERSION: "1.49.0" }, "1.49.0"), null);
  assert.equal(officialBuild({ RELEASE_VERSION: "1.49.0", GIT_SHA: SHA }, "1.49.0"), null);
  assert.equal(officialBuild({ OFFICIAL_BUILD: "true", RELEASE_VERSION: "1.49.0", GIT_SHA: SHA }, "1.49.0"), null);
  assert.equal(officialBuild({ OFFICIAL_BUILD: "1", RELEASE_VERSION: "1.49.0-rc.1", GIT_SHA: SHA }, "1.49.0-rc.1"), null);
  assert.equal(officialBuild({}, "1.49.0"), null);
});

test("build oficial: Railway solo desde la rama stable del repositorio oficial", () => {
  const base = { RAILWAY_GIT_COMMIT_SHA: SHA, RAILWAY_GIT_REPO_OWNER: "pla87", RAILWAY_GIT_REPO_NAME: "pizarro" };
  assert.equal(officialBuild({ ...base, RAILWAY_GIT_BRANCH: "stable" }, "1.49.0"), "railway");
  assert.equal(officialBuild({ ...base, RAILWAY_GIT_REPO_OWNER: "PLA87", RAILWAY_GIT_BRANCH: "stable" }, "1.49.0"), "railway");
  // main (commits sueltos), un fork u otra rama: no.
  assert.equal(officialBuild({ ...base, RAILWAY_GIT_BRANCH: "main" }, "1.49.0"), null);
  assert.equal(officialBuild({ ...base, RAILWAY_GIT_REPO_OWNER: "otra-persona", RAILWAY_GIT_BRANCH: "stable" }, "1.49.0"), null);
  assert.equal(officialBuild({ ...base, RAILWAY_GIT_REPO_NAME: "pizarro-fork", RAILWAY_GIT_BRANCH: "stable" }, "1.49.0"), null);
  assert.equal(officialBuild({ ...base, RAILWAY_GIT_COMMIT_SHA: "", RAILWAY_GIT_BRANCH: "stable" }, "1.49.0"), null);
});

test("commit: solo hexadecimal de 7 a 40 caracteres, en minúsculas", () => {
  assert.equal(buildCommit({ GIT_SHA: SHA.toUpperCase() }), SHA);
  assert.equal(buildCommit({ RAILWAY_GIT_COMMIT_SHA: "abc1234" }), "abc1234");
  assert.equal(buildCommit({ GIT_SHA: "no-es-un-commit" }), "");
  assert.equal(buildCommit({ GIT_SHA: `${SHA}00` }), "");
  assert.equal(buildCommit({}), "");
});

test("navegador: familia, versión mayor y sistema, nada más", () => {
  assert.equal(describeBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.80 Safari/537.36"), "Chrome 140 · Windows");
  assert.equal(describeBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0"), "Edge 140 · Windows");
  assert.equal(describeBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0"), "Firefox 133 · macOS");
  assert.equal(describeBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"), "Safari 18.1 · iOS");
  assert.equal(describeBrowser("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"), "Chrome 139 · Android");
  assert.equal(describeBrowser("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36"), "Chrome 140 · Linux");
  assert.equal(describeBrowser(""), "?");
});

test("dirección del formulario: plantilla de GitHub y solo los campos técnicos", () => {
  const url = new URL(bugReportUrl({ version: "1.49.0", commit: SHA, install: "docker", browser: "Chrome 140 · Linux", language: "es" }));
  assert.equal(url.origin + url.pathname, "https://github.com/pla87/pizarro/issues/new");
  assert.deepEqual([...url.searchParams.keys()], ["template", "version", "commit", "install", "browser", "language"]);
  assert.equal(url.searchParams.get("template"), BUG_REPORT_TEMPLATE);
  assert.equal(url.searchParams.get("install"), "Docker Compose");
  assert.equal(url.searchParams.get("browser"), "Chrome 140 · Linux");
  // Sin instalación conocida, el campo no va; los valores no llevan saltos de línea ni pasan de 120 caracteres.
  const f = bugReportFields({ version: "1.49.0", commit: "", install: null, browser: `a\nb${"x".repeat(200)}`, language: "en" });
  assert.deepEqual(f.map(([k]) => k), ["version", "browser", "language"]);
  assert.ok(!f[1]![1].includes("\n") && f[1]![1].length === 120);
});

test("plantilla de incidencias: los ids que rellena la app existen y hay casilla obligatoria", () => {
  // Sin parser de YAML entre las dependencias: se comprueba el texto (la estructura la valida GitHub al usarla).
  const form = readFileSync(".github/ISSUE_TEMPLATE/bug_report.yml", "utf8");
  const ids = [...form.matchAll(/^\s+id: (\S+)$/gm)].map((m) => m[1]);
  for (const [k] of bugReportFields({ version: "1", commit: "a".repeat(7), install: "railway", browser: "b", language: "es" })) assert.ok(ids.includes(k), k);
  // Los valores que la app pone en «install» son opciones del desplegable.
  assert.match(form, /- "Docker Compose"\n\s+- "Railway"/);
  assert.match(form, /- label: "Uso una versión publicada sin modificar\.[^"]*"\n\s+required: true/);
  assert.match(form, /datos personales/);
  const config = readFileSync(".github/ISSUE_TEMPLATE/config.yml", "utf8");
  assert.match(config, /^blank_issues_enabled: false$/m);
  assert.match(config, /url: https:\/\/github\.com\/pla87\/pizarro\/security\/advisories\/new/);
});

test("información técnica: nombres de variables y versiones, ningún valor", () => {
  const text = formatTechInfo({
    version: "1.49.0", commit: SHA, buildId: "1.49.0-0123456789ab", official: "railway", node: "v22.12.0", platform: "linux/x64",
    postgres: "16.4", migrations: { applied: 120, pending: 1, failed: 0, unknown: 0 }, envSet: ["APP_URL", "SESSION_SECRET"],
    envInvalid: ["TOKEN_SECRET"], features: ["backups"], timeZone: "UTC",
  });
  assert.match(text, /^Pizarro: 1\.49\.0$/m);
  assert.match(text, /^Official build: yes \(Railway\)$/m);
  assert.match(text, /^Migrations: 120 applied, 1 pending$/m);
  assert.match(text, /^Env vars set: APP_URL, SESSION_SECRET$/m);
  assert.match(text, /^Env vars with an invalid value: TOKEN_SECRET$/m);
  assert.match(formatTechInfo({ version: "1", commit: "", buildId: null, official: null, node: "v22", platform: "x", postgres: null, migrations: null, envSet: [], envInvalid: [], features: [], timeZone: "UTC" }), /^Database: not reachable$/m);
});
