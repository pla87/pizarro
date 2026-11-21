// Paso de migraciones del arranque del contenedor (scripts/start.sh): espera a que PostgreSQL responda y aplica las
// migraciones con el Prisma CLI aislado de migrator/ (etapa «migrator» del Dockerfile). Solo usa node:* y pg (que la
// salida standalone de Next ya trae en /app/node_modules). Se ejecuta desde /app: `node scripts/migrate.mjs`.
//
// Antes, con la base aún arrancando o caída, `prisma migrate deploy` fallaba al segundo (P1001, en inglés) y el
// contenedor salía: Railway lo daba por «Crashed» tras 5 reinicios. Ahora se reintenta cada 3 s durante 3 min, con
// un mensaje claro en español al agotarlo. Si la base responde a la primera, no añade espera.
// Una migración que falló a medias deja P3009 en cada arranque: se reconoce y se explica qué hacer. Si es de las que van
// enteras entre BEGIN; y COMMIT; (las posteriores a LAST_WITHOUT_TRANSACTION), PostgreSQL ya deshizo lo que hizo: se
// marca como revertida y se vuelve a aplicar, una sola vez (ver autoResolvePlan).
//
// Las líneas informativas que Prisma escribe en stderr («Loaded Prisma config…», «Prisma schema loaded…») pasan a stdout:
// Railway pinta en rojo todo lo que llega por stderr y parecían errores.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RETRY_MS = 3000;
const ATTEMPT_TIMEOUT_MS = 5000;
const DEFAULT_WAIT_S = 180;
/** Cada cuánto se repite en el log que la base sigue sin responder. */
const LOG_EVERY_MS = 30_000;
const PRISMA = "./node_modules/.bin/prisma";
/**
 * Última migración publicada sin BEGIN;/COMMIT; (v1.62.0). Las posteriores van enteras en una transacción
 * (tests/migrations.test.ts lo exige): si fallan o se cortan, no dejan nada a medias.
 */
export const LAST_WITHOUT_TRANSACTION = "20261126100000";

const log = (msg) => console.log(`[start] ${msg}`);
const err = (msg) => console.error(`[start] ${msg}`);

/** Errores de conexión por los que merece la pena esperar: la base no está (aún) o está arrancando. */
const TRANSIENT = new Set([
  "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "ECONNABORTED",
  "57P01", "57P02", "57P03", "53300",
]);

/** ¿Es un error de los que se arreglan solos esperando (base arrancando, caída o aún sin nombre en la red)? */
export function transientDbError(e) {
  return TRANSIENT.has(e?.code) || /timeout|terminated/i.test(e?.message ?? "");
}

/** El motivo, en español y sin datos de acceso. */
export function dbErrorReason(e) {
  const code = e?.code;
  const raw = e?.message ?? String(e);
  if (/timeout/i.test(raw)) return `no ha respondido en ${ATTEMPT_TIMEOUT_MS / 1000} s`;
  if (code === "ECONNREFUSED") return "rechaza la conexión (¿está en marcha?)";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "no se encuentra el servidor (revisa el nombre en DATABASE_URL)";
  if (code === "57P03") return "está arrancando";
  if (code === "57P01" || code === "57P02") return "se está apagando o reiniciando";
  if (code === "53300") return "no admite más conexiones";
  if (code === "28P01" || code === "28000") return "no acepta el usuario o la contraseña de DATABASE_URL";
  return raw;
}

/** Servidor y base de DATABASE_URL para el log (sin usuario ni contraseña), como dbTarget de src/lib/db-pool.ts. */
export function dbTarget(url) {
  try {
    const u = new URL(url ?? "");
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname && u.pathname !== "/" ? `, base ${decodeURIComponent(u.pathname.slice(1))}` : ""}`;
  } catch {
    return "DATABASE_URL no válida";
  }
}

const duration = (s) => (s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);
const onRailway = (env) => Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID);

/** Nombres de las migraciones que `prisma migrate deploy` da por fallidas (P3009), sin repetir. */
export function failedMigrations(output) {
  if (!/\bP3009\b/.test(output)) return [];
  return [...new Set([...output.matchAll(/The `([^`]+)` migration started at [^\n]*? failed/g)].map((m) => m[1]))];
}

