// IP del cliente: la única regla para todo lo que la usa (límites de intentos, registro de actividad, sesiones y
// dispositivos). Parte pura (sin Next ni node:http): se prueba en tests/client-ip.test.ts. La usa lib/request.ts.

type Env = Record<string, string | undefined>;

/**
 * Cabecera interna con la dirección de la conexión TCP. La pone el propio servidor en cada petición (lib/peer-ip.ts,
 * desde instrumentation.ts) y sustituye siempre la que traiga el cliente.
 */
export const PEER_IP_HEADER = "x-pz-peer-ip";

/** Marca global de que lib/peer-ip.ts está instalado en este proceso (si no, la cabecera podría venir del cliente). */
export const PEER_IP_MARK = Symbol.for("pizarro.peerIp");

const YES = new Set(["1", "true", "yes", "on"]);
const NO = new Set(["0", "false", "no", "off"]);

/**
 * ¿Hay un proxy delante en el que confiar (TRUST_PROXY)? Solo entonces valen X-Real-IP y X-Forwarded-For, que el
 * proxy sobrescribe; sin proxy, cualquiera puede mandarlas y falsear su IP (saltarse los límites de intentos o firmar
 * el registro con la IP de otro).
 *
 * Sin definir, según cómo se arrancó: en Docker (scripts/start.sh) y en Railway, sí, porque llevan proxy delante (el
 * Caddy de deploy/compose.yml y el de Railway, que fijan X-Real-IP); con `npm start` (scripts/start-local.mjs), `next
 * start` o `node server.js` a mano, no: lo normal es que el servidor esté expuesto tal cual. Quien ponga su propio
 * proxy delante de `npm start` define TRUST_PROXY=1; quien publique el contenedor sin Caddy, TRUST_PROXY=0.
 */
export function trustProxy(env: Env = process.env): boolean {
  const v = env.TRUST_PROXY?.trim().toLowerCase();
  if (v && YES.has(v)) return true;
  if (v && NO.has(v)) return false;
  if (env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID) return true;
  return env.PIZARRO_LAUNCHER === "docker";
}

/** ¿TRUST_PROXY tiene un valor que no se entiende? (se avisa en el log de arranque y se usa el valor por defecto). */
export function trustProxyInvalid(env: Env = process.env): boolean {
  const v = env.TRUST_PROXY?.trim().toLowerCase();
  return !!v && !YES.has(v) && !NO.has(v);
}

/** «::ffff:1.2.3.4» (IPv4 vista por un socket IPv6) → «1.2.3.4»; recorta y limita la longitud. */
function normalizeIp(ip: string): string {
  const s = ip.trim().slice(0, 64);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  return mapped ? mapped[1]! : s;
}

/**
 * IP del cliente o null si no se sabe. Tras un proxy de confianza, X-Real-IP (la fija el proxy) o, si no, el último
 * salto de X-Forwarded-For (el que añadió el proxy; los anteriores los puede inventar el cliente). Sin proxy, o si el
 * proxy no las manda, la dirección de la conexión (solo si este proceso la anota él mismo: `peerInstalled`).
 */
export function clientIpFrom(get: (name: string) => string | null, { trusted, peerInstalled }: { trusted: boolean; peerInstalled: boolean }): string | null {
  if (trusted) {
    const ip = get("x-real-ip")?.trim() || get("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (ip) return normalizeIp(ip);
  }
  const peer = peerInstalled ? get(PEER_IP_HEADER)?.trim() : "";
  return peer ? normalizeIp(peer) : null;
}
