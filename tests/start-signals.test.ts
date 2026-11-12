// `npm start` parado con SIGTERM al proceso de npm: npm reenvía la señal al `sh -c` que ejecuta el script; dash muere sin
// pasarla a node. start-local.mjs vigila al proceso padre (scripts/parent-watch.mjs) y se apaga de forma ordenada en
// cuanto desaparece, así que el servidor no se queda huérfano escuchando. El script no empieza por `exec`: en Windows npm
// usa cmd.exe, que no lo entiende, y `npm start` no arrancaba.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

type WatchOpts = { parentPid?: number; currentPpid?: () => number; isAlive?: (pid: number) => boolean; onOrphan: () => void; intervalMs?: number };
// Especificador no literal: el script es .mjs (lo ejecuta node sin compilar) y tsc no tiene sus tipos.
const { watchParent, shutdownAsIfSigterm, processAlive } = (await import(new URL("../scripts/parent-watch.mjs", import.meta.url).href)) as {
  watchParent: (o: WatchOpts) => () => void;
  shutdownAsIfSigterm: (proc: unknown) => void;
  processAlive: (pid: number) => boolean;
};

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const startScript = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts.start!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** ¿Sigue en marcha? Un proceso ya terminado que su nuevo padre aún no ha recogido (zombi) no cuenta. */
const running = (pid: number) => {
  if (!processAlive(pid)) return false;
  try {
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return true;
  }
};

test("el script start funciona con cualquier shell (sin `exec`, que cmd.exe no entiende) y arranca start-local.mjs", () => {
  assert.doesNotMatch(startScript, /\bexec\b/);
  assert.match(startScript, /^node /);
  assert.match(startScript, /scripts\/start-local\.mjs$/);
  // Nada de sintaxis de shell POSIX (;, &&, $VAR, comillas simples) que cmd.exe interpretaría de otra forma.
  assert.doesNotMatch(startScript, /[;&|$'`]/);
});

const hasNpm = process.platform !== "win32" && spawnSync("npm", ["--version"], { stdio: "ignore" }).status === 0;

test("`npm start` parado con SIGTERM al pid de npm: el servidor se apaga de forma ordenada en ~1 s y no queda huérfano", { skip: !hasNpm }, async () => {
  // Copia mínima del proyecto: el script start de package.json, start-local.mjs con sus módulos y un servidor de prueba en
  // .next/standalone/server.js que anota cuándo arranca y cuándo recibe el apagado ordenado.
  const dir = await mkdtemp(path.join(tmpdir(), "pz-start-"));
  try {
    await mkdir(path.join(dir, "scripts"));
    await mkdir(path.join(dir, ".next", "standalone"), { recursive: true });
    for (const f of ["start-local.mjs", "parent-watch.mjs", "local-paths.mjs", "server.env"]) await copyFile(path.join(root, "scripts", f), path.join(dir, "scripts", f));
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "pz-start-test", private: true, scripts: { start: startScript } }));
    const log = path.join(dir, "server.log");
    await writeFile(
      path.join(dir, ".next", "standalone", "server.js"),
      [
        `const fs = require("fs");`,
        `const log = (m) => fs.appendFileSync(${JSON.stringify(log)}, m + " " + Date.now() + "\\n");`,
        `process.on("SIGTERM", () => { log("apagado"); setTimeout(() => process.exit(0), 50); });`,
        `log("listo " + process.pid);`,
        `setInterval(() => {}, 1000);`,
      ].join("\n"),
    );
    const npm = spawn("npm", ["start", "--silent"], { cwd: dir, stdio: "ignore", env: { ...process.env, npm_config_update_notifier: "false" } });
    let server = 0;
    for (let i = 0; i < 200 && !server; i++) {
      await sleep(50);
      const m = /listo (\d+)/.exec(await readFile(log, "utf8").catch(() => ""));
      if (m) server = Number(m[1]);
    }
    assert.ok(server > 0, "el servidor de prueba no arrancó");
    const npmExited = new Promise<void>((r) => npm.on("exit", () => r()));
    const killedAt = Date.now();
    npm.kill("SIGTERM");
    await npmExited;
    let stoppedAt = 0;
    for (let i = 0; i < 100 && !stoppedAt; i++) {
      await sleep(50);
      const m = /apagado (\d+)/.exec(await readFile(log, "utf8"));
      if (m) stoppedAt = Number(m[1]);
    }
    assert.ok(stoppedAt, "el servidor no recibió el apagado ordenado");
    assert.ok(stoppedAt - killedAt < 2500, `apagado ${stoppedAt - killedAt} ms después de parar npm`);
    for (let i = 0; i < 40 && running(server); i++) await sleep(50);
    if (running(server)) {
      process.kill(server, "SIGKILL");
      assert.fail("el servidor quedó huérfano");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("watchParent avisa una sola vez cuando el padre cambia (adoptado por init) o deja de existir", async () => {
  let ppid = 4242;
  let alive = true;
  let calls = 0;
  const stop = watchParent({ parentPid: 4242, currentPpid: () => ppid, isAlive: () => alive, onOrphan: () => calls++, intervalMs: 5 });
  await sleep(30);
  assert.equal(calls, 0, "con el padre vivo no hace nada");
  ppid = 1;
  await sleep(30);
  assert.equal(calls, 1);
  await sleep(30);
  assert.equal(calls, 1, "solo una vez");
  stop();

  // Windows no cambia el ppid al morir el padre: se comprueba también que siga existiendo.
  let calls2 = 0;
  const stop2 = watchParent({ parentPid: 4242, currentPpid: () => 4242, isAlive: () => alive, onOrphan: () => calls2++, intervalMs: 5 });
  alive = false;
  await sleep(30);
  assert.equal(calls2, 1);
  stop2();
});

test("watchParent no vigila si ya no había padre al arrancar", async () => {
  let calls = 0;
  watchParent({ parentPid: 1, currentPpid: () => 1, isAlive: () => false, onOrphan: () => calls++, intervalMs: 5 })();
  await sleep(20);
  assert.equal(calls, 0);
});

test("shutdownAsIfSigterm avisa a los manejadores de SIGTERM (apagado ordenado) y, sin ellos, sale con 143", () => {
  const withHandler = Object.assign(new EventEmitter(), { exit: (c: number) => assert.fail(`no debía salir (${c})`) });
  let got = "";
  withHandler.on("SIGTERM", (sig: string) => (got = sig));
  shutdownAsIfSigterm(withHandler);
  assert.equal(got, "SIGTERM");
  let code = 0;
  shutdownAsIfSigterm(Object.assign(new EventEmitter(), { exit: (c: number) => (code = c) }));
  assert.equal(code, 143);
});

test("processAlive: el proceso actual existe; un pid que no existe, no", () => {
  assert.equal(processAlive(process.pid), true);
  assert.equal(processAlive(2 ** 22 + 12345), false);
});