/** Las sentencias de verdad: sin líneas vacías ni comentarios de línea (`-- …`) al principio y al final. */
function sqlBody(sql) {
  const lines = sql.split(/\r?\n/).map((l) => l.trim());
  const meaningful = (l) => l !== "" && !l.startsWith("--");
  const first = lines.findIndex(meaningful);
  const last = lines.findLastIndex(meaningful);
  return first < 0 ? [] : lines.slice(first, last + 1);
}

/** Motivo por el que una migración no va entera en una transacción explícita, o null si va bien (tests/migrations.test.ts). */
export function transactionProblem(sql) {
  const b = sqlBody(sql);
  if (b.length === 0) return "está vacía";
  if (!/^BEGIN;$/i.test(b[0])) return `no empieza por «BEGIN;» (empieza por «${b[0]}»)`;
  if (!/^COMMIT;$/i.test(b.at(-1))) return `no termina en «COMMIT;» (termina en «${b.at(-1)}»)`;
  if (b.length < 3) return "no tiene nada entre BEGIN; y COMMIT;";
  // Nada en medio que cierre o abra otra transacción ni que no pueda ir dentro de una (CONCURRENTLY): si no, un reintento
  // repetiría lo ya confirmado. Lo que va entre $$ (cuerpos de funciones y bloques DO, con su BEGIN/END propios) no cuenta.
  // Sin cuerpos entre $$, textos entre comillas ni comentarios; después se mira cada sentencia entera (así «CASE … END;»
  // de un UPDATE no cuenta, y «COMMIT WORK;» o «END TRANSACTION;» sí).
  const outside = b.slice(1, -1).join("\n")
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, "");
  const statements = outside.split(";").map((x) => x.trim().replace(/\s+/g, " "));
  const txControl = /^(?:(?:BEGIN|START TRANSACTION|COMMIT|END|ROLLBACK|ABORT)(?:\s+(?:WORK|TRANSACTION)\b.*)?|(?:SAVEPOINT|RELEASE|ROLLBACK TO|PREPARE TRANSACTION|COMMIT PREPARED)\b.*)$/i;
  const bad = statements.find((x) => txControl.test(x)) ?? statements.find((x) => /\bCONCURRENTLY\b/i.test(x))?.match(/\bCONCURRENTLY\b/i)?.[0];
  if (bad) return `tiene «${bad}» entre BEGIN; y COMMIT;`;
  return null;
}

/**
 * ¿Se pueden marcar como revertidas y volver a aplicar solas las migraciones fallidas (P3009)? Solo si todas van enteras
 * en una transacción (posteriores a LAST_WITHOUT_TRANSACTION y con BEGIN;/COMMIT;): falle una sentencia o se corte el
 * proceso, PostgreSQL deshace la transacción entera y la base queda como antes de empezarla. Y solo la primera vez: si ya
 * hay una fila de esa migración marcada como revertida (este mismo reintento en un arranque anterior, o alguien a mano),
 * ya se volvió a intentar y falló otra vez, así que se explica qué hacer en vez de repetirlo en cada arranque.
 *
 * `sqlOf(nombre)`: el migration.sql de la carpeta del migrador (null si no se puede leer). `rows`: las filas de
 * _prisma_migrations de esas migraciones (null si no se pudieron leer). Devuelve { ok: true } o { ok: false, reason }.
 */
