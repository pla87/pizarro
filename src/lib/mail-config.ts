import "server-only";
import { db } from "./db";
import { AppError } from "./errors";
import { decryptSecret, encryptSecret } from "./keyring";
import {
  EMPTY_MAIL_SETTINGS, envMailConfig, MAIL_FROM_ADDRESS_KEY, MAIL_FROM_NAME_KEY, MAIL_HOST_KEY, MAIL_KEYS, MAIL_MODE_KEY, MAIL_PASS_KEY, MAIL_PORT_KEY, MAIL_SECURE_KEY, MAIL_USER_KEY,
  NO_MAIL_CONFIG, parseMailMode, parseMailSettings, resolveMailConfig, type MailConfig, type MailSettings, type MailSettingsInput,
} from "./mail-settings-core";

// Configuración del envío de emails: variables SMTP_* del servidor (mandan) o lo que un administrador guarda en
// Administración → Ajustes (AppState, con la contraseña cifrada). emailEnabled() es síncrona y la usan muchas páginas:
// lee una copia en memoria que se carga al arrancar (instrumentation), se rehace al guardar y se refresca sola cada
// 30 s en segundo plano (por si otro proceso la cambia). Vive en globalThis porque Next puede cargar este módulo
// más de una vez (páginas, acciones, instrumentación) y todos deben ver la misma copia.

const TTL_MS = 30_000;

interface Store {
  config: MailConfig | null;
  settings: MailSettings;
  at: number;
  loading: Promise<MailConfig> | null;
}

const GLOBAL = "__pizarroMailConfig";
function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  return (g[GLOBAL] ??= { config: null, settings: EMPTY_MAIL_SETTINGS, at: 0, loading: null });
}

async function readSaved(): Promise<{ settings: MailSettings; passEnc: string }> {
  const rows = await db.appState.findMany({ where: { key: { in: [...MAIL_KEYS] } }, select: { key: true, value: true } });
  return { settings: parseMailSettings(rows), passEnc: rows.find((r) => r.key === MAIL_PASS_KEY)?.value ?? "" };
}

/** Descifra la contraseña guardada; si ninguna clave la abre, se trata como ausente (y se avisa en el registro). */
function openPassword(passEnc: string): string {
  if (!passEnc) return "";
  try {
    return decryptSecret(passEnc);
  } catch {
    console.error("[mail] No se pudo descifrar la contraseña SMTP guardada (¿cambió ENCRYPTION_KEY?). Vuelve a guardarla en Administración → Ajustes.");
    return "";
  }
}

/** Configuración efectiva (con caché de 30 s). Si la BD falla, conserva la última conocida. */
export async function loadMailConfig(now: number = Date.now()): Promise<MailConfig> {
  // Las variables del servidor mandan siempre y no necesitan la BD.
  const fromEnv = envMailConfig();
  if (fromEnv) return fromEnv;
  const s = store();
  if (s.config && now - s.at < TTL_MS) return s.config;
  return refreshMailConfig();
}

/** Vuelve a leer la BD (una sola lectura a la vez). */
export function refreshMailConfig(): Promise<MailConfig> {
  const s = store();
  s.loading ??= (async () => {
    try {
      const { settings, passEnc } = await readSaved();
      const config = resolveMailConfig(process.env, settings, envMailConfig() ? "" : openPassword(passEnc));
      s.config = config;
      s.settings = settings;
      s.at = Date.now();
      return config;
    } catch {
      // Sin BD (arranque, caída): se usa lo que hubiera, o las variables del servidor, y se reintenta pronto.
      s.config ??= NO_MAIL_CONFIG;
      s.at = Date.now() - TTL_MS + 5_000;
      return s.config;
    } finally {
      s.loading = null;
    }
  })();
  return s.loading;
}

