// «Informar de un error o enviar una sugerencia» por email: la ruta /api/feedback (origen, sesión, build oficial, última
// versión, límites, tipo y tamaño de la captura) y lo que llega en el email (buzón de pruebas). Contra PostgreSQL real.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { db, loginAs, logout, makeUser } from "./helpers";
import { POST as feedbackRoute } from "../../src/app/api/feedback/route";
import { getFeedbackStatus, handleFeedbackPost } from "../../src/lib/feedback";
import { FEEDBACK_FIELDS, FEEDBACK_LIMITS, SCREENSHOT_MAX_BYTES } from "../../src/lib/feedback-core";
import { invalidateMemo } from "../../src/lib/memo";
import { resetRateLimit } from "../../src/lib/rate-limit";
import pkg from "../../package.json";

const TO = "feedback@example.com";
const ORIGIN = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const ENV_KEYS = ["NEXT_PUBLIC_OFFICIAL_BUILD", "NEXT_PUBLIC_GIT_COMMIT", "MAIL_OUTBOX_DIR", "SMTP_HOST", "SMTP_FROM", "UPDATE_CHECK"] as const;
const saved: Record<string, string | undefined> = {};
let outbox = "";

function request(fields: { kind?: string; text?: string; replyTo?: boolean; language?: string; screenshot?: Blob | string }, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (fields.kind !== undefined) form.set(FEEDBACK_FIELDS.kind, fields.kind);
  if (fields.text !== undefined) form.set(FEEDBACK_FIELDS.text, fields.text);
  if (fields.language) form.set(FEEDBACK_FIELDS.language, fields.language);
  if (fields.replyTo) form.set(FEEDBACK_FIELDS.replyTo, "1");
  if (fields.screenshot !== undefined) {
    if (typeof fields.screenshot === "string") form.set(FEEDBACK_FIELDS.screenshot, fields.screenshot);
    else form.set(FEEDBACK_FIELDS.screenshot, fields.screenshot, "captura.jpg");
  }
  return new Request(`${ORIGIN}/api/feedback`, { method: "POST", body: form, headers: { origin: ORIGIN, "x-real-ip": "10.20.30.40", "user-agent": UA, ...headers } });
}
const post = (fields: Parameters<typeof request>[0], opts: { to?: string; headers?: Record<string, string> } = {}) =>
  handleFeedbackPost(request(fields, opts.headers), { to: opts.to ?? TO });
const errorOf = async (res: Response) => ((await res.json()) as { error?: string }).error;

/** Emails del buzón de pruebas (JSON y adjuntos), del más antiguo al más reciente. */
async function mails(): Promise<{ to: string; from: string | null; subject: string; text: string; replyTo?: string; attachments?: { filename: string; bytes: number; file: string }[] }[]> {
  const files = (await readdir(outbox)).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(outbox, f), "utf8"))));
}

/** Última versión publicada que conoce la instalación (la caché del aviso de versión nueva, recién consultada). */
async function setLatest(version: string | null) {
  const value = JSON.stringify({ checkedAt: Date.now(), latest: version, url: null });
  await db.appState.upsert({ where: { key: "updateCheck" }, create: { key: "updateCheck", value }, update: { value } });
  invalidateMemo("update:latest");
}

function resetLimits(...userIds: string[]) {
  resetRateLimit("feedback:install");
  for (const id of userIds) {
    resetRateLimit(`feedback:user:${id}`);
    resetRateLimit(`feedback-try:${id}`);
  }
}

before(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  outbox = await mkdtemp(path.join(tmpdir(), "pz-feedback-"));
  Object.assign(process.env, {
    NEXT_PUBLIC_OFFICIAL_BUILD: "docker",
    NEXT_PUBLIC_GIT_COMMIT: "0123456789abcdef0123456789abcdef01234567",
    MAIL_OUTBOX_DIR: outbox,
    // El remitente configurado lleva el nombre de la organización: el informe no debe llevarlo.
    SMTP_HOST: "smtp.example.com",
    SMTP_FROM: "Acme Organización <avisos@example.com>",
  });
  delete process.env.UPDATE_CHECK;
  await setLatest(pkg.version);
});

after(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await db.appState.deleteMany({ where: { key: "updateCheck" } });
  invalidateMemo("update:latest");
  await rm(outbox, { recursive: true, force: true });
});

