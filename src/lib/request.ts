import "server-only";

/**
 * IP del cliente tras el proxy de Railway. Se prefiere X-Real-IP (lo fija el proxy)
 * y, si no, el último salto de X-Forwarded-For (el primero lo puede inventar el cliente).
 */
export function clientIp(headers: Headers): string {
  return headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
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
