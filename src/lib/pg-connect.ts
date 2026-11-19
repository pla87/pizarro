// Conexiones directas con pg (fuera del pool de Prisma): la del volcado y la restauración de copias (backup-pg.ts) y la
// del bloqueo de las tareas de fondo (jobs.ts), y la zona horaria UTC de todas las conexiones (también las del pool de
// Prisma, db.ts). Sin dependencias de la app: lo usan también los scripts de dist/.

import pg from "pg";

/**
 * Tope para conectar (TCP, TLS y arranque de la sesión). Sin él, un servidor que no contesta (cortafuegos que descarta
 * paquetes, base saturada) dejaba la conexión esperando para siempre: la copia seguía «en curso» y no se volvía a lanzar.
 */
export const PG_CONNECT_TIMEOUT_MS = 15_000;

/** Parámetro de arranque que fija la zona horaria de la sesión. */
const UTC_SESSION = "-c TimeZone=UTC";

/**
 * Configuración de conexión con la sesión en UTC. Las fechas van en columnas `timestamp(3)` sin zona y Prisma las
 * escribe y las lee como UTC; un `NOW()` (o `CURRENT_TIMESTAMP`) de una consulta propia, de un disparador o de un
 * valor por defecto, en cambio, se guarda en la hora de la sesión: con el servidor o la base en otra zona
 * (`timezone = 'Europe/Madrid'`) quedaba desplazado una o dos horas. pg toma `options` de la URL antes que de la
 * configuración, así que si la URL ya trae `options` se le añade ahí; si no, se suma a `PGOPTIONS` (que `options`
 * sustituiría). Lo último que se fija gana, así que la zona va siempre al final.
 */
export function utcSessionConfig(url: string): { connectionString: string; options?: string } {
  try {
    const u = new URL(url);
    const own = u.searchParams.get("options");
    if (own !== null) {
      u.searchParams.set("options", `${own} ${UTC_SESSION}`.trim());
      return { connectionString: u.toString() };
    }
  } catch {
    // Una URL que URL no entiende la interpreta pg igual que antes; la zona va en `options`.
  }
  return { connectionString: url, options: `${process.env.PGOPTIONS ?? ""} ${UTC_SESSION}`.trim() };
}

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
    ...utcSessionConfig(url),
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
