// Parte pura (sin base de datos ni «server-only») de la configuración de Google: claves, validación y la regla de
// precedencia (las variables GOOGLE_* del servidor ganan a lo guardado en Administración → Ajustes).
// La usan el servidor, el diagnóstico y el script de rotación de claves.

export const GOOGLE_CLIENT_ID_KEY = "google.clientId";
/** Secreto del cliente OAuth cifrado con ENCRYPTION_KEY (lib/keyring.ts); nunca viaja al cliente. */
export const GOOGLE_SECRET_KEY = "google.clientSecretEnc";
export const GOOGLE_DOMAIN_KEY = "google.workspaceDomain";
export const GOOGLE_KEYS = [GOOGLE_CLIENT_ID_KEY, GOOGLE_SECRET_KEY, GOOGLE_DOMAIN_KEY] as const;

export interface GoogleSettings {
  clientId: string;
  /** Dominio de Workspace permitido; vacío = cualquier cuenta de Google. */
  workspaceDomain: string;
  hasSecret: boolean;
}

export const EMPTY_GOOGLE_SETTINGS: GoogleSettings = { clientId: "", workspaceDomain: "", hasSecret: false };

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
  return { clientId: get(GOOGLE_CLIENT_ID_KEY).trim(), workspaceDomain: get(GOOGLE_DOMAIN_KEY).trim().toLowerCase(), hasSecret: get(GOOGLE_SECRET_KEY) !== "" };
}

export interface GoogleSettingsInput {
  clientId: string;
  workspaceDomain: string;
}

/** Valida y normaliza el formulario. Devuelve el mensaje de error (clave de traducción) o los datos limpios. */
export function validateGoogleSettings(input: GoogleSettingsInput): { ok: true; value: GoogleSettingsInput } | { ok: false; error: string } {
  const clientId = String(input.clientId ?? "").trim();
  // Se admite escribir «@empresa.com» o «empresa.com».
  const workspaceDomain = String(input.workspaceDomain ?? "").trim().toLowerCase().replace(/^@/, "");
  if (clientId !== "" && !CLIENT_ID_RE.test(clientId)) return { ok: false, error: "El ID de cliente de Google no es válido." };
  if (workspaceDomain !== "" && !isWorkspaceDomain(workspaceDomain)) return { ok: false, error: "El dominio de Workspace no es válido (por ejemplo empresa.com)." };
  return { ok: true, value: { clientId, workspaceDomain } };
}
