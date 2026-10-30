// Parte pura (sin base de datos ni «server-only») de la configuración del envío de emails: claves, validación,
// preajustes y la regla de precedencia (las variables SMTP_* del servidor ganan a lo guardado en Administración).
// La usan el cliente (preajuste de Gmail), el servidor y el script de rotación de claves.

export const MAIL_HOST_KEY = "mail.host";
export const MAIL_PORT_KEY = "mail.port";
export const MAIL_SECURE_KEY = "mail.secure";
export const MAIL_USER_KEY = "mail.user";
/** Contraseña SMTP cifrada con ENCRYPTION_KEY (lib/keyring.ts); nunca viaja al cliente. */
export const MAIL_PASS_KEY = "mail.passEnc";
export const MAIL_FROM_NAME_KEY = "mail.fromName";
export const MAIL_FROM_ADDRESS_KEY = "mail.fromAddress";
/** Solo para la pantalla: qué opción eligió el administrador («gmail» o «company»). No cambia cómo se envía. */
export const MAIL_MODE_KEY = "mail.mode";
export const MAIL_KEYS = [MAIL_HOST_KEY, MAIL_PORT_KEY, MAIL_SECURE_KEY, MAIL_USER_KEY, MAIL_PASS_KEY, MAIL_FROM_NAME_KEY, MAIL_FROM_ADDRESS_KEY, MAIL_MODE_KEY] as const;

export type MailMode = "gmail" | "company";

export interface MailSettings {
  host: string;
  port: number;
  /** true: SSL/TLS directo (puerto 465). false: STARTTLS (587). */
  secure: boolean;
  user: string;
  fromName: string;
  fromAddress: string;
  hasPassword: boolean;
  /** Opción de la pantalla; si no se guardó, se deduce del servidor (smtp.gmail.com = Gmail). */
  mode: MailMode;
}

export const GMAIL_PRESET = { host: "smtp.gmail.com", port: 465, secure: true } as const;

export const EMPTY_MAIL_SETTINGS: MailSettings = { host: "", port: 465, secure: true, user: "", fromName: "", fromAddress: "", hasPassword: false, mode: "gmail" };

/** Proveedor de correo con preajuste. `hint`: qué usuario y contraseña espera (clave de traducción). */
export interface MailPreset {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  /** Usuario fijo que exige el proveedor (SendGrid: «apikey»). */
  user?: string;
  hint: string;
}

export const MAIL_PRESETS: readonly MailPreset[] = [
  { id: "workspace", label: "Google Workspace (buzón con contraseña de aplicación)", host: "smtp.gmail.com", port: 465, secure: true, hint: "Usuario: el buzón completo (nombre@tuempresa.com). Contraseña: una contraseña de aplicación de ese buzón (necesita la verificación en dos pasos)." },
  { id: "workspace-relay", label: "Google Workspace (relay SMTP)", host: "smtp-relay.gmail.com", port: 587, secure: false, hint: "Usuario y contraseña de aplicación de un buzón de tu dominio. Un administrador debe activar el servicio de relay SMTP en la consola de administración de Google (Gmail → Enrutamiento) y exigir autenticación SMTP." },
  { id: "brevo", label: "Brevo", host: "smtp-relay.brevo.com", port: 587, secure: false, hint: "Usuario: el login SMTP que aparece en Brevo (SMTP y API). Contraseña: la clave SMTP que genera Brevo, no la de tu cuenta." },
  { id: "mandrill", label: "Mailchimp Transactional (Mandrill)", host: "smtp.mandrillapp.com", port: 587, secure: false, hint: "Usuario: cualquier nombre (el de tu cuenta de Mailchimp Transactional). Contraseña: una clave de API de Mandrill." },
  { id: "sendgrid", label: "SendGrid", host: "smtp.sendgrid.net", port: 587, secure: false, user: "apikey", hint: "Usuario: la palabra apikey, tal cual. Contraseña: una clave de API de SendGrid con permiso de envío de correo." },
  { id: "ses", label: "Amazon SES", host: "email-smtp.eu-west-1.amazonaws.com", port: 587, secure: false, hint: "Usuario y contraseña: las credenciales SMTP que crea SES (no las de acceso a AWS). Cambia eu-west-1 por tu región." },
  { id: "mailgun", label: "Mailgun", host: "smtp.mailgun.org", port: 587, secure: false, hint: "Usuario: postmaster@ seguido de tu dominio de envío de Mailgun. Contraseña: la del usuario SMTP que muestra Mailgun." },
  { id: "microsoft365", label: "Outlook / Microsoft 365", host: "smtp.office365.com", port: 587, secure: false, hint: "Usuario: el buzón completo. Contraseña: la del buzón; un administrador de Microsoft 365 debe permitir el envío SMTP autenticado (SMTP AUTH) para ese buzón." },
];