export function autoResolvePlan(names, sqlOf, rows) {
  if (names.length === 0) return { ok: false, reason: "no se sabe qué migración es" };
  if (!rows) return { ok: false, reason: "no se pudo leer su estado en la base de datos" };
  for (const name of names) {
    if (!/^\d{14}_/.test(name) || name.slice(0, 14) <= LAST_WITHOUT_TRANSACTION) return { ok: false, reason: `${name} es de las antiguas, sin transacción, y pudo quedar a medias` };
    const sql = sqlOf(name);
    if (sql === null) return { ok: false, reason: `no se encuentra prisma/migrations/${name}/migration.sql` };
    const problem = transactionProblem(sql);
    if (problem) return { ok: false, reason: `${name}/migration.sql ${problem}` };
    if (rows.some((r) => r.migration_name === name && r.rolled_back_at)) return { ok: false, reason: `${name} ya se volvió a aplicar una vez y falló de nuevo` };
  }
  return { ok: true };
}

/** Qué hacer ante P3009, con el comando de Docker Compose o el de Railway. */
export function p3009Help(names, env = process.env) {
  const list = names.length ? names : ["<nombre de la migración>"];
  const lines = [
    `ERROR: una migración de la base de datos falló a medias (P3009): ${list.join(", ")}.`,
    "Prisma no aplicará ninguna otra hasta resolverlo, y la app no arranca. Qué hacer:",
    "  1. Busca más arriba, o en el log del arranque anterior, el error de esa migración y corrige la causa (p. ej. disco lleno).",
    "     Si Prisma solo dice «current transaction is aborted», el error de verdad está en el log de PostgreSQL (la sentencia que falló).",
    `  2. Mira qué hace: prisma/migrations/${list[0]}/migration.sql (en el repositorio).`,
    "     Si no llegó a cambiar nada, o deshaces a mano lo que hizo, márcala como revertida y arranca de nuevo: se volverá a aplicar.",
  ];
  const resolve = (n) => `./node_modules/.bin/prisma migrate resolve --rolled-back ${n}`;
  if (onRailway(env)) {
    lines.push("     Con la CLI de Railway, en el servicio de la app:  railway ssh");
    for (const n of list) lines.push(`     y dentro:  cd /app/migrator && ${resolve(n)}`);
    lines.push("     Después, «Redeploy» del último despliegue. Si no hay ningún despliegue en marcha: docs/INSTALL.md, sección 8.");
  } else {
    lines.push("     En la carpeta deploy (p. ej. cd /opt/pizarro/deploy):");
    for (const n of list) lines.push(`     docker compose run --rm --no-deps -w /app/migrator app ${resolve(n)}`);
    lines.push("     docker compose up -d");
  }
  lines.push(
    "  3. Si no sabes qué dejó hecho, restaura la copia de antes de actualizar (docs/INSTALL.md, sección 6).",
    "Guía: docs/INSTALL.md, sección 8 («Una migración falló a medias (P3009)»).",
  );
  return lines;
}

