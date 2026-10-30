import { readFile, readdir, statfs } from "node:fs/promises";
import { envGoogleCredentials } from "./google-config-core";
import os from "node:os";
import path from "node:path";
import pkg from "../../package.json";
import { parseBackupFileName } from "./backup-core";
import { db } from "./db";
import { configFlags, envPresence, groupLogCounts, migrationStatus, scrubDeep, scrubText, secretEnvValues, type ScrubContext } from "./doctor-core";
import { checkUploads, evaluateHealth, minFreeBytes } from "./health";
import { backupsDir, uploadDir } from "./upload-dir";

// Diagnóstico para soporte: estado técnico de la instalación SIN datos personales ni secretos. Lo usan la descarga de
// Administración → Ajustes (/api/admin/doctor) y node dist/doctor.mjs. Sin «server-only»: también corre fuera de Next.
// Cada bloque se recoge por separado: si uno falla (p. ej. sin BD) queda su error limpio y el resto sigue.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Carpeta de migraciones: en desarrollo ./prisma; en el contenedor, la del migrador; con `npm start`, dos niveles arriba. */
async function migrationFolder(): Promise<string[] | null> {
  const cwd = process.cwd();
  const candidates = [
    process.env.DOCTOR_MIGRATIONS_DIR,
    path.join(/*turbopackIgnore: true*/ cwd, "prisma", "migrations"),
    path.join(/*turbopackIgnore: true*/ cwd, "migrator", "prisma", "migrations"),
    path.join(/*turbopackIgnore: true*/ cwd, "..", "..", "prisma", "migrations"),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory() && /^\d{14}_/.test(e.name)).map((e) => e.name);
    } catch {
      // Siguiente candidata.
    }
  }
  return null;
}

/** Identificador de la compilación: el que Next incrusta o, desde la línea de órdenes, el fichero .next/BUILD_ID. */
async function buildId(): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_BUILD_ID) return process.env.NEXT_PUBLIC_BUILD_ID;
  for (const p of [path.join(/*turbopackIgnore: true*/ process.cwd(), ".next", "BUILD_ID"), path.join(/*turbopackIgnore: true*/ process.cwd(), ".next", "standalone", ".next", "BUILD_ID")]) {
    try {
      return (await readFile(p, "utf8")).trim().slice(0, 80);
    } catch {
      // Siguiente.
    }
  }
  return null;
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function section<T>(fn: () => Promise<T>, ctx: ScrubContext): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    return { error: scrubText(err instanceof Error ? err.message : String(err), ctx) };
  }
}

export interface DoctorOptions {
  /** Quién lo genera: la app (proceso del servidor) o la línea de órdenes (proceso aparte). */
  source: "app" | "cli";
  now?: Date;
}

