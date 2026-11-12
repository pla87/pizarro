import { DEFAULT_LIVE_REFRESH_JITTER_MS, MAX_LIVE_REFRESH_JITTER_MS } from "@/components/board/remoteChange";

/**
 * Retardo máximo (ms) con el que cada pestaña refresca el tablero cuando otra persona cambia algo (ver
 * foreignRefreshDelay en components/board/remoteChange.ts). LIVE_REFRESH_JITTER_MS: 0 lo quita; por defecto 2000; como
 * mucho 10000. Se lee al pintar la página (no al compilar).
 */
export function liveRefreshJitterMs(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.LIVE_REFRESH_JITTER_MS ?? "").trim();
  if (!/^\d+$/.test(raw)) return DEFAULT_LIVE_REFRESH_JITTER_MS;
  return Math.min(Number(raw), MAX_LIVE_REFRESH_JITTER_MS);
}