/** Mensaje al agotar la espera: qué comprobar en Docker Compose o en Railway. */
export function dbWaitTimeoutHelp(url, reason, waitS, env = process.env) {
  const lines = [
    `ERROR: No se puede conectar con PostgreSQL (${dbTarget(url)}) tras ${duration(waitS)} intentándolo: ${reason}.`,
    "Comprueba que la base de datos está en marcha y que DATABASE_URL apunta a ella:",
  ];
  if (onRailway(env)) {
    lines.push(
      "  - Que el servicio de PostgreSQL del proyecto está activo (Online) y su log no muestra errores (disco lleno, memoria).",
      "  - Que DATABASE_URL, en Variables del servicio de la app, es ${{Postgres.DATABASE_URL}} (con el nombre de tu servicio).",
    );
  } else {
    lines.push(
      "  - En la carpeta deploy (p. ej. cd /opt/pizarro/deploy):  docker compose ps  y  docker compose logs --tail 50 postgres",
      "  - Disco lleno o falta de memoria detienen PostgreSQL:  df -h  y  free -m",
    );
  }
  lines.push("El contenedor se reiniciará y lo volverá a intentar.");
  return lines;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Intenta una conexión; null si entra, el error si no. */
async function tryConnect(pg, url) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: ATTEMPT_TIMEOUT_MS });
  client.on("error", () => {});
  try {
    await client.connect();
    return null;
  } catch (e) {
    return e;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Espera a que la base acepte conexiones. true si responde (o no se puede comprobar), false si se agota el tope. */
export async function waitForDb(url, { waitS = DEFAULT_WAIT_S, env = process.env } = {}) {
  let pg;
  try {
    pg = (await import("pg")).default;
  } catch {
    log("AVISO: no se puede comprobar PostgreSQL antes de migrar (falta el módulo pg); se migra directamente.");
    return true;
  }
  const start = Date.now();
  const deadline = start + waitS * 1000;
  let lastLog = 0;
  let waited = false;
  for (;;) {
    const e = await tryConnect(pg, url);
    if (!e) {
      if (waited) log(`PostgreSQL ya responde (tras ${Math.round((Date.now() - start) / 1000)} s).`);
      return true;
    }
    // Base inexistente: `prisma migrate deploy` la crea (primer arranque con una base vacía en un servidor propio).
    if (e?.code === "3D000") return true;
    if (!transientDbError(e)) {
      // Responde pero no deja entrar (usuario o contraseña, TLS): esperar no lo arregla. Prisma da el detalle.
      log(`AVISO: PostgreSQL (${dbTarget(url)}) responde pero ${dbErrorReason(e)}. Revisa DATABASE_URL.`);
      return true;
    }
    const now = Date.now();
    if (now >= deadline) {
      for (const l of dbWaitTimeoutHelp(url, dbErrorReason(e), waitS, env)) err(l);
      return false;
    }
    if (!waited || now - lastLog >= LOG_EVERY_MS) {
      log(
        waited
          ? `PostgreSQL sigue sin responder (${dbTarget(url)}, ${Math.round((now - start) / 1000)} s): ${dbErrorReason(e)}.`
          : `PostgreSQL aún no responde (${dbTarget(url)}): ${dbErrorReason(e)}. Se reintenta cada ${RETRY_MS / 1000} s durante ${duration(waitS)}...`,
      );
      lastLog = now;
    }
    waited = true;
    await sleep(Math.min(RETRY_MS, Math.max(0, deadline - now)));
  }
}

/**
 * Líneas que Prisma escribe en stderr sin ser errores: la configuración y el esquema cargados, el origen de las variables
 * y las líneas en blanco entre ellas. Van a stdout (Railway pinta stderr en rojo). Todo lo demás sigue en stderr.
 */
const PRISMA_INFO = /^(Loaded Prisma config from |Prisma schema loaded from |Environment variables loaded from |Datasource "|\s*$)/;

export function isPrismaInfoLine(line) {
  return PRISMA_INFO.test(line);
}

/** Reparte por líneas lo que llega por stderr: las informativas a `info`, el resto a `error`. */
function lineRouter(info, error) {
  let pending = "";
  const emit = (line) => (isPrismaInfoLine(line) ? info : error)(`${line}\n`);
  return {
    write(chunk) {
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const l of lines) emit(l);
    },
    end() {
      if (pending) emit(pending);
      pending = "";
    },
  };
}

/** El Prisma CLI de migrator/ con `args`, mostrando su salida y guardando el final para reconocer P3009. */
function runPrisma(cwd, args) {
  return new Promise((resolve) => {
    // Sin el aviso de versión nueva de Prisma: la versión va fijada en la imagen y quien instala no puede cambiarla.
    const child = spawn(PRISMA, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { PRISMA_HIDE_UPDATE_MESSAGE: "1", ...process.env } });
    let out = "";
    const keep = (chunk) => {
      out = (out + chunk.toString("utf8")).slice(-65_536);
    };
    const stderr = lineRouter((l) => process.stdout.write(l), (l) => process.stderr.write(l));
    child.stdout.on("data", (c) => {
      process.stdout.write(c);
      keep(c);
    });
    child.stderr.on("data", (c) => {
      stderr.write(c);
      keep(c);
    });
    child.on("error", (e) => resolve({ code: 1, out: `${out}\n${e.message}` }));
    child.on("close", (code) => {
      stderr.end();
      resolve({ code: code ?? 1, out });
    });
  });
}

