// `npm start` parado con SIGTERM al proceso de npm: npm reenvía la señal al `sh -c` que ejecuta el script; dash muere sin
// pasarla a node y el servidor se quedaba huérfano escuchando. El script empieza por `exec` (la señal llega a node) y
// start-local.mjs vigila además al proceso padre (scripts/parent-watch.mjs) para apagarse si desaparece.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
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

test("el script start sustituye el sh de npm por node (exec) y sigue arrancando start-local.mjs", () => {
  assert.match(startScript, /^exec node /);
  assert.match(startScript, /scripts\/start-local\.mjs$/);
});

test("SIGTERM al sh que lanza npm llega a node (como hace npm al pararlo)", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pz-start-"));
  const fixture = path.join(dir, "server.mjs");
  await writeFile(fixture, `process.on("SIGTERM", () => { console.log("SIGTERM recibida"); process.exit(0); }); console.log("listo"); setTimeout(() => process.exit(1), 5000);`);
  // El mismo script de package.json, con un servidor de prueba en vez de start-local.mjs.
  const child = spawn("sh", ["-c", startScript.replace("scripts/start-local.mjs", JSON.stringify(fixture))], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  child.stdout!.on("data", (d) => (out += d));
  const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
  for (let i = 0; i < 100 && !out.includes("listo"); i++) await sleep(50);
  assert.match(out, /listo/);
  child.kill("SIGTERM");
  await exited;
  for (let i = 0; i < 40 && !out.includes("SIGTERM recibida"); i++) await sleep(50);
  assert.match(out, /SIGTERM recibida/, "node no recibió la señal: se quedaría huérfano");
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
