import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// deploy/get.sh con un docker falso, un tarball local y un install.sh de mentira (que anota sus argumentos).
const GET = join(process.cwd(), "deploy", "get.sh");
const root = mkdtempSync(join(tmpdir(), "pizarro-get-"));
const bin = join(root, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "docker"), '#!/bin/sh\n[ "$1" = "--version" ] && echo "Docker version 99.0.0"\nexit 0\n');
chmodSync(join(bin, "docker"), 0o755);

function makeTarball(name: string, files: Record<string, string>): string {
  const src = join(root, `src-${name}`, "pizarro-main");
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(src, rel, ".."), { recursive: true });
    writeFileSync(join(src, rel), body);
  }
  const out = join(root, `${name}.tar.gz`);
  const r = spawnSync("tar", ["-czf", out, "-C", join(root, `src-${name}`), "pizarro-main"]);
  assert.equal(r.status, 0);
  return out;
}

const STUB_INSTALL = '#!/bin/sh\necho "$@" > "$(dirname "$0")/args.txt"\ntouch "$(dirname "$0")/.env"\n';
const full = (extra: Record<string, string> = {}) => ({
  "Dockerfile": "FROM scratch\n",
  "deploy/compose.yml": "name: pizarro\n",
  "deploy/install.sh": STUB_INSTALL,
  "deploy/.env.example": "A=1\n",
  "src/old.txt": "v1\n",
  ...extra,
});

// setsid: sin terminal de control, get.sh no puede preguntar nada.
const mkEnv = (path: string, extra: Record<string, string> = {}) => ({ ...process.env, PATH: path, HOME: root, ...extra });

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync("setsid", ["-w", "sh", GET, ...args], {
    encoding: "utf8",
    env: mkEnv(`${bin}:${process.env.PATH}`, env),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("get.sh: --help en español y sale sin tocar nada", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--domain/);
  assert.match(r.stdout, /Instalación de Pizarro en un paso/);
});

test("get.sh: rechaza opciones desconocidas, dirs de sistema y --domain con --local", () => {
  assert.notEqual(run(["--nope"]).status, 0);
  assert.match(run(["--dir", "/usr", "--tarball", "x"]).stderr, /carpeta del sistema/);
  assert.match(run(["--dir", "relativa"]).stderr, /ruta absoluta/);
  assert.match(run(["--domain", "a.example.com", "--local"]).stderr, /no los dos/);
  assert.match(run(["--ref", "x;rm -rf"]).stderr, /no es válida/);
});

test("get.sh: instala, pasa --domain a install.sh y en la 2ª ejecución conserva .env y kit", { skip: process.getuid?.() !== 0 && "requiere root (usa sudo en caso contrario)" }, () => {
  const tar = makeTarball("a", full());
  const dir = join(root, "inst");
  const r1 = run(["--domain", "pizarro.example.com", "--dir", dir, "--tarball", tar]);
  assert.equal(r1.status, 0, r1.stderr + r1.stdout);
  assert.equal(readFileSync(join(dir, "deploy", "args.txt"), "utf8").trim(), "--domain pizarro.example.com");
  assert.match(r1.stdout, /Próximos pasos/);

  // El usuario ya tiene configuración, datos locales y un fichero que el código nuevo ya no trae.
  writeFileSync(join(dir, "deploy", ".env"), 'SESSION_SECRET="keep"\nAPP_URL="https://tablero.example.com"\n');
  writeFileSync(join(dir, "deploy", "recovery-kit.txt"), "kit\n");

  const { "src/old.txt": _old, ...sinOld } = full();
  const tar2 = makeTarball("b", { ...sinOld, "src/new.txt": "v2\n" });
  const r2 = run(["--local", "--dir", dir, "--tarball", tar2]);
  assert.equal(r2.status, 0, r2.stderr + r2.stdout);
  assert.equal(readFileSync(join(dir, "deploy", "args.txt"), "utf8").trim(), "--local");
  assert.equal(readFileSync(join(dir, "deploy", ".env"), "utf8"), 'SESSION_SECRET="keep"\nAPP_URL="https://tablero.example.com"\n');
  assert.equal(readFileSync(join(dir, "deploy", "recovery-kit.txt"), "utf8"), "kit\n");
  assert.equal(existsSync(join(dir, "src", "new.txt")), true);
  assert.equal(existsSync(join(dir, "src", "old.txt")), false);

  // Sin opciones y con un .env real: no pregunta, deja que install.sh reutilice el dominio.
  const r3 = run(["--dir", dir, "--tarball", tar2, "--no-start"]);
  assert.equal(r3.status, 0, r3.stderr + r3.stdout);
  assert.equal(readFileSync(join(dir, "deploy", "args.txt"), "utf8").trim(), "--no-start");
});

test("get.sh: sin dominio ni terminal falla con un mensaje claro; no pisa carpetas ajenas", { skip: process.getuid?.() !== 0 && "requiere root" }, () => {
  const tar = makeTarball("c", full());
  const dir = join(root, "inst2");
  const r = run(["--dir", dir, "--tarball", tar]);
  assert.notEqual(r.status, 0);

  const foreign = join(root, "ajena");
  mkdirSync(foreign);
  writeFileSync(join(foreign, "mis-datos.txt"), "x");
  const r2 = run(["--local", "--dir", foreign, "--tarball", tar]);
  assert.notEqual(r2.status, 0);
  assert.match(r2.stderr, /no parece una instalación de Pizarro/);
  assert.equal(existsSync(join(foreign, "mis-datos.txt")), true);
});

test("get.sh: un tarball incompleto o corrupto se rechaza", { skip: process.getuid?.() !== 0 && "requiere root" }, () => {
  const bad = makeTarball("d", { "README.md": "x\n" });
  const r = run(["--local", "--dir", join(root, "inst3"), "--tarball", bad]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no contiene Pizarro completo/);
  writeFileSync(join(root, "roto.tar.gz"), "no es un tar");
  const r2 = run(["--local", "--dir", join(root, "inst3"), "--tarball", join(root, "roto.tar.gz")]);
  assert.notEqual(r2.status, 0);
});

test("get.sh: sin Docker y sin --yes ni terminal no instala nada", () => {
  // PATH sin docker: solo utilidades básicas.
  const r = spawnSync("setsid", ["-w", "sh", GET, "--local", "--tarball", "/nada", "--dir", join(root, "inst4")], {
    encoding: "utf8",
    env: mkEnv("/usr/bin:/bin"),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (spawnSync("sh", ["-c", "command -v docker"], { env: mkEnv("/usr/bin:/bin") }).status === 0) return; // docker real instalado
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /Docker/);
});

test("cleanup", () => {
  rmSync(root, { recursive: true, force: true });
});
