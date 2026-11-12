// El volcado de cada copia va en una conexión propia (no ocupa una del pool de la app durante minutos), con la misma
// instantánea consistente (REPEATABLE READ) y la conexión cerrada siempre: al terminar, si falla y si pasa del tope.
// También: una sola copia a la vez entre procesos y copias cortadas entre el volcado y el manifiesto.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server, type Socket } from "node:net";
import { after, describe, test } from "node:test";
import { db, makeUser } from "./helpers";

const { connectPg, dumpDatabaseOwnConnection } = await import("../../src/lib/backup-pg");
const { PG_CONNECT_TIMEOUT_MS } = await import("../../src/lib/pg-connect");
const { verifyBackupFile } = await import("../../src/lib/backup-core");

const url = process.env.DATABASE_URL!;
const key = randomBytes(32);
const dir = await mkdtemp(path.join(tmpdir(), "pz-dump-"));
after(() => rm(dir, { recursive: true, force: true }));

async function backupConnections(): Promise<number> {
  // Un instante para que el servidor retire la sesión cerrada.
  await new Promise((r) => setTimeout(r, 100));
  const [row] = await db.$queryRawUnsafe<{ n: number }[]>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'pizarro-backup'");
  return row!.n;
}

describe("volcado en conexión propia", () => {
  test("copia válida, en una conexión aparte, cerrada al terminar; todas las tablas del mismo instante (REPEATABLE READ)", async () => {
    await makeUser();
    const before = await db.user.count();
    const file = path.join(dir, "ok.pzbak");
    let seen: { isolation: string; app: string } | null = null;
    const { manifest } = await dumpDatabaseOwnConnection(url, file, key, {
      onConnect: (sql) => {
        // Tras la primera consulta del volcado (la que fija la instantánea), la app crea otro usuario por su cuenta (pool
        // de Prisma, ya confirmado): no debe salir en la copia.
        const orig = sql.$queryRawUnsafe.bind(sql);
        let done = false;
        sql.$queryRawUnsafe = (async (query: string, ...values: unknown[]) => {
          const rows = await orig(query, ...values);
          if (!done && query.includes("information_schema.tables")) {
            done = true;
            seen = (await orig<{ isolation: string; app: string }[]>("SELECT current_setting('transaction_isolation') AS isolation, current_setting('application_name') AS app"))[0]!;
            await makeUser();
          }
          return rows;
        }) as typeof sql.$queryRawUnsafe;
      },
    });
    assert.deepEqual(seen, { isolation: "repeatable read", app: "pizarro-backup" });
    assert.equal(await db.user.count(), before + 1);
    assert.equal(manifest.tables.find((t) => t.name === "User")?.rows, before, "el usuario creado durante el volcado no entra");
    assert.equal((await verifyBackupFile(file, key)).manifest.totalRows, manifest.totalRows);
    assert.equal(await backupConnections(), 0, "la conexión se cierra al terminar");
  });

  test("si el volcado falla o pasa del tope, la conexión se cierra igual", async () => {
    await assert.rejects(dumpDatabaseOwnConnection(url, path.join(dir, "no-existe", "x.pzbak"), key));
    assert.equal(await backupConnections(), 0, "tras un fallo");
    await assert.rejects(dumpDatabaseOwnConnection(url, path.join(dir, "lento.pzbak"), key, { timeoutMs: 1 }), /se ha cortado/);
    assert.equal(await backupConnections(), 0, "tras pasar del tope");
  });
});

