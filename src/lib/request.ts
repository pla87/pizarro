import "server-only";

/**
 * IP del cliente tras el proxy de Railway. Se prefiere X-Real-IP (lo fija el proxy)
 * y, si no, el último salto de X-Forwarded-For (el primero lo puede inventar el cliente).
 */
export function clientIp(headers: Headers): string {
  return headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
}

/** Protección CSRF para rutas API que modifican datos: Origin debe coincidir con el host. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
