import { createECDH, createHmac, createCipheriv, createPrivateKey, generateKeyPairSync, randomBytes, sign, type JsonWebKey } from "node:crypto";

// Avisos push del navegador (Web Push) sin dependencias, solo con node:crypto. Lógica pura, sin base de datos:
// - VAPID (RFC 8292): el servidor se identifica ante el servicio push con un JWT ES256 firmado con su par P-256.
// - Cifrado del contenido (RFC 8291 sobre RFC 8188, «aes128gcm»): solo el navegador suscrito puede leer el aviso; el
//   servicio push (Google, Mozilla, Apple, Microsoft) transporta bytes cifrados.
// - Lista cerrada de servicios push: el servidor hace POST a la dirección (endpoint) que manda el navegador, así que solo
//   se admiten https y los hosts de los servicios conocidos (contra SSRF), comprobado al suscribir y al enviar.

const b64url = (buf: Uint8Array): string => Buffer.from(buf).toString("base64url");
export const fromB64url = (s: string): Buffer => Buffer.from(s, "base64url");

// --- Servicios push admitidos ---

/** Hosts exactos de los servicios push de los navegadores (Chrome/Android/Samsung/Opera: FCM; Firefox; Safari). */
const PUSH_HOSTS: readonly string[] = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
/** Sufijos con un subdominio delante (Edge: WNS, p. ej. wns2-par02p.notify.windows.com). */
const PUSH_HOST_SUFFIXES: readonly string[] = [".notify.windows.com"];
/** Largo máximo de un endpoint (los reales rondan los 200-500 caracteres). */
export const PUSH_ENDPOINT_MAX = 1024;

/**
 * ¿Es este endpoint de un servicio push conocido? Solo https, puerto por defecto, sin usuario ni contraseña, y el host
 * en la lista cerrada. Devuelve el host o null.
 */
export function pushEndpointHost(endpoint: unknown): string | null {
  if (typeof endpoint !== "string" || endpoint.length > PUSH_ENDPOINT_MAX) return null;
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.port !== "" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (PUSH_HOSTS.includes(host)) return host;
  for (const suffix of PUSH_HOST_SUFFIXES) {
    const label = host.slice(0, -suffix.length);
    if (host.endsWith(suffix) && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) return host;
  }
  return null;
}

/** Nombre legible del servicio push (para la lista de dispositivos; nunca el endpoint, que es un secreto). */
export function pushServiceName(host: string): string {
  if (host === "fcm.googleapis.com") return "Google";
  if (host === "updates.push.services.mozilla.com") return "Mozilla";
  if (host === "web.push.apple.com") return "Apple";
  if (host.endsWith(".notify.windows.com")) return "Microsoft";
  return host;
}

// --- Claves del navegador ---

/** Claves de la suscripción (p256dh: punto P-256 sin comprimir, 65 bytes; auth: 16 bytes), en base64url. */
export interface PushKeys {
  p256dh: string;
  auth: string;
}

/** Comprueba las claves que manda el navegador: tamaños y que el punto sea de la curva (si no, el cifrado fallaría). */
export function validPushKeys(keys: unknown): PushKeys | null {
  if (!keys || typeof keys !== "object") return null;
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (typeof p256dh !== "string" || typeof auth !== "string" || p256dh.length > 200 || auth.length > 50) return null;
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(p256dh) || !/^[A-Za-z0-9_-]+={0,2}$/.test(auth)) return null;
  const pub = fromB64url(p256dh);
  const secret = fromB64url(auth);
  if (pub.length !== 65 || pub[0] !== 0x04 || secret.length !== 16) return null;
  try {
    const probe = createECDH("prime256v1");
    probe.generateKeys();
    probe.computeSecret(pub);
  } catch {
    return null;
  }
  return { p256dh: b64url(pub), auth: b64url(secret) };
}

// --- Cifrado aes128gcm (RFC 8291 y RFC 8188) ---

const hmac = (key: Uint8Array, data: Uint8Array): Buffer => createHmac("sha256", key).update(data).digest();
/** HKDF-SHA256 en dos pasos (extract + expand de un solo bloque), como lo escriben los RFC. */
const hkdf = (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Buffer => hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, length);

/** Tamaño de registro (rs) de la cabecera: un solo registro, así que basta con que quepa el aviso. */
const RECORD_SIZE = 4096;
/** Lo más que cabe en claro (RFC 8291 §4): los servicios admiten 4096 bytes cifrados, menos 86 de cabecera, 16 de etiqueta y 1 de delimitador. */
export const PUSH_PAYLOAD_MAX = 3993;

/**
 * Cifra `plaintext` para un navegador (RFC 8291 §3.4): ECDH con un par efímero del servidor, HKDF con el secreto `auth`,
 * y AES-128-GCM con un solo registro. Devuelve el cuerpo completo (cabecera + texto cifrado). `asPrivate` y `salt` solo
 * se fijan en las pruebas (vectores del RFC); en el uso normal son aleatorios en cada aviso.
 */
