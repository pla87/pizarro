import "server-only";
import { db } from "./db";
import { AppError } from "./errors";
import { decryptSecret, encryptSecret } from "./keyring";
import {
  EMPTY_GOOGLE_SETTINGS, envGoogleCredentials, GOOGLE_CLIENT_ID_KEY, GOOGLE_DOMAIN_KEY, GOOGLE_KEYS, GOOGLE_SECRET_KEY, googleRedirectUris, isGoogleActive,
  parseGoogleSettings, resolveGoogleConfig, type GoogleConfig, type GoogleSettings, type GoogleSettingsInput,
} from "./google-config-core";

// Configuración de Google (acceso con Google y Docs/Sheets): variables GOOGLE_* del servidor (mandan) o lo que un
// administrador guarda en Administración → Ajustes (AppState, con el secreto cifrado). googleEnabled() es síncrona y la
// usan muchas páginas: lee una copia en memoria que se carga al arrancar (instrumentation), se rehace al guardar y se
// refresca sola cada 30 s en segundo plano. Vive en globalThis porque Next puede cargar este módulo más de una vez.

const TTL_MS = 30_000;

interface Store {
  loaded: boolean;
  settings: GoogleSettings;
  secret: string;
  at: number;
  loading: Promise<void> | null;
}

const GLOBAL = "__pizarroGoogleConfig";
function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  return (g[GLOBAL] ??= { loaded: false, settings: EMPTY_GOOGLE_SETTINGS, secret: "", at: 0, loading: null });
}

async function readSaved(): Promise<{ settings: GoogleSettings; secretEnc: string }> {
  const rows = await db.appState.findMany({ where: { key: { in: [...GOOGLE_KEYS] } }, select: { key: true, value: true } });
  return { settings: parseGoogleSettings(rows), secretEnc: rows.find((r) => r.key === GOOGLE_SECRET_KEY)?.value ?? "" };
}

/** Descifra el secreto guardado; si ninguna clave lo abre, se trata como ausente (y se avisa en el registro). */
function openSecret(secretEnc: string): string {
  if (!secretEnc) return "";
  try {
    return decryptSecret(secretEnc);
  } catch {
    console.error("[google] No se pudo descifrar el secreto de cliente guardado (¿cambió ENCRYPTION_KEY?). Vuelve a guardarlo en Administración → Ajustes.");
    return "";
  }
}

/** Vuelve a leer la BD (una sola lectura a la vez). Si falla, conserva lo último conocido y reintenta pronto. */
export function refreshGoogleConfig(): Promise<void> {
  const s = store();
  s.loading ??= (async () => {
    try {
      const { settings, secretEnc } = await readSaved();
      s.settings = settings;
      s.secret = openSecret(secretEnc);
      s.loaded = true;
      s.at = Date.now();
    } catch {
      s.at = Date.now() - TTL_MS + 5_000;
    } finally {
      s.loading = null;
    }
  })();
  return s.loading;
}

/** Configuración efectiva, síncrona: las variables del servidor mandan; si no, la copia en memoria (refrescada en segundo plano si caducó). */
export function googleConfig(): GoogleConfig {
  const s = store();
  if (!s.loaded || Date.now() - s.at >= TTL_MS) void refreshGoogleConfig();
  return resolveGoogleConfig(process.env, s.settings, s.secret);
}

export const googleEnabled = (): boolean => isGoogleActive(googleConfig());
export const googleWorkspaceDomain = (): string | undefined => googleConfig().domain || undefined;

/** Entorno para la política de acceso (auth-policy.ts): el del proceso con el ID y el secreto efectivos de Google. */
export function googlePolicyEnv(): Record<string, string | undefined> {
  const c = googleConfig();
  return { ...process.env, GOOGLE_CLIENT_ID: c.clientId, GOOGLE_CLIENT_SECRET: c.clientSecret ? "1" : "" };
}

/** Lo que ve la pantalla de administración: nunca el secreto. */
export interface GoogleSettingsView {
  settings: GoogleSettings;
  /** Las variables GOOGLE_CLIENT_ID/SECRET del servidor mandan: ID y secreto son de solo lectura. */
  envCredentials: boolean;
  /** GOOGLE_WORKSPACE_DOMAIN del servidor manda sobre el dominio guardado. */
  envDomain: string | null;
  /** ¿Aparece «Iniciar sesión con Google»? */
  active: boolean;
  /** Falta APP_URL: sin ella no hay URL de redirección ni acceso con Google. */
  appUrlMissing: boolean;
  redirectUris: { login: string; docs: string } | null;
}

export async function getGoogleSettingsView(): Promise<GoogleSettingsView> {
  const { settings } = await readSaved();
  await refreshGoogleConfig();
  return {
    settings,
    envCredentials: envGoogleCredentials(),
    envDomain: process.env.GOOGLE_WORKSPACE_DOMAIN?.trim() || null,
    active: googleEnabled(),
    appUrlMissing: !process.env.APP_URL?.trim(),
    redirectUris: googleRedirectUris(process.env.APP_URL),
  };
}

/**
 * Guarda los ajustes. `secret`: ""/undefined = conservar el guardado; con texto = sustituirlo. Sin ID de cliente se desactiva y se borra el secreto.
 * Si el ID de cliente cambia, hay que escribir el secreto de nuevo (no se reutiliza el anterior con otro cliente).
 */
export async function saveGoogleSettings(
  input: GoogleSettingsInput,
  opts: { secret?: string },
): Promise<{ secretChange: "set" | "cleared" | "unchanged"; before: GoogleSettings; after: GoogleSettings }> {
  const { settings: before } = await readSaved();
  const disabling = input.clientId === "";
  const secret = opts.secret ?? "";
  if (!disabling && secret === "") {
    if (before.hasSecret && before.clientId !== input.clientId) throw new AppError("Escribe el secreto de nuevo al cambiar el ID de cliente");
    if (!before.hasSecret) throw new AppError("Falta el secreto de cliente de Google.");
  }
  let secretChange: "set" | "cleared" | "unchanged" = "unchanged";
  await db.$transaction(async (tx) => {
    const entries: [string, string][] = [[GOOGLE_CLIENT_ID_KEY, input.clientId], [GOOGLE_DOMAIN_KEY, input.workspaceDomain]];
    for (const [key, value] of entries) await tx.appState.upsert({ where: { key }, create: { key, value }, update: { value } });
    if (disabling) {
      await tx.appState.deleteMany({ where: { key: GOOGLE_SECRET_KEY } });
      if (before.hasSecret) secretChange = "cleared";
    } else if (secret !== "") {
      const value = encryptSecret(secret);
      await tx.appState.upsert({ where: { key: GOOGLE_SECRET_KEY }, create: { key: GOOGLE_SECRET_KEY, value }, update: { value } });
      secretChange = "set";
    }
  });
  // Si había una lectura en curso (con datos anteriores), se espera y se repite.
  const s = store();
  if (s.loading) await s.loading.catch(() => {});
  await refreshGoogleConfig();
  const { settings: after } = await readSaved();
  return { secretChange, before, after };
}
