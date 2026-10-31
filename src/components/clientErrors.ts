"use client";

import { isStaleActionError } from "@/lib/stale-action";
import { reloadForNewVersion } from "./VersionWatcher";

type Source = "error-boundary" | "global-error" | "window" | "promise";

const sent = new Map<string, number>();

/** Envía un error del navegador a los logs (sin repetir el mismo más de una vez por minuto). */
export function reportClientError(source: Source, error: unknown, digest?: string) {
  try {
    const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
    const key = `${source}:${err.message}`;
    const now = Date.now();
    if ((sent.get(key) ?? 0) > now - 60_000) return;
    sent.set(key, now);
    const body = JSON.stringify({
      source,
      message: err.message.slice(0, 2000) || "(sin mensaje)",
      digest: digest ?? (err as Error & { digest?: string }).digest,
      stack: err.stack?.slice(0, 4000),
      path: (window.location.pathname + window.location.search).slice(0, 500),
    });
    void fetch("/api/client-errors", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // Informar de un error nunca debe provocar otro.
  }
}

/**
 * Para las pantallas de error (error.tsx, global-error.tsx): si el fallo viene de una versión anterior del código
 * (acción o fragmento que el servidor ya no tiene tras un despliegue) se recarga la página entera en vez de enseñar
 * el error; si no, se registra. Devuelve true si ha pedido la recarga.
 */
export function handleBoundaryError(source: Source, error: Error & { digest?: string }): boolean {
  if (isStaleActionError(error) || /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module/i.test(error.message ?? "")) {
    if (reloadForNewVersion()) return true;
  }
  reportClientError(source, error, error.digest);
  return false;
}
