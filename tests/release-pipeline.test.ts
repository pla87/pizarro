import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

test("release-notes: la versión actual sale con su resumen y sus cambios; una inexistente falla", () => {
  const ok = spawnSync("node", ["scripts/release-notes.mjs", `v${pkg.version}`], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const entry = (JSON.parse(readFileSync("changelog.json", "utf8")) as { versions: { version: string; summary: string }[] }).versions.find((v) => v.version === pkg.version);
  assert.ok(entry);
  assert.ok(ok.stdout.startsWith(entry.summary));
  assert.match(ok.stdout, /https:\/\/getpizarro\.com\/instalar\/#actualizar/);
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

test("workflow de release: build oficial y rama stable movida solo por su job, con scripts/move-stable.sh", () => {
  const wf = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(wf, /OFFICIAL_BUILD=1/);
  assert.match(wf, /RELEASE_VERSION=\$\{\{ env\.VERSION \}\}/);
  const stable = wf.slice(wf.indexOf("\n  stable:"));
  assert.ok(stable.length > 20);
  assert.match(stable, /needs: release/);
  assert.match(stable, /contents: write/);
  const check = stable.indexOf("bash scripts/move-stable.sh check-token");
  assert.ok(check > 0);
  assert.ok(check < stable.indexOf('bash scripts/move-stable.sh move "$GITHUB_SHA"'), "el token se comprueba antes de mover");
  const script = readFileSync("scripts/move-stable.sh", "utf8");
  assert.match(script, /push --force-with-lease="refs\/heads\/stable:\$current" "\$remote" "\$sha:refs\/heads\/stable"/);
  const mergeBase = script.indexOf('git merge-base --is-ancestor "$sha" origin/main');
  assert.ok(mergeBase > 0);
  assert.ok(mergeBase < script.indexOf("push --force-with-lease"), "la comprobación va antes del push");
  // El Dockerfile declara las variables que la build usa para saberse oficial (Railway solo pasa las declaradas).
  const df = readFileSync("Dockerfile", "utf8");
  for (const a of ["OFFICIAL_BUILD", "RELEASE_VERSION", "RAILWAY_GIT_REPO_OWNER", "RAILWAY_GIT_REPO_NAME", "RAILWAY_GIT_BRANCH", "RAILWAY_GIT_COMMIT_SHA", "GIT_SHA"]) {
    assert.match(df, new RegExp(`^ARG ${a}=`, "m"), a);
  }
});

test("stable: el checkout usa siempre github.token y STABLE_PUSH_TOKEN solo llega a los pasos del script", () => {
  for (const f of ["release.yml", "stable.yml"]) {
    const wf = readFileSync(`.github/workflows/${f}`, "utf8");
    const job = f === "release.yml" ? wf.slice(wf.indexOf("\n  stable:")) : wf;
    const from = job.indexOf("uses: actions/checkout@");
    const checkout = job.slice(from, job.indexOf("\n\n", from));
    assert.match(checkout, /token: \$\{\{ github\.token \}\}/, f);
    assert.match(checkout, /fetch-depth: 0/, f);
    assert.doesNotMatch(checkout, /STABLE_PUSH_TOKEN/, f);
    // El secreto solo aparece como variable de entorno de los pasos que llaman al script.
    const uses = [...job.matchAll(/secrets\.STABLE_PUSH_TOKEN/g)];
    assert.ok(uses.length >= 2, f);
    for (const m of uses) {
      const line = job.slice(job.lastIndexOf("\n", m.index) + 1, job.indexOf("\n", m.index));
      assert.match(line, /^\s+STABLE_PUSH_TOKEN: \$\{\{ secrets\.STABLE_PUSH_TOKEN \}\}$/, `${f}: ${line}`);
    }
  }
  const script = readFileSync("scripts/move-stable.sh", "utf8");
  // El valor se limpia de espacios y saltos de línea, se enmascara y nunca va en la línea de órdenes ni en una URL.
  assert.match(script, /tr -d '\[:space:\]'/);
  assert.match(script, /::add-mask::\$pat/);
  assert.match(script, /curl [^\n]*-H @-/);
  assert.match(script, /GIT_CONFIG_KEY_0="http\.\$server\/\.extraheader" GIT_CONFIG_VALUE_0=""/);
  assert.doesNotMatch(script, /x-access-token:\$\{?(pat|push_token)\}?@/);
});

test("workflow «Mover stable»: a mano, solo desde main, permisos mínimos y el mismo script con --latest", () => {
  const wf = readFileSync(".github/workflows/stable.yml", "utf8");
  assert.match(wf, /^name: Mover stable$/m);
  assert.match(wf, /^on:\n {2}workflow_dispatch:\n\n/m);
  assert.doesNotMatch(wf, /^\s+(push|pull_request|schedule):/m);
  assert.match(wf, /^permissions:\n {2}contents: read$/m);
  assert.match(wf, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(wf, /group: release/);
  assert.doesNotMatch(wf, /packages: write|workflows: write|actions: write/);
  assert.ok(wf.indexOf("move-stable.sh check-token") > 0);
  assert.ok(wf.indexOf("move-stable.sh check-token") < wf.indexOf("move-stable.sh move --latest"));
  assert.match(wf, /PUBLISHED_TAGS<</);
  assert.match(wf, /select\(\.draft \| not\) \| select\(\.prerelease \| not\)/);
});

/** Repositorio de origen local (bare) con un clon de trabajo, para ejecutar scripts/move-stable.sh de verdad. */
function stableSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "pz-stable-"));
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@example.com", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const origin = join(dir, "origin.git");
  const work = join(dir, "work");
  git(dir, "init", "--bare", "-q", origin);
  git(dir, "clone", "-q", origin, work);
  const commit = (version: string, tag = true) => {
    writeFileSync(join(work, "package.json"), JSON.stringify({ version }));
    git(work, "add", "package.json");
    git(work, "commit", "-q", "-m", `v${version}`);
    if (tag) git(work, "tag", `v${version}`);
    return git(work, "rev-parse", "HEAD");
  };
  const summary = join(dir, "summary.md");
  const script = join(process.cwd(), "scripts/move-stable.sh");
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync("bash", [script, ...args], {
      cwd: work,
      encoding: "utf8",
      env: { ...process.env, GITHUB_REPOSITORY: "example/pizarro", GITHUB_STEP_SUMMARY: summary, STABLE_REMOTE_URL: origin, STABLE_PUSH_TOKEN: "", GITHUB_TOKEN: "token-de-prueba", PUBLISHED_TAGS: "", ...env },
    });
  const stableAt = () => spawnSync("git", ["ls-remote", origin, "refs/heads/stable"], { encoding: "utf8" }).stdout.split("\t")[0];
  /** La salida sin la línea ::add-mask:: (que Actions no muestra) no contiene el token. */
  const hidden = (r: { stdout: string; stderr: string }) => assert.doesNotMatch(r.stdout.replace(/^::add-mask::.*$/m, "") + r.stderr, /github_pat_prueba123/);
  return { dir, origin, work, git, commit, run, stableAt, summary, hidden };
}

test("move-stable.sh: no se mueve fuera de main, ni hacia atrás, ni a preversiones; avisa si GitHub rechaza el push", () => {
  const { dir, origin, work, git, commit, run, stableAt, summary, hidden } = stableSandbox();
  try {
    const v1 = commit("1.0.0");
    git(work, "push", "-q", "origin", "HEAD:main");
    const v2 = commit("1.1.0");
    git(work, "push", "-q", "origin", "HEAD:main");
    git(work, "checkout", "-q", "-b", "side", v1);
    const side = commit("1.2.0");
    git(work, "push", "-q", "origin", "side");
    git(work, "checkout", "-q", "main");

    let r = run(["move", v2]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(stableAt(), v2);
    r = run(["move", v2]);
    assert.match(r.stdout, /stable ya está en/);
    // Una etiqueta en un commit fuera de main: stable no se mueve (y el job no falla).
    r = run(["move", side]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no está en main/);
    assert.equal(stableAt(), v2);
    // Nunca hacia atrás.
    r = run(["move", v1]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /stable ya tiene la 1\.1\.0 \(>= 1\.0\.0\)/);
    assert.equal(stableAt(), v2);
    // Una preversión no mueve stable.
    const rc = commit("2.0.0-rc.1", false);
    git(work, "push", "-q", "origin", "HEAD:main");
    r = run(["move", rc]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /preversión/);
    assert.equal(stableAt(), v2);

    // GitHub rechaza el push con GITHUB_TOKEN (cambian workflows): el job falla diciendo qué secreto crear.
    const v3 = commit("2.0.0");
    git(work, "push", "-q", "origin", "HEAD:main");
    const hook = join(origin, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho \"refusing to allow a GitHub App to create or update workflow \\`.github/workflows/release.yml\\` without \\`workflows\\` permission\" >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    r = run(["move", v3]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::.*GITHUB_TOKEN.*STABLE_PUSH_TOKEN.*Contents y Workflows/);
    assert.match(readFileSync(summary, "utf8"), /STABLE_PUSH_TOKEN/);
    assert.equal(stableAt(), v2);
    // Con un PAT sin el permiso Workflows; el valor (con espacios y salto de línea) no aparece en la salida.
    r = run(["move", v3], { STABLE_PUSH_TOKEN: " github_pat_prueba123 \n" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::.*no tiene el permiso Workflows/);
    assert.match(r.stdout, /Only select repositories → example\/pizarro/);
    assert.match(r.stdout, /^::add-mask::github_pat_prueba123$/m);
    hidden(r);
    // Credenciales rechazadas (token caducado o sin acceso).
    writeFileSync(hook, "#!/bin/sh\necho 'Permission to example/pizarro.git denied to bot.' >&2\nexit 1\n");
    r = run(["move", v3], { STABLE_PUSH_TOKEN: "github_pat_prueba123" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::.*rechaza las credenciales de STABLE_PUSH_TOKEN.*Fine-grained tokens/);
    hidden(r);
    rmSync(hook);
    r = run(["move", v3], { STABLE_PUSH_TOKEN: "github_pat_prueba123" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(stableAt(), v3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("move-stable.sh --latest: la versión vX.Y.Z más alta publicada que está en main", () => {
  const { dir, work, git, commit, run, stableAt } = stableSandbox();
  try {
    git(work, "commit", "-q", "--allow-empty", "-m", "inicio");
    git(work, "push", "-q", "origin", "HEAD:main");
    let r = run(["move", "--latest"]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::No hay ninguna versión publicada en main/);

    const v1 = commit("1.9.0");
    const v2 = commit("1.10.0");
    git(work, "push", "-q", "origin", "HEAD:main");
    git(work, "checkout", "-q", "-b", "side");
    commit("1.11.0"); // en otra rama: no cuenta
    git(work, "push", "-q", "origin", "side");
    git(work, "checkout", "-q", "main");
    commit("2.0.0-rc.1"); // preversión: no cuenta
    git(work, "push", "-q", "origin", "HEAD:main");
    git(work, "push", "-q", "origin", "--tags");
    git(work, "tag", "-d", "v1.9.0", "v1.10.0", "v1.11.0", "v2.0.0-rc.1"); // las etiquetas se leen del origen

    // Solo las que tienen release publicada (PUBLISHED_TAGS): v1.10.0 no la tiene.
    r = run(["move", "--latest"], { PUBLISHED_TAGS: "v1.9.0\nv1.11.0\nv2.0.0-rc.1" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Última versión publicada en main: v1\.9\.0/);
    assert.equal(stableAt(), v1);
    // Sin lista, la más alta de main (orden numérico: 1.10.0 > 1.9.0).
    r = run(["move", "--latest"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /v1\.10\.0/);
    assert.equal(stableAt(), v2);
    r = run(["move", "--latest"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /stable ya está en/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("move-stable.sh check-token: sin mostrar el token, distingue caducado, sin acceso y sin permiso de escritura", () => {
  const { dir, work, git, commit, run, stableAt, hidden } = stableSandbox();
  try {
    commit("1.0.0");
    git(work, "push", "-q", "origin", "HEAD:main");
    // curl falso: guarda las cabeceras que recibe por la entrada estándar y responde lo que diga FAKE_CURL_CODE.
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const log = join(dir, "curl.log");
    writeFileSync(join(bin, "curl"), '#!/bin/sh\nout=""\nprev=""\nfor a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done\ncat > "$FAKE_CURL_LOG"\nprintf \'%s\' "$FAKE_CURL_BODY" > "$out"\nprintf \'%s\' "$FAKE_CURL_CODE"\n');
    chmodSync(join(bin, "curl"), 0o755);
    const check = (code: string, env: Record<string, string> = {}) =>
      run(["check-token"], { PATH: `${bin}:${process.env.PATH}`, FAKE_CURL_LOG: log, FAKE_CURL_CODE: code, FAKE_CURL_BODY: '{"permissions":{"push":true}}', STABLE_PUSH_TOKEN: " github_pat_prueba123\n", ...env });

    let r = check("200", { STABLE_PUSH_TOKEN: "" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /No hay STABLE_PUSH_TOKEN/);

    r = check("401");
    assert.equal(r.status, 1);
    // El valor llega limpio (sin el espacio ni el salto de línea) y por la entrada estándar, no por la línea de órdenes.
    assert.equal(readFileSync(log, "utf8"), "Authorization: Bearer github_pat_prueba123\n");
    assert.match(r.stdout, /::error::STABLE_PUSH_TOKEN no es válido \(GitHub responde 401\)\..*caducado.*pendiente de aprobación/);
    assert.match(r.stdout, /Fine-grained tokens.*Only select repositories → example\/pizarro.*Contents Read and write y Workflows Read and write.*Settings → Secrets and variables → Actions → STABLE_PUSH_TOKEN.*sin espacios ni saltos de línea/);
    hidden(r);

    r = check("404");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::STABLE_PUSH_TOKEN no tiene acceso a example\/pizarro.*Only select repositories/);

    r = check("200", { FAKE_CURL_BODY: '{"permissions":{"push":false}}' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::El dueño de STABLE_PUSH_TOKEN no puede escribir/);

    // La API responde 200, pero git no deja escribir (aquí, un destino inexistente): falla pidiendo Contents.
    r = check("200", { STABLE_REMOTE_URL: join(dir, "no-existe.git") });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /::error::STABLE_PUSH_TOKEN no puede escribir.*Contents: Read and write/);
    hidden(r);

    // Todo bien: el push de prueba (--dry-run) no mueve stable.
    r = check("200");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /STABLE_PUSH_TOKEN es válido/);
    hidden(r);
    assert.equal(stableAt(), "");
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
