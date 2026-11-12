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
  assert.match(run(["--ref", "a/../b"]).stderr, /no es válida/);
  assert.match(run(["--dir", "/srv/pizarro/../x", "--tarball", "x"]).stderr, /\.\./);
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
  // Pedir --local sobre una instalación con dominio avisa de que se mantiene el actual y explica cómo cambiarlo.
  assert.match(r2.stdout, /AVISO: esta instalación ya usa https:\/\/tablero\.example\.com/);
  assert.match(r2.stdout, /DOMAIN y APP_URL/);
  // El cambio es atómico: no quedan carpetas temporales.
  assert.equal(existsSync(`${dir}.new`), false);
  assert.equal(existsSync(`${dir}.old`), false);
  assert.equal(readFileSync(join(dir, "deploy", ".env"), "utf8"), 'SESSION_SECRET="keep"\nAPP_URL="https://tablero.example.com"\n');
  assert.equal(readFileSync(join(dir, "deploy", "recovery-kit.txt"), "utf8"), "kit\n");
  assert.equal(existsSync(join(dir, "src", "new.txt")), true);
  assert.equal(existsSync(join(dir, "src", "old.txt")), false);

  // Sin opciones y con un .env real: no pregunta, deja que install.sh reutilice el dominio.
  const r3 = run(["--dir", dir, "--tarball", tar2, "--no-start"]);
  assert.equal(r3.status, 0, r3.stderr + r3.stdout);
  assert.equal(readFileSync(join(dir, "deploy", "args.txt"), "utf8").trim(), "--no-start");
});

test("get.sh: --domain distinto del que ya hay avisa; el mismo no", { skip: process.getuid?.() !== 0 && "requiere root" }, () => {
  const tar = makeTarball("w", full());
  const dir = join(root, "inst-warn");
  assert.equal(run(["--local", "--dir", dir, "--tarball", tar]).status, 0);
  writeFileSync(join(dir, "deploy", ".env"), 'APP_URL="https://tablero.example.com"\n');
  const otro = run(["--domain", "nuevo.example.com", "--dir", dir, "--tarball", tar]);
  assert.equal(otro.status, 0, otro.stderr);
  assert.match(otro.stdout, /AVISO/);
  const igual = run(["--domain", "Tablero.example.com", "--dir", dir, "--tarball", tar]);
  assert.equal(igual.status, 0, igual.stderr);
  assert.doesNotMatch(igual.stdout, /AVISO/);
});

