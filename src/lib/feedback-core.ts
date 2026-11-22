// «Informar de un error o enviar una sugerencia» (botón junto a «Cerrar sesión»): lógica pura, sin red ni base de datos,
// probada en tests/feedback.test.ts. La usan el diálogo (navegador) y la ruta /api/feedback (servidor): sin zod.
//
// Privacidad: el informe solo lleva lo que la persona escribe, la captura que elige enviar, su email si marca la casilla y
// los datos técnicos de siempre (versión, commit, instalación, navegador y sistema, idioma; ver bug-report-core.ts).
import { bugReportFields, type BugReportFields } from "./bug-report-core";
import { isNewerVersion } from "./update-check-core";

export const FEEDBACK_KINDS = ["bug", "idea"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Lo que se escribe en el diálogo, como mucho (caracteres). */
export const FEEDBACK_TEXT_MAX = 5000;
/** Captura: ancho máximo (px), calidad JPEG y tope del fichero. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 0.8;
export const SCREENSHOT_MAX_BYTES = 1.5 * 1024 * 1024;
type ScreenshotType = "image/jpeg" | "image/webp";
/** Cuerpo entero del envío: la captura más el texto (hasta 4 bytes por carácter) y el multipart. */
export const FEEDBACK_BODY_MAX_BYTES = SCREENSHOT_MAX_BYTES + 64 * 1024;

/** Campos del multipart que manda el diálogo a /api/feedback. */
export const FEEDBACK_FIELDS = { kind: "kind", text: "text", replyTo: "replyTo", language: "language", screenshot: "screenshot" } as const;

/** Envíos por email: por persona y por instalación, en 24 horas (solo cuentan los que salen). */
export const FEEDBACK_LIMITS = { user: 5, install: 20, windowMs: 24 * 3600_000 } as const;

/**
 * Estado del botón para esta instalación (lo calcula el layout en el servidor; null = no se muestra):
 * - solo en builds oficiales sin modificar (`officialBuild`, bug-report-core.ts);
 * - `outdated`: hay una versión publicada más nueva que la que corre (la última conocida por el aviso de versión nueva,
 *   con su caché de 12 h): el botón sale desactivado. Sin saber la última (sin red, UPDATE_CHECK=0) se deja enviar;
 * - `githubReason`: null si se envía por email (la instalación envía emails y el producto tiene dirección,
 *   FEEDBACK_EMAIL); si no, va por el formulario público de GitHub (con el texto y los datos técnicos, y la captura para
 *   adjuntarla a mano), y dice por qué, para que el diálogo diga la verdad: «no_address» (el producto aún no tiene
 *   dirección: le pasa a todas las instalaciones, no es culpa de su correo) o «no_mail» (la instalación no envía emails).
 */
export interface FeedbackStatus {
  outdated: boolean;
  latest: string | null;
  githubReason: "no_address" | "no_mail" | null;
}

/** `address`: el producto tiene dirección (FEEDBACK_EMAIL); `mail`: la instalación envía emails. */
export function feedbackStatus(o: { official: boolean; current: string; latest: string | null; address: boolean; mail: boolean }): FeedbackStatus | null {
  if (!o.official) return null;
  const outdated = !!o.latest && isNewerVersion(o.latest, o.current);
  const githubReason = !o.address ? "no_address" : !o.mail ? "no_mail" : null;
  return { outdated, latest: outdated ? o.latest : null, githubReason };
}

/** Escala de la captura: la de la pantalla (nítida) sin pasar de SCREENSHOT_MAX_WIDTH píxeles de ancho. */
export function captureScale(viewportWidth: number, devicePixelRatio: number, maxWidth: number = SCREENSHOT_MAX_WIDTH): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 1;
  return Math.max(0.1, Math.min(dpr, maxWidth / viewportWidth));
}

