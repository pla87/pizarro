import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { labelledHmac, labelledHmacCandidates } from "./keyring";

// «Compartir fuera» (columna cuyas tareas se publican en /x/<token>, una página sin cuenta): la parte pura, sin base de
// datos. Token y huella, caducidad, estado del enlace, textos del enlace por email y la comprobación de mismo origen de
// los formularios de la página. La lógica con base está en share-out.ts y la página en share-out-page.ts.

/** Bytes aleatorios del token (256 bits); en la dirección son 43 caracteres base64url. */
const SHARE_TOKEN_BYTES = 32;
export const SHARE_TOKEN_LENGTH = Math.ceil((SHARE_TOKEN_BYTES * 8) / 6);
/** Etiqueta de dominio del HMAC: la huella no vale como la de ningún otro token de la app. */
const SHARE_HMAC_LABEL = "share-out";

export const newShareToken = (): string => randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
/** Lo único que se guarda del token. */
export const hashShareToken = (token: string): string => labelledHmac(SHARE_HMAC_LABEL, token);
/** Huellas con las que buscar un token: la de la clave actual y, durante la rotación de TOKEN_SECRET, la de la anterior. */
export const shareTokenHashes = (token: string): string[] => labelledHmacCandidates(SHARE_HMAC_LABEL, token);
/** ¿Tiene la forma de un token nuestro? Descarta basura sin tocar la base de datos. */
export const isShareTokenShape = (s: string): boolean => s.length === SHARE_TOKEN_LENGTH && /^[A-Za-z0-9_-]+$/.test(s);

/** Comparación en tiempo constante de dos huellas hexadecimales. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Clave corta del enlace para el limitador y los registros (nunca el token en claro). */
export const shareKeyOf = (token: string): string => createHash("sha256").update(`share-out:${token}`).digest("hex").slice(0, 16);

/** Días sin uso tras los que caduca el enlace: lo que rota el selector del pie de la columna. */
export const SHARE_EXPIRY_DAYS = [7, 30, 90] as const;
export type ShareExpiryDays = (typeof SHARE_EXPIRY_DAYS)[number];
export const DEFAULT_SHARE_EXPIRY_DAYS: ShareExpiryDays = 30;
export const isShareExpiry = (n: unknown): n is ShareExpiryDays => SHARE_EXPIRY_DAYS.includes(n as ShareExpiryDays);
/** Siguiente valor del selector (7 días → 1 mes → 3 meses → 7 días). Uno desconocido vuelve al de por defecto. */
export function nextShareExpiry(n: number): ShareExpiryDays {
  const i = SHARE_EXPIRY_DAYS.indexOf(n as ShareExpiryDays);
  return i < 0 ? DEFAULT_SHARE_EXPIRY_DAYS : SHARE_EXPIRY_DAYS[(i + 1) % SHARE_EXPIRY_DAYS.length]!;
}
/** Texto del selector (clave de traducción). */
export function shareExpiryLabel(n: number): "7 días" | "1 mes" | "3 meses" {
  return n === 7 ? "7 días" : n === 90 ? "3 meses" : "1 mes";
}

/** Tras caducar o revocarse, la misma dirección dice «ha caducado» estos días; después, «no encontrado». */
export const SHARE_GRACE_DAYS = 30;
/** Tareas que se publican como mucho (las primeras de la columna). */
export const MAX_SHARE_TASKS = 200;
/** Largo máximo de un comentario escrito desde fuera. */
export const MAX_SHARE_COMMENT = 2000;
/** Se apunta el uso (abrir la página) como mucho una vez cada tanto: no se escribe en la base en cada visita. */
export const SHARE_USE_WRITE_MS = 60 * 60_000;

/**
 * Topes del limitador (mapa de seguridad: prefijo `share-out:`). Por IP, todas las peticiones de la página; por enlace,
 * los cambios por hora (marcar hecha, fecha, comentar) y las descargas por hora.
 */
export const SHARE_LIMITS = {
  ip: { limit: 120, windowMs: 10 * 60_000 },
  changes: { limit: 60, windowMs: 60 * 60_000 },
  downloads: { limit: 300, windowMs: 60 * 60_000 },
} as const;

const DAY = 86_400_000;