/** ¿Hay configuración guardada o del servidor? Síncrona: lee la copia en memoria y la refresca en segundo plano si caducó. */
export function savedMailEnabled(): boolean {
  if (envMailConfig()) return true;
  const s = store();
  if (!s.config || Date.now() - s.at >= TTL_MS) void refreshMailConfig();
  return Boolean(s.config?.host);
}

/** La configuración que haya en memoria, sin leer la BD (o la del servidor, o ninguna). */
export function peekMailConfig(): MailConfig {
  return envMailConfig() ?? store().config ?? NO_MAIL_CONFIG;
}

export function invalidateMailConfig(): void {
  store().config = null;
}

/** Lo que ve la pantalla de administración: sin contraseña, y si manda el servidor, sus valores (sin usuario ni contraseña). */
export interface MailSettingsView {
  settings: MailSettings;
  /** Las variables SMTP_* del servidor mandan: la pantalla es de solo lectura. */
  env: { host: string; port: number; secure: boolean; hasUser: boolean; from: string } | null;
  /** MAIL_OUTBOX_DIR activo (solo desarrollo y pruebas): los emails se guardan en disco. */
  outbox: boolean;
}

export async function getMailSettingsView(outbox: boolean): Promise<MailSettingsView> {
  const { settings } = await readSaved();
  const e = envMailConfig();
  return { settings, env: e ? { host: e.host, port: e.port, secure: e.secure, hasUser: Boolean(e.user), from: e.from } : null, outbox };
}

/**
 * Guarda los ajustes. `password`: undefined o "" = conservar la guardada; con texto = sustituirla.
 * `clearPassword` la borra. Devuelve qué pasó con la contraseña (para el registro, que no la lleva).
 */
export async function saveMailSettings(
  input: MailSettingsInput,
  opts: { password?: string; clearPassword?: boolean },
): Promise<{ passwordChange: "set" | "cleared" | "unchanged"; before: MailSettings; after: MailSettings }> {
  const { settings: before } = await readSaved();
  const disabling = input.host === "";
  let passwordChange: "set" | "cleared" | "unchanged" = "unchanged";
  const pass = opts.password ?? "";
  // Cambiar de servidor, puerto o usuario con la contraseña guardada la enviaría al nuevo destino: hay que escribirla de nuevo.
  const target = before.host !== input.host.trim() || before.port !== input.port || before.user !== input.user.trim();
  if (!disabling && before.hasPassword && before.host !== "" && target && pass === "" && !opts.clearPassword) {
    throw new AppError("Escribe la contraseña de nuevo al cambiar de servidor o usuario");
  }
  const entries: [string, string][] = [
    [MAIL_HOST_KEY, input.host],
    [MAIL_PORT_KEY, String(input.port)],
    [MAIL_SECURE_KEY, String(input.secure)],
    [MAIL_USER_KEY, input.user],
    [MAIL_FROM_NAME_KEY, input.fromName],
    [MAIL_FROM_ADDRESS_KEY, input.fromAddress],
    [MAIL_MODE_KEY, input.mode ?? parseMailMode("", input.host)],
  ];
  await db.$transaction(async (tx) => {
    for (const [key, value] of entries) await tx.appState.upsert({ where: { key }, create: { key, value }, update: { value } });
    if (disabling || opts.clearPassword) {
      await tx.appState.deleteMany({ where: { key: MAIL_PASS_KEY } });
      if (before.hasPassword) passwordChange = "cleared";
    } else if (pass !== "") {
      const value = encryptSecret(pass);
      await tx.appState.upsert({ where: { key: MAIL_PASS_KEY }, create: { key: MAIL_PASS_KEY, value }, update: { value } });
      passwordChange = "set";
    }
  });
  await refreshAfterSave();
  const { settings: after } = await readSaved();
  return { passwordChange, before, after };
}

async function refreshAfterSave(): Promise<void> {
  invalidateMailConfig();
  // Si había una lectura en curso (con datos anteriores), se espera y se repite.
  const s = store();
  if (s.loading) await s.loading.catch(() => {});
  await refreshMailConfig();
}
