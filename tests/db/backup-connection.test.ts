// El volcado de cada copia va en una conexión propia (no ocupa una del pool de la app durante minutos), con la misma
// instantánea consistente (REPEATABLE READ) y la conexión cerrada siempre: al terminar, si falla y si pasa del tope.
// También: una sola copia a la vez entre procesos, copias cortadas entre el volcado y el manifiesto y la comprobación
// previa de espacio en el disco.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
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
  const [row] = await db.$queryRawUnsafe<{ n: number }[]>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'pizarro-backup'");
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
      // Con una copia reciente, la tarea no hace nada y lo dice («Omitida: ya hay una copia de las últimas 23 h» en Tareas de mantenimiento).
      assert.deepEqual(await dailyBackupJob(), { skipped: "alreadyToday" });
      // Pasado un día desde la buena, la tarea diaria hace copia aunque el volcado cortado sea de hace 4 h.
      const before = (await readStatus()).lastBackup?.at;
      await new Promise((r) => setTimeout(r, 1100));
      assert.equal(await dailyBackupJob(Date.now() + 24 * 3600 * 1000), undefined, "esta vez sí hace la copia");
      const last = (await readStatus()).lastBackup;
      assert.notEqual(last?.at, before, "se ha hecho la copia diaria");
      assert.equal(last?.ok, true, last?.error);
      assert.equal((await listBackups()).length, 2);
    });
  });
});

describe("nombres de las copias", () => {
  test("una copia nunca reutiliza la raíz de otra (dos en el mismo segundo): toma el segundo siguiente libre", async () => {
    const { createBackup } = await import("../../src/lib/backup");
    const { backupFileName } = await import("../../src/lib/backup-core");
    await withBackupEnv({}, async (uploads) => {
      const backups = path.join(uploads, "backups");
      await mkdir(backups, { recursive: true });
      // Raíces ya usadas desde este segundo hasta dentro de 5 (por el volcado o por el manifiesto).
      const base = Math.floor(Date.now() / 1000) * 1000;
      for (let i = 0; i <= 5; i++) {
        const name = backupFileName(new Date(base + i * 1000));
        await writeFile(path.join(backups, i % 2 ? name : name.replace(/\.pzbak$/, ".pzman")), "");
      }
      const run = await createBackup();
      assert.equal(run.ok, true, run.error);
      assert.equal(run.file, backupFileName(new Date(base + 6000)));
    });
  });
});

