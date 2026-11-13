// Migrador de la imagen Docker (scripts/migrator-deps.mjs): el CLI de Prisma se instala con las versiones del
// package-lock.json del proyecto y se poda lo que `migrate deploy` no usa.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

type LockEntry = { version?: string; integrity?: string; dev?: boolean; devOptional?: boolean; dependencies?: Record<string, string> };
type Lock = { lockfileVersion: number; packages: Record<string, LockEntry> };
type Mod = {
  migratorManifest: (pkg: unknown, lock: unknown) => { pkg: { dependencies: Record<string, string> }; lock: Lock };
  prune: (dir: string) => string[];
  UNUSED: string[];
};
// Especificador no literal: el script es .mjs (lo ejecuta node sin compilar) y tsc no tiene sus tipos.
const { migratorManifest, prune, UNUSED } = (await import(new URL("../scripts/migrator-deps.mjs", import.meta.url).href)) as Mod;

const appPkg = JSON.parse(readFileSync("package.json", "utf8")) as { devDependencies: Record<string, string> };
const appLock = JSON.parse(readFileSync("package-lock.json", "utf8")) as Lock;

test("el lockfile del migrador fija prisma y sus dependencias a las versiones y hashes del proyecto", () => {
  const { pkg, lock } = migratorManifest(appPkg, appLock);
  const version = appPkg.devDependencies.prisma!;
  assert.match(version, /^\d+\.\d+\.\d+$/, "prisma con versión exacta en package.json");
  assert.deepEqual(pkg.dependencies, { prisma: version });
  assert.deepEqual(lock.packages[""]?.dependencies, { prisma: version });
  for (const name of ["prisma", "@prisma/engines", "@prisma/config"]) {
    const key = `node_modules/${name}`;
    assert.ok(lock.packages[key], `${name} en el lockfile del migrador`);
    assert.equal(lock.packages[key]!.version, appLock.packages[key]!.version);
    assert.equal(lock.packages[key]!.integrity, appLock.packages[key]!.integrity);
  }
  // Nada de la app (Next, React del proyecto solo si Prisma lo pide como «peer»…) ni marcas de desarrollo.
  for (const name of ["next", "pg", "@prisma/client", "zod", "tsx", "eslint"]) assert.ok(!lock.packages[`node_modules/${name}`], `${name} no debe ir al migrador`);
  for (const [key, entry] of Object.entries(lock.packages)) {
    assert.ok(!entry.dev && !entry.devOptional, `${key} sin marca de desarrollo`);
    // Cada dependencia de cada paquete está en el lockfile (si no, `npm ci` fallaría).
    for (const dep of Object.keys(entry.dependencies ?? {})) {
      let dir = key;
      let found = false;
      for (;;) {
        if (lock.packages[dir ? `${dir}/node_modules/${dep}` : `node_modules/${dep}`]) {
          found = true;
          break;
        }
        if (!dir) break;
        const i = dir.lastIndexOf("/node_modules/");
        dir = i === -1 ? "" : dir.slice(0, i);
      }
      assert.ok(found, `${key} → ${dep}`);
    }
  }
  assert.ok(Object.keys(lock.packages).length < 200, "solo el CLI de Prisma, no todo el proyecto");
});

test("sin prisma en package.json o con una versión distinta en el lockfile, falla (no instala otra cosa)", () => {
  assert.throws(() => migratorManifest({ devDependencies: {} }, appLock), /no declara prisma/);
  assert.throws(() => migratorManifest({ devDependencies: { prisma: "0.0.1" } }, appLock), /package-lock.json tiene prisma/);
});

test("la poda quita lo de Studio, prisma dev y los compiladores de consultas, y deja lo que usa migrate deploy", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pz-migrator-"));
  try {
    const nm = path.join(dir, "node_modules");
    const files = [
      "prisma/build/index.js", "prisma/build/cli.js", "prisma/build/prisma_schema_build_bg.wasm", "prisma/build/schema_engine_bg.wasm",
      "prisma/build/query_compiler_fast_bg.postgresql.wasm", "prisma/build/studio.js", "prisma/build/studio.css",
      "@prisma/engines/schema-engine-debian-openssl-3.0.x", "@prisma/studio-core/dist/data/bff/index.cjs", "@prisma/studio-core/dist/ui/index.js",
      "@prisma/studio-core/dist/metafile-cjs.json", "@prisma/dev/dist/state.cjs", "@prisma/dev/dist/runtime-assets/pglite.wasm",
      "@electric-sql/pglite/package.json", "react-dom/package.json", "effect/package.json",
    ];
    for (const f of files) {
      mkdirSync(path.dirname(path.join(nm, f)), { recursive: true });
      writeFileSync(path.join(nm, f), "x");
    }
    const removed = prune(dir);
    for (const kept of ["prisma/build/index.js", "prisma/build/cli.js", "prisma/build/prisma_schema_build_bg.wasm", "prisma/build/schema_engine_bg.wasm", "@prisma/engines/schema-engine-debian-openssl-3.0.x", "@prisma/studio-core/dist/data/bff/index.cjs", "@prisma/dev/dist/state.cjs", "effect/package.json"]) {
      assert.ok(existsSync(path.join(nm, kept)), `se conserva ${kept}`);
    }
    for (const gone of ["prisma/build/query_compiler_fast_bg.postgresql.wasm", "prisma/build/studio.js", "@prisma/studio-core/dist/ui", "@prisma/studio-core/dist/metafile-cjs.json", "@prisma/dev/dist/runtime-assets", "@electric-sql", "react-dom"]) {
      assert.ok(!existsSync(path.join(nm, gone)), `se quita ${gone}`);
      assert.ok(removed.includes(gone), `${gone} en la lista de quitados`);
    }
    // Una segunda pasada no hace nada (y no falla por lo que ya no está).
    assert.deepEqual(prune(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // Nunca lo imprescindible.
  for (const essential of ["prisma", "@prisma/engines", "@prisma/config", "effect", "c12", "jiti"]) assert.ok(!UNUSED.includes(essential));
});

test("el Dockerfile instala el migrador con el lockfile y comprueba la poda al construir", () => {
  const docker = readFileSync("Dockerfile", "utf8");
  const stage = docker.slice(docker.indexOf("AS migrator"), docker.indexOf("AS runner"));
  assert.match(stage, /migrator-deps\.mjs \/tmp\/app \/app\/migrator/);
  assert.match(stage, /npm ci /);
  assert.doesNotMatch(stage, /npm install/);
  assert.match(stage, /migrator-deps\.mjs --prune/);
  assert.match(stage, /prisma migrate diff --from-empty --to-schema prisma\/schema\.prisma/);
});
