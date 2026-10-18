import "server-only";
import { headers } from "next/headers";

/** IP del cliente y página desde la que se lanza la petición (para los logs). */
export async function requestContext(): Promise<{ ip: string | null; path: string | null }> {
  try {
    const h = await headers();
    const ip = h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",").at(-1)?.trim() || null;
    const referer = h.get("referer");
    let path: string | null = h.get("x-pz-path");
    if (!path && referer) {
      try {
        const url = new URL(referer);
        path = url.pathname + url.search;
      } catch {
        path = null;
      }
    }
    return { ip, path };
  } catch {
    return { ip: null, path: null };
  }
}
