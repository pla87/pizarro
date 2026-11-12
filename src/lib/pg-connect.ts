// Conexiones directas con pg (fuera del pool de Prisma): la del volcado y la restauración de copias (backup-pg.ts) y la
// del bloqueo de las tareas de fondo (jobs.ts). Sin dependencias de la app: lo usan también los scripts de dist/.

import pg from "pg";

/**
 * Tope para conectar (TCP, TLS y arranque de la sesión). Sin él, un servidor que no contesta (cortafuegos que descarta
 * paquetes, base saturada) dejaba la conexión esperando para siempre: la copia seguía «en curso» y no se volvía a lanzar.
 */
export const PG_CONNECT_TIMEOUT_MS = 15_000;

/**
 * Abre una conexión con tope de conexión y keepalive de TCP (una conexión que se corta sin avisar acaba dando error en
 * vez de colgar la consulta). `label` sale en el log si la conexión se pierde después. Si no se puede conectar, la
 * conexión se cierra y se lanza el error.
 */
export async function connectPgClient(
  url: string,
  { label, applicationName, connectTimeoutMs = PG_CONNECT_TIMEOUT_MS }: { label: string; applicationName?: string; connectTimeoutMs?: number },
): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: connectTimeoutMs,
    keepAlive: true,
    ...(applicationName ? { application_name: applicationName } : {}),
  });
  // Sin este oyente, un corte de la conexión inactiva sería una excepción no capturada (y con
  // EXIT_ON_UNCAUGHT_EXCEPTION=1, un reinicio de la app); la siguiente consulta ya falla con su error.
  client.on("error", (err) => console.error(`[${label}] conexión perdida`, err.message));
  try {
    await client.connect();
  } catch (err) {
    await client.end().catch(() => {});
    throw err;
  }
  return client;
}
