import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

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

/** El script del paso «Mover stable a la versión publicada» (las líneas bajo «run: |», sin su sangría). */
function stableScript(): string {
  const wf = readFileSync(".github/workflows/release.yml", "utf8");
  const stable = wf.slice(wf.indexOf("\n  stable:"));
  const lines = stable.slice(stable.indexOf("Mover stable a la versión publicada")).split("\n");
  const start = lines.findIndex((l) => /^\s+run: \|\s*$/.test(l));
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && !l.startsWith("          ")) break;
    body.push(l.slice(10));
  }
  return body.join("\n");
}

test("workflow de release: stable usa STABLE_PUSH_TOKEN si existe y no se mueve a un commit que no está en main", () => {
  const wf = readFileSync(".github/workflows/release.yml", "utf8");
  const stable = wf.slice(wf.indexOf("\n  stable:"));
  assert.match(stable, /token: \$\{\{ secrets\.STABLE_PUSH_TOKEN \|\| github\.token \}\}/);
  assert.match(stable, /fetch-depth: 0/);
  const script = stableScript();
  assert.ok(script.indexOf('git merge-base --is-ancestor "$GITHUB_SHA" origin/main') > 0);
  assert.ok(script.indexOf("merge-base") < script.indexOf("git push"), "la comprobación va antes del push");

  // Ensayo con un repositorio local de origen: main con dos versiones y una rama aparte.
  const dir = mkdtempSync(join(tmpdir(), "pz-stable-"));
  try {
    const git = (cwd: string, ...args: string[]) => {
      const r = spawnSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@example.com", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    const origin = join(dir, "origin.git");
    const work = join(dir, "work");
    git(dir, "init", "--bare", "-q", origin);
    git(dir, "clone", "-q", origin, work);
    const commit = (version: string) => {
      writeFileSync(join(work, "package.json"), JSON.stringify({ version }));
      git(work, "add", "package.json");
      git(work, "commit", "-q", "-m", `v${version}`);
      return git(work, "rev-parse", "HEAD");
    };
    const v1 = commit("1.0.0");
    git(work, "push", "-q", "origin", "HEAD:main");
    const v2 = commit("1.1.0");
    git(work, "push", "-q", "origin", "HEAD:main");
    git(work, "checkout", "-q", "-b", "side", v1);
    const side = commit("1.2.0");
    git(work, "push", "-q", "origin", "side");
    git(work, "checkout", "-q", "main");
    const summary = join(dir, "summary.md");
    const run = (sha: string, hasToken = "false") =>
      spawnSync("bash", ["-e", "-c", script], { cwd: work, encoding: "utf8", env: { ...process.env, GITHUB_SHA: sha, GITHUB_STEP_SUMMARY: summary, HAS_STABLE_PUSH_TOKEN: hasToken, GIT_TERMINAL_PROMPT: "0" } });
    const stableAt = () => spawnSync("git", ["ls-remote", origin, "refs/heads/stable"], { encoding: "utf8" }).stdout.split("\t")[0];

    let r = run(v2);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(stableAt(), v2);
    // Una etiqueta en un commit fuera de main: stable no se mueve (y el job no falla).
    r = run(side);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no está en main/);
    assert.equal(stableAt(), v2);

    // GitHub rechaza el push con GITHUB_TOKEN (cambian workflows): el job falla diciendo qué secreto crear.
    git(work, "checkout", "-q", "main");
    const v3 = commit("1.3.0");
    git(work, "push", "-q", "origin", "HEAD:main");
    const hook = join(origin, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho \"refusing to allow a GitHub App to create or update workflow \\`.github/workflows/release.yml\\` without \\`workflows\\` permission\" >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    r = run(v3);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::.*STABLE_PUSH_TOKEN.*Contents y Workflows/);
    assert.match(readFileSync(summary, "utf8"), /STABLE_PUSH_TOKEN/);
    assert.equal(stableAt(), v2);
    r = run(v3, "true");
    assert.match(r.stdout, /::error::.*no tiene el permiso Workflows/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
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

describe("workflow de release: versión ya publicada", () => {
  /** El script del paso que comprueba la versión, ejecutado con un `git` falso (ls-remote devuelve FAKE_LS). */
  function runCheck(env: Record<string, string>) {
    const wf = readFileSync(".github/workflows/release.yml", "utf8");
    const m = /- name: Comprobar que la etiqueta coincide con package\.json\n\s+run: \|\n((?: {10}.*\n|\n)+)/.exec(wf);
    assert.ok(m, "paso de comprobación");
    const script = m[1]!.replace(/^ {10}/gm, "");
    const dir = mkdtempSync(join(tmpdir(), "pz-release-"));
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "git"), `#!/bin/sh\necho "$*" >> "${dir}/git-calls"\n[ -n "$FAKE_FAIL" ] && exit 128\nprintf "%s" "$FAKE_LS"\n`);
    chmodSync(join(bin, "git"), 0o755);
    const ghEnv = join(dir, "env");
    writeFileSync(ghEnv, "");
    const r = spawnSync("bash", ["-e", "-c", script], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_ENV: ghEnv, ...env } });
    return { status: r.status, stderr: r.stderr, env: readFileSync(ghEnv, "utf8"), gitCalls: existsSync(join(dir, "git-calls")) ? readFileSync(join(dir, "git-calls"), "utf8") : "" };
  }
  const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

  test("a mano con la etiqueta ya en el remoto: para con un error claro antes de publicar", () => {
    const r = runCheck({ GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF_NAME: "main", FAKE_LS: `abc123\trefs/tags/v${version}\n` });
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`La versión ${version.replace(/\./g, "\\.")} ya está publicada`));
    assert.match(r.stderr, /npm run version:bump/);
    assert.equal(r.env, "", "no llega a fijar VERSION");
    assert.match(r.gitCalls, new RegExp(`ls-remote --tags origin refs/tags/v${version.replace(/\./g, "\\.")}`));
  });

  test("a mano con una versión nueva sigue; si no se puede consultar el remoto, para", () => {
    const ok = runCheck({ GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF_NAME: "main", FAKE_LS: "" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.env, `VERSION=${version}\n`);
    const down = runCheck({ GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF_NAME: "main", FAKE_LS: "", FAKE_FAIL: "1" });
    assert.equal(down.status, 1);
  });

  test("con etiqueta (push) no consulta el remoto: la etiqueta es la que se publica", () => {
    const r = runCheck({ GITHUB_EVENT_NAME: "push", GITHUB_REF_NAME: `v${version}`, FAKE_LS: `abc\trefs/tags/v${version}\n` });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.gitCalls, "");
  });

  test("un solo grupo de concurrencia para la ejecución por etiqueta y la manual", () => {
    const wf = readFileSync(".github/workflows/release.yml", "utf8");
    assert.match(wf, /^concurrency:\n {2}group: release\n {2}cancel-in-progress: false$/m);
  });
});
