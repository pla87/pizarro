// Utilidades puras del registro de actividad (lib/log.ts), aparte para poder probarlas sin base de datos.

/**
 * Texto que PostgreSQL acepta tanto en `text` como en `jsonb`: sin el carácter NUL (\u0000, que ninguno de los dos admite)
 * y sin mitades sueltas de un par sustituto (medio emoji), que `jsonb` rechaza; se cambian por «�».
 */
export function cleanText(s: string): string {
  return (s.includes("\u0000") ? s.replaceAll("\u0000", "") : s).toWellFormed();
}

/** `cleanText` recortado a `max` unidades sin partir un emoji (un par sustituto) por la mitad. */
export function clipText(s: string, max: number): string {
  const c = cleanText(s);
  if (c.length <= max) return c;
  // Ya está bien formado: si el último que cabe es la primera mitad de un par, la segunda se quedaría fuera.
  const code = c.charCodeAt(max - 1);
  return c.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** Tipos de error del adaptador de PostgreSQL que dependen de la conexión o del servidor, no del contenido de la fila. */
const CONNECTION_KINDS = new Set([
  "DatabaseNotReachable", "DatabaseDoesNotExist", "DatabaseAccessDenied", "AuthenticationFailed", "ConnectionClosed",
  "TlsConnectionError", "TooManyConnections", "SocketTimeout", "TransactionWriteConflict", "TransactionAlreadyClosed", "GenericJs",
]);

/**
 * ¿El error es de conexión o del servidor (se reintenta más tarde) y no de los datos (se descarta la fila)?
 * Prisma 7 con @prisma/adapter-pg trae el SQLSTATE de PostgreSQL en `meta.driverAdapterError.cause`; sin él, los P1xxx son
 * de conexión y un error suelto de pg o de Node («Connection terminated», ECONNRESET…) también.
 */
export function isConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return true;
  const e = err as { name?: unknown; code?: unknown; meta?: { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown } } } };
  const cause = e.meta?.driverAdapterError?.cause;
  if (cause) {
    if (typeof cause.kind === "string" && CONNECTION_KINDS.has(cause.kind)) return true;
    // SQLSTATE 08 conexión, 40 conflicto o bloqueo, 53 recursos (disco lleno, demasiadas conexiones), 57 servidor parándose o arrancando.
    return typeof cause.originalCode === "string" && /^(08|40|53|57)/.test(cause.originalCode);
  }
  if (typeof e.code === "string" && /^P1\d{3}$/.test(e.code)) return true;
  const name = typeof e.name === "string" ? e.name : "";
  return !name.startsWith("PrismaClient") || name === "PrismaClientInitializationError";
}
