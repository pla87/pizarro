import "server-only";
import { cache } from "react";
import { db } from "./db";
import {
  parseLatestRelease, parseUpdateCache, pendingUpdate, refreshUpdateCache, UPDATE_CHECK_URL, UPDATE_FETCH_TIMEOUT_MS,
  type UpdateInfo,
} from "./update-check-core";
import pkg from "../../package.json";

const CACHE_KEY = "updateCheck";
const DISMISS_KEY = "updateDismissed";

/** UPDATE_CHECK=0 (o false/off) desactiva por completo la consulta a GitHub. */
export function updateCheckEnabled(): boolean {
  return !/^(0|false|off|no)$/i.test((process.env.UPDATE_CHECK ?? "").trim());
}

/** Railway reconstruye desde GitHub; un servidor propio se actualiza con get.sh o `docker compose pull`. */
export function runsOnRailway(): boolean {
  return Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
}

async function fetchLatestRelease() {
  const res = await fetch(UPDATE_CHECK_URL, {
    headers: { "User-Agent": `Pizarro/${pkg.version}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(UPDATE_FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) return null; // 403/429 (límite), 404 (sin releases)…
  return parseLatestRelease(await res.json());
}

/** Versión nueva disponible para anunciar a los administradores, o null. Nunca lanza. */
export async function computeUpdateNotice(now: number = Date.now()): Promise<UpdateInfo | null> {
  if (!updateCheckEnabled()) return null;
  try {
    const [row, dismissed] = await Promise.all([
      db.appState.findUnique({ where: { key: CACHE_KEY } }),
      db.appState.findUnique({ where: { key: DISMISS_KEY } }),
    ]);
    const { cache: next, changed } = await refreshUpdateCache(parseUpdateCache(row?.value), now, fetchLatestRelease);
    if (changed) {
      const value = JSON.stringify(next);
      await db.appState.upsert({ where: { key: CACHE_KEY }, create: { key: CACHE_KEY, value }, update: { value } });
    }
    return pendingUpdate(next, pkg.version, dismissed?.value ?? null);
  } catch {
    return null;
  }
}

/** Igual, memorizado por petición (el layout y la página lo piden en la misma pasada). */
export const getUpdateNotice = cache(() => computeUpdateNotice());

/** Descarta el aviso de esa versión (y de las anteriores); una más nueva volverá a avisar. */
export async function dismissUpdateNotice(version: string): Promise<void> {
  await db.appState.upsert({ where: { key: DISMISS_KEY }, create: { key: DISMISS_KEY, value: version }, update: { value: version } });
}
