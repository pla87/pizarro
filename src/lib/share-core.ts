// «Compartir → Pizarro» (share_target del manifiesto): reglas puras, sin servidor ni zod, para la ruta que recibe lo
// compartido (api/share), la página que lo convierte en «Nueva tarea» (/share) y sus pruebas.

/** Ruta que recibe lo compartido (POST multipart del propio navegador): la que declara el manifiesto. */
export const SHARE_ACTION = "/api/share";
/** Nombres de los campos del formulario que manda el navegador (los del manifiesto). */
export const SHARE_FIELDS = { title: "title", text: "text", url: "url", files: "files" } as const;
/** Archivos por envío (lo demás se ignora y se avisa). */
export const SHARE_MAX_FILES = 10;
/** Lo compartido y no usado caduca a los 30 minutos (se borra al caducar y al usarlo o descartarlo). */
export const SHARE_TTL_MS = 30 * 60_000;
/** Envíos pendientes por persona como mucho: uno nuevo retira los más antiguos. */
export const SHARE_MAX_PENDING = 3;
/** Topes de los textos (un título de página, un texto o un enlace largos no llenan nada). */
export const SHARE_TEXT_MAX = 10_000;
const SHARE_TITLE_MAX = 500;
const SHARE_URL_MAX = 2048;
/** Sin sesión solo se conservan los textos (van en la dirección del acceso): se leen si el envío es pequeño. */
export const SHARE_NO_SESSION_MAX_BYTES = 256 * 1024;
/** Lo que cabe de texto en la dirección de vuelta tras iniciar sesión. */
const SHARE_QUERY_TEXT_MAX = 1500;

/** Motivos por los que no se guardó lo compartido (`/share?error=…`). */
export type ShareError = "too_big" | "busy" | "slow" | "rate" | "failed" | "empty";

export interface SharedText {
  title: string;
  text: string;
  url: string;
}

const clip = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/\u0000/g, "").trim().slice(0, max) : "");

/** Los textos de un envío, ya recortados. */
export function sharedText(raw: { title?: unknown; text?: unknown; url?: unknown }): SharedText {
  return { title: clip(raw.title, SHARE_TITLE_MAX), text: clip(raw.text, SHARE_TEXT_MAX), url: clip(raw.url, SHARE_URL_MAX) };
}

/**
 * ¿Puede venir de aquí? El navegador manda lo compartido como una navegación POST suya (no de una página): `Sec-Fetch-Site:
 * none` y sin `Origin` (o `null`). Desde otra web llegaría con `Sec-Fetch-Site: cross-site` u `Origin` ajeno: se
 * rechaza. Tampoco se admite una petición sin ninguna de las dos cabeceras (los navegadores con share_target las mandan).
 * Aun así, guardar lo compartido no tiene ningún efecto: la tarea solo se crea cuando la persona pulsa «Crear tarea».
 */
export function shareRequestAllowed(h: { origin: string | null; secFetchSite: string | null; host: string | null }, appUrl?: string): boolean {
  const site = h.secFetchSite?.toLowerCase() ?? null;
  if (site !== null && site !== "none" && site !== "same-origin") return false;
  const origin = h.origin && h.origin !== "null" ? h.origin : null;
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return false;
    }
    let appHost: string | null = null;
    try {
      appHost = appUrl ? new URL(appUrl).host : null;
    } catch {
      appHost = null;
    }
    return originHost === h.host || (appHost !== null && originHost === appHost);
  }
  return site !== null;
}

/** Título propuesto para la tarea: el compartido, la primera línea del texto o el sitio del enlace. */
export function shareTaskTitle(s: SharedText, max = 210): string {
  const firstLine = s.text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  let host = "";
  try {
    host = s.url ? new URL(s.url).hostname.replace(/^www\./, "") : "";
  } catch {
    host = "";
  }
  const title = s.title || (firstLine && firstLine !== s.url ? firstLine : "") || host;
  return Array.from(title.replace(/\s+/g, " ")).slice(0, max).join("").trim();
}

/** Descripción de la tarea: el texto y el enlace (si el texto no lo trae ya). Sin repetir la línea usada como título. */
export function shareTaskDescription(s: SharedText): string {
  const parts: string[] = [];
  if (s.text) parts.push(s.text);
  if (s.url && !s.text.includes(s.url)) parts.push(s.url);
  return parts.join("\n\n");
}

/** Dirección de /share con los textos (sin sesión: vuelven tras iniciarla) y cuántos archivos no se pudieron guardar. */
export function shareTextQuery(s: SharedText, lostFiles: number): string {
  const q = new URLSearchParams();
  if (s.title) q.set("title", s.title.slice(0, 300));
  if (s.text) q.set("text", s.text.slice(0, SHARE_QUERY_TEXT_MAX));
  if (s.url && s.url.length <= SHARE_QUERY_TEXT_MAX) q.set("url", s.url);
  if (lostFiles > 0) q.set("lost", String(Math.min(lostFiles, 99)));
  const qs = q.toString();
  return qs ? `/share?${qs}` : "/share";
}