/** Servidor TCP que acepta la conexión y no contesta nunca (como un PostgreSQL colgado o un cortafuegos a medias). */
async function silentServer(): Promise<{ url: string; sockets: () => number; close: () => Promise<void> }> {
  const open = new Set<Socket>();
  const server: Server = createServer((sock) => {
    open.add(sock);
    sock.resume(); // lee (y descarta) lo que llegue: así se entera de que el otro lado cerró
    sock.on("close", () => open.delete(sock));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return {
    url: `postgresql://postgres:x@127.0.0.1:${port}/nada`,
    sockets: () => open.size,
    close: () => {
      for (const s of open) s.destroy();
      return new Promise((r) => server.close(() => r()));
    },
  };
}

describe("conexión propia con tope para conectar", () => {
  test("un servidor que no contesta: falla al cumplirse el tope (15 s por defecto) y no deja la conexión abierta", async () => {
    assert.equal(PG_CONNECT_TIMEOUT_MS, 15_000);
    const silent = await silentServer();
    try {
      const started = Date.now();
      await assert.rejects(connectPg(silent.url, { connectTimeoutMs: 200 }), /timeout|terminated/i);
      assert.ok(Date.now() - started < 5_000, "no espera para siempre");
      await assert.rejects(dumpDatabaseOwnConnection(silent.url, path.join(dir, "colgado.pzbak"), key, { connectTimeoutMs: 200 }), /timeout|terminated/i);
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(silent.sockets(), 0, "la conexión fallida se cierra");
    } finally {
      await silent.close();
    }
  });

  test("con una base que responde, la conexión lleva keepalive", async () => {
    const sql = await connectPg(url);
    try {
      assert.equal((sql.client as unknown as { connection: { _keepAlive: boolean } }).connection._keepAlive, true);
      assert.equal((await sql.$queryRawUnsafe<{ n: number }[]>("SELECT 1 AS n"))[0]!.n, 1);
    } finally {
      await sql.end();
    }
  });

  test("si la conexión del volcado falla, la copia termina como fallida y no se queda «en curso»", async () => {
    const { createBackup } = await import("../../src/lib/backup");
    const uploads = await mkdtemp(path.join(tmpdir(), "pz-uploads-"));
    const saved = { url: process.env.DATABASE_URL, key: process.env.BACKUP_KEY, up: process.env.UPLOAD_DIR };
    // Puerto cerrado: la conexión se rechaza en el acto (el caso colgado lo cubre el tope de arriba).
    Object.assign(process.env, { DATABASE_URL: "postgresql://postgres:x@127.0.0.1:1/nada", BACKUP_KEY: randomBytes(32).toString("base64"), UPLOAD_DIR: uploads });
    try {
      const first = await createBackup();
      assert.equal(first.ok, false);
      assert.doesNotMatch(first.error ?? "", /en curso/);
      const second = await createBackup();
      assert.equal(second.ok, false);
      assert.doesNotMatch(second.error ?? "", /Ya hay una copia en curso/, "el candado se suelta");
    } finally {
      process.env.DATABASE_URL = saved.url;
      if (saved.key === undefined) delete process.env.BACKUP_KEY;
      else process.env.BACKUP_KEY = saved.key;
      if (saved.up === undefined) delete process.env.UPLOAD_DIR;
      else process.env.UPLOAD_DIR = saved.up;
      await rm(uploads, { recursive: true, force: true });
    }
  });
});

/** Ejecuta `fn` con una UPLOAD_DIR nueva, una BACKUP_KEY y estas variables; después deja el entorno como estaba. */
async function withBackupEnv(vars: Record<string, string>, fn: (uploads: string) => Promise<void>): Promise<void> {
  const uploads = await mkdtemp(path.join(tmpdir(), "pz-uploads-"));
  const names = ["UPLOAD_DIR", "BACKUP_KEY", ...Object.keys(vars)];
  const saved = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { UPLOAD_DIR: uploads, BACKUP_KEY: randomBytes(32).toString("base64"), ...vars });
  try {
    await fn(uploads);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(uploads, { recursive: true, force: true });
  }
}

describe("copias: una sola a la vez y copias cortadas", () => {
  test("una sola copia o subida a la vez entre procesos (bloqueo LOCK_BACKUP de Postgres)", async () => {
    const { createBackup, listBackups, readStatus, syncExternal } = await import("../../src/lib/backup");
    const { withAdvisoryLock } = await import("../../src/lib/jobs");
    const { LOCK_BACKUP } = await import("../../src/lib/advisory-locks");
    const external = await mkdtemp(path.join(tmpdir(), "pz-ext-"));
    try {
      await withBackupEnv({ BACKUP_EXTERNAL_DIR: external }, async () => {
        const first = await createBackup();
        assert.equal(first.ok, true, first.error);
        const status = await readStatus();
        // Otro proceso (otra conexión) está copiando: aquí no se hace nada, ni se anota como fallo.
        let release!: () => void;
        const held = new Promise<void>((r) => (release = r));
        let entered!: () => void;
        const inside = new Promise<void>((r) => (entered = r));
        const other = withAdvisoryLock(LOCK_BACKUP, async () => {
          entered();
          await held;
        });
        await inside;
        try {
          await new Promise((r) => setTimeout(r, 1100)); // los nombres de las copias van por segundos
          const busy = await createBackup();
          assert.equal(busy.ok, false);
          assert.match(busy.error ?? "", /Ya hay una copia en curso/);
          assert.deepEqual(await syncExternal({ force: true }), [], "la subida tampoco");
          assert.deepEqual((await listBackups()).map((b) => b.name), [first.file]);
          assert.deepEqual(await readStatus(), status, "no cuenta como copia fallida");
        } finally {
          release();
          await other;
        }
        const after = await createBackup();
        assert.equal(after.ok, true, after.error);
        assert.deepEqual((await syncExternal()).map((r) => r.ok), [true]);
      });
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  });

  test("copia cortada entre el volcado y el manifiesto: no es la última ni frena la copia diaria", async () => {
    const { createBackup, dailyBackupJob, latestBackupPath, listBackups, readStatus } = await import("../../src/lib/backup");
    const { backupFileName } = await import("../../src/lib/backup-core");
    await withBackupEnv({}, async (uploads) => {
      const good = await createBackup();
      assert.equal(good.ok, true, good.error);
      const backups = path.join(uploads, "backups");
      // Durante la copia, el volcado es un temporal; el .pzbak solo aparece con su manifiesto.
      assert.deepEqual((await readdir(backups)).filter((n) => n.endsWith(".tmp")), []);
      assert.ok((await readdir(backups)).includes(good.file!.replace(/\.pzbak$/, ".pzman")));
      // Un volcado sin manifiesto, más reciente (de una versión anterior, o de un corte justo antes del manifiesto).
      const cut = backupFileName(new Date(Date.now() + 20 * 3600 * 1000));
      await copyFile(path.join(backups, good.file!), path.join(backups, cut));
      assert.deepEqual((await listBackups()).map((b) => b.name), [good.file]);
      assert.equal((await latestBackupPath())?.name, good.file, "ni se descarga ni se prueba como «la última»");
      // Pasado un día desde la buena, la tarea diaria hace copia aunque el volcado cortado sea de hace 4 h.
      const before = (await readStatus()).lastBackup?.at;
      await new Promise((r) => setTimeout(r, 1100));
      await dailyBackupJob(Date.now() + 24 * 3600 * 1000);
      const last = (await readStatus()).lastBackup;
      assert.notEqual(last?.at, before, "se ha hecho la copia diaria");
      assert.equal(last?.ok, true, last?.error);
      assert.equal((await listBackups()).length, 2);
    });
  });
});