export function encryptPushPayload(plaintext: Uint8Array, keys: PushKeys, opts: { asPrivate?: Uint8Array; salt?: Uint8Array } = {}): Buffer {
  if (plaintext.length > PUSH_PAYLOAD_MAX) throw new Error(`El aviso push ocupa ${plaintext.length} bytes (máximo ${PUSH_PAYLOAD_MAX}).`);
  const uaPublic = fromB64url(keys.p256dh);
  const authSecret = fromB64url(keys.auth);
  const ecdh = createECDH("prime256v1");
  if (opts.asPrivate) ecdh.setPrivateKey(opts.asPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const salt = opts.salt ? Buffer.from(opts.salt) : randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // Último (y único) registro: el texto seguido del delimitador 0x02, sin relleno.
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

// --- VAPID (RFC 8292) ---

/** Par VAPID de la instalación: la clave privada como JWK (d, x, y) y la pública sin comprimir (65 bytes) en base64url. */
export interface VapidKeys {
  publicKey: string;
  privateJwk: { kty: "EC"; crv: "P-256"; d: string; x: string; y: string };
}

export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" }) as JsonWebKey;
  return vapidFromJwk(jwk);
}

/** Rehace el par a partir de la JWK guardada (lanza si no es una clave P-256 válida). */
export function vapidFromJwk(jwk: unknown): VapidKeys {
  const j = (jwk ?? {}) as Record<string, unknown>;
  if (j.kty !== "EC" || j.crv !== "P-256" || typeof j.d !== "string" || typeof j.x !== "string" || typeof j.y !== "string") throw new Error("Clave VAPID no válida");
  const privateJwk = { kty: "EC" as const, crv: "P-256" as const, d: j.d, x: j.x, y: j.y };
  // Comprueba que la clave se puede usar (y que x, y son el punto de d).
  const key = createPrivateKey({ key: privateJwk, format: "jwk" });
  const pub = key.export({ format: "jwk" }) as JsonWebKey;
  if (pub.x !== j.x || pub.y !== j.y) throw new Error("Clave VAPID no válida");
  return { publicKey: b64url(Buffer.concat([Buffer.from([4]), fromB64url(j.x), fromB64url(j.y)])), privateJwk };
}

/** Validez del JWT: 12 horas (el RFC admite hasta 24). */
const VAPID_TTL_SEC = 12 * 60 * 60;

/**
 * JWT VAPID para un servicio push: `aud` es el origen del endpoint, `sub` un contacto (mailto: o https:). Firma ES256
 * en el formato de JOSE (r‖s, 64 bytes).
 */
function vapidJwt(endpoint: string, subject: string, keys: VapidKeys, nowSec: number = Math.floor(Date.now() / 1000)): string {
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + VAPID_TTL_SEC, sub: subject })));
  const input = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(input), { key: createPrivateKey({ key: keys.privateJwk, format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(signature)}`;
}

/** Contacto VAPID: el email público de contacto (mailto:) o, sin él, la dirección de la app. */
export function vapidSubject(contactEmail: string, appUrl: string): string {
  const email = contactEmail.trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? `mailto:${email}` : appUrl;
}

/** Cabeceras del POST al servicio push (RFC 8030 + 8291 + 8292). TTL: cuánto puede guardar el aviso si el dispositivo está apagado. */
export function pushRequestHeaders(endpoint: string, subject: string, keys: VapidKeys, opts: { ttlSec?: number; urgency?: "normal" | "high"; nowSec?: number } = {}): { Authorization: string; "Content-Encoding": string; "Content-Type": string; TTL: string; Urgency: string } {
  return {
    Authorization: `vapid t=${vapidJwt(endpoint, subject, keys, opts.nowSec)}, k=${keys.publicKey}`,
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(opts.ttlSec ?? 24 * 60 * 60),
    Urgency: opts.urgency ?? "normal",
  };
}

/** Qué hacer con la respuesta del servicio push: 2xx enviado; 404/410 la suscripción ya no existe (se borra); lo demás, fallo. */
export function pushOutcome(status: number): "sent" | "expired" | "failed" {
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "expired";
  return "failed";
}

// --- Contenido del aviso ---

/** Lo que recibe el service worker (public/sw.js). `url` es siempre una ruta de la propia app (empieza por «/»). */
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
  icon: string;
}

/** Ruta relativa y del mismo origen: «/p/x?task=y». Cualquier otra cosa (otro origen, «//host») pasa a «/». */
export function samePath(url: string, origin: string): string {
  try {
    const u = new URL(url, origin);
    if (u.origin !== new URL(origin).origin) return "/";
    return `${u.pathname}${u.search}${u.hash}` || "/";
  } catch {
    return "/";
  }
}

const clip = (s: string, max: number): string => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

/**
 * Aviso push en JSON: título (la cabecera del aviso: quién y qué tarea), texto (el proyecto) y la ruta que abre. Sin
 * descripciones ni comentarios: la pantalla bloqueada del móvil lo enseña a cualquiera que la mire.
 */
export function pushMessageJson(m: PushMessage): Buffer {
  const msg: PushMessage = { title: clip(m.title, 200), body: clip(m.body, 160), url: m.url.startsWith("/") && !m.url.startsWith("//") ? m.url.slice(0, 1000) : "/", tag: m.tag.slice(0, 80), icon: m.icon.slice(0, 200) };
  return Buffer.from(JSON.stringify(msg));
}

/** Dispositivos con avisos push por persona. */
export const PUSH_DEVICES_MAX = 10;
/** Avisos push por persona y hora (como Telegram): una avalancha de avisos no se convierte en una avalancha de notificaciones. */
export const PUSH_LIMIT_PER_HOUR = 30;
/** Tiempo máximo de cada envío a un servicio push. */
export const PUSH_TIMEOUT_MS = 10_000;
/** Clave de AppState con el par VAPID de la instalación (la JWK privada, cifrada con ENCRYPTION_KEY). */
export const PUSH_VAPID_KEY = "push.vapidEnc";
