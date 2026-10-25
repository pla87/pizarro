// Parte de las copias de seguridad que habla con PostgreSQL: volcado consistente y restauración.
// Sin dependencias de Next (lo importan también scripts/restore.ts y la prueba de restauración).
// Funciona con cualquier cliente que ofrezca SQL en bruto: el de Prisma (la app) o el de pg (backup-pg.ts, que usan
// la herramienta de restauración y la prueba mensual, sin cargar Prisma).

import { orderTables, readLines, splitDataLine, verifyBackupFile, writeBackupFile, type BackupManifest, type TableBatch } from "./backup-core";

export interface RawSql {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}
export interface Client extends RawSql {
  $transaction<R>(fn: (tx: RawSql) => Promise<R>, options?: { maxWait?: number; timeout?: number; isolationLevel?: "RepeatableRead" }): Promise<R>;
}

const FETCH_ROWS = 500;
const INSERT_ROWS = 500;
/** Tablas de Prisma que no se copian: la restauración parte de una BD con las migraciones ya aplicadas. */
const SKIP_TABLES = new Set(["_prisma_migrations"]);

/** Identificador SQL entre comillas. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function listTables(sql: RawSql): Promise<string[]> {
  const rows = await sql.$queryRawUnsafe<{ t: string }[]>(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  return rows.map((r) => r.t).filter((t) => !SKIP_TABLES.has(t));
}

async function listForeignKeys(sql: RawSql): Promise<{ child: string; parent: string }[]> {
  return sql.$queryRawUnsafe(
    `SELECT c.relname AS child, p.relname AS parent
       FROM pg_constraint k
       JOIN pg_class c ON c.oid = k.conrelid
       JOIN pg_class p ON p.oid = k.confrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE k.contype = 'f' AND n.nspname = 'public'`,
  );
}

/** Última migración aplicada con éxito (o null si la tabla no existe). */
export async function lastMigration(sql: RawSql): Promise<string | null> {
  try {
    const rows = await sql.$queryRawUnsafe<{ migration_name: string }[]>(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1",
    );
    return rows[0]?.migration_name ?? null;
  } catch {
    return null;
  }
}

/**
 * Vuelca toda la base de datos a `file` (NDJSON → gzip → AES-256-GCM) dentro de una transacción
 * REPEATABLE READ: todas las tablas se leen del mismo instante, aunque la app siga escribiendo.
 */
export async function dumpDatabase(client: Client, file: string, key: Buffer): Promise<{ manifest: BackupManifest; bytes: number }> {
  return client.$transaction(
    async (tx) => {
      const [tables, fks, migration] = await Promise.all([listTables(tx), listForeignKeys(tx), lastMigration(tx)]);
      const { order } = orderTables(tables, fks);
      async function* source(): AsyncGenerator<TableBatch> {
        for (const name of order) {
          yield { name, rows: [] }; // Registra la tabla en el manifiesto aunque esté vacía.
          // Cursor: se lee por lotes sin cargar la tabla entera en memoria.
          await tx.$executeRawUnsafe(`DECLARE pz_backup NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS j FROM ${quoteIdent(name)} t`);
          try {
            for (;;) {
              const rows = await tx.$queryRawUnsafe<{ j: string }[]>(`FETCH ${FETCH_ROWS} FROM pz_backup`);
              if (rows.length === 0) break;
              yield { name, rows: rows.map((r) => r.j) };
            }
          } finally {
            await tx.$executeRawUnsafe("CLOSE pz_backup");
          }
        }
      }
      return writeBackupFile({ file, key, tables: source(), migration, build: process.env.NEXT_PUBLIC_BUILD_ID ?? null });
    },
    { isolationLevel: "RepeatableRead", maxWait: 15_000, timeout: 30 * 60_000 },
  );
}

/**
 * Restaura una copia en una base de datos VACÍA con las migraciones ya aplicadas (`prisma migrate deploy`).
 * Verifica antes toda la copia (clave, integridad, sha256 y cuentas) y carga todo en una sola transacción:
 * si algo falla, la base de datos queda como estaba.
 */
export async function restoreDatabase(client: Client, file: string, key: Buffer, log: (msg: string) => void = () => {}, opts: { verified?: BackupManifest } = {}): Promise<BackupManifest> {
  let manifest = opts.verified;
  if (!manifest) {
    log("Verificando la copia (descifrado, integridad y cuentas)…");
    manifest = (await verifyBackupFile(file, key)).manifest;
    log(`Copia válida: ${manifest.totalRows} filas en ${manifest.tables.length} tablas, hecha el ${manifest.createdAt}.`);
  }
  const m = manifest;

  const tables = await listTables(client);
  const missing = m.tables.filter((t) => !tables.includes(t.name)).map((t) => t.name);
  if (missing.length) throw new Error(`Faltan tablas en la base de datos (¿migraciones sin aplicar?): ${missing.join(", ")}`);
  const current = await lastMigration(client);
  if (current !== m.migration) {
    throw new Error(`La base de datos está en la migración «${current ?? "ninguna"}» y la copia en «${m.migration ?? "ninguna"}». Aplica la misma versión de la app (prisma migrate deploy) antes de restaurar.`);
  }
  // «Vacía» = sin datos de usuario. Las migraciones siembran algunas filas (p. ej. los tipos de tarea):
  // esas se reemplazan por las de la copia dentro de la misma transacción.
  for (const name of ["User", "Project"]) {
    if (!tables.includes(name)) continue;
    const [row] = await client.$queryRawUnsafe<{ n: boolean }[]>(`SELECT EXISTS (SELECT 1 FROM ${quoteIdent(name)}) AS n`);
    if (row?.n) throw new Error(`La base de datos NO está vacía (la tabla ${name} tiene filas). La restauración solo se hace sobre una base de datos recién migrada, sin usuarios ni proyectos (no arranques la app antes: el seed crea el administrador).`);
  }

  await client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map(quoteIdent).join(", ")} CASCADE`);
      const inserted = new Map<string, number>();
      let table: string | null = null;
      let batch: string[] = [];
      const flush = async () => {
        if (!table || batch.length === 0) return;
        // jsonb_populate_recordset convierte cada campo JSON al tipo real de la columna (fechas, enums, JSON…).
        await tx.$executeRawUnsafe(`INSERT INTO ${quoteIdent(table)} SELECT * FROM jsonb_populate_recordset(null::${quoteIdent(table)}, $1::jsonb)`, `[${batch.join(",")}]`);
        inserted.set(table, (inserted.get(table) ?? 0) + batch.length);
        batch = [];
      };
      for await (const line of readLines(file, key)) {
        if (line.startsWith('{"manifest":')) continue;
        const parts = splitDataLine(line);
        if (!parts) throw new Error("Línea de datos con formato inválido.");
        if (parts.table !== table) {
          await flush();
          table = parts.table;
          log(`Restaurando ${table}…`);
        }
        batch.push(parts.row);
        if (batch.length >= INSERT_ROWS) await flush();
      }
      await flush();
      for (const t of m.tables) {
        if ((inserted.get(t.name) ?? 0) !== t.rows) throw new Error(`Tabla ${t.name}: se esperaban ${t.rows} filas y se insertaron ${inserted.get(t.name) ?? 0}.`);
      }
    },
    { maxWait: 15_000, timeout: 60 * 60_000 },
  );
  return m;
}
