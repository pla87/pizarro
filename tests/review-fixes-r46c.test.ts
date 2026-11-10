// Revisión: avisos del canal en vivo con acciones propias en vuelo, comprobación de versión ya publicada del
// workflow de release, escritura de adjuntos que no deja temporales ni huérfanos y aviso en el registro si el apagado
// no encuentra el servidor HTTP.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { announceOnArrival, settleIncoming, type IncomingChange } from "../src/components/board/remoteChange";
import { resetShutdownForTests, runShutdown, type ShutdownDeps } from "../src/lib/shutdown";
import { removeAttachmentFiles, saveAttachmentFiles, saveRawAttachmentFile } from "../src/lib/uploads";

describe("canal en vivo con acciones propias en vuelo (una subida larga)", () => {
  test("lo de otras personas (o del sistema) se reenvía al llegar; lo propio espera", () => {
    assert.equal(announceOnArrival({ action: "tasks.addComment", taskId: "t1", userId: "bea" }, "ana"), true);
    assert.equal(announceOnArrival({ action: "jobs.reminder", taskId: "t1", userId: null }, "ana"), true);
    assert.equal(announceOnArrival({ action: "tasks.addComment", taskId: "t1", userId: "ana" }, "ana"), false);
  });

  test("al decidir: no se reenvía dos veces lo ya reenviado ni lo de una acción propia; refresca si hay algo ajeno", () => {
    const bea = { action: "tasks.addComment", taskId: "t1", userId: "bea" };
    const otherTab = { action: "tasks.editComment", taskId: "t1", userId: "ana" };
    const mine = { action: "tasks.addComment", taskId: "t1", userId: "ana" };
    const queue: IncomingChange[] = [
      { cid: "c1", change: bea, announced: true },
      { cid: "c2", change: otherTab, announced: false },
      { cid: "c3", change: mine, announced: false },
    ];
    const own = new Set(["c3", "c9"]);
    assert.deepEqual(settleIncoming(queue, own), { announce: [otherTab], refresh: true });
    assert.deepEqual([...own], ["c9"], "se olvidan los ids ya vistos");
    assert.deepEqual(settleIncoming([{ cid: "c9", change: mine, announced: false }], own), { announce: [], refresh: false });
  });
});

describe("workflow de release: versión ya publicada", () => {
  /** El script del paso que comprueba la versión, ejecutado con un `git` falso (ls-remote devuelve FAKE_LS). */
  function runCheck(env: Record<string, string>) {
    const wf = readFileSync(".github/workflows/release.yml", "utf8");
    const m = /- name: Comprobar que la etiqueta coincide con package\.json\n\s+run: \|\n((?: {10}.*\n|\n)+)/.exec(wf);
    assert.ok(m, "paso de comprobación");
    const script = m[1]!.replace(/^ {10}/gm, "");
    const dir = mkdtempSync(path.join(tmpdir(), "pz-release-"));
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "git"), `#!/bin/sh\necho "$*" >> "${dir}/git-calls"\n[ -n "$FAKE_FAIL" ] && exit 128\nprintf "%s" "$FAKE_LS"\n`);
    chmodSync(path.join(bin, "git"), 0o755);
    const ghEnv = path.join(dir, "env");
    writeFileSync(ghEnv, "");
    const r = spawnSync("bash", ["-e", "-c", script], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_ENV: ghEnv, ...env } });
    return { status: r.status, stderr: r.stderr, env: readFileSync(ghEnv, "utf8"), gitCalls: existsSync(path.join(dir, "git-calls")) ? readFileSync(path.join(dir, "git-calls"), "utf8") : "" };
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

describe("escritura de adjuntos", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pz-uploads-"));
  process.env.UPLOAD_DIR = dir;
  const tmps = () => readdirSync(dir).filter((f) => f.endsWith(".tmp"));

  test("si falla la escritura, no queda el temporal", async () => {
    // El destino es una carpeta: el rename falla después de escribir el temporal.
    mkdirSync(path.join(dir, "craw1.bin"));
    writeFileSync(path.join(dir, "craw1.bin", "x"), "x");
    await assert.rejects(saveRawAttachmentFile("craw1", Buffer.from("hola")));
    assert.deepEqual(tmps(), []);
  });

  test("si falla la miniatura, espera a la otra escritura: borrar al fallar no deja huérfanos", async () => {
    mkdirSync(path.join(dir, "cimg1.thumb.webp"));
    writeFileSync(path.join(dir, "cimg1.thumb.webp", "x"), "x");
    const big = Buffer.alloc(64 * 1024 * 1024, 1);
    await assert.rejects(saveAttachmentFiles("cimg1", { full: big, thumb: Buffer.from("t"), width: 1, height: 1 }));
    // Lo que hace la ruta de subida al fallar.
    await removeAttachmentFiles(["cimg1"]);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(existsSync(path.join(dir, "cimg1.webp")), false, "la imagen no aparece después del borrado");
    assert.deepEqual(tmps(), []);
  });
});

describe("apagado sin servidor HTTP encontrado", () => {
  function deps(closed: number) {
    const logs: { level?: string; action: string }[] = [];
    const d: ShutdownDeps = {
      flushLogs: async () => {}, logEvent: (e) => void logs.push(e), closeStreams: () => 0, exit: () => {}, graceMs: 20, flushMs: 20,
      stopListening: async () => ({ closed, drained: async () => 0 }),
    };
    return { d, logs };
  }
  async function run(nodeEnv: string, closed: number) {
    resetShutdownForTests();
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = nodeEnv;
    try {
      const x = deps(closed);
      await runShutdown("SIGTERM", x.d);
      return x.logs.filter((l) => l.action === "system.shutdown.no_listener");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
      resetShutdownForTests();
    }
  }

  test("en producción deja un aviso en el registro; con el servidor encontrado o fuera de producción, no", async () => {
    const warned = await run("production", 0);
    assert.equal(warned.length, 1);
    assert.equal(warned[0]!.level, "warn");
    assert.equal((await run("production", 1)).length, 0);
    assert.equal((await run("test", 0)).length, 0);
  });
});