beforeEach(async () => {
  logout();
  for (const f of await readdir(outbox)) await rm(path.join(outbox, f), { force: true });
});

describe("/api/feedback", () => {
  test("envía el email con el texto, los datos técnicos y la captura; remitente sin el nombre de la organización", async () => {
    const u = await makeUser({ name: "Ana Informa" });
    resetLimits(u.id);
    await loginAs(u);
    const res = await post({ kind: "bug", text: "  Al mover una tarjeta se queda gris.\nPasos: …  ", language: "en", screenshot: new Blob([JPEG], { type: "image/jpeg" }) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    const [m, ...rest] = await mails();
    assert.equal(rest.length, 0);
    assert.equal(m!.to, TO);
    assert.equal(m!.from, '"Pizarro" <avisos@example.com>');
    assert.equal(m!.subject, "[Pizarro] Error: Al mover una tarjeta se queda gris. Pasos: …");
    assert.match(m!.text, new RegExp(`^Versión: ${pkg.version.replace(/\./g, "\\.")}$`, "m"));
    assert.match(m!.text, /^Commit: 0123456789abcdef0123456789abcdef01234567$/m);
    assert.match(m!.text, /^Instalación: Docker Compose$/m);
    assert.match(m!.text, /^Navegador y sistema: Chrome 140 · Linux$/m);
    assert.match(m!.text, /^Idioma: en$/m);
    assert.match(m!.text, /Al mover una tarjeta se queda gris\.\nPasos: …\n$/);
    // Sin respuesta pedida: ni su email ni su nombre, ni Reply-To.
    assert.equal(m!.replyTo, undefined);
    assert.ok(!m!.text.includes(u.email) && !m!.text.includes("Ana Informa"));
    assert.equal(m!.attachments?.length, 1);
    assert.equal(m!.attachments![0]!.filename, "captura-pizarro.jpg");
    assert.deepEqual(new Uint8Array(await readFile(path.join(outbox, m!.attachments![0]!.file))), JPEG);
    // Queda en el registro que se envió, sin el texto.
    const { flushLogs } = await import("../../src/lib/log");
    await flushLogs();
    const log = await db.appLog.findFirstOrThrow({ where: { action: "feedback.sent", userId: u.id } });
    assert.ok(!log.message.includes("tarjeta"));
  });

  test("con «Incluir mi email», responde a su dirección; sugerencia sin captura", async () => {
    const u = await makeUser();
    resetLimits(u.id);
    await loginAs(u);
    const res = await post({ kind: "idea", text: "Vista de semana en el calendario", replyTo: true });
    assert.equal(res.status, 200);
    const [m] = await mails();
    assert.equal(m!.replyTo, u.email);
    assert.match(m!.subject, /^\[Pizarro\] Sugerencia: Vista de semana/);
    assert.match(m!.text, new RegExp(`^Responder a: ${u.email.replace(/[.+]/g, "\\$&")}$`, "m"));
    assert.match(m!.text, /^Captura: no$/m);
    assert.equal(m!.attachments, undefined);
  });

  test("origen, sesión, build oficial y envío de emails", async () => {
    const u = await makeUser();
    resetLimits(u.id);
    assert.equal((await post({ kind: "bug", text: "x" })).status, 401);
    await loginAs(u);
    assert.equal((await post({ kind: "bug", text: "x" }, { headers: { origin: "https://evil.example.com" } })).status, 403);
    // Sin la dirección del producto (FEEDBACK_EMAIL vacía, como ahora) la ruta de verdad no envía nada.
    const real = await feedbackRoute(request({ kind: "bug", text: "x" }));
    assert.equal(real.status, 404);
    assert.equal(await errorOf(real), "unavailable");
    // Build no oficial.
    process.env.NEXT_PUBLIC_OFFICIAL_BUILD = "";
    try {
      assert.equal(await errorOf(await post({ kind: "bug", text: "x" })), "unavailable");
      assert.equal(await getFeedbackStatus(TO), null);
    } finally {
      process.env.NEXT_PUBLIC_OFFICIAL_BUILD = "docker";
    }
    // Sin envío de emails en la instalación.
    process.env.MAIL_OUTBOX_DIR = "";
    process.env.SMTP_HOST = "";
    try {
      assert.equal(await errorOf(await post({ kind: "bug", text: "x" })), "unavailable");
      assert.equal((await getFeedbackStatus(TO))!.delivery, "github");
    } finally {
      process.env.MAIL_OUTBOX_DIR = outbox;
      process.env.SMTP_HOST = "smtp.example.com";
    }
    assert.equal((await getFeedbackStatus(TO))!.delivery, "mail");
    assert.equal((await getFeedbackStatus(""))!.delivery, "github");
    assert.equal((await mails()).length, 0);
  });

  test("con una versión publicada más nueva, el botón sale desactivado y la ruta no envía; sin saberla, sí", async () => {
    const u = await makeUser();
    resetLimits(u.id);
    await loginAs(u);
    try {
      await setLatest("999.0.0");
      assert.deepEqual(await getFeedbackStatus(TO), { outdated: true, latest: "999.0.0", delivery: "mail" });
      const res = await post({ kind: "bug", text: "x" });
      assert.equal(res.status, 409);
      assert.equal(await errorOf(res), "outdated");
      await setLatest(null);
      assert.equal((await getFeedbackStatus(TO))!.outdated, false);
      assert.equal((await post({ kind: "bug", text: "sin saber la última" })).status, 200);
    } finally {
      await setLatest(pkg.version);
    }
  });

  test("valida tipo, texto y captura (por su contenido y tamaño); los rechazos no gastan el límite", async () => {
    const u = await makeUser();
    resetLimits(u.id);
    await loginAs(u);
    assert.equal(await errorOf(await post({ kind: "otro", text: "x" })), "invalid");
    assert.equal(await errorOf(await post({ kind: "bug", text: "   " })), "empty");
    assert.equal(await errorOf(await post({ kind: "bug", text: "x".repeat(5001) })), "invalid");
    const png = await post({ kind: "bug", text: "x", screenshot: new Blob([PNG], { type: "image/jpeg" }) });
    assert.equal(png.status, 415);
    assert.equal(await errorOf(png), "bad_image");
    assert.equal(await errorOf(await post({ kind: "bug", text: "x", screenshot: "no es un archivo" })), "invalid");
    const big = new Uint8Array(SCREENSHOT_MAX_BYTES + 1);
    big.set(JPEG);
    const tooBig = await post({ kind: "bug", text: "x", screenshot: new Blob([big], { type: "image/jpeg" }) });
    assert.equal(tooBig.status, 413);
    assert.equal(await errorOf(tooBig), "too_big");
    // El cuerpo entero, con su tope (Content-Length declarado).
    const huge = await post({ kind: "bug", text: "x" }, { headers: { "content-length": String(10 * 1024 * 1024) } });
    assert.equal(huge.status, 413);
    assert.equal((await mails()).length, 0);
    // Ninguno de esos ha gastado envíos: quedan los 5.
    for (let i = 0; i < FEEDBACK_LIMITS.user; i++) assert.equal((await post({ kind: "bug", text: `envío ${i}` })).status, 200, `envío ${i}`);
  });

  test("límites: 5 al día por persona y 20 por instalación", async () => {
    const people = await Promise.all(Array.from({ length: 5 }, () => makeUser()));
    resetLimits(...people.map((p) => p.id));
    await loginAs(people[0]!);
    for (let i = 0; i < FEEDBACK_LIMITS.user; i++) assert.equal((await post({ kind: "bug", text: `a${i}` })).status, 200);
    const sixth = await post({ kind: "bug", text: "sexto" });
    assert.equal(sixth.status, 429);
    assert.equal(await errorOf(sixth), "rate_user");
    for (const p of people.slice(1, 4)) {
      await loginAs(p);
      for (let i = 0; i < FEEDBACK_LIMITS.user; i++) assert.equal((await post({ kind: "idea", text: `b${i}` })).status, 200);
    }
    await loginAs(people[4]!);
    const install = await post({ kind: "bug", text: "uno más" });
    assert.equal(install.status, 429);
    assert.equal(await errorOf(install), "rate_install");
    assert.equal((await mails()).length, FEEDBACK_LIMITS.install);
    resetLimits(...people.map((p) => p.id));
  });
});
