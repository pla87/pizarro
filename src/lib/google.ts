import "server-only";
import { db } from "./db";
import { decryptSecret, decryptSecretInfo, encryptSecret } from "./crypto";
import { AppError } from "./errors";
import { logEvent } from "./log";
import { idTokenKeyId, verifiedConnectEmail } from "./google-id-token";
import { googleKeys } from "./google-login";
import { googleConfig, googleEnabled, googleWorkspaceDomain } from "./google-config";
import { shareStatusOf, type ShareStatus } from "./google-share";

// Integración con Google Drive mediante OAuth por usuario.
// Permiso mínimo: drive.file (solo los archivos que crea la propia app).

/** Error de conexión con un código estable para mostrarlo en Ajustes (nunca texto libre en la URL). */
export class GoogleConnectError extends AppError {
  constructor(message: string, public readonly code: "scope" | "domain" | "token" | "identity") {
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

export { googleEnabled };

function googleRedirectUri(): string {
  return `${process.env.APP_URL!.replace(/\/$/, "")}/api/google/callback`;
}

export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: googleConfig().clientId,
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
  const domain = googleWorkspaceDomain();
  if (domain) params.set("hd", domain);
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
      client_id: googleConfig().clientId,
      client_secret: googleConfig().clientSecret,
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

export async function connectGoogleAccount(userId: string, code: string): Promise<string> {
  const tokens = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: googleRedirectUri() });
  if (!tokens.scope.split(" ").includes("https://www.googleapis.com/auth/drive.file")) {
    throw new GoogleConnectError("No se concedió el permiso de Google Drive.", "scope");
  }
  // El id_token se verifica como en el login (firma con las claves de Google, emisor, audiencia,
  // caducidad, email verificado y dominio): de él salen el email guardado y la comprobación de dominio.
  const workspace = googleWorkspaceDomain();
  const identity = verifiedConnectEmail(tokens.id_token, tokens.id_token ? await googleKeys(idTokenKeyId(tokens.id_token)) : [], {
    clientId: googleConfig().clientId,
    domain: workspace,
  });
  if (!identity.ok) {
    if (identity.reason === "domain" && workspace) throw new GoogleConnectError(`Usa una cuenta de ${workspace}.`, "domain");
    throw new GoogleConnectError(`Google no confirmó la identidad de la cuenta (${identity.reason}).`, "identity");
  }
  const email = identity.email;
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

/**
 * Descifra un token; si no se puede (clave de cifrado cambiada sin ENCRYPTION_KEY_PREVIOUS) borra la conexión y pide
 * reconectar. Si estaba cifrado con la clave anterior, lo vuelve a cifrar con la actual.
 */
async function decryptOrReset(userId: string, value: string, field: "accessTokenEnc" | "refreshTokenEnc"): Promise<string> {
  try {
    const { plain, stale } = decryptSecretInfo(value);
    if (stale) await db.googleAccount.updateMany({ where: { userId, [field]: value }, data: { [field]: encryptSecret(plain) } }).catch(() => {});
    return plain;
  } catch {
    await db.googleAccount.delete({ where: { userId } }).catch(() => {});
    throw reconnectError();
  }
}

async function accessToken(userId: string): Promise<string> {
  const account = await db.googleAccount.findUnique({ where: { userId } });
  if (!account) throw new AppError("Conecta tu cuenta de Google en «Mi perfil» para crear documentos.", 412);
  if (account.accessTokenEnc && account.accessTokenExpiry && account.accessTokenExpiry > new Date()) {
    return decryptOrReset(userId, account.accessTokenEnc, "accessTokenEnc");
  }
  const refreshToken = await decryptOrReset(userId, account.refreshTokenEnc, "refreshTokenEnc");
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

/** Permisos de Drive que hay que crear para ese destino y rol (el dominio sale de GOOGLE_WORKSPACE_DOMAIN). */
export function sharePermissionBodies(target: DriveShareTarget, env: { domain?: string; role?: string } = { domain: googleWorkspaceDomain(), role: "writer" }): Record<string, string>[] {
  const role = env.role ?? "writer";
  if (role === "none" || !["writer", "commenter", "reader"].includes(role)) return [];
  if (target.type === "domain") return env.domain ? [{ type: "domain", domain: env.domain, role }] : [];
  // Un proyecto privado nunca se comparte con el dominio: solo con las direcciones de sus miembros.
  return [...new Set(target.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].map((emailAddress) => ({ type: "user", emailAddress, role }));
}

/** Resultado de compartir: estado y, si falló alguno, cuántas personas se quedaron sin acceso. */
export interface ShareOutcome { status: ShareStatus; failed: number }

/** Crea el archivo y lo comparte con `share` y el rol `role` (según el modo del proyecto, ver google-share.ts). */
export async function createDriveFile(userId: string, kind: GoogleFileKind, name: string, share: DriveShareTarget | null = { type: "domain" }, role = "writer") {
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
  const sharing = share ? await shareFile(token, file.id, share, role) : { status: "NOT_SHARED", failed: 0 } satisfies ShareOutcome;
  return { ...file, share: sharing };
}

/**
 * Con drive.file el archivo nace privado en el Drive de quien lo crea. Para que el resto del equipo pueda abrirlo
 * desde la tarjeta, se comparte con el dominio de Workspace (GOOGLE_WORKSPACE_DOMAIN) o solo con los emails de los
 * miembros del proyecto, según el modo del proyecto. Devuelve cuántos permisos se crearon y cuántos fallaron.
 */
async function shareFile(token: string, fileId: string, target: DriveShareTarget, role: string): Promise<ShareOutcome> {
  const bodies = sharePermissionBodies(target, { domain: googleWorkspaceDomain(), role });
  let failed = 0;
  // En paralelo: con muchos miembros, uno detrás de otro podía tardar más de un minuto.
  await Promise.all(bodies.map(async (body) => {
    const res = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    // Si la política del Workspace lo impide, el archivo sigue creado: solo se registra.
    if (!res?.ok) {
      failed++;
      const what = body.type === "domain" ? "con el dominio" : "con un miembro del proyecto";
      console.error(`[google] No se pudo compartir el archivo ${what}`, res?.status);
      logEvent({ level: "warn", category: "google", action: "google.shareFailed", message: `No se pudo compartir el archivo ${what} (HTTP ${res?.status ?? "sin respuesta"})`, details: { fileId, status: res?.status ?? null } });
    }
  }));
  return { status: shareStatusOf(bodies.length, failed), failed };
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