/** Preajuste que corresponde a un servidor y puerto (SES vale con cualquier región), o null si es otro. */
export function detectMailPreset(host: string, port: number): MailPreset | null {
  const h = host.trim().toLowerCase();
  if (/^email-smtp\.[a-z0-9-]+\.amazonaws\.com$/.test(h)) return MAIL_PRESETS.find((p) => p.id === "ses")!;
  return MAIL_PRESETS.find((p) => p.host === h && p.port === port) ?? null;
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/;

export const isEmailAddress = (s: string) => s.length <= 200 && EMAIL_RE.test(s);
export const isMailHost = (s: string) => HOST_RE.test(s);

/** Modo guardado; sin él (ajustes de versiones anteriores) se deduce del servidor. */
export function parseMailMode(value: string, host: string): MailMode {
  if (value === "gmail" || value === "company") return value;
  return host === "" || host.toLowerCase() === GMAIL_PRESET.host ? "gmail" : "company";
}

/** Lee los ajustes guardados (AppState); la contraseña solo se indica como presente o no. */
export function parseMailSettings(rows: { key: string; value: string }[]): MailSettings {
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? "";
  const port = Number(get(MAIL_PORT_KEY));
  const host = get(MAIL_HOST_KEY).trim();
  return {
    host,
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 465,
    secure: get(MAIL_SECURE_KEY) === "" ? true : get(MAIL_SECURE_KEY) === "true",
    user: get(MAIL_USER_KEY).trim(),
    fromName: get(MAIL_FROM_NAME_KEY).trim(),
    fromAddress: get(MAIL_FROM_ADDRESS_KEY).trim(),
    hasPassword: get(MAIL_PASS_KEY) !== "",
    mode: parseMailMode(get(MAIL_MODE_KEY), host),
  };
}

/** Remitente «Nombre <dirección>» (el nombre sin comillas, saltos de línea ni ángulos: no se puede inyectar una cabecera). */
export function formatFrom(name: string, address: string): string {
  const clean = name.replace(/[\r\n"<>]/g, " ").replace(/\s+/g, " ").trim();
  return clean ? `"${clean}" <${address}>` : address;
}

/** Configuración efectiva para enviar. */
export interface MailConfig {
  /** De dónde sale: variables del servidor, ajustes de Administración o ninguno. */
  source: "env" | "db" | "none";
  host: string;
  port: number;
  secure: boolean;
  /** Solo STARTTLS: no seguir si el servidor no lo ofrece (lo guardado en Administración nunca baja a texto plano). */
  requireTLS: boolean;
  user: string;
  pass: string;
  from: string;
}

type Env = Record<string, string | undefined>;

export const NO_MAIL_CONFIG: MailConfig = { source: "none", host: "", port: 465, secure: true, requireTLS: false, user: "", pass: "", from: "" };

/** Variables SMTP_* del servidor (SMTP_HOST y SMTP_FROM definidos), o null. Es lo que hacía la app antes de existir los ajustes. */
export function envMailConfig(env: Env = process.env): MailConfig | null {
  if (!env.SMTP_HOST || !env.SMTP_FROM) return null;
  const port = Number(env.SMTP_PORT ?? 465);
  return { source: "env", host: env.SMTP_HOST, port, secure: port === 465, requireTLS: false, user: env.SMTP_USER ?? "", pass: env.SMTP_PASS ?? "", from: env.SMTP_FROM };
}

/** Precedencia: si hay SMTP_* en el servidor mandan; si no, lo guardado (con su contraseña ya descifrada). */
export function resolveMailConfig(env: Env, saved: MailSettings, password: string): MailConfig {
  const fromEnv = envMailConfig(env);
  if (fromEnv) return fromEnv;
  if (!saved.host || !saved.fromAddress) return NO_MAIL_CONFIG;
  return { source: "db", host: saved.host, port: saved.port, secure: saved.secure, requireTLS: !saved.secure, user: saved.user, pass: password, from: formatFrom(saved.fromName, saved.fromAddress) };
}

export interface MailSettingsInput {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromAddress: string;
  /** Opción elegida en la pantalla (opcional: se conserva el modo deducido del servidor). */
  mode?: MailMode;
}

/** Valida y normaliza el formulario. Devuelve el mensaje de error (en español, clave de traducción) o los datos limpios. */
export function validateMailSettings(input: MailSettingsInput): { ok: true; value: MailSettingsInput } | { ok: false; error: string } {
  const host = String(input.host ?? "").trim();
  const user = String(input.user ?? "").trim();
  const fromName = String(input.fromName ?? "").replace(/[\r\n"<>]/g, " ").replace(/\s+/g, " ").trim();
  const fromAddress = String(input.fromAddress ?? "").trim();
  const port = Number(input.port);
  // Sin servidor se desactiva el envío: se guarda vacío y no se exige nada más.
  if (host === "") return { ok: true, value: { host: "", port: 465, secure: true, user: "", fromName: "", fromAddress: "", mode: input.mode === "company" ? "company" : "gmail" } };
  if (!isMailHost(host)) return { ok: false, error: "El servidor SMTP no es válido." };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: "El puerto debe estar entre 1 y 65535." };
  if (user.length > 200 || /[\r\n]/.test(user)) return { ok: false, error: "El usuario no es válido." };
  if (fromName.length > 100) return { ok: false, error: "El nombre del remitente es demasiado largo." };
  if (!isEmailAddress(fromAddress)) return { ok: false, error: "El email del remitente no es válido." };
  const mode = parseMailMode(String(input.mode ?? ""), host);
  return { ok: true, value: { host, port, secure: Boolean(input.secure), user, fromName, fromAddress, mode } };
}

/** Mensaje de error de SMTP apto para mostrar: sin la contraseña ni el usuario, sin saltos de línea y acotado. */
export function sanitizeSmtpError(err: unknown, secrets: string[] = []): string {
  const e = err as { message?: unknown; response?: unknown } | null;
  let text = String(e?.message ?? err ?? "").trim();
  const response = typeof e?.response === "string" ? e.response.trim() : "";
  if (response && !text.includes(response)) text = `${text} (${response})`;
  for (const s of secrets) if (s.length >= 3) text = text.split(s).join("***");
  text = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 300 ? `${text.slice(0, 300)}…` : text || "Error desconocido";
}
