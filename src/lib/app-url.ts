// Dirección pública de la app (APP_URL): de ella salen los enlaces de los emails, las direcciones de Google, el webhook de
// Telegram, la cookie segura y la redirección canónica. Todo el servidor lee process.env.APP_URL; aquí se decide, en un
// solo sitio y al arrancar, qué vale cuando no está definida.
//
// En Railway la dirección pública no existe hasta que se genera el dominio (tras el primer despliegue), así que APP_URL
// no se podía rellenar en el orden de la guía. Railway inyecta RAILWAY_PUBLIC_DOMAIN (p. ej.
// pizarro-production.up.railway.app): sin APP_URL, se usa https://<ese dominio>. Con un dominio propio hay que definir
// APP_URL (RAILWAY_PUBLIC_DOMAIN sigue siendo el de Railway). Sin dependencias: lo usan también los scripts (dist/*.mjs).

type Env = Record<string, string | undefined>;

/** De dónde sale APP_URL: la variable, el dominio público de Railway o ninguno. */
export type AppUrlSource = "env" | "railway" | "none";

/** Marca que deja applyAppUrlFallback para que los procesos hijos (y el diagnóstico) sepan que no la puso nadie. */
const SOURCE_VAR = "PIZARRO_APP_URL_SOURCE";

/** Un nombre de host (sin esquema, ruta, puerto ni espacios), con al menos un punto. */
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** APP_URL que vale para este entorno y de dónde sale (sin tocar `env`). */
export function resolveAppUrl(env: Env = process.env): { url: string | null; source: AppUrlSource } {
  const explicit = env.APP_URL?.trim();
  if (explicit) return { url: explicit, source: env[SOURCE_VAR] === "railway" ? "railway" : "env" };
  const domain = env.RAILWAY_PUBLIC_DOMAIN?.trim().toLowerCase().replace(/\.$/, "");
  if (domain && HOSTNAME.test(domain)) return { url: `https://${domain}`, source: "railway" };
  return { url: null, source: "none" };
}

/**
 * Al arrancar (instrumentation.ts, dist/boot.mjs y los scripts de la línea de órdenes): si falta APP_URL y Railway da su
 * dirección pública, la fija en `env` para todo el proceso (y los que lance) y lo dice una vez en el log con `log`.
 * Devuelve de dónde sale APP_URL.
 */
export function applyAppUrlFallback(env: Env = process.env, log: ((message: string) => void) | null = (m) => console.log(m)): AppUrlSource {
  const { url, source } = resolveAppUrl(env);
  if (source === "railway" && url && !env.APP_URL?.trim()) {
    env.APP_URL = url;
    env[SOURCE_VAR] = "railway";
    log?.(`APP_URL no está definida: se usa ${url} (RAILWAY_PUBLIC_DOMAIN, la dirección pública que da Railway). Si usas un dominio propio, define APP_URL en Variables.`);
  }
  return source;
}