test("get.sh: recupera una carpeta que solo tiene deploy/.env (ejecución anterior interrumpida) y un .old huérfano", { skip: process.getuid?.() !== 0 && "requiere root" }, () => {
  const tar = makeTarball("r", full());
  const dir = join(root, "inst-rec");
  mkdirSync(join(dir, "deploy"), { recursive: true });
  writeFileSync(join(dir, "deploy", ".env"), 'APP_URL="https://tablero.example.com"\n');
  writeFileSync(join(dir, "deploy", "recovery-kit.txt"), "kit\n");
  const r = run(["--dir", dir, "--tarball", tar, "--no-start"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(readFileSync(join(dir, "deploy", ".env"), "utf8"), 'APP_URL="https://tablero.example.com"\n');
  assert.equal(readFileSync(join(dir, "deploy", "recovery-kit.txt"), "utf8"), "kit\n");
  assert.equal(existsSync(join(dir, "Dockerfile")), true);

  // Cortada entre los dos «mv»: la carpeta buena quedó en .old y la principal no existe.
  const dir2 = join(root, "inst-orph");
  mkdirSync(`${dir2}.old/deploy`, { recursive: true });
  writeFileSync(join(`${dir2}.old`, "deploy", ".env"), 'APP_URL="https://tablero.example.com"\n');
  writeFileSync(join(`${dir2}.old`, "Dockerfile"), "x\n");
  writeFileSync(join(`${dir2}.old`, "deploy", "install.sh"), "x\n");
  const r2 = run(["--dir", dir2, "--tarball", tar, "--no-start"]);
  assert.equal(r2.status, 0, r2.stderr + r2.stdout);
  assert.equal(readFileSync(join(dir2, "deploy", ".env"), "utf8"), 'APP_URL="https://tablero.example.com"\n');
  assert.equal(existsSync(`${dir2}.old`), false);
});

test("get.sh: un script truncado no ejecuta nada (todo va dentro de main, que se llama al final)", () => {
  const src = readFileSync(GET, "utf8");
  assert.match(src, /^main "\$@"\n$/m);
  assert.match(src, /trap 'exit 130' INT/);
  assert.match(src, /trap 'exit 143' TERM/);
  const marca = join(root, "marca-truncado");
  const cortado = src.slice(0, src.indexOf("# --- Descarga del código")) + `\n  touch ${marca}\n`;
  const f = join(root, "get-truncado.sh");
  writeFileSync(f, cortado);
  const r = spawnSync("setsid", ["-w", "sh", f, "--local"], { encoding: "utf8", env: mkEnv(`${bin}:${process.env.PATH}`), stdio: ["ignore", "pipe", "pipe"] });
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(marca), false);
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

// Sin red (curl falso que falla): una instalación existente no pasa a construir main; una nueva pide --build o --ref main.
test("get.sh: si falla la consulta de la última versión no construye main a escondidas", { skip: process.getuid?.() !== 0 && "requiere root" }, () => {
  const fake = join(root, "bin-offline");
  mkdirSync(fake, { recursive: true });
  writeFileSync(join(fake, "curl"), "#!/bin/sh\nexit 22\n");
  chmodSync(join(fake, "curl"), 0o755);
  const runOffline = (args: string[]) =>
    spawnSync("setsid", ["-w", "sh", GET, ...args], { encoding: "utf8", env: mkEnv(`${fake}:${bin}:${process.env.PATH}`), stdio: ["ignore", "pipe", "pipe"] });
  const fresh = join(root, "inst-offline-new");
  const a = runOffline(["--domain", "pizarro.example.com", "--dir", fresh]);
  assert.notEqual(a.status, 0);
  assert.match(a.stderr, /--build/);
  assert.equal(existsSync(fresh), false);
  const old = join(root, "inst-offline-old");
  mkdirSync(join(old, "deploy"), { recursive: true });
  writeFileSync(join(old, "Dockerfile"), "FROM scratch\n");
  writeFileSync(join(old, "deploy", ".env"), 'APP_URL="https://p.example.com"\n');
  const b = runOffline(["--domain", "p.example.com", "--build", "--dir", old]);
  assert.notEqual(b.status, 0);
  assert.match(b.stderr, /--version X\.Y\.Z/);
  assert.equal(readFileSync(join(old, "deploy", ".env"), "utf8"), 'APP_URL="https://p.example.com"\n');
});

test("cleanup", () => {
  rmSync(root, { recursive: true, force: true });
});

test("get.sh: --version valida el formato, no se mezcla con --ref y se pasa a install.sh con su etiqueta", { skip: process.getuid?.() !== 0 && "requiere root" }, () => {
  assert.match(run(["--version", "1.2"]).stderr, /no es válida/);
  assert.match(run(["--version", "x;rm"]).stderr, /no es válida/);
  assert.match(run(["--version", "1.2.3", "--ref", "main"]).stderr, /no los dos/);
  const tar = makeTarball("v", full());
  const dir = join(root, "inst-v");
  const r = run(["--domain", "pizarro.example.com", "--version", "v1.2.3", "--dir", dir, "--tarball", tar]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(readFileSync(join(dir, "deploy", "args.txt"), "utf8").trim(), "--domain pizarro.example.com --version 1.2.3");
  const b = run(["--domain", "pizarro.example.com", "--build", "--dir", dir, "--tarball", tar]);
  assert.equal(b.status, 0, b.stderr + b.stdout);
  assert.equal(readFileSync(join(dir, "deploy", "args.txt"), "utf8").trim(), "--domain pizarro.example.com --build");
  // Una rama no tiene imagen publicada: se construye aquí.
  const m = run(["--domain", "pizarro.example.com", "--ref", "main", "--dir", dir, "--tarball", tar]);
  assert.equal(m.status, 0, m.stderr + m.stdout);
  assert.match(readFileSync(join(dir, "deploy", "args.txt"), "utf8"), /--build/);
});

// install.sh de verdad (con --no-start: no llega a llamar a docker).
test("install.sh: --version fija la imagen, --unpin la suelta, --build usa compose.build.yml y se respeta un registro propio", () => {
  const dir = join(root, "inst-real", "deploy");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".env.example"), 'DOMAIN="pizarro.example.com"\nAPP_URL="https://pizarro.example.com"\nPOSTGRES_PASSWORD=""\nSESSION_SECRET=""\nBACKUP_KEY=""\n');
  writeFileSync(join(dir, "compose.yml"), "name: pizarro\n");
  writeFileSync(join(dir, "install.sh"), readFileSync(join(process.cwd(), "deploy", "install.sh"), "utf8"));
  const env = mkEnv(`${bin}:${process.env.PATH}`);
  const go = (...args: string[]) => {
    const r = spawnSync("sh", [join(dir, "install.sh"), "--domain", "a.example.com", "--no-start", ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return readFileSync(join(dir, ".env"), "utf8");
  };
  assert.doesNotMatch(go(), /PIZARRO_IMAGE|COMPOSE_FILE/);
  assert.match(go("--version", "v1.38.0"), /^PIZARRO_IMAGE="ghcr\.io\/pla87\/pizarro:1\.38\.0"$/m);
  assert.doesNotMatch(go("--unpin"), /PIZARRO_IMAGE/);
  assert.match(go("--build"), /^COMPOSE_FILE="compose\.yml:compose\.build\.yml"$/m);
  assert.doesNotMatch(go("--unpin"), /COMPOSE_FILE/);
  writeFileSync(join(dir, ".env"), `${readFileSync(join(dir, ".env"), "utf8")}PIZARRO_IMAGE="registro.example.com/pizarro:7"\n`);
  assert.match(go("--unpin"), /registro\.example\.com\/pizarro:7/);
  const bad = spawnSync("sh", [join(dir, "install.sh"), "--version", "1.x"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(bad.status, 2);
});

// Modo red local: la dirección va tal cual a APP_URL (http://…), así que se valida como el dominio.
test("install.sh --local: valida la dirección (nombre, IPv4 o [IPv6], con :puerto) y rechaza comillas y espacios", () => {
  const dir = join(root, "inst-local", "deploy");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".env.example"), 'DOMAIN="pizarro.example.com"\nAPP_URL="https://pizarro.example.com"\nPOSTGRES_PASSWORD=""\nSESSION_SECRET=""\nBACKUP_KEY=""\n');
  writeFileSync(join(dir, "compose.yml"), "name: pizarro\n");
  writeFileSync(join(dir, "install.sh"), readFileSync(join(process.cwd(), "deploy", "install.sh"), "utf8"));
  // Sin terminal se usa la primera dirección de `hostname -I` (aquí, un hostname falso que devuelve FAKE_IP).
  const hbin = join(root, "hostname-bin");
  mkdirSync(hbin, { recursive: true });
  writeFileSync(join(hbin, "hostname"), '#!/bin/sh\nprintf "%s\\n" "$FAKE_IP"\n');
  chmodSync(join(hbin, "hostname"), 0o755);
  const go = (ip: string) => {
    rmSync(join(dir, ".env"), { force: true });
    const r = spawnSync("sh", [join(dir, "install.sh"), "--local", "--no-start"], { encoding: "utf8", env: mkEnv(`${hbin}:${bin}:${process.env.PATH}`, { FAKE_IP: ip }), stdio: ["ignore", "pipe", "pipe"] });
    const env = existsSync(join(dir, ".env")) ? readFileSync(join(dir, ".env"), "utf8") : "";
    return { status: r.status, stderr: r.stderr, env, url: /^APP_URL="(.*)"$/m.exec(env)?.[1] ?? null };
  };
  for (const [ip, url] of [
    ["192.168.1.10", "http://192.168.1.10"],
    ["servidor.local:8080", "http://servidor.local:8080"],
    ["fd00::1", "http://[fd00::1]"],
    ["[fd00::1]:8080", "http://[fd00::1]:8080"],
    ["HTTP://Servidor.Local/ruta", "http://servidor.local"],
  ] as const) {
    const r = go(ip);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.url, url);
  }
  for (const bad of ['srv"x', "srv'x", "srv;x", "srv:0", "srv:99999", "srv:", "-srv", "a..b", "[zz::1]"]) {
    const r = go(bad);
    assert.equal(r.status, 1, `${bad} debía rechazarse`);
    assert.match(r.stderr, /no es válida/);
    assert.doesNotMatch(r.env, /^APP_URL="http:/m, `${bad}: no se escribe`);
  }
});
