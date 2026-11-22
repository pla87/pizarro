// «Informar de un error o enviar una sugerencia»: cuándo sale el botón y cuándo está desactivado, tamaño y tipo de la
// captura, el email que llega y los límites. La ruta, con base de datos, en tests/db/feedback.test.ts.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  CAPTURE_ATTEMPTS, captureScale, FEEDBACK_BODY_MAX_BYTES, FEEDBACK_LIMITS, feedbackMail, feedbackMailtoFits, feedbackMailtoUrl, feedbackStatus, MAILTO_URL_MAX, SCREENSHOT_MAX_BYTES,
  SCREENSHOT_MAX_PIXELS, SCREENSHOT_MAX_SIDE, SCREENSHOT_MAX_WIDTH, SCREENSHOT_QUALITY, screenshotFileName, screenshotProblem,
  screenshotSizeOk, sniffScreenshot,
} from "../src/lib/feedback-core";
import { releaseFeedback, reserveFeedback } from "../src/lib/feedback-rate";
import { PROXY_BODY_LIMIT_BYTES } from "../src/lib/upload-size";
import { FEEDBACK_EMAIL } from "../src/lib/product";
import { resetRateLimit } from "../src/lib/rate-limit";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const WEBP = new Uint8Array([...Buffer.from("RIFF"), 0x24, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

test("botón: solo en builds oficiales; desactivado si hay una versión publicada más nueva; sin saberla, se deja enviar", () => {
  assert.equal(feedbackStatus({ official: false, current: "1.64.0", latest: null, address: true, mail: true }), null);
  assert.deepEqual(feedbackStatus({ official: true, current: "1.64.0", latest: "1.64.0", address: true, mail: true }), { outdated: false, latest: null, githubReason: null });
  assert.deepEqual(feedbackStatus({ official: true, current: "1.64.0", latest: "1.65.0", address: true, mail: true }), { outdated: true, latest: "1.65.0", githubReason: null });
  // Recién actualizada (la caché aún dice la anterior), sin red o con UPDATE_CHECK=0: se puede enviar.
  assert.equal(feedbackStatus({ official: true, current: "1.65.0", latest: "1.64.0", address: true, mail: true })!.outdated, false);
  assert.equal(feedbackStatus({ official: true, current: "1.64.0", latest: null, address: true, mail: true })!.outdated, false);
  assert.equal(feedbackStatus({ official: true, current: "1.64.0", latest: "basura", address: true, mail: true })!.outdated, false);
  // Sin envío de emails: «Enviar por email» desde el programa de correo (y GitHub de alternativa). Sin dirección del
  // producto (no pasa con FEEDBACK_EMAIL puesta, pero sigue cubierto): solo GitHub, sin culpar al correo de la instalación.
  assert.deepEqual(feedbackStatus({ official: true, current: "1.64.0", latest: null, address: true, mail: false }), { outdated: false, latest: null, githubReason: "no_mail" });
  assert.deepEqual(feedbackStatus({ official: true, current: "1.64.0", latest: null, address: false, mail: true }), { outdated: false, latest: null, githubReason: "no_address" });
  assert.equal(feedbackStatus({ official: true, current: "1.64.0", latest: null, address: false, mail: false })!.githubReason, "no_address");
});

test("dirección del producto: una dirección de email del dominio del producto, nada más", () => {
  assert.match(FEEDBACK_EMAIL, /^[a-z0-9._-]+@getpizarro\.com$/);
});

test("«Enviar por email» (la instalación no envía emails): mailto con el asunto, los datos técnicos y el texto", () => {
  const fields = { version: "1.65.0", commit: "0123456789abcdef", install: "railway" as const, browser: "Firefox 140 · Windows", language: "es" };
  const href = feedbackMailtoUrl("feedback@example.com", "bug", "  Al mover una tarjeta\r\nse queda gris & sin «título» +1  ", fields);
  assert.ok(href.startsWith("mailto:feedback@example.com?subject="), href);
  // Espacios como %20 (un «+» sería un «+») y saltos de línea como CRLF (RFC 6068).
  assert.ok(!/\+/.test(href.split("?")[1]!.replace(/%2B/g, "")), href);
  const params = new URLSearchParams(href.slice(href.indexOf("?") + 1).replace(/\+/g, "%2B"));
  assert.equal(params.get("subject"), "[Pizarro] Error: Al mover una tarjeta se queda gris & sin «título» +1");
  const body = params.get("body")!;
  assert.ok(!/[^\r]\n/.test(body), "saltos de línea CRLF");
  const lines = body.split("\r\n");
  assert.deepEqual(lines.slice(0, 6), ["Tipo: Error", "Versión: 1.65.0", "Commit: 0123456789abcdef", "Instalación: Railway", "Navegador y sistema: Firefox 140 · Windows", "Idioma: es"]);
  // Sin «Responder a» (el remitente ya es su email) ni «Captura» (la adjunta ella).
  assert.ok(!body.includes("Responder a") && !body.includes("Captura"), body);
  assert.ok(body.endsWith("Al mover una tarjeta\r\nse queda gris & sin «título» +1\r\n"), body);
  assert.equal(feedbackMailtoFits("feedback@example.com", "bug", "corto", fields), true);
  const idea = new URLSearchParams(feedbackMailtoUrl("feedback@example.com", "idea", "Vista por semanas", fields).split("?")[1]);
  assert.equal(idea.get("subject"), "[Pizarro] Sugerencia: Vista por semanas");
  // Un texto largo (con tildes, que ocupan más codificadas): recortado con «…» sin pasar del tope.
  for (const long of ["Una sugerencia larga con tildes y eñes. ".repeat(120), "😀".repeat(2000), "a".repeat(5000)]) {
    const url = feedbackMailtoUrl("feedback@example.com", "idea", long, fields);
    assert.ok(url.length <= MAILTO_URL_MAX, `${url.length}`);
    assert.ok(url.length > MAILTO_URL_MAX - 60, `aprovecha el sitio: ${url.length}`);
    const text = new URLSearchParams(url.split("?")[1]).get("body")!.split("---\r\n\r\n")[1]!;
    assert.ok(text.trimEnd().endsWith("…"), text.slice(-20));
    assert.ok(long.startsWith(text.trimEnd().slice(0, -1)));
    assert.ok(!/[\uD800-\uDBFF]…/.test(text), "sin partir un emoji");
    assert.equal(feedbackMailtoFits("feedback@example.com", "idea", long, fields), false);
  }
});

test("captura: nítida, pero sin pasar de 1600 px de ancho", () => {
  assert.equal(SCREENSHOT_MAX_WIDTH, 1600);
  assert.equal(captureScale(1280, 1), 1);
  assert.equal(captureScale(800, 2), 2); // 1600 px
  assert.equal(captureScale(1440, 2), 1600 / 1440);
  assert.equal(captureScale(1920, 1), 1600 / 1920);
  assert.equal(captureScale(393, 3), 3); // móvil: 1179 px
  assert.equal(captureScale(1280, Number.NaN), 1);
  assert.equal(captureScale(0, 2), 1);
  for (const [w, dpr] of [[1280, 1], [1440, 2], [3840, 1.5], [393, 3], [50_000, 1]] as const) assert.ok(Math.round(w * captureScale(w, dpr)) <= 1600 || captureScale(w, dpr) === 0.1);
});

test("captura: JPEG al 80 % y, si no cabe en 1,5 MB, menos calidad y luego más pequeña", () => {
  assert.equal(SCREENSHOT_QUALITY, 0.8);
  assert.equal(SCREENSHOT_MAX_BYTES, 1.5 * 1024 * 1024);
  assert.deepEqual(CAPTURE_ATTEMPTS[0], { scale: 1, quality: 0.8 });
  // Cada intento es igual o más pequeño y de igual o menos calidad que el anterior.
  for (let i = 1; i < CAPTURE_ATTEMPTS.length; i++) {
    assert.ok(CAPTURE_ATTEMPTS[i]!.scale <= 1 && CAPTURE_ATTEMPTS[i]!.quality <= CAPTURE_ATTEMPTS[i - 1]!.quality);
  }
  assert.ok(CAPTURE_ATTEMPTS.reduce((s, a) => s * a.scale, 1) < 0.5, "el último intento reduce bastante");
  // El envío entero cabe en el tope del proxy (pasa por él) con la captura más grande y el texto.
  assert.ok(FEEDBACK_BODY_MAX_BYTES < PROXY_BODY_LIMIT_BYTES);
});

test("captura: el tipo se comprueba por el contenido (JPEG o WebP) y el tamaño, con su tope", () => {
  assert.equal(sniffScreenshot(JPEG), "image/jpeg");
  assert.equal(sniffScreenshot(WEBP), "image/webp");
  assert.equal(sniffScreenshot(PNG), null);
  assert.equal(sniffScreenshot(new TextEncoder().encode("<svg xmlns=")), null);
  assert.equal(sniffScreenshot(new Uint8Array([0xff, 0xd8])), null);
  assert.equal(screenshotProblem(100_000, JPEG), null);
  assert.equal(screenshotProblem(SCREENSHOT_MAX_BYTES, WEBP), null);
  assert.equal(screenshotProblem(SCREENSHOT_MAX_BYTES + 1, JPEG), "too_big");
  assert.equal(screenshotProblem(100_000, PNG), "bad_image");
  assert.equal(screenshotProblem(0, JPEG), "bad_image");
  // Dimensiones (las de la cabecera): las del diálogo caben de sobra; una bomba de descompresión, no.
  assert.ok(screenshotSizeOk(1600, 900) && screenshotSizeOk(1179, 2556));
  assert.ok(screenshotSizeOk(SCREENSHOT_MAX_SIDE, SCREENSHOT_MAX_PIXELS / SCREENSHOT_MAX_SIDE));
  assert.ok(!screenshotSizeOk(SCREENSHOT_MAX_SIDE + 1, 10) && !screenshotSizeOk(10, SCREENSHOT_MAX_SIDE + 1));
  assert.ok(!screenshotSizeOk(30000, 30000) && !screenshotSizeOk(0, 10) && !screenshotSizeOk(undefined, 10) && !screenshotSizeOk(1.5, 10));
  assert.equal(screenshotFileName("image/jpeg"), "captura-pizarro.jpg");
  assert.equal(screenshotFileName("image/webp"), "captura-pizarro.webp");
});

test("email: tipo y comienzo del texto en el asunto, datos técnicos, respuesta solo si se pide y el texto tal cual", () => {
  const fields = { version: "1.64.0", commit: "0123456789abcdef", install: "docker" as const, browser: "Chrome 140 · Linux", language: "en" };
  const m = feedbackMail({ kind: "bug", text: "  Al arrastrar\r\nuna tarjeta se queda gris.\n\nPasos: …  ", fields, replyTo: null, screenshotBytes: 204_800 });
  assert.equal(m.subject, "[Pizarro] Error: Al arrastrar una tarjeta se queda gris. Pasos: …");
  assert.match(m.text, /^Tipo: Error$/m);
  assert.match(m.text, /^Versión: 1\.64\.0$/m);
  assert.match(m.text, /^Commit: 0123456789abcdef$/m);
  assert.match(m.text, /^Instalación: Docker Compose$/m);
  assert.match(m.text, /^Navegador y sistema: Chrome 140 · Linux$/m);
  assert.match(m.text, /^Idioma: en$/m);
  assert.match(m.text, /^Responder a: no ha pedido respuesta/m);
  assert.match(m.text, /^Captura: adjunta \(200 KB\)$/m);
  assert.ok(m.text.endsWith("Al arrastrar\nuna tarjeta se queda gris.\n\nPasos: …\n"));
  assert.ok(!m.text.includes("@"), "sin email si no lo pide");
  const idea = feedbackMail({ kind: "idea", text: "x".repeat(200), fields, replyTo: "persona@example.com", screenshotBytes: null });
  assert.equal(idea.subject, `[Pizarro] Sugerencia: ${"x".repeat(69)}…`);
  assert.match(idea.text, /^Responder a: persona@example\.com$/m);
  assert.match(idea.text, /^Captura: no$/m);
  assert.ok(!idea.subject.includes("\n"));
  // El asunto se recorta por caracteres: sin medio emoji suelto.
  assert.equal(feedbackMail({ kind: "idea", text: "😀".repeat(100), fields, replyTo: null, screenshotBytes: null }).subject, `[Pizarro] Sugerencia: ${"😀".repeat(69)}…`);
});

test("límites: 5 al día por persona y 20 por instalación; un rechazo no gasta y se devuelve lo que no sale", () => {
  assert.deepEqual({ ...FEEDBACK_LIMITS }, { user: 5, install: 20, windowMs: 24 * 3600_000 });
  resetRateLimit("feedback:install");
  const users = Array.from({ length: 6 }, (_, i) => `u-limits-${i}`);
  for (const u of users) resetRateLimit(`feedback:user:${u}`);
  for (let i = 0; i < 5; i++) assert.equal(reserveFeedback(users[0]!), null);
  assert.equal(reserveFeedback(users[0]!), "rate_user");
  // Un envío que no salió se devuelve: vuelve a quedar uno.
  releaseFeedback(users[0]!);
  assert.equal(reserveFeedback(users[0]!), null);
  // 5 + 5 + 5 + 5 = 20 en la instalación: la siguiente persona ya no puede, aunque no haya enviado ninguno.
  for (const u of users.slice(1, 4)) for (let i = 0; i < 5; i++) assert.equal(reserveFeedback(u), null);
  assert.equal(reserveFeedback(users[4]!), "rate_install");
  assert.equal(reserveFeedback(users[4]!), "rate_install");
  releaseFeedback(users[1]!);
  assert.equal(reserveFeedback(users[4]!), null);
  resetRateLimit("feedback:install");
  for (const u of users) resetRateLimit(`feedback:user:${u}`);
});

test("la librería de captura solo se carga al pedir la captura (import dinámico desde el diálogo, que también va aparte)", () => {
  const src = path.join(import.meta.dirname, "../src");
  const files = (function walk(d: string): string[] {
    return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
  })(src);
  const statics = files.filter((f) => /from\s+["']modern-screenshot["']/.test(readFileSync(f, "utf8")));
  assert.deepEqual(statics, []);
  const dynamics = files.filter((f) => /import\(\s*["']modern-screenshot["']\s*\)/.test(readFileSync(f, "utf8"))).map((f) => path.relative(src, f));
  assert.deepEqual(dynamics, [path.join("components", "feedback", "capture.ts")]);
  // capture.ts solo lo importa el diálogo, y el diálogo solo se carga con lazyDialog.
  const importers = files.filter((f) => /from\s+["']\.\/capture["']/.test(readFileSync(f, "utf8"))).map((f) => path.basename(f));
  assert.deepEqual(importers, ["FeedbackDialog.tsx"]);
  const dialogStatic = files.filter((f) => /from\s+["'][^"']*FeedbackDialog["']/.test(readFileSync(f, "utf8")));
  assert.deepEqual(dialogStatic, []);
  // Versión fijada exacta.
  const pkg = JSON.parse(readFileSync(path.join(import.meta.dirname, "../package.json"), "utf8")) as { dependencies: Record<string, string> };
  assert.match(pkg.dependencies["modern-screenshot"]!, /^\d+\.\d+\.\d+$/);
});

test("captura: los secretos a la vista llevan data-pz-no-capture (la captura los deja fuera)", () => {
  const src = path.join(import.meta.dirname, "../src");
  const marked = (file: string, needle: string) => {
    const text = readFileSync(path.join(src, file), "utf8");
    const at = text.indexOf(needle);
    assert.ok(at >= 0, `${file}: ${needle}`);
    // En la misma etiqueta: entre el `<` que la abre y el `>` que la cierra.
    const open = text.lastIndexOf("<", at);
    const close = text.indexOf(">", at);
    assert.ok(text.slice(open, close).includes("data-pz-no-capture"), `${file}: ${needle} sin data-pz-no-capture`);
  };
  marked("components/auth/TwoFactorEnroll.tsx", 'data-testid="recovery-codes"');
  marked("components/auth/TwoFactorEnroll.tsx", 'data-testid="totp-secret"');
  marked("components/auth/TwoFactorEnroll.tsx", 'data-testid="totp-qr"');
  marked("app/(app)/admin/users/UsersAdmin.tsx", 'data-testid="invite-link"');
  marked("app/(app)/admin/users/UsersAdmin.tsx", 'data-testid="reset-link"');
  marked("app/(app)/p/[projectId]/settings/ProjectSettings.tsx", 'data-testid="member-link"');
  marked("app/setup/SetupWizard.tsx", 'id="setup-code"');
  marked("components/calendar/CalendarSubscribe.tsx", "value={links.https}");
  assert.match(readFileSync(path.join(src, "components/feedback/capture.ts"), "utf8"), /hasAttribute\("data-pz-no-capture"\)/);
});
