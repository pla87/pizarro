"use client";

import { probeServer, refreshWhenOnline, reportOffline } from "@/lib/connection";
import { isNextNavigationSignal } from "@/lib/next-navigation-signal";
import { isStaleActionError } from "@/lib/stale-action";
import { reloadForNewVersion } from "./VersionWatcher";

type Source = "error-boundary" | "global-error" | "window" | "promise";

const sent = new Map<string, number>();

/** Envía un error del navegador a los logs (sin repetir el mismo más de una vez por minuto). */
export function reportClientError(source: Source, error: unknown, digest?: string) {
  try {
    const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
    const errDigest = digest ?? (err as Error & { digest?: string }).digest;
    // Redirección o «no encontrado» de Next que llegó con la página a medio enviar: no es un fallo (ver isNextNavigationSignal).
    if (isNextNavigationSignal(errDigest, err.message)) return;
    const key = `${source}:${err.message}`;
    const now = Date.now();
    if ((sent.get(key) ?? 0) > now - 60_000) return;
    sent.set(key, now);
    if (sent.size > 100) for (const [k, t] of sent) if (t < now - 60_000) sent.delete(k);
    const body = JSON.stringify({
      source,
      message: err.message.slice(0, 2000) || "(sin mensaje)",
      digest: errDigest,
      stack: err.stack?.slice(0, 4000),
      path: (window.location.pathname + window.location.search).slice(0, 500),
    });
    void fetch("/api/client-errors", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // Informar de un error nunca debe provocar otro.
  }
}

/** ¿Es un fragmento de código que no ha llegado (ChunkLoadError)? Sin red también lo es. */
function isChunkLoadError(error: Error): boolean {
  return /Loading chunk|ChunkLoadError|Loading CSS chunk|Failed to fetch dynamically imported module/i.test(`${error.name} ${error.message ?? ""}`);
}

/**
 * Para las pantallas de error (error.tsx, global-error.tsx): si el fallo viene de una versión anterior del código
 * (acción o fragmento que el servidor ya no tiene tras un despliegue) se recarga la página entera en vez de enseñar
 * el error; si no, se registra.
 *
 * Un fragmento que no llega sin red (o con el servidor caído) no es una versión nueva: recargar sin red cambiaba la página
 * por la de error del navegador. Entonces no se recarga: «sin conexión» y, al volver la conexión, `retry` (el «Reintentar»
 * de la pantalla) vuelve a pintar lo que falló.
 */
export function handleBoundaryError(source: Source, error: Error & { digest?: string }, retry?: () => void): void {
  if (!isStaleActionError(error) && !isChunkLoadError(error)) {
    reportClientError(source, error, error.digest);
    return;
  }
  void probeServer().then((reachable) => {
    if (!reachable) {
      reportOffline();
      if (retry) refreshWhenOnline(retry);
      return;
    }
    if (!reloadForNewVersion()) reportClientError(source, error, error.digest);
  });
}
