// Aviso de versión nueva: lógica pura (sin base de datos ni red directa), probada en tests/update-check.test.ts.

export const UPDATE_CHECK_URL = "https://api.github.com/repos/pla87/pizarro/releases/latest";
export const UPDATE_RELEASES_URL = "https://github.com/pla87/pizarro/releases";
/** «Cómo actualizar»: la sección de la guía de instalación de la web (docs/web/instalar.md, {#actualizar} y {#update}). */
export const UPDATE_DOCS_URL = "https://getpizarro.com/instalar/#actualizar";
export const UPDATE_DOCS_URL_EN = "https://getpizarro.com/en/install/#update";
export const updateDocsUrl = (locale: string): string => (locale === "en" ? UPDATE_DOCS_URL_EN : UPDATE_DOCS_URL);
/** Como mucho una consulta a GitHub cada 12 horas. */
export const UPDATE_CHECK_INTERVAL_MS = 12 * 3600_000;
/** Tras un fallo (sin red, límite de GitHub…) se reintenta antes, pero no en cada petición. */
export const UPDATE_CHECK_RETRY_MS = 30 * 60_000;
export const UPDATE_FETCH_TIMEOUT_MS = 4000;

export interface UpdateCache {
  /** Cuándo se intentó la última consulta (ms desde 1970). */
  checkedAt: number;
  /** Última versión conocida (sin «v»), o null si nunca se pudo consultar. */
  latest: string | null;
  /** Dirección de la página de la release. */
  url: string | null;
  /** La última consulta falló (se conserva `latest` anterior). */
  failed?: boolean;
}

export interface UpdateInfo {
  version: string;
  url: string;
}

/** «v1.2.3» o «1.2.3» -> [1, 2, 3]; null si no es una versión X.Y.Z (las preversiones no se aceptan). */
export function parseSemver(v: unknown): [number, number, number] | null {
  if (typeof v !== "string") return null;
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negativo si a < b, 0 si iguales, positivo si a > b; null si alguna no es válida. */
export function compareSemver(a: string, b: string): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  const c = compareSemver(latest, current);
  return c !== null && c > 0;
}

/** Extrae versión y enlace de la respuesta de `releases/latest`; null si no encaja (borradores y preversiones, fuera). */
export function parseLatestRelease(body: unknown): { version: string; url: string } | null {
  if (!body || typeof body !== "object") return null;
  const r = body as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return null;
  const p = parseSemver(r.tag_name);
  if (!p) return null;
  const version = p.join(".");
  const html = typeof r.html_url === "string" && /^https:\/\/github\.com\/pla87\/pizarro\//.test(r.html_url) ? r.html_url : null;
  return { version, url: html ?? `${UPDATE_RELEASES_URL}/tag/v${version}` };
}

/** ¿Toca consultar? Nunca consultado, o pasado el plazo (más corto tras un fallo). */
export function updateCheckDue(cache: UpdateCache | null, now: number): boolean {
  if (!cache) return true;
  if (!Number.isFinite(cache.checkedAt) || cache.checkedAt > now) return true;
  return now - cache.checkedAt >= (cache.failed ? UPDATE_CHECK_RETRY_MS : UPDATE_CHECK_INTERVAL_MS);
}

/** Lee la caché guardada (JSON en AppState); null si no es válida. */
export function parseUpdateCache(raw: string | null | undefined): UpdateCache | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<UpdateCache>;
    if (typeof o.checkedAt !== "number") return null;
    const latest = typeof o.latest === "string" && parseSemver(o.latest) ? o.latest : null;
    // La URL acaba en un enlace del aviso: solo se acepta una de las versiones del repositorio oficial.
    const url = typeof o.url === "string" && /^https:\/\/github\.com\/pla87\/pizarro\//.test(o.url) ? o.url : null;
    return { checkedAt: o.checkedAt, latest, url, failed: o.failed === true };
  } catch {
    return null;
  }
}

/**
 * Resuelve la caché: si toca, consulta con `fetchLatest` (que puede lanzar o devolver null); un fallo conserva
 * la última versión conocida y solo retrasa el siguiente intento. Devuelve la caché nueva y si hay que guardarla.
 */
export async function refreshUpdateCache(
  cache: UpdateCache | null,
  now: number,
  fetchLatest: () => Promise<{ version: string; url: string } | null>,
): Promise<{ cache: UpdateCache; changed: boolean }> {
  if (!updateCheckDue(cache, now)) return { cache: cache!, changed: false };
  try {
    const found = await fetchLatest();
    if (found) return { cache: { checkedAt: now, latest: found.version, url: found.url }, changed: true };
  } catch {
    // Sin red, límite de peticiones de GitHub, etc.: en silencio.
  }
  return { cache: { checkedAt: now, latest: cache?.latest ?? null, url: cache?.url ?? null, failed: true }, changed: true };
}

/** Versión a anunciar: la conocida si es más nueva que la que corre y el admin no la ha descartado. */
export function pendingUpdate(cache: UpdateCache | null, current: string, dismissed: string | null): UpdateInfo | null {
  if (!cache?.latest || !isNewerVersion(cache.latest, current)) return null;
  if (dismissed && !isNewerVersion(cache.latest, dismissed)) return null;
  return { version: cache.latest, url: cache.url ?? `${UPDATE_RELEASES_URL}/tag/v${cache.latest}` };
}
