// Conexión directa con pg (una sola conexión) con la misma interfaz de SQL en bruto que Prisma, para la herramienta
// de restauración y la prueba mensual: así no hace falta cargar Prisma ni apuntar el cliente de la app a otra base.

import pg from "pg";
import type { Client, RawSql } from "./backup-db";

export class PgSql implements Client {
  private inTx = false;
  // Una sola conexión: las consultas se encadenan (quien llama puede lanzarlas a la vez con Promise.all).
  private chain: Promise<unknown> = Promise.resolve();
  constructor(readonly client: pg.Client) {}

  private run(query: string, values?: unknown[]): Promise<pg.QueryResult> {
    const next = this.chain.then(() => (values ? this.client.query(query, values) : this.client.query(query)));
    this.chain = next.catch(() => {});
    return next;
  }

  async $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T> {
    return (await this.run(query, values)).rows as T;
  }

  async $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number> {
    return (await this.run(query, values)).rowCount ?? 0;
  }

  /** Ejecuta un script con varias sentencias (protocolo simple: una transacción implícita, como Prisma). */
  async exec(script: string): Promise<void> {
    await this.run(script);
  }

  async $transaction<R>(fn: (tx: RawSql) => Promise<R>, options?: { isolationLevel?: "RepeatableRead" }): Promise<R> {
    if (this.inTx) throw new Error("Transacción anidada no soportada.");
    this.inTx = true;
    try {
      await this.run(options?.isolationLevel === "RepeatableRead" ? "BEGIN ISOLATION LEVEL REPEATABLE READ" : "BEGIN");
      try {
        const r = await fn(this);
        await this.run("COMMIT");
        return r;
      } catch (err) {
        await this.run("ROLLBACK").catch(() => {});
        throw err;
      }
    } finally {
      this.inTx = false;
    }
  }

  end(): Promise<void> {
    return this.client.end();
  }
}

export async function connectPg(url: string): Promise<PgSql> {
  const client = new pg.Client({ connectionString: url });
  // Sin este oyente, un corte de la conexión inactiva sería una excepción no capturada (y con
  // EXIT_ON_UNCAUGHT_EXCEPTION=1, un reinicio de la app); la siguiente consulta ya falla con su error.
  client.on("error", (err) => console.error("[backup-pg] conexión perdida", err.message));
  await client.connect();
  return new PgSql(client);
}

/** La misma URL con otra base de datos (conserva usuario, servidor y parámetros como sslmode). */
export function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
}
