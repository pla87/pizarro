import "server-only";
import { db } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";
import { AppError } from "./errors";
import { logEvent } from "./log";

// Integración con Google Drive mediante OAuth por usuario.
// Permiso mínimo: drive.file (solo los archivos que crea la propia app).

/** Error de conexión con un código estable para mostrarlo en Ajustes (nunca texto libre en la URL). */
export class GoogleConnectError extends AppError {
  constructor(message: string, public readonly code: "scope" | "domain" | "token") {
    super(message);
  }
}

const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.file"];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

export const GOOGLE_MIME = {
  GOOGLE_DOC: "application/vnd.google-apps.document",
  GOOGLE_SHEET: "application/vnd.google-apps.spreadsheet",
} as const;
export type GoogleFileKind = keyof typeof GOOGLE_MIME;

export function googleEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_URL);
}

function googleRedirectUri(): string {
  return `${process.env.APP_URL!.replace(/\/$/, "")}/api/google/callback`;
}

export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    // consent: garantiza recibir refresh_token también al reconectar.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  // Limita la elección de cuenta al dominio de Workspace, si se configura.
  if (process.env.GOOGLE_WORKSPACE_DOMAIN) params.set("hd", process.env.GOOGLE_WORKSPACE_DOMAIN);
  return `${AUTH_URL}?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...body,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new AppError("Google ha rechazado la autorización. Vuelve a conectar tu cuenta.", 400);
    (err as AppError & { googleError?: string }).googleError = json.error;
    throw err;
  }
  return json as TokenResponse;
}

/** El id_token llega directamente del endpoint de Google por TLS: basta con leer su contenido. */
function emailFromIdToken(idToken?: string): string {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split(".")[1]!, "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : "";
  } catch {
    return "";
  }
}

export async function connectGoogleAccount(userId: string, code: string): Promise<string> {
  const tokens = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: googleRedirectUri() });
  if (!tokens.scope.split(" ").includes("https://www.googleapis.com/auth/drive.file")) {
    throw new GoogleConnectError("No se concedió el permiso de Google Drive.", "scope");
  }
  const email = emailFromIdToken(tokens.id_token);
  const workspace = process.env.GOOGLE_WORKSPACE_DOMAIN;
  if (workspace && !email.toLowerCase().endsWith(`@${workspace.toLowerCase()}`)) {
    throw new GoogleConnectError(`Usa una cuenta de ${workspace}.`, "domain");
  }
  const existing = await db.googleAccount.findUnique({ where: { userId }, select: { refreshTokenEnc: true } });
  const refresh = tokens.refresh_token ? encryptSecret(tokens.refresh_token) : existing?.refreshTokenEnc;
  if (!refresh) throw new GoogleConnectError("Google no devolvió un token de acceso permanente.", "token");
  const data = {
    email,
    refreshTokenEnc: refresh,
    accessTokenEnc: encryptSecret(tokens.access_token),
    accessTokenExpiry: new Date(Date.now() + (tokens.expires_in - 60) * 1000),
    scope: tokens.scope,
  };
  await db.googleAccount.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  return email;
}

const reconnectError = () => new AppError("Tu conexión con Google ha caducado. Vuelve a conectarla en «Mi perfil».", 412);

/** Descifra un token; si no se puede (p. ej. SESSION_SECRET rotado) borra la conexión y pide reconectar. */
async function decryptOrReset(userId: string, value: string): Promise<string> {
  try {
    return decryptSecret(value);
  } catch {
    await db.googleAccount.delete({ where: { userId } }).catch(() => {});
    throw reconnectError();
  }
}

async function accessToken(userId: string): Promise<string> {
  const account = await db.googleAccount.findUnique({ where: { userId } });
  if (!account) throw new AppError("Conecta tu cuenta de Google en «Mi perfil» para crear documentos.", 412);
  if (account.accessTokenEnc && account.accessTokenExpiry && account.accessTokenExpiry > new Date()) {
    return decryptOrReset(userId, account.accessTokenEnc);
  }
  const refreshToken = await decryptOrReset(userId, account.refreshTokenEnc);
  let tokens: TokenResponse;
  try {
    tokens = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
  } catch (err) {
    // Permiso revocado o caducado: se elimina la conexión para que el usuario reconecte.
    if ((err as { googleError?: string }).googleError === "invalid_grant") {
      await db.googleAccount.delete({ where: { userId } }).catch(() => {});
      logEvent({ level: "warn", category: "google", action: "google.tokenRevoked", message: "Permiso de Google revocado o caducado: conexión eliminada", userId });
      throw reconnectError();
    }
    throw err;
  }
  await db.googleAccount.update({
    where: { userId },
    data: { accessTokenEnc: encryptSecret(tokens.access_token), accessTokenExpiry: new Date(Date.now() + (tokens.expires_in - 60) * 1000) },
  });
  return tokens.access_token;
}

/** Con quién se comparte el archivo: todo el dominio del Workspace o solo unas personas (proyectos privados). */
export type DriveShareTarget = { type: "domain" } | { type: "users"; emails: string[] };

/** Permisos de Drive que hay que crear según la configuración (GOOGLE_WORKSPACE_DOMAIN, GOOGLE_SHARE_ROLE). */
export function sharePermissionBodies(target: DriveShareTarget, env: { domain?: string; role?: string } = { domain: process.env.GOOGLE_WORKSPACE_DOMAIN, role: process.env.GOOGLE_SHARE_ROLE }): Record<string, string>[] {
  const role = env.role ?? "writer";
  if (role === "none" || !["writer", "commenter", "reader"].includes(role)) return [];
  if (target.type === "domain") return env.domain ? [{ type: "domain", domain: env.domain, role }] : [];
  // Un proyecto privado nunca se comparte con el dominio: solo con las direcciones de sus miembros.
  return [...new Set(target.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].map((emailAddress) => ({ type: "user", emailAddress, role }));
}

export async function createDriveFile(userId: string, kind: GoogleFileKind, name: string, share: DriveShareTarget = { type: "domain" }) {
  const token = await accessToken(userId);
  const res = await fetch(`${DRIVE_FILES_URL}?fields=id,name,webViewLink&supportsAllDrives=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: GOOGLE_MIME[kind] }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("[google] Error al crear archivo", res.status, json?.error?.message);
    logEvent({ level: "error", category: "google", action: "google.createFileFailed", message: `Google Drive rechazó crear «${name}» (HTTP ${res.status})`, userId, details: { kind, status: res.status, error: json?.error?.message } });
    throw new AppError(res.status === 403 ? "Google ha denegado la creación del archivo (revisa que la API de Drive esté activada)." : "No se pudo crear el archivo en Google Drive.");
  }
  const file = { id: String(json.id), name: String(json.name), url: String(json.webViewLink) };
  logEvent({ category: "google", action: "google.createFile", message: `Archivo de Google (${kind}) creado: «${file.name}»`, userId, details: { kind, fileId: file.id } });
  await shareFile(token, file.id, share);
  return file;
}