/** Informe completo, ya limpio. */
export async function collectDiagnostics(opts: DoctorOptions): Promise<Record<string, unknown>> {
  const now = opts.now ?? new Date();
  const uploads = uploadDir();
  const secrets = secretEnvValues();
  const ctx: ScrubContext = {
    literals: [...secrets],
    paths: { [uploads]: "[UPLOAD_DIR]", ...(os.homedir().length > 1 ? { [os.homedir()]: "[HOME]" } : {}) },
  };
  // Nombres y emails de las cuentas: se tachan de cualquier texto libre (errores de tareas, de copias…).
  try {
    const people = await db.user.findMany({ select: { name: true, email: true } });
    for (const p of people) ctx.literals.push(p.email, p.name);
  } catch {
    // Sin BD: el bloque «database» lo dirá.
  }

  const mem = process.memoryUsage();
  const report: Record<string, unknown> = {
    generatedAt: now.toISOString(),
    source: opts.source,
    app: { name: "pizarro", version: (pkg as { version?: string }).version ?? null, buildId: await buildId() },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      // En la línea de órdenes, el tiempo y la memoria son los del propio comando; el arranque de la app está en «lastBoot».
      uptimeSeconds: Math.round(process.uptime()),
      memoryMB: { rss: mb(mem.rss), heapUsed: mb(mem.heapUsed), heapTotal: mb(mem.heapTotal), external: mb(mem.external) },
      system: { totalMemMB: mb(os.totalmem()), freeMemMB: mb(os.freemem()), loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100), cpus: os.cpus().length },
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    env: envPresence(),
    features: configFlags(),
  };
  // Email configurado en Administración → Ajustes (sin valores: solo si hay servidor y remitente guardados). Las variables SMTP_* mandan.
  await section(async () => {
    const rows = await db.appState.findMany({ where: { key: { in: ["mail.host", "mail.fromAddress"] } }, select: { key: true, value: true } });
    const emailInApp = ["mail.host", "mail.fromAddress"].every((k) => rows.some((r) => r.key === k && r.value.trim() !== ""));
    const features = report.features as Record<string, unknown>;
    features.emailInApp = emailInApp;
    features.email = Boolean(features.email) || emailInApp;
    features.emailSource = features.smtp ? "env" : emailInApp ? "app" : features.mailOutbox ? "outbox" : "none";
  }, ctx);
  // Google configurado en Administración → Ajustes (sin valores: solo si hay ID, secreto y dominio). Las variables GOOGLE_* mandan.
  await section(async () => {
    const rows = await db.appState.findMany({ where: { key: { in: ["google.clientId", "google.clientSecretEnc", "google.workspaceDomain"] } }, select: { key: true, value: true } });
    const has = (k: string) => rows.some((r) => r.key === k && r.value.trim() !== "");
    const inApp = has("google.clientId") && has("google.clientSecretEnc");
    const features = report.features as Record<string, unknown>;
    features.googleInApp = inApp;
    features.googleSource = envGoogleCredentials() ? "env" : inApp ? "app" : "none";
    features.google = (envGoogleCredentials() || inApp) && Boolean(process.env.APP_URL);
    features.googleWorkspaceDomain = Boolean(features.googleWorkspaceDomain) || has("google.workspaceDomain");
  }, ctx);

  report.health =await section(async () => {
    const [dbOk, up] = await Promise.all([db.$queryRaw`SELECT 1`.then(() => true, () => false), checkUploads(uploads)]);
    return { ...evaluateHealth({ dbOk, uploads: up, minFreeBytes: minFreeBytes() }), dbOk, uploadsWritable: up.writable };
  }, ctx);

  report.disk = await section(async () => {
    const s = await statfs(uploads);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    return { totalMB: mb(total), freeMB: mb(free), usedMB: mb(total - Number(s.bfree) * Number(s.bsize)), minFreeMB: mb(minFreeBytes()) };
  }, ctx);

  report.database = await section(async () => {
    const size = (await db.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`)[0]?.size ?? 0n;
    const version = (await db.$queryRaw<{ version: string }[]>`SELECT current_setting('server_version') AS version`)[0]?.version ?? null;
    const tables = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`;
    const rowCounts: Record<string, number> = {};
    for (const { table_name } of tables) {
      const [row] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${quoteIdent(table_name)}`);
      rowCounts[table_name] = Number(row?.n ?? 0);
    }
    return { sizeMB: mb(Number(size)), postgres: version, tables: tables.length, rowCounts };
  }, ctx);

  report.migrations = await section(async () => {
    const rows = await db.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
      SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
    return migrationStatus(await migrationFolder(), rows);
  }, ctx);

  report.jobs = await section(async () => {
    const rows = await db.jobRun.findMany({ orderBy: { name: "asc" } });
    return rows.map((r) => ({
      job: r.name,
      lastStartedAt: r.lastStartedAt?.toISOString() ?? null,
      lastFinishedAt: r.lastFinishedAt?.toISOString() ?? null,
      lastOk: r.lastOk,
      lastError: r.lastError ? scrubText(r.lastError, ctx) : null,
    }));
  }, ctx);

  report.backups = await section(async () => {
    let status: unknown = {};
    try {
      status = JSON.parse(await readFile(path.join(backupsDir(), "status.json"), "utf8"));
    } catch {
      // Sin copias todavía.
    }
    let files: string[] = [];
    try {
      files = (await readdir(backupsDir())).filter((n) => parseBackupFileName(n));
    } catch {
      // Sin carpeta.
    }
    const newest = files.map((n) => parseBackupFileName(n)!).sort((a, b) => b.getTime() - a.getTime())[0];
    // status.json entero (copia local, prueba de restauración y, si existe, la externa), limpio.
    return { localCopies: files.length, newestLocalAt: newest?.toISOString() ?? null, status: scrubDeep(status, ctx) };
  }, ctx);

  report.logs24h = await section(async () => {
    const since = new Date(now.getTime() - DAY_MS);
    const rows = await db.appLog.groupBy({ by: ["level", "action"], where: { createdAt: { gte: since }, level: { in: ["error", "warn"] } }, _count: { _all: true } });
    const grouped = groupLogCounts(rows);
    return {
      since: since.toISOString(),
      errors: grouped.filter((g) => g.level === "error").reduce((a, g) => a + g.count, 0),
      warnings: grouped.filter((g) => g.level === "warn").reduce((a, g) => a + g.count, 0),
      byAction: grouped,
    };
  }, ctx);

  report.sessions = await section(async () => ({
    active: await db.session.count({ where: { expiresAt: { gt: now } } }),
    activeUsers: await db.user.count({ where: { active: true } }),
    admins: await db.user.count({ where: { active: true, role: "ADMIN" } }),
  }), ctx);

  report.lastBoot = await section(async () => {
    const row = await db.appLog.findFirst({ where: { action: "system.boot" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    return row ? { at: row.createdAt.toISOString(), secondsAgo: Math.round((now.getTime() - row.createdAt.getTime()) / 1000) } : null;
  }, ctx);

  // Pasada final de seguridad: ningún valor secreto, credencial de URL ni email en todo el informe. Los nombres de
  // personas ya se han tachado de los textos libres; aquí no, porque un nombre corto estropearía nombres de tablas.
  return scrubDeep(report, { literals: secrets, paths: ctx.paths, tokens: false, dropFields: false }) as Record<string, unknown>;
}

function mb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}