/** Lo que importa de una fila para saber cómo está su enlace. */
export interface ShareLinkRow {
  columnId: string | null;
  tokenHash: string | null;
  expiryDays: number;
  generatedAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Estado del enlace actual: `none` (sin generar), `active` (vale hasta `endsAt` si no se usa) o `ended` (caducó o se
 * revocó en `endsAt`). Una fila sin columna (borrada o sin la función) cuenta como terminada.
 */
export function shareLinkState(row: ShareLinkRow, now: Date = new Date()): { state: "none" | "active" | "ended"; endsAt: Date | null } {
  if (!row.tokenHash) return { state: "none", endsAt: null };
  const used = row.lastUsedAt ?? row.generatedAt;
  const expires = used ? new Date(used.getTime() + row.expiryDays * DAY) : null;
  if (row.revokedAt) return { state: "ended", endsAt: expires && expires < row.revokedAt ? expires : row.revokedAt };
  if (!row.columnId) return { state: "ended", endsAt: expires && expires < now ? expires : (used ?? now) };
  if (!expires || expires <= now) return { state: "ended", endsAt: expires ?? now };
  return { state: "active", endsAt: expires };
}

/** ¿Sigue en los 30 días en que la dirección dice «ha caducado»? */
export const inShareGrace = (endedAt: Date, now: Date = new Date()): boolean => now.getTime() < endedAt.getTime() + SHARE_GRACE_DAYS * DAY;

/** Quién firma lo que se hace desde fuera, en la app y en el informe: «Proveedor (fuera)». */
export const shareAuthorLabel = (columnName: string): { k: string; p: { name: string } } => ({ k: "{name} (fuera)", p: { name: columnName } });

export const shareUrl = (appUrl: string, token: string): string => `${appUrl.replace(/\/$/, "")}/x/${token}`;

/**
 * Enlace `mailto:` para mandar la dirección desde el correo de quien comparte (Pizarro no envía nada). Asunto y cuerpo ya
 * traducidos; sin destinatario (lo pone quien lo envía).
 */
export function shareMailto(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Formularios de la página (POST normales): ¿vienen de la propia página? La página va con `Referrer-Policy: no-referrer`,
 * así que el navegador manda `Origin: null` en sus POST: se decide con `Sec-Fetch-Site` (`same-origin`) y, si no lo trae,
 * con un `Origin` que sea el de la app. Un `Sec-Fetch-Site` de otro sitio, o un `Origin` ajeno, se rechazan. Sin ninguna
 * de las dos cabeceras (navegadores muy antiguos) se acepta: la credencial es el token de la dirección, no una cookie,
 * así que otra web no puede actuar sin conocerlo.
 */
export function shareFormAllowed(h: { secFetchSite: string | null; origin: string | null; host: string | null }, appUrl?: string): boolean {
  const site = h.secFetchSite?.toLowerCase() ?? null;
  if (site) return site === "same-origin";
  const origin = h.origin;
  if (!origin || origin === "null") return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  let appHost: string | null = null;
  try {
    appHost = appUrl ? new URL(appUrl).host : null;
  } catch {
    appHost = null;
  }
  return originHost === h.host || (appHost !== null && originHost === appHost);
}

/** Fecha de un formulario: «AAAA-MM-DD» válida (de 2000 a 2100), «» para quitarla, o undefined si no vale. */
export function parseShareDate(raw: string): string | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return undefined;
  const y = d.getUTCFullYear();
  return y >= 2000 && y <= 2100 ? s : undefined;
}

/** Códigos del aviso que enseña la página tras un formulario (`?m=`): solo estos se pintan. */
export const SHARE_NOTICES = ["done", "due", "comment", "rate", "invalid", "full", "gone"] as const;
export type ShareNotice = (typeof SHARE_NOTICES)[number];
export const isShareNotice = (s: unknown): s is ShareNotice => SHARE_NOTICES.includes(s as ShareNotice);

/**
 * Cabeceras de todas las respuestas de /x/ (fuera del proxy y de las cabeceras generales de next.config): sin indexar,
 * sin enviar la dirección (con el token) a otros sitios, sin guardar en cachés y sin scripts.
 */
export function shareResponseHeaders(production: boolean = process.env.NODE_ENV === "production"): Record<string, string> {
  return {
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    ...(production ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
  };
}

/** CSP de la página: nada de scripts; estilos en línea, imágenes y formularios solo de la propia instalación. */
export const SHARE_PAGE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
/** CSP de los ficheros que se sirven (descargas e imágenes): ni scripts ni nada, por si un navegador intentase pintarlos. */
export const SHARE_FILE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";
