import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

test("release-notes: la versión actual sale con su resumen y sus cambios; una inexistente falla", () => {
  const ok = spawnSync("node", ["scripts/release-notes.mjs", `v${pkg.version}`], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const entry = (JSON.parse(readFileSync("changelog.json", "utf8")) as { versions: { version: string; summary: string }[] }).versions.find((v) => v.version === pkg.version);
  assert.ok(entry);
  assert.ok(ok.stdout.startsWith(entry.summary));
  assert.match(ok.stdout, /docs\/INSTALL\.md#5-actualizar/);
  const missing = spawnSync("node", ["scripts/release-notes.mjs", "0.0.1"], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.equal(spawnSync("node", ["scripts/release-notes.mjs", "latest"], { encoding: "utf8" }).status, 2);
});

test("workflow de release: etiquetas v*.*.*, GHCR con amd64+arm64, caché gha y notas del changelog", () => {
  const wf = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(wf, /tags:\s*\n\s*- "v\*\.\*\.\*"/);
  assert.match(wf, /packages: write/);
  assert.match(wf, /platforms: linux\/amd64,linux\/arm64/);
  assert.match(wf, /ghcr\.io\/pla87\/pizarro:\$\{VERSION\}/);
  assert.match(wf, /pizarro:latest/);
  assert.match(wf, /cache-from: type=gha/);
  assert.match(wf, /cache-to: type=gha/);
  assert.match(wf, /secrets\.GITHUB_TOKEN/);
  assert.match(wf, /scripts\/release-notes\.mjs/);
  assert.match(wf, /needs: image/);
});

test("workflows: cada acción fijada a un commit exacto con su versión en el comentario", () => {
  for (const f of readdirSync(".github/workflows").filter((n) => /\.ya?ml$/.test(n))) {
    const wf = readFileSync(`.github/workflows/${f}`, "utf8");
    const uses = [...wf.matchAll(/^\s*(?:-\s+)?uses:\s*(.+)$/gm)].map((m) => m[1]!.trim());
    assert.ok(uses.length > 0, f);
    for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.\/-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, `${f}: ${u}`);
  }
  const dep = readFileSync(".github/dependabot.yml", "utf8");
  assert.match(dep, /package-ecosystem: github-actions/);
  assert.match(dep, /package-ecosystem: npm/);
  assert.match(dep, /version-update:semver-major/);
});

test("workflow de release: build oficial y rama stable movida solo por su job, con --force-with-lease", () => {
  const wf = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(wf, /OFFICIAL_BUILD=1/);
  assert.match(wf, /RELEASE_VERSION=\$\{\{ env\.VERSION \}\}/);
  const stable = wf.slice(wf.indexOf("\n  stable:"));
  assert.ok(stable.length > 20);
  assert.match(stable, /needs: release/);
  assert.match(stable, /contents: write/);
  assert.match(stable, /git push --force-with-lease="refs\/heads\/stable:\$current" origin "\$GITHUB_SHA:refs\/heads\/stable"/);
  // El Dockerfile declara las variables que la build usa para saberse oficial (Railway solo pasa las declaradas).
  const df = readFileSync("Dockerfile", "utf8");
  for (const a of ["OFFICIAL_BUILD", "RELEASE_VERSION", "RAILWAY_GIT_REPO_OWNER", "RAILWAY_GIT_REPO_NAME", "RAILWAY_GIT_BRANCH", "RAILWAY_GIT_COMMIT_SHA", "GIT_SHA"]) {
    assert.match(df, new RegExp(`^ARG ${a}=`, "m"), a);
  }
});

test("compose: usa la imagen publicada por defecto y compose.build.yml permite construir", () => {
  const c = readFileSync("deploy/compose.yml", "utf8");
  assert.match(c, /image: \$\{PIZARRO_IMAGE:-ghcr\.io\/pla87\/pizarro:latest\}/);
  assert.doesNotMatch(c, /^\s+build:/m);
  const b = readFileSync("deploy/compose.build.yml", "utf8");
  assert.match(b, /^\s+build:/m);
  assert.match(b, /dockerfile: Dockerfile/);
});
