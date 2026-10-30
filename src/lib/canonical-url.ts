// Redirección opcional al dominio canónico (CANONICAL_REDIRECT=1): quien entra por otra dirección (p. ej. la
// *.up.railway.app tras poner un dominio propio) pasa a APP_URL, conservando ruta y consulta. Parte pura para poder probarla.

const INTERNAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/**
 * Devuelve la URL a la que redirigir (308) o null si no hay que hacerlo. Solo GET/HEAD de páginas: las acciones (POST),
 * la API y las comprobaciones de salud no se tocan, ni las peticiones internas (localhost, sin cabecera Host).
 */
export function canonicalRedirect(opts: { enabled: string | undefined; appUrl: string | undefined; host: string | null; method: string; pathname: string; search: string }): string | null {
  if (opts.enabled !== "1" || !opts.appUrl || !opts.host) return null;
  if (opts.method !== "GET" && opts.method !== "HEAD") return null;
  if (opts.pathname.startsWith("/api/")) return null;
  let app: URL;
  try {
    app = new URL(opts.appUrl);
  } catch {
    return null;
  }
  if (app.protocol !== "https:" && app.protocol !== "http:") return null;
  const host = opts.host.trim().toLowerCase();
  if (host === app.host.toLowerCase()) return null;
  const hostname = host.replace(/:\d+$/, "");
  if (INTERNAL_HOSTS.has(hostname)) return null;
  return `${app.origin}${opts.pathname}${opts.search}`;
}