/** Filas de _prisma_migrations de estas migraciones, o null si no se pueden leer. */
async function migrationRows(url, names) {
  let pg;
  try {
    pg = (await import("pg")).default;
  } catch {
    return null;
  }
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: ATTEMPT_TIMEOUT_MS, query_timeout: ATTEMPT_TIMEOUT_MS });
  client.on("error", () => {});
  try {
    await client.connect();
    const { rows } = await client.query("SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = ANY($1)", [names]);
    return rows;
  } catch {
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

/** migration.sql de una migración en la carpeta del migrador, o null. */
function readMigrationSql(migratorDir, name) {
  if (!/^[0-9A-Za-z_]+$/.test(name)) return null;
  try {
    return readFileSync(path.join(migratorDir, "prisma", "migrations", name, "migration.sql"), "utf8");
  } catch {
    return null;
  }
}

/** Opciones (solo para las pruebas): --wait <segundos>. */
function parseArgs(argv) {
  let waitS = DEFAULT_WAIT_S;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--wait" && /^\d+$/.test(argv[i + 1] ?? "")) waitS = Number(argv[++i]);
  }
  return { waitS };
}

const seconds = (ms) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

async function main() {
  const { waitS } = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL ?? "";
  const waitStart = Date.now();
  if (!(await waitForDb(url, { waitS }))) return 1;
  const migrator = path.resolve("migrator");
  log("Aplicando migraciones...");
  const started = Date.now();
  let { code, out } = await runPrisma(migrator, ["migrate", "deploy"]);
  let retried = false;
  if (code !== 0 && /\bP3009\b/.test(out)) {
    const names = failedMigrations(out);
    const sqlOf = (n) => readMigrationSql(migrator, n);
    // La base solo se consulta si la migración es de las que van en una transacción.
    let plan = autoResolvePlan(names, sqlOf, []);
    if (plan.ok) plan = autoResolvePlan(names, sqlOf, await migrationRows(url, names));
    if (plan.ok) {
      log(`La migración ${names.join(", ")} falló en un arranque anterior, pero va entera en una transacción (BEGIN/COMMIT): PostgreSQL deshizo lo que hizo y no quedó nada a medias. Se marca como revertida y se vuelve a aplicar (solo esta vez).`);
      let resolved = true;
      for (const n of names) {
        const r = await runPrisma(migrator, ["migrate", "resolve", "--rolled-back", n]);
        if (r.code !== 0) {
          err(`No se pudo marcar ${n} como revertida (código ${r.code}).`);
          resolved = false;
          break;
        }
      }
      if (resolved) {
        retried = true;
        ({ code, out } = await runPrisma(migrator, ["migrate", "deploy"]));
        if (code === 0) log(`La migración ${names.join(", ")} se ha aplicado bien al reintentarla.`);
        else {
          err(`La migración ${names.join(", ")} ha vuelto a fallar al reintentarla (el error está justo encima): no se reintentará sola otra vez.`);
          for (const l of p3009Help(names)) err(l);
          return code || 1;
        }
      }
    } else if (names.length) log(`La migración fallida no se reintenta sola: ${plan.reason}.`);
  }
  if (code === 0) {
    // Cuánto ha tardado cada parte: así se ve en el log si el arranque espera a la base o a las migraciones.
    const waited = started - waitStart;
    log(`Base de datos al día (migraciones: ${seconds(Date.now() - started)}${waited >= 1000 ? `; espera a PostgreSQL: ${seconds(waited)}` : ""}${retried ? "; con un reintento" : ""}).`);
    return 0;
  }
  if (/\bP3009\b/.test(out)) for (const l of p3009Help(failedMigrations(out))) err(l);
  return code || 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
