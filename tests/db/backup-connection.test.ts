// El volcado de cada copia va en una conexión propia (no ocupa una del pool de la app durante minutos), con la misma
// instantánea consistente (REPEATABLE READ) y la conexión cerrada siempre: al terminar, si falla y si pasa del tope.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { db, makeUser } from "./helpers";

const { dumpDatabaseOwnConnection } = await import("../../src/lib/backup-pg");
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
