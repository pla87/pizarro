import { parseBackupKey } from "./backup-core";

// Parte pura del diagnóstico para soporte (Administración → Ajustes → «Descargar diagnóstico» y node dist/doctor.mjs):
// qué variables se comprueban, cómo se describen sin revelar su valor y cómo se limpian los textos.
// Regla: el informe NUNCA lleva valores de variables, emails, nombres ni mensajes de los logs.

type Env = Record<string, string | undefined>;

/** Variables documentadas (.env.example, docs/INSTALL.md). Solo se informa de si están definidas. */
export const DOCUMENTED_ENV_VARS = [
  "DATABASE_URL", "SESSION_SECRET", "TOKEN_SECRET", "TOKEN_SECRET_PREVIOUS", "ENCRYPTION_KEY", "ENCRYPTION_KEY_PREVIOUS",
  "APP_URL", "UPLOAD_DIR", "PORT", "NODE_ENV",
  "SEED_ADMIN_EMAIL", "SEED_ADMIN_PASSWORD", "SEED_ADMIN_NAME",
  "MAX_USERS", "MAX_UPLOAD_MB", "DATABASE_POOL_SIZE", "COOKIE_SECURE", "UPLOAD_QUOTA_MB_PER_PROJECT", "UPLOAD_QUOTA_MB_TOTAL",
  "BACKUP_KEY", "APP_TIMEZONE", "LOG_RETENTION_DAYS", "HEALTH_MIN_FREE_MB", "EXIT_ON_UNCAUGHT_EXCEPTION",
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_WORKSPACE_DOMAIN", "GOOGLE_SHARE_ROLE", "AUTH_GOOGLE_ONLY", "AUTH_ALLOW_ADMIN_PASSWORD",
  "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "MAIL_OUTBOX_DIR", "MAIL_OUTBOX_IN_PRODUCTION",
  "WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_TEMPLATE_NAME", "WHATSAPP_TEMPLATE_LANG", "WHATSAPP_API_VERSION",
] as const;

/** Claves que deben tener al menos 32 caracteres: de ellas se dice también si el valor no sirve (sin decir cuál es). */
const MIN32 = new Set(["SESSION_SECRET", "TOKEN_SECRET", "TOKEN_SECRET_PREVIOUS", "ENCRYPTION_KEY", "ENCRYPTION_KEY_PREVIOUS"]);

export type EnvPresence = "set" | "unset" | "invalid";

/** Nombre → «set» / «unset» (o «invalid» si una clave está definida pero no es válida). Nunca el valor. */
export function envPresence(env: Env = process.env): Record<string, EnvPresence> {
  const out: Record<string, EnvPresence> = {};
  for (const name of DOCUMENTED_ENV_VARS) {
    const v = env[name];
    if (v === undefined || v.trim() === "") out[name] = "unset";
    else if (MIN32.has(name) && v.length < 32) out[name] = "invalid";
    else if (name === "BACKUP_KEY" && !parseBackupKey(v)) out[name] = "invalid";
    else out[name] = "set";
  }
  return out;
}

/** ¿Qué está activado? (las mismas condiciones que la app: lib/google.ts, lib/mail.ts, lib/notify.ts, lib/auth-policy.ts) */
export function configFlags(env: Env = process.env) {
  const google = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.APP_URL);
  const outbox = Boolean(env.MAIL_OUTBOX_DIR?.trim() && (env.NODE_ENV !== "production" || env.MAIL_OUTBOX_IN_PRODUCTION === "1"));
  return {
    google,
    googleWorkspaceDomain: Boolean(env.GOOGLE_WORKSPACE_DOMAIN),
    authGoogleOnly: env.AUTH_GOOGLE_ONLY === "true" && google,
    smtp: Boolean(env.SMTP_HOST && env.SMTP_FROM),
    mailOutbox: outbox,
    email: outbox || Boolean(env.SMTP_HOST && env.SMTP_FROM),
    whatsapp: Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_TEMPLATE_NAME),
    backups: Boolean(parseBackupKey(env.BACKUP_KEY)),
    separateTokenSecret: Boolean(env.TOKEN_SECRET?.trim()),
    separateEncryptionKey: Boolean(env.ENCRYPTION_KEY?.trim()),
    keyRotationInProgress: Boolean(env.TOKEN_SECRET_PREVIOUS?.trim() || env.ENCRYPTION_KEY_PREVIOUS?.trim()),
  };
}