/**
 * Con drive.file el archivo nace privado en el Drive de quien lo crea. Para que el resto del equipo pueda abrirlo
 * desde la tarjeta, se comparte con el dominio de Workspace (GOOGLE_WORKSPACE_DOMAIN) o, en proyectos privados,
 * solo con los emails de sus miembros, con el rol GOOGLE_SHARE_ROLE (writer por defecto; "none" lo desactiva).
 */
async function shareFile(token: string, fileId: string, target: DriveShareTarget): Promise<void> {
  for (const body of sharePermissionBodies(target)) {
    const res = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    // Si la política del Workspace lo impide, el archivo sigue creado: solo se registra.
    if (!res?.ok) {
      const what = body.type === "domain" ? "con el dominio" : "con un miembro del proyecto";
      console.error(`[google] No se pudo compartir el archivo ${what}`, res?.status);
      logEvent({ level: "warn", category: "google", action: "google.shareFailed", message: `No se pudo compartir el archivo ${what} (HTTP ${res?.status ?? "sin respuesta"})`, details: { fileId, status: res?.status ?? null } });
    }
  }
}

export async function disconnectGoogleAccount(userId: string): Promise<void> {
  const account = await db.googleAccount.findUnique({ where: { userId }, select: { refreshTokenEnc: true } });
  if (!account) return;
  // La revocación es de cortesía: aunque falle (o no se pueda descifrar), la conexión se borra.
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: decryptSecret(account.refreshTokenEnc) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // ignorado
  }
  await db.googleAccount.deleteMany({ where: { userId } });
}
