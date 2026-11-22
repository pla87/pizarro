import "server-only";
import { describeBrowser, type InstallKind } from "./bug-report-core";
import {
  FEEDBACK_BODY_MAX_BYTES, FEEDBACK_FIELDS, FEEDBACK_KINDS, FEEDBACK_TEXT_MAX, feedbackMail, feedbackStatus, screenshotFileName,
  screenshotProblem, sniffScreenshot, type FeedbackError, type FeedbackKind, type FeedbackStatus,
} from "./feedback-core";
import { releaseFeedback, reserveFeedback } from "./feedback-rate";
import { logEvent } from "./log";
import { emailEnabled, sendMail } from "./mail";
import { maskEmailsIn } from "./mask-email";
import { FEEDBACK_EMAIL } from "./product";
import { rateLimit } from "./rate-limit";
import { clientIp, isSameOrigin } from "./request";
import { getCurrentUser } from "./session";
import { getLatestKnownVersion } from "./update-check";
import { isNewerVersion } from "./update-check-core";
import { BodyTooLargeError, declaredLength, readBodyLimited } from "./upload-slots";
import pkg from "../../package.json";

// «Informar de un error o enviar una sugerencia» en el servidor: estado del botón (layout) y envío por email (ruta
// /api/feedback). La lógica pura está en feedback-core.ts.

/** Build oficial sin modificar («docker»/«railway»), fijado al compilar (next.config.ts); null si no lo es. */
function officialInstall(): InstallKind | null {
  const v = process.env.NEXT_PUBLIC_OFFICIAL_BUILD;
  return v === "docker" || v === "railway" ? v : null;
}

/** ¿Se puede enviar por email? Hace falta la dirección del producto (FEEDBACK_EMAIL) y que la instalación envíe emails. */
function canMail(to: string): boolean {
  return to.trim() !== "" && emailEnabled();
}

/** Estado del botón para el layout (null: no se muestra). Nunca lanza ni espera a GitHub. */
export async function getFeedbackStatus(to: string = FEEDBACK_EMAIL): Promise<FeedbackStatus | null> {
  if (!officialInstall()) return null;
  const latest = await getLatestKnownVersion().catch(() => null);
  return feedbackStatus({ official: true, current: pkg.version, latest, address: to.trim() !== "", mail: emailEnabled() });
}

const json = (status: number, body: { ok: true } | { error: FeedbackError }) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST /api/feedback (multipart, ver FEEDBACK_FIELDS): envía el informe por email a `to` desde el servidor de correo de
 * la instalación. Con sesión, mismo origen, solo en builds oficiales y con la última versión publicada (si se sabe);
 * con límites (feedback-rate.ts), tope del cuerpo y de la captura, y el tipo de imagen comprobado por su contenido.
 * Los datos técnicos los pone el servidor (versión, commit, instalación y, del User-Agent, navegador y sistema); del
 * navegador solo llegan el tipo, el texto, el idioma, la casilla de responder y la captura.
 */
export async function handleFeedbackPost(req: Request, { to }: { to: string }): Promise<Response> {
  if (!isSameOrigin(req)) return new Response(null, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "No autorizado" }, { status: 401 });
  const install = officialInstall();
  if (!install || !canMail(to)) return json(404, { error: "unavailable" });
  const latest = await getLatestKnownVersion().catch(() => null);
  if (latest && isNewerVersion(latest, pkg.version)) return json(409, { error: "outdated" });
  const ip = clientIp(req.headers);
  // Intentos (también los que no salen): como mucho 20 cada hora por persona, antes de leer nada.
  if (!rateLimit(`feedback-try:${user.id}`, 20, 3600_000)) return json(429, { error: "rate_user" });
  const declared = declaredLength(req.headers);
  if (declared !== null && declared > FEEDBACK_BODY_MAX_BYTES) return json(413, { error: "too_big" });
  const limited = reserveFeedback(user.id);
  if (limited) return json(429, { error: limited });
  let sent = false;
  try {
    let form: FormData;
    try {
      form = await readBodyLimited(req, FEEDBACK_BODY_MAX_BYTES, "formData");
    } catch (err) {
      return err instanceof BodyTooLargeError ? json(413, { error: "too_big" }) : json(400, { error: "invalid" });
    }
    const kind = form.get(FEEDBACK_FIELDS.kind);
    if (typeof kind !== "string" || !(FEEDBACK_KINDS as readonly string[]).includes(kind)) return json(400, { error: "invalid" });
    const rawText = form.get(FEEDBACK_FIELDS.text);
    const text = typeof rawText === "string" ? rawText.trim() : "";
    if (!text) return json(400, { error: "empty" });
    if (text.length > FEEDBACK_TEXT_MAX) return json(400, { error: "invalid" });
    const language = form.get(FEEDBACK_FIELDS.language) === "en" ? "en" : "es";
    const replyTo = form.get(FEEDBACK_FIELDS.replyTo) === "1" ? user.email : null;
    const shot = form.get(FEEDBACK_FIELDS.screenshot);
    let attachment: { filename: string; content: Buffer; contentType: string } | null = null;
    if (shot instanceof File && shot.size > 0) {
      const content = Buffer.from(await shot.arrayBuffer());
      const problem = screenshotProblem(content.length, content.subarray(0, 16));
      if (problem) return json(problem === "too_big" ? 413 : 415, { error: problem });
      const type = sniffScreenshot(content.subarray(0, 16))!;
      attachment = { filename: screenshotFileName(type), content, contentType: type };
    } else if (shot !== null && !(shot instanceof File)) return json(400, { error: "invalid" });
    const mail = feedbackMail({
      kind: kind as FeedbackKind,
      text,
      fields: { version: pkg.version, commit: process.env.NEXT_PUBLIC_GIT_COMMIT ?? "", install, browser: describeBrowser(req.headers.get("user-agent") ?? ""), language },
      replyTo,
      screenshotBytes: attachment?.content.length ?? null,
    });
    try {
      await sendMail({ to, subject: mail.subject, text: mail.text, plainSender: true, ...(replyTo ? { replyTo } : {}), ...(attachment ? { attachments: [attachment] } : {}) });
    } catch (err) {
      logEvent({ level: "error", category: "api", action: "feedback.failed", message: `No se pudo enviar el informe: ${maskEmailsIn((err as Error).message)}`, userId: user.id, userName: user.name, path: "/api/feedback", ip });
      return json(502, { error: "failed" });
    }
    sent = true;
    // Sin el texto ni la captura: solo que se ha enviado (lo que dice queda en el email).
    logEvent({
      category: "api", action: "feedback.sent", message: kind === "bug" ? "Informe de error enviado al equipo de Pizarro" : "Sugerencia enviada al equipo de Pizarro",
      userId: user.id, userName: user.name, path: "/api/feedback", ip, details: { kind, screenshotBytes: attachment?.content.length ?? 0, replyTo: !!replyTo },
    });
    return json(200, { ok: true });
  } finally {
    if (!sent) releaseFeedback(user.id);
  }
}