/** ¿El nombre de la variable sugiere un secreto? (sus valores se buscan y se tachan en todo el informe) */
export const SECRET_NAME = /SECRET|KEY|PASS|TOKEN|DATABASE_URL|CLIENT_ID|PHONE_NUMBER/i;
/** Claves de objeto que nunca se copian al informe. */
const SECRET_FIELD = /pass(word)?|token|secret|authorization|cookie|phone|email|^name$|userName|^ip$/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Credenciales dentro de una URL (postgresql://usuario:clave@host). */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(:[^\s/@]*)?@/gi;
/** Cadenas largas tipo token/clave (base64, hex) de 24 caracteres o más. */
const LONG_TOKEN = /[A-Za-z0-9+/_-]{24,}={0,2}/g;

export interface ScrubContext {
  /** Valores concretos que deben desaparecer: los de las variables con aspecto de secreto, nombres de personas… */
  literals: string[];
  /** Rutas del servidor que se sustituyen por un marcador (p. ej. UPLOAD_DIR → «[UPLOAD_DIR]»). */
  paths?: Record<string, string>;
  /** Tachar también cadenas largas tipo token (por defecto sí). No en la pasada final: romperían nombres de migraciones. */
  tokens?: boolean;
  /** Quitar campos con nombre sensible (email, name, token…) de los objetos (por defecto sí). */
  dropFields?: boolean;
}

/** Valores de las variables de entorno con aspecto de secreto (los que hay que buscar y tachar). */
export function secretEnvValues(env: Env = process.env): string[] {
  return Object.entries(env)
    .filter(([k, v]) => SECRET_NAME.test(k) && typeof v === "string" && v.trim().length >= 8)
    .map(([, v]) => v!);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Limpia un texto: sin secretos conocidos, credenciales de URL, emails, nombres conocidos ni tokens largos. */
export function scrubText(text: string, ctx: ScrubContext): string {
  let s = text;
  // Primero los más largos: un valor que contiene a otro no deja restos.
  for (const lit of [...new Set(ctx.literals)].filter((l) => l && l.trim().length >= 3).sort((a, b) => b.length - a.length)) {
    s = s.replace(new RegExp(escapeRe(lit), "gi"), "[oculto]");
  }
  for (const [p, label] of Object.entries(ctx.paths ?? {}).sort((a, b) => b[0].length - a[0].length)) {
    if (p && p.length > 1) s = s.split(p).join(label);
  }
  s = s.replace(URL_CREDENTIALS, "$1[oculto]@").replace(EMAIL, "[email]");
  if (ctx.tokens !== false) s = s.replace(LONG_TOKEN, "[token]");
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

/** Copia limpia de un valor cualquiera: textos limpiados y campos sensibles fuera. */
export function scrubDeep(value: unknown, ctx: ScrubContext, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return scrubText(value, ctx);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (depth > 6) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 500).map((v) => scrubDeep(v, ctx, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (ctx.dropFields !== false && SECRET_FIELD.test(k)) continue;
      out[k] = scrubDeep(v, ctx, depth + 1);
    }
    return out;
  }
  return null;
}

export interface MigrationStatus {
  folder: number;
  applied: number;
  /** En la carpeta pero sin aplicar (falta `prisma migrate deploy`). */
  pending: string[];
  /** Aplicadas en la BD pero que esta versión no conoce (BD más nueva que la app). */
  unknown: string[];
  /** Empezadas y sin terminar ni deshacer (hay que resolverlas a mano). */
  failed: string[];
  /** No se encontró la carpeta de migraciones (solo se informa de lo aplicado). */
  folderFound: boolean;
}

export function migrationStatus(
  folder: string[] | null,
  rows: { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[],
): MigrationStatus {
  const applied = rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
  const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
  const appliedSet = new Set(applied);
  const folderSet = new Set(folder ?? []);
  return {
    folder: folder?.length ?? 0,
    applied: applied.length,
    pending: folder ? folder.filter((m) => !appliedSet.has(m)).sort() : [],
    unknown: folder ? applied.filter((m) => !folderSet.has(m)).sort() : [],
    failed: failed.sort(),
    folderFound: folder !== null,
  };
}

/** Recuento de errores y avisos de las últimas 24 h por acción (sin mensajes). */
export function groupLogCounts(rows: { level: string; action: string; _count: { _all: number } }[]) {
  const out: { level: string; action: string; count: number }[] = rows
    .filter((r) => r.level === "error" || r.level === "warn")
    .map((r) => ({ level: r.level, action: r.action, count: r._count._all }));
  return out.sort((a, b) => b.count - a.count || a.action.localeCompare(b.action));
}
