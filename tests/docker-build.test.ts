// Imagen y build: los scripts de dist/ con trozos compartidos (scripts/build-boot.mjs) y la caché de `npm ci` del
// Dockerfile, que no se pierde al cambiar la versión (scripts/docker-manifests.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// @ts-expect-error: script .mjs sin tipos
import { FIXED_VERSION, INSTALL_SCRIPTS, withFixedVersion } from "../scripts/docker-manifests.mjs";

const fix = withFixedVersion as (text: string, kind: "package" | "lock") => string;
const dockerfile = readFileSync("Dockerfile", "utf8");
const stage = (name: string) => {
  const at = dockerfile.indexOf(` AS ${name}\n`);
  assert.ok(at > 0, name);
  const next = dockerfile.indexOf("\nFROM ", at);
  return dockerfile.slice(at, next > 0 ? next : undefined);
};

test("package.json y package-lock.json con otra versión dan los mismos bytes; las dependencias, intactas", () => {
  const pkg = readFileSync("package.json", "utf8");
  const lock = readFileSync("package-lock.json", "utf8");
  const bump = (text: string) => text.replaceAll(`"version": "${JSON.parse(pkg).version}"`, '"version": "99.0.0"');
  assert.notEqual(bump(pkg), pkg);
  assert.equal(fix(bump(pkg), "package"), fix(pkg, "package"));
  assert.equal(fix(bump(lock), "lock"), fix(lock, "lock"));
  const fixedLock = JSON.parse(fix(lock, "lock"));
  assert.equal(fixedLock.version, FIXED_VERSION);
  assert.equal(fixedLock.packages[""].version, FIXED_VERSION);
  // Solo la versión de la raíz: las de los paquetes y las dependencias declaradas no cambian.
  const original = JSON.parse(lock);
  assert.deepEqual({ ...fixedLock.packages, "": undefined }, { ...original.packages, "": undefined });
  assert.deepEqual(fixedLock.packages[""].dependencies, original.packages[""].dependencies);
  const fixedPkg = JSON.parse(fix(pkg, "package"));
  // Sin `scripts` (npm ci no usa ninguno); lo demás, igual.
  assert.equal("scripts" in fixedPkg, false);
  const { scripts: _scripts, ...rest } = JSON.parse(pkg);
  assert.deepEqual({ ...fixedPkg, version: undefined }, { ...rest, version: undefined });
});

test("cambiar un script de package.json no cambia los manifiestos; un script que npm ci ejecutaría hace fallar la etapa", () => {
  const pkg = readFileSync("package.json", "utf8");
  const json = JSON.parse(pkg) as { scripts: Record<string, string> };
  // El proyecto no tiene ninguno de los que ejecuta `npm ci` (si se añade, hay que revisar la etapa «manifests»).
  for (const name of INSTALL_SCRIPTS as string[]) assert.equal(json.scripts[name], undefined, name);
  const changed = JSON.stringify({ ...json, scripts: { ...json.scripts, test: "node otra-cosa.mjs", nuevo: "echo hola" } }, null, 2);
  assert.equal(fix(changed, "package"), fix(pkg, "package"));
  for (const name of ["postinstall", "prepare"]) {
    assert.throws(() => fix(JSON.stringify({ ...json, scripts: { ...json.scripts, [name]: "node x.mjs" } }), "package"), new RegExp(name));
  }
  // El lockfile no tiene scripts: con kind "lock" no se toca más que la versión.
  assert.doesNotThrow(() => fix(readFileSync("package-lock.json", "utf8"), "lock"));
});

test("Dockerfile: las dependencias se instalan con los manifiestos de versión fija, antes de copiar el código", () => {
  const manifests = stage("manifests");
  assert.match(manifests, /COPY package\.json package-lock\.json \.\//);
  assert.match(manifests, /RUN node \/tmp\/docker-manifests\.mjs \/tmp\/manifests/);
  assert.ok(dockerfile.indexOf(" AS manifests\n") < dockerfile.indexOf(" AS deps\n"));
  const deps = stage("deps");
  assert.match(deps, /COPY --from=manifests \/tmp\/manifests\/package\.json \/tmp\/manifests\/package-lock\.json \.\//);
  assert.doesNotMatch(deps, /^COPY (?!--from=manifests)/m, "deps no copia nada más (ni el código ni el package.json con versión)");
  assert.match(deps, /RUN npm ci /);
  // El migrador, igual: su `npm ci` tampoco se repite por la versión.
  assert.match(stage("migrator"), /COPY --from=manifests \/tmp\/manifests\/package\.json \/tmp\/manifests\/package-lock\.json \/tmp\/app\//);
  // El código (con la versión real) llega después, en la etapa de build.
  assert.match(stage("build"), /COPY --from=deps \/app\/node_modules \.\/node_modules\nCOPY \. \./);
  // Sin cachés de BuildKit con id: Railway exige un prefijo propio y el despliegue puede fallar.
  assert.doesNotMatch(dockerfile, /--mount=type=cache/);
  // .dockerignore no aparta el script de la etapa.
  assert.doesNotMatch(readFileSync(".dockerignore", "utf8"), /^scripts/m);
});

test("build:boot: los cinco scripts de dist/ de una vez, con trozos compartidos y los mismos nombres de entrada", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["build:boot"], "node scripts/build-boot.mjs");
  assert.match(pkg.scripts.build!, /node scripts\/postbuild\.mjs && npm run build:boot$/);
  const src = readFileSync("scripts/build-boot.mjs", "utf8");
  assert.match(src, /const BOOT_ENTRIES = \["boot", "restore", "rotate-keys", "doctor", "reset-link"\];/);
  for (const opt of [/splitting: true/, /format: "esm"/, /outdir: OUT/, /outExtension: \{ "\.js": "\.mjs" \}/, /const OUT = "dist";/]) assert.match(src, opt);
  // Los trozos van junto a las entradas (sin chunkNames con carpeta): import.meta.url sigue en dist/.
  assert.doesNotMatch(src, /chunkNames/);
  // Lo que se lanza con esos nombres: el arranque del contenedor y `npm start`.
  assert.match(readFileSync("scripts/start.sh", "utf8"), /node dist\/boot\.mjs/);
  assert.match(readFileSync("scripts/start-local.mjs", "utf8"), /path\.join\(root, "dist", "boot\.mjs"\)/);
  assert.match(dockerfile, /^COPY --from=build \/app\/dist \.\/dist$/m);
});
