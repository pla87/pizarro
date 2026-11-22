import "server-only";
import { cache } from "react";
import { db } from "./db";
import { invalidateMemo, memo } from "./memo";
import {
  parseLatestRelease, parseUpdateCache, pendingUpdate, refreshUpdateCache, updateCheckDue, UPDATE_CHECK_URL, UPDATE_FETCH_TIMEOUT_MS,
  type UpdateInfo,
} from "./update-check-core";
import pkg from "../../package.json";

const CACHE_KEY = "updateCheck";
const DISMISS_KEY = "updateDismissed";
/** Claves en la memoria en proceso (lib/memo.ts). */
const NOTICE_MEMO = "update:notice";
const LATEST_MEMO = "update:latest";

/** UPDATE_CHECK=0 (o false/off) desactiva por completo la consulta a GitHub. */
function updateCheckEnabled(): boolean {
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

let inFlight: Promise<void> | null = null;

/** Consulta GitHub y guarda la caché; una sola consulta a la vez en el proceso. */
function refreshInBackground(row: string | undefined, now: number): Promise<void> {
  inFlight ??= (async () => {
    try {
      const { cache: next, changed } = await refreshUpdateCache(parseUpdateCache(row), now, fetchLatestRelease);
      if (changed) {
        const value = JSON.stringify(next);
        await db.appState.upsert({ where: { key: CACHE_KEY }, create: { key: CACHE_KEY, value }, update: { value } });
        invalidateMemo(NOTICE_MEMO);
        invalidateMemo(LATEST_MEMO);
      }
    } catch {
      // En silencio: el aviso es opcional.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Versión nueva disponible para anunciar a los administradores, o null. Nunca lanza ni hace esperar a la página:
 * si toca consultar GitHub, la consulta va en segundo plano y esta respuesta usa lo que ya había en caché.
 * Con `wait` (tests) espera a la consulta.
 */
async function computeUpdateNotice(now: number = Date.now(), wait = false): Promise<UpdateInfo | null> {
  if (!updateCheckEnabled()) return null;
  try {
    const [row, dismissed] = await Promise.all([
      db.appState.findUnique({ where: { key: CACHE_KEY } }),
      db.appState.findUnique({ where: { key: DISMISS_KEY } }),
    ]);
    let cache = parseUpdateCache(row?.value);
    if (updateCheckDue(cache, now)) {
      const p = refreshInBackground(row?.value, now);
      if (wait) {
        await p;
        cache = parseUpdateCache((await db.appState.findUnique({ where: { key: CACHE_KEY } }))?.value);
      }
    }
    return pendingUpdate(cache, pkg.version, dismissed?.value ?? null);
  } catch {
    return null;
  }
}

/**
 * Igual, memorizado por petición (el layout y la página lo piden en la misma pasada) y en el proceso durante un minuto
 * (el layout lo pide en cada página de un admin; se invalida al descartarlo y al llegar datos nuevos de GitHub).
 */
export const getUpdateNotice = cache(() => memo(NOTICE_MEMO, () => computeUpdateNotice()));

/**
 * Última versión publicada que se conoce (la de la caché del aviso, sin mirar si un admin la ha descartado), o null si
 * no se sabe (nunca se pudo consultar, o UPDATE_CHECK=0). La usa «Informar de un error o enviar una sugerencia» para
 * pedir que se actualice antes. Como el aviso: nunca lanza ni espera a GitHub (si toca consultar, en segundo plano; como
 * mucho una consulta cada 12 h para toda la instalación, nunca una por navegador) y se memoriza un minuto en el proceso.
 */
export const getLatestKnownVersion = cache(() =>
  memo(LATEST_MEMO, async (): Promise<string | null> => {
    if (!updateCheckEnabled()) return null;
    try {
      const row = await db.appState.findUnique({ where: { key: CACHE_KEY } });
      const now = Date.now();
      const parsed = parseUpdateCache(row?.value);
      if (updateCheckDue(parsed, now)) void refreshInBackground(row?.value, now);
      return parsed?.latest ?? null;
    } catch {
      return null;
    }
  }),
);

/** Descarta el aviso de esa versión (y de las anteriores); una más nueva volverá a avisar. */
export async function dismissUpdateNotice(version: string): Promise<void> {
  await db.appState.upsert({ where: { key: DISMISS_KEY }, create: { key: DISMISS_KEY, value: version }, update: { value: version } });
  invalidateMemo(NOTICE_MEMO);
}