/**
 * Intentos para que la captura quepa en SCREENSHOT_MAX_BYTES: se dibuja una vez y se vuelve a codificar con menos
 * calidad y, si aún no cabe, más pequeña (`scale` sobre la ya reducida). Una pantalla normal cabe en el primero.
 */
export const CAPTURE_ATTEMPTS: readonly { scale: number; quality: number }[] = [
  { scale: 1, quality: SCREENSHOT_QUALITY },
  { scale: 1, quality: 0.65 },
  { scale: 0.75, quality: 0.65 },
  { scale: 0.5, quality: 0.6 },
];

/** Tipo de imagen por su contenido (no por lo que diga el navegador): JPEG o WebP, o null. */
export function sniffScreenshot(head: Uint8Array): ScreenshotType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (head.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * Dimensiones máximas de la captura que acepta el servidor (las lee de la cabecera, sin decodificarla): la del diálogo
 * mide como mucho 1600 px de ancho, pero un JPEG de 1,5 MB puede declarar 30.000 × 30.000 px de un color (una bomba de
 * descompresión para quien abra el informe).
 */
export const SCREENSHOT_MAX_SIDE = 4000;
export const SCREENSHOT_MAX_PIXELS = 16_000_000;

/** ¿Caben estas dimensiones (las de la cabecera de la imagen)? Sin dimensiones válidas, no. */
export function screenshotSizeOk(width: number | undefined, height: number | undefined): boolean {
  if (!width || !height || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return false;
  return width <= SCREENSHOT_MAX_SIDE && height <= SCREENSHOT_MAX_SIDE && width * height <= SCREENSHOT_MAX_PIXELS;
}

/** ¿Se puede enviar esta captura? Tamaño (sin pasar del tope, y no vacía) y tipo por su contenido. */
export function screenshotProblem(size: number, head: Uint8Array): "too_big" | "bad_image" | null {
  if (size > SCREENSHOT_MAX_BYTES) return "too_big";
  if (size <= 0 || !sniffScreenshot(head)) return "bad_image";
  return null;
}

export type FeedbackError = "rate_user" | "rate_install" | "too_big" | "bad_image" | "outdated" | "unavailable" | "empty" | "invalid" | "failed";

/** Nombre del fichero de la captura (adjunto del email y «Descargar la captura»). */
export function screenshotFileName(type: string): string {
  return `captura-pizarro.${type === "image/webp" ? "webp" : "jpg"}`;
}

const TECH_LABELS: Record<string, string> = {
  version: "Versión",
  commit: "Commit",
  install: "Instalación",
  browser: "Navegador y sistema",
  language: "Idioma",
};

/**
 * Email que llega al equipo de Pizarro (en español, el idioma de quien lo lee): asunto con el tipo y el comienzo del
 * texto, los datos técnicos, si pide respuesta (solo entonces su email) y el texto tal cual. Nada más de la instalación.
 */
export function feedbackMail(o: { kind: FeedbackKind; text: string; fields: BugReportFields; replyTo: string | null; screenshotBytes: number | null }): { subject: string; text: string } {
  const label = o.kind === "bug" ? "Error" : "Sugerencia";
  const first = o.text.replace(/\s+/g, " ").trim();
  const subject = `[Pizarro] ${label}: ${first.length > 70 ? `${first.slice(0, 69)}…` : first}`;
  const lines = [
    `Tipo: ${label}`,
    ...bugReportFields(o.fields).map(([k, v]) => `${TECH_LABELS[k] ?? k}: ${v}`),
    o.replyTo ? `Responder a: ${o.replyTo}` : "Responder a: no ha pedido respuesta (su email no se incluye).",
    o.screenshotBytes ? `Captura: adjunta (${Math.max(1, Math.round(o.screenshotBytes / 1024))} KB)` : "Captura: no",
    "",
    "---",
    "",
    o.text.replace(/\r\n?/g, "\n").trim(),
    "",
  ];
  return { subject, text: lines.join("\n") };
}