describe("copia diaria con el disco lleno", () => {
  test("con una copia anterior, si no cabe su volcado × 1,2 falla con «disco lleno» sin escribir nada; con sitio, vuelve a copiar", async () => {
    const { createBackup, dailyBackupJob, listBackups } = await import("../../src/lib/backup");
    const { NO_SPACE_MESSAGE } = await import("../../src/lib/disk-space");
    const { flushLogs } = await import("../../src/lib/log");
    await withBackupEnv({ DISK_MIN_FREE_MB: "" }, async (uploads) => {
      const backups = path.join(uploads, "backups");
      const written = async () => (await readdir(backups).catch(() => [])).filter((n) => n !== "status.json");
      const ok = await createBackup();
      assert.equal(ok.ok, true, ok.error);
      const after1 = (await written()).sort();
      // Un margen imposible: la estimación parte del volcado anterior (× 1,2) y no cabe.
      process.env.DISK_MIN_FREE_MB = String(1e12);
      const full = await createBackup();
      assert.equal(full.error, NO_SPACE_MESSAGE);
      assert.deepEqual((await written()).sort(), after1, "la copia buena sigue y no hay restos de la fallida");
      assert.equal((await listBackups()).length, 1);
      // El registro dice cuánto hay libre y el margen exigido.
      await flushLogs();
      const row = await db.appLog.findFirst({ where: { action: "backup.failed" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { message: true, details: true } });
      const details = row?.details as { estimatedDumpBytes?: number; freeBytes?: number; marginBytes?: number } | undefined;
      assert.equal(details?.estimatedDumpBytes, Math.ceil(ok.bytes! * 1.2));
      assert.equal(details?.marginBytes, 1e12 * 1024 * 1024);
      assert.equal(typeof details?.freeBytes, "number");
      assert.match(row?.message ?? "", /libres y se exige dejar un margen de .*DISK_MIN_FREE_MB/);
      // La tarea horaria falla con el mismo motivo (consta en Tareas de mantenimiento) y tampoco escribe nada.
      await assert.rejects(dailyBackupJob(Date.now() + 24 * 3600 * 1000), { message: NO_SPACE_MESSAGE });
      assert.deepEqual((await written()).sort(), after1);
    });
  });

  test("el margen libre de la copia es de 100 MB (no el común de hasta 1 GB); DISK_MIN_FREE_MB sigue mandando", async () => {
    const { createBackup, readStatus } = await import("../../src/lib/backup");
    const { assertDiskRoom, backupMarginBytes, diskMarginBytes, NO_SPACE_MESSAGE } = await import("../../src/lib/disk-space");
    const { flushLogs } = await import("../../src/lib/log");
    const MB = 1024 * 1024;
    assert.equal(backupMarginBytes(undefined), 100 * MB);
    assert.equal(backupMarginBytes(""), 100 * MB);
    assert.equal(backupMarginBytes("2048"), 2048 * MB);
    // 50 GB de disco con 600 MB libres: el margen común (1 GB) no deja volcar 300 MB; el de la copia, sí.
    const free = async () => 600 * MB;
    const total = async () => 50 * 1024 * MB;
    await assert.rejects(assertDiskRoom("/x", 300 * MB, free, total, undefined, (t) => diskMarginBytes(t, "")), { message: NO_SPACE_MESSAGE });
    await assertDiskRoom("/x", 300 * MB, free, total, undefined, () => backupMarginBytes(""));
    // createBackup lo usa: con un volcado anterior imposible, el registro dice que el margen exigido era de 100 MB.
    await withBackupEnv({ DISK_MIN_FREE_MB: "" }, async (uploads) => {
      const ok = await createBackup();
      assert.equal(ok.ok, true, ok.error);
      const file = path.join(uploads, "backups", "status.json");
      const status = await readStatus();
      await writeFile(file, JSON.stringify({ ...status, lastBackup: { ...status.lastBackup, bytes: 1e15 } }));
      const full = await createBackup();
      assert.equal(full.error, NO_SPACE_MESSAGE);
      await flushLogs();
      const row = await db.appLog.findFirst({ where: { action: "backup.failed" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { details: true } });
      assert.equal((row?.details as { marginBytes?: number } | undefined)?.marginBytes, 100 * MB);
    });
  });

  test("la primera copia (sin copia anterior) no se comprueba de antemano: el tamaño de la base en PostgreSQL no la bloquea", async () => {
    const { createBackup } = await import("../../src/lib/backup");
    await withBackupEnv({ DISK_MIN_FREE_MB: String(1e12) }, async () => {
      const run = await createBackup();
      assert.equal(run.ok, true, run.error);
    });
  });

  test("tras una restauración (todos los ficheros con fecha nueva) la copia no los cuenta como «por escribir»", async () => {
    const { createBackup, readStatus } = await import("../../src/lib/backup");
    const { diskStats } = await import("../../src/lib/disk-space");
    await withBackupEnv({ DISK_MIN_FREE_MB: "" }, async (uploads) => {
      const MB = 1024 * 1024;
      await writeFile(path.join(uploads, "grande.bin"), randomBytes(64 * MB));
      const first = await createBackup();
      assert.equal(first.ok, true, first.error);
      // La restauración (o un cp sin conservar las fechas) vuelve a escribir los ficheros: su fecha ya no coincide con
      // la de files-index.json, aunque sus objetos sigan en el almacén.
      const later = new Date(Date.now() + 3600 * 1000);
      await utimes(path.join(uploads, "grande.bin"), later, later);
      // Cabe el volcado × 1,2 con 32 MB de holgura, pero no los 64 MB de «ficheros nuevos» encima.
      const dump = Math.ceil((await readStatus()).lastBackup!.bytes! * 1.2);
      const free = (await diskStats(path.join(uploads, "backups")))!.free;
      process.env.DISK_MIN_FREE_MB = String(Math.floor((free - dump - 32 * MB) / MB));
      await new Promise((r) => setTimeout(r, 1100)); // los nombres de las copias van por segundos
      const again = await createBackup();
      assert.equal(again.ok, true, again.error);
    });
  });
});
