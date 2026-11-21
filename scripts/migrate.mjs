// Paso de migraciones del arranque del contenedor (scripts/start.sh): espera a que PostgreSQL responda y aplica las
// migraciones con el Prisma CLI aislado de migrator/ (etapa «migrator» del Dockerfile). Solo usa node:* y pg (que la
// salida standalone de Next ya trae en /app/node_modules). Se ejecuta desde /app: `node scripts/migrate.mjs`.
//
// Antes, con la base aún arrancando o caída, `prisma migrate deploy` fallaba al segundo (P1001, en inglés) y el
// contenedor salía: Railway lo daba por «Crashed» tras 5 reinicios. Ahora se reintenta cada 3 s durante 3 min, con
// un mensaje claro en español al agotarlo. Si la base responde a la primera, no añade espera.
// Una migración que falló a medias deja P3009 en cada arranque: se reconoce y se explica qué hacer.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RETRY_MS = 3000;
const ATTEMPT_TIMEOUT_MS = 5000;
const DEFAULT_WAIT_S = 180;
/** Cada cuánto se repite en el log que la base sigue sin responder. */
const LOG_EVERY_MS = 30_000;
const PRISMA = "./node_modules/.bin/prisma";

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

/** Qué hacer ante P3009, con el comando de Docker Compose o el de Railway. */
export function p3009Help(names, env = process.env) {
  const list = names.length ? names : ["<nombre de la migración>"];
  const lines = [
    `ERROR: una migración de la base de datos falló a medias (P3009): ${list.join(", ")}.`,
    "Prisma no aplicará ninguna otra hasta resolverlo, y la app no arranca. Qué hacer:",
    "  1. Busca más arriba, o en el log del arranque anterior, el error de esa migración y corrige la causa (p. ej. disco lleno).",
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

/** `prisma migrate deploy` en migrator/, mostrando su salida tal cual y guardando el final para reconocer P3009. */
function migrateDeploy(cwd) {
  return new Promise((resolve) => {
    const child = spawn(PRISMA, ["migrate", "deploy"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const keep = (chunk) => {
      out = (out + chunk.toString("utf8")).slice(-65_536);
    };
    child.stdout.on("data", (c) => {
      process.stdout.write(c);
      keep(c);
    });
    child.stderr.on("data", (c) => {
      process.stderr.write(c);
      keep(c);
    });
    child.on("error", (e) => resolve({ code: 1, out: `${out}\n${e.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

/** Opciones (solo para las pruebas): --wait <segundos>. */
function parseArgs(argv) {
  let waitS = DEFAULT_WAIT_S;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--wait" && /^\d+$/.test(argv[i + 1] ?? "")) waitS = Number(argv[++i]);
  }
  return { waitS };
}

async function main() {
  const { waitS } = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL ?? "";
  if (!(await waitForDb(url, { waitS }))) return 1;
  log("Aplicando migraciones...");
  const { code, out } = await migrateDeploy(path.resolve("migrator"));
  if (code === 0) return 0;
  if (/\bP3009\b/.test(out)) for (const l of p3009Help(failedMigrations(out))) err(l);
  return code || 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
