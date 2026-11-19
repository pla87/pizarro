import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { dbConnectErrorMessage, dbPoolConfig } from "./db-pool";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Como mucho un aviso de «no se puede conectar» cada tanto (con la base caída fallan todas las peticiones). */
const CONNECT_ERROR_LOG_EVERY_MS = 30_000;

/**
 * Pool de pg que anota en el log, con un mensaje claro, cuándo no consigue una conexión (base caída, nombre mal escrito,
 * tope de conexión agotado). El error sigue su camino: la consulta falla como antes, ahora a los 20 s (por defecto) y no nunca.
 */
class LoggedPool extends pg.Pool {
  private lastConnectErrorAt = -Infinity;

  private report(err: unknown) {
    const now = Date.now();
    if (now - this.lastConnectErrorAt < CONNECT_ERROR_LOG_EVERY_MS) return;
    this.lastConnectErrorAt = now;
    console.error(dbConnectErrorMessage(err, process.env.DATABASE_URL, this.options.connectionTimeoutMillis ?? 0));
  }

  // pg llama a connect() con callback (pool.query) o sin él (transacciones): se cubren las dos formas.
  connect(): Promise<pg.PoolClient>;
  connect(callback: (err: Error | undefined, client: pg.PoolClient | undefined, done: (release?: unknown) => void) => void): void;
  connect(callback?: (err: Error | undefined, client: pg.PoolClient | undefined, done: (release?: unknown) => void) => void): Promise<pg.PoolClient> | void {
    if (callback) {
      return super.connect((err, client, done) => {
        if (err) this.report(err);
        callback(err, client, done);
      });
    }
    return super.connect().catch((err: unknown) => {
      this.report(err);
      throw err;
    });
  }
}

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no está definida");
  const { max, connectionTimeoutMillis, warnings } = dbPoolConfig();
  for (const w of warnings) console.warn(`[db] ${w}`);
  const pool = new LoggedPool({
    connectionString,
    max,
    connectionTimeoutMillis,
    // Por defecto pg cierra las conexiones inactivas a los 10 s y la siguiente petición paga
    // abrir otra: con poco tráfico eso se notaba como cargas lentas «a veces».
    idleTimeoutMillis: 10 * 60_000,
    keepAlive: true,
  });
  // disposeExternalPool: $disconnect() cierra el pool (las tareas de dist/*.mjs terminan al acabar, como antes).
  const adapter = new PrismaPg(pool, { disposeExternalPool: true });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
