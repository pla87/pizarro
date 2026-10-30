// Parte pura (sin base de datos ni «server-only») de la configuración de Google: claves, validación y la regla de
// precedencia (las variables GOOGLE_* del servidor ganan a lo guardado en Administración → Ajustes).
// La usan el servidor, el diagnóstico y el script de rotación de claves.

export const GOOGLE_CLIENT_ID_KEY = "google.clientId";
/** Secreto del cliente OAuth cifrado con ENCRYPTION_KEY (lib/keyring.ts); nunca viaja al cliente. */
export const GOOGLE_SECRET_KEY = "google.clientSecretEnc";
export const GOOGLE_DOMAIN_KEY = "google.workspaceDomain";
/** Email de contacto público (páginas /privacy y /terms); no es secreto. */
export const GOOGLE_CONTACT_KEY = "google.publicContactEmail";
export const GOOGLE_KEYS = [GOOGLE_CLIENT_ID_KEY, GOOGLE_SECRET_KEY, GOOGLE_DOMAIN_KEY, GOOGLE_CONTACT_KEY] as const;

export interface GoogleSettings {
  clientId: string;
  /** Dominio de Workspace permitido; vacío = cualquier cuenta de Google. */
  workspaceDomain: string;
  hasSecret: boolean;
  /** Email de contacto que se muestra en /privacy y /terms (vacío = «el administrador de esta instalación»). */
  publicContactEmail: string;
}

export const EMPTY_GOOGLE_SETTINGS: GoogleSettings = { clientId: "", workspaceDomain: "", hasSecret: false, publicContactEmail: "" };

type Env = Record<string, string | undefined>;

/** Configuración efectiva de Google. */
export interface GoogleConfig {
  /** De dónde salen el ID y el secreto: variables del servidor, ajustes de Administración o ninguno. */
  source: "env" | "db" | "none";
  clientId: string;
  clientSecret: string;
  /** Dominio de Workspace (vacío = cualquiera). Las variables del servidor mandan sobre lo guardado. */
  domain: string;
  domainSource: "env" | "db" | "none";
}

export const NO_GOOGLE_CONFIG: GoogleConfig = { source: "none", clientId: "", clientSecret: "", domain: "", domainSource: "none" };

const clean = (v: string | undefined) => (v ?? "").trim();

/** ¿Define el servidor el ID y el secreto de cliente? */
export const envGoogleCredentials = (env: Env = process.env): boolean => Boolean(clean(env.GOOGLE_CLIENT_ID) && clean(env.GOOGLE_CLIENT_SECRET));

/** Precedencia: ID y secreto del servidor (los dos) mandan; si no, lo guardado. El dominio del servidor manda sobre el guardado. */
export function resolveGoogleConfig(env: Env, saved: GoogleSettings, secret: string): GoogleConfig {
  const envDomain = clean(env.GOOGLE_WORKSPACE_DOMAIN);
  const domain = envDomain || saved.workspaceDomain;
  const domainSource: GoogleConfig["domainSource"] = envDomain ? "env" : saved.workspaceDomain ? "db" : "none";
  if (envGoogleCredentials(env)) return { source: "env", clientId: clean(env.GOOGLE_CLIENT_ID), clientSecret: clean(env.GOOGLE_CLIENT_SECRET), domain, domainSource };
  if (saved.clientId && secret) return { source: "db", clientId: saved.clientId, clientSecret: secret, domain, domainSource };
  return { ...NO_GOOGLE_CONFIG, domain, domainSource };
}

/** ¿Funciona el acceso con Google? Hace falta también APP_URL (de ahí salen las URL de redirección). */
export const isGoogleActive = (config: GoogleConfig, env: Env = process.env): boolean => Boolean(config.clientId && config.clientSecret && clean(env.APP_URL));

/** Las dos URL de redirección que hay que dar de alta en Google Cloud (null si falta APP_URL). */
export function googleRedirectUris(appUrl: string | undefined): { login: string; docs: string } | null {
  const base = clean(appUrl).replace(/\/$/, "");
  if (!base) return null;
  return { login: `${base}/api/auth/google/callback`, docs: `${base}/api/google/callback` };
}

