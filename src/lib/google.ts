import "server-only";
import { db } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";
import { AppError } from "./errors";

// Integración con Google Drive mediante OAuth por usuario.
// Permiso mínimo: drive.file (solo los archivos que crea la propia app).

export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.file"];

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

export function googleRedirectUri(): string {
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
    throw new AppError("No se concedió el permiso de Google Drive. Vuelve a intentarlo y acepta el permiso.");
  }
  const email = emailFromIdToken(tokens.id_token);
  const workspace = process.env.GOOGLE_WORKSPACE_DOMAIN;
  if (workspace && !email.toLowerCase().endsWith(`@${workspace.toLowerCase()}`)) {
    throw new AppError(`Usa una cuenta de ${workspace}.`);
  }
  const existing = await db.googleAccount.findUnique({ where: { userId }, select: { refreshTokenEnc: true } });
  const refresh = tokens.refresh_token ? encryptSecret(tokens.refresh_token) : existing?.refreshTokenEnc;
  if (!refresh) throw new AppError("Google no devolvió un token de acceso permanente. Vuelve a conectar.");
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

async function accessToken(userId: string): Promise<string> {
  const account = await db.googleAccount.findUnique({ where: { userId } });
  if (!account) throw new AppError("Conecta tu cuenta de Google en «Mi perfil» para crear documentos.", 412);
  if (account.accessTokenEnc && account.accessTokenExpiry && account.accessTokenExpiry > new Date()) {
    return decryptSecret(account.accessTokenEnc);
  }
  let tokens: TokenResponse;
  try {
    tokens = await tokenRequest({ refresh_token: decryptSecret(account.refreshTokenEnc), grant_type: "refresh_token" });
  } catch (err) {
    // Permiso revocado o caducado: se elimina la conexión para que el usuario reconecte.
    if ((err as { googleError?: string }).googleError === "invalid_grant") {
      await db.googleAccount.delete({ where: { userId } }).catch(() => {});
      throw new AppError("Tu conexión con Google ha caducado. Vuelve a conectarla en «Mi perfil».", 412);
    }
    throw err;
  }
  await db.googleAccount.update({
    where: { userId },
    data: { accessTokenEnc: encryptSecret(tokens.access_token), accessTokenExpiry: new Date(Date.now() + (tokens.expires_in - 60) * 1000) },
  });
  return tokens.access_token;
}

export async function createDriveFile(userId: string, kind: GoogleFileKind, name: string) {
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
    throw new AppError(res.status === 403 ? "Google ha denegado la creación del archivo (revisa que la API de Drive esté activada)." : "No se pudo crear el archivo en Google Drive.");
  }
  return { id: String(json.id), name: String(json.name), url: String(json.webViewLink) };
}

export async function disconnectGoogleAccount(userId: string): Promise<void> {
  const account = await db.googleAccount.findUnique({ where: { userId }, select: { refreshTokenEnc: true } });
  if (!account) return;
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: decryptSecret(account.refreshTokenEnc) }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
  await db.googleAccount.delete({ where: { userId } });
}
