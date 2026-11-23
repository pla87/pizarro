// Dirección pública de la app (APP_URL): de ella salen los enlaces de los emails, las direcciones de Google, el webhook de
// Telegram, la cookie segura y la redirección canónica. Todo el servidor lee process.env.APP_URL; aquí se decide, en un
// solo sitio y al arrancar, qué vale cuando no está definida.
//
// En Railway la dirección pública no existe hasta que se genera el dominio (tras el primer despliegue), así que APP_URL
// no se podía rellenar en el orden de la guía. Railway inyecta RAILWAY_PUBLIC_DOMAIN (p. ej.
// pizarro-production.up.railway.app): sin APP_URL, se usa https://<ese dominio>. Igual en Render, que inyecta
// RENDER_EXTERNAL_URL (https://<servicio>.onrender.com), y en Fly.io, que inyecta FLY_APP_NAME (la app responde en
// https://<nombre>.fly.dev). Con un dominio propio hay que definir APP_URL (esas variables siguen siendo las de la
// plataforma). Sin dependencias: lo usan también los scripts (dist/*.mjs).

type Env = Record<string, string | undefined>;

/** De dónde sale APP_URL: la variable, la dirección que da la plataforma (Railway, Render o Fly.io) o ninguno. */
export type AppUrlSource = "env" | "railway" | "render" | "fly" | "none";
type PlatformSource = "railway" | "render" | "fly";

/** Marca que deja applyAppUrlFallback para que los procesos hijos (y el diagnóstico) sepan que no la puso nadie. */
const SOURCE_VAR = "PIZARRO_APP_URL_SOURCE";

/** Un nombre de host (sin esquema, ruta, puerto ni espacios), con al menos un punto. */
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** Nombre de una app de Fly.io: minúsculas, cifras y guiones. */
const FLY_APP = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Variable de la que sale la dirección en cada plataforma y su nombre (para el log). */
const PLATFORM: Record<PlatformSource, { variable: string; name: string }> = {
  railway: { variable: "RAILWAY_PUBLIC_DOMAIN", name: "Railway" },
  render: { variable: "RENDER_EXTERNAL_URL", name: "Render" },
  fly: { variable: "FLY_APP_NAME", name: "Fly.io" },
};

const isPlatform = (v: string | undefined): v is PlatformSource => v === "railway" || v === "render" || v === "fly";

function hostname(raw: string | undefined): string | null {
  const h = raw?.trim().toLowerCase().replace(/\.$/, "");
  return h && HOSTNAME.test(h) ? h : null;
}

/** La dirección pública que da la plataforma en la que corre, si hay una válida. */
function platformUrl(env: Env): { url: string; source: PlatformSource } | null {
  const railway = hostname(env.RAILWAY_PUBLIC_DOMAIN);
  if (railway) return { url: `https://${railway}`, source: "railway" };
  // Render da la URL completa: solo vale https, sin ruta, consulta ni puerto.
  const render = /^https:\/\/([^/?#:\s]+)\/?$/i.exec(env.RENDER_EXTERNAL_URL?.trim() ?? "");
  const renderHost = render ? hostname(render[1]) : null;
  if (renderHost) return { url: `https://${renderHost}`, source: "render" };
  const fly = env.FLY_APP_NAME?.trim().toLowerCase();
  if (fly && FLY_APP.test(fly)) return { url: `https://${fly}.fly.dev`, source: "fly" };
  return null;
}

/** APP_URL que vale para este entorno y de dónde sale (sin tocar `env`). */
export function resolveAppUrl(env: Env = process.env): { url: string | null; source: AppUrlSource } {
  const explicit = env.APP_URL?.trim();
  if (explicit) {
    const marked = env[SOURCE_VAR];
    return { url: explicit, source: isPlatform(marked) ? marked : "env" };
  }
  return platformUrl(env) ?? { url: null, source: "none" };
}

/**
 * Al arrancar (instrumentation.ts, dist/boot.mjs y los scripts de la línea de órdenes): si falta APP_URL y la plataforma
 * (Railway, Render o Fly.io) da su dirección pública, la fija en `env` para todo el proceso (y los que lance) y lo dice
 * una vez en el log con `log`. Devuelve de dónde sale APP_URL.
 */
export function applyAppUrlFallback(env: Env = process.env, log: ((message: string) => void) | null = (m) => console.log(m)): AppUrlSource {
  const { url, source } = resolveAppUrl(env);
  if (isPlatform(source) && url && !env.APP_URL?.trim()) {
    env.APP_URL = url;
    env[SOURCE_VAR] = source;
    const p = PLATFORM[source];
    log?.(`APP_URL no está definida: se usa ${url} (${p.variable}, la dirección pública que da ${p.name}). Si usas un dominio propio, define APP_URL en las variables del servicio.`);
  }
  return source;
}