const DOMAIN_RE = /^(?=.{3,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const CLIENT_ID_RE = /^[A-Za-z0-9._~-]{5,200}$/;

export const isWorkspaceDomain = (s: string) => DOMAIN_RE.test(s);

export function parseGoogleSettings(rows: { key: string; value: string }[]): GoogleSettings {
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? "";
  return { clientId: get(GOOGLE_CLIENT_ID_KEY).trim(), workspaceDomain: get(GOOGLE_DOMAIN_KEY).trim().toLowerCase(), hasSecret: get(GOOGLE_SECRET_KEY) !== "", publicContactEmail: get(GOOGLE_CONTACT_KEY).trim() };
}

export interface GoogleSettingsInput {
  clientId: string;
  workspaceDomain: string;
  /** Opcional; ausente = no cambiar el guardado. */
  publicContactEmail?: string;
}

/** Valida y normaliza el formulario. Devuelve el mensaje de error (clave de traducción) o los datos limpios. */
export function validateGoogleSettings(input: GoogleSettingsInput): { ok: true; value: GoogleSettingsInput } | { ok: false; error: string } {
  const clientId = String(input.clientId ?? "").trim();
  // Se admite escribir «@empresa.com» o «empresa.com».
  const workspaceDomain = String(input.workspaceDomain ?? "").trim().toLowerCase().replace(/^@/, "");
  if (clientId !== "" && !CLIENT_ID_RE.test(clientId)) return { ok: false, error: "El ID de cliente de Google no es válido." };
  if (workspaceDomain !== "" && !isWorkspaceDomain(workspaceDomain)) return { ok: false, error: "El dominio de Workspace no es válido (por ejemplo empresa.com)." };
  const contact = input.publicContactEmail === undefined ? undefined : String(input.publicContactEmail).trim();
  if (contact !== undefined && contact !== "" && !isPlainEmail(contact)) return { ok: false, error: "El email de contacto público no es válido." };
  return { ok: true, value: contact === undefined ? { clientId, workspaceDomain } : { clientId, workspaceDomain, publicContactEmail: contact } };
}

const isPlainEmail = (s: string) => s.length <= 200 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(s);

// Sufijos públicos habituales de alojamiento compartido: cualquiera puede tener un subdominio, pero el dominio
// no es de nadie, así que Google no lo acepta como «dominio autorizado» de una aplicación.
const SHARED_SUFFIXES = [
  "up.railway.app", "railway.app", "vercel.app", "netlify.app", "herokuapp.com", "onrender.com", "fly.dev", "github.io", "pages.dev", "workers.dev",
  "ngrok.io", "ngrok-free.app", "trycloudflare.com", "azurewebsites.net", "run.app", "web.app", "firebaseapp.com", "duckdns.org", "glitch.me", "repl.co",
];
// Sufijos de país con dos etiquetas (no exhaustivo): el dominio registrable lleva una etiqueta más.
const TWO_PART_TLDS = new Set(["co.uk", "org.uk", "ac.uk", "com.es", "org.es", "com.mx", "com.ar", "com.br", "com.co", "com.pe", "com.au", "co.nz", "co.jp", "co.za", "com.tr", "co.in"]);

export interface AppDomainInfo {
  host: string;
  /** Dominio que va en «Dominios autorizados» (vacío si no hay uno utilizable). */
  domain: string;
  /** «shared»: subdominio de un alojamiento compartido; «local»: localhost/IP; «ok»: dominio propio (según la lista conocida). */
  kind: "ok" | "shared" | "local" | "none";
}

/** Dominio registrable de APP_URL para «Dominios autorizados» de Google. Heurística: no usa la lista completa de sufijos públicos. */
export function appDomainInfo(appUrl: string | undefined): AppDomainInfo {
  let host = "";
  try {
    host = new URL(clean(appUrl)).hostname.toLowerCase();
  } catch {
    return { host: "", domain: "", kind: "none" };
  }
  if (!host) return { host: "", domain: "", kind: "none" };
  if (host === "localhost" || host.endsWith(".localhost") || /^[\d.]+$/.test(host) || host.includes(":") || !host.includes(".")) return { host, domain: "", kind: "local" };
  const shared = SHARED_SUFFIXES.find((s) => host === s || host.endsWith("." + s));
  if (shared) {
    const labels = host.split(".");
    const n = shared.split(".").length;
    return { host, domain: labels.slice(-(n + 1)).join("."), kind: "shared" };
  }
  const labels = host.split(".");
  const take = TWO_PART_TLDS.has(labels.slice(-2).join(".")) ? 3 : 2;
  return { host, domain: labels.slice(-take).join("."), kind: "ok" };
}
