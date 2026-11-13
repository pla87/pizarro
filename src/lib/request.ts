import "server-only";
import { clientIpFrom, PEER_IP_MARK, trustProxy } from "./client-ip";

/**
 * IP del cliente (o null si no se sabe): la única función que la calcula, para los límites de intentos, el registro de
 * actividad y las sesiones. Con proxy de confianza (TRUST_PROXY), la que dice el proxy; sin él, la de la conexión.
 * Ver lib/client-ip.ts.
 */
export function clientIpOrNull(headers: Headers): string | null {
  const peerInstalled = Boolean((globalThis as Record<symbol, unknown>)[PEER_IP_MARK]);
  return clientIpFrom((name) => headers.get(name), { trusted: trustProxy(), peerInstalled });
}

/** Como clientIpOrNull, con «unknown» si no se sabe (todas las peticiones sin IP comparten límite). */
export function clientIp(headers: Headers): string {
  return clientIpOrNull(headers) ?? "unknown";
}

/**
 * Protección CSRF para rutas API que modifican datos: Origin debe ser el de la app. Con APP_URL (siempre en
 * producción) vale su host o la cabecera Host de la petición (que el navegador no deja falsear);
 * X-Forwarded-Host no se usa, porque solo es fiable si un proxy delante la sobrescribe. Sin APP_URL
 * (desarrollo) se mantiene el comportamiento anterior: Host o, tras un proxy, X-Forwarded-Host.
 */
export function isSameOrigin(req: Request, appUrl: string | undefined = process.env.APP_URL): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = req.headers.get("host");
  if (appUrl) {
    let appHost: string | null = null;
    try {
      appHost = new URL(appUrl).host;
    } catch {
      appHost = null;
    }
    return originHost === appHost || originHost === host;
  }
  return originHost === (req.headers.get("x-forwarded-host") ?? host);
}
