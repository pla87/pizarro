// «Compartir fuera»: la lógica pura (token y huella, caducidad y estado del enlace, mismo origen de los formularios, fechas,
// Markdown de la página, la página entera, los avisos de lo hecho desde fuera y el submenú del rol).
import assert from "node:assert/strict";
import { test } from "node:test";
import { hashFeedToken } from "../src/lib/calendar-feed-core";
import { splitRoleChoices, currentRoleChoice, ROLE_CHOICES } from "../src/lib/column-role-choices";
import { externalExcerpt, externalNotice, noticeActorName, notificationBody, notificationHeadline } from "../src/lib/notification-text";
import { DEFAULT_SHARE_EXPIRY_DAYS, isShareColumn, isShareExpiry, nextShareExpiry, shareExpiryLabel, shareLinkState, shareMailto, shareStateText } from "../src/lib/share-out-board";
import {
  hashShareToken, inShareGrace, isShareNotice, isShareTokenShape, newShareToken, parseShareDate,
  SHARE_PAGE_CSP, SHARE_TOKEN_LENGTH, shareFormAllowed, shareKeyOf, shareResponseHeaders, shareUrl,
} from "../src/lib/share-out-core";
import { shareAttachmentPath, shareMarkdownHtml, shareMessageHtml, sharePageHtml, type SharePageData } from "../src/lib/share-out-page";
import { makeT } from "../src/i18n/core";

process.env.SESSION_SECRET ??= "x".repeat(40);

const DAY = 86_400_000;
const t = makeT("es");

test("token: 32 bytes aleatorios en base64url; la huella es un HMAC con etiqueta propia y la clave del limitador no es el token", () => {
  const a = newShareToken();
  const b = newShareToken();
  assert.notEqual(a, b);
  assert.equal(a.length, SHARE_TOKEN_LENGTH);
  assert.equal(Buffer.from(a, "base64url").length, 32);
  assert.ok(isShareTokenShape(a));
  assert.ok(!isShareTokenShape(`${a}x`) && !isShareTokenShape(a.slice(1)) && !isShareTokenShape(`${a.slice(1)}/`));
  assert.equal(hashShareToken(a), hashShareToken(a));
  assert.notEqual(hashShareToken(a), a);
  assert.ok(!hashShareToken(a).includes(a));
  assert.notEqual(hashShareToken(a), hashFeedToken(a), "no vale como token del calendario");
  assert.ok(!shareKeyOf(a).includes(a) && shareKeyOf(a).length === 16);
  assert.equal(shareUrl("https://pizarro.example.com/", a), `https://pizarro.example.com/x/${a}`);
});

test("caducidad: el selector rota 7 días → 1 mes → 3 meses y vuelve; por defecto 1 mes", () => {
  assert.equal(DEFAULT_SHARE_EXPIRY_DAYS, 30);
  assert.equal(nextShareExpiry(7), 30);
  assert.equal(nextShareExpiry(30), 90);
  assert.equal(nextShareExpiry(90), 7);
  assert.equal(nextShareExpiry(12), 30, "un valor desconocido vuelve al de por defecto");
  assert.deepEqual([7, 30, 90].map(shareExpiryLabel), ["7 días", "1 mes", "3 meses"]);
  assert.ok(isShareExpiry(7) && !isShareExpiry(8) && !isShareExpiry("7"));
});

test("estado del enlace: sin generar, activo hasta N días tras el último uso, caducado, revocado y sin columna", () => {
  const now = new Date("2026-11-25T12:00:00Z");
  const base = { columnId: "c1", tokenHash: "h", expiryDays: 7, generatedAt: new Date(now.getTime() - 10 * DAY), lastUsedAt: new Date(now.getTime() - 2 * DAY), revokedAt: null };
  assert.deepEqual(shareLinkState({ ...base, tokenHash: null }, now), { state: "none", endsAt: null });
  const active = shareLinkState(base, now);
  assert.equal(active.state, "active");
  assert.equal(active.endsAt?.toISOString(), new Date(now.getTime() + 5 * DAY).toISOString());
  // Sin uso apuntado cuenta desde que se generó.
  assert.equal(shareLinkState({ ...base, lastUsedAt: null }, now).state, "ended");
  const expired = shareLinkState({ ...base, lastUsedAt: new Date(now.getTime() - 8 * DAY) }, now);
  assert.equal(expired.state, "ended");
  assert.equal(expired.endsAt?.toISOString(), new Date(now.getTime() - DAY).toISOString(), "terminó al cumplir los días");
  const revokedAt = new Date(now.getTime() - DAY);
  assert.deepEqual(shareLinkState({ ...base, revokedAt }, now), { state: "ended", endsAt: revokedAt });
  assert.equal(shareLinkState({ ...base, columnId: null }, now).state, "ended", "columna borrada o sin la función");
  // 30 días de «ha caducado» y después nada.
  assert.ok(inShareGrace(revokedAt, now));
  assert.ok(inShareGrace(new Date(now.getTime() - 29 * DAY), now));
  assert.ok(!inShareGrace(new Date(now.getTime() - 31 * DAY), now));
});

test("formularios de la página: mismo origen por Sec-Fetch-Site u Origin; con Origin null (no-referrer) cuenta Sec-Fetch-Site", () => {
  const app = "https://pizarro.example.com";
  const ok = (h: { secFetchSite?: string | null; origin?: string | null; host?: string | null }) => shareFormAllowed({ secFetchSite: h.secFetchSite ?? null, origin: h.origin ?? null, host: h.host ?? "pizarro.example.com" }, app);
  assert.equal(ok({ secFetchSite: "same-origin", origin: "null" }), true);
  assert.equal(ok({ secFetchSite: "cross-site", origin: "null" }), false);
  assert.equal(ok({ secFetchSite: "same-site" }), false);
  assert.equal(ok({ secFetchSite: "none" }), false);
  assert.equal(ok({ origin: "https://pizarro.example.com" }), true);
  assert.equal(ok({ origin: "https://otra.example.com" }), false);
  assert.equal(ok({ origin: "no es una url" }), false);
  assert.equal(ok({}), true, "sin cabeceras (navegador antiguo): la credencial es el token, no una cookie");
});

test("fechas del formulario: AAAA-MM-DD válida, vacía para quitarla, el resto no vale", () => {
  assert.equal(parseShareDate("2026-12-03"), "2026-12-03");
  assert.equal(parseShareDate("  "), null);
  for (const bad of ["2026-02-30", "2026-13-01", "03/12/2026", "1999-12-31", "2101-01-01", "2026-12-3"]) assert.equal(parseShareDate(bad), undefined, bad);
  assert.ok(isShareNotice("done") && !isShareNotice("<script>"));
});

test("Markdown de la página: imágenes de la tarea a la ruta de descarga, ajenas solo texto, enlaces internos fuera, menciones en texto plano, sin HTML", () => {
  const token = "T".repeat(43);
  const html = shareMarkdownHtml(
    [
      "Hola @[Ana López](user:u1)",
      "![plano](/api/attachments/att1) ![otra](/api/attachments/ajena)",
      "[ver en Pizarro](/p/abc?task=1) [externa](https://example.com/doc) [app](https://pizarro.example.com/p/x) [mal](javascript:alert(1))",
      "[descargar](/api/attachments/att1) <script>alert(1)</script> ++subrayado++",
    ].join("\n\n"),
    { token, attachments: new Set(["att1"]), appOrigin: "https://pizarro.example.com" },
  );
  assert.ok(html.includes("@Ana López") && !html.includes("user:u1"), html);
  assert.ok(html.includes(`src="${shareAttachmentPath(token, "att1", true)}"`), html);
  assert.ok(!html.includes("ajena"), "la imagen de otra tarea queda en su texto");
  assert.ok(html.includes(">otra") || html.includes("otra"));
  assert.ok(!html.includes('href="/p/abc') && html.includes("ver en Pizarro"), "enlace interno: solo su texto");
  assert.ok(!html.includes("pizarro.example.com/p/x"), "enlace a la propia instalación: fuera");
  assert.ok(html.includes('href="https://example.com/doc" rel="noopener noreferrer nofollow" target="_blank"'));
  assert.ok(!html.includes("javascript:"));
  assert.ok(html.includes(`href="${shareAttachmentPath(token, "att1")}"`), "enlace al adjunto: a la descarga");
  assert.ok(!html.includes("<script>") && html.includes("&lt;script&gt;"));
  assert.ok(html.includes("<u>subrayado</u>"));
});

const pageData = (over: Partial<SharePageData> = {}): SharePageData => ({
  token: "A".repeat(43),
  columnName: "Proveedor <b>",
  canMarkDone: true,
  expiresAt: "2026-12-25T12:00:00.000Z",
  notice: null,
  locale: "es-ES",
  lang: "es",
  timeZone: "Europe/Madrid",
  appOrigin: "https://pizarro.example.com",
  tasks: [{
    id: "t1", title: "Revisar <planos>", description: "Mira ![p](/api/attachments/a1)", dueDate: "2026-12-03", assignee: "Ana", done: false,
    subtasks: [{ title: "Medir", done: true }], attachments: [{ id: "a1", name: "plano.webp", size: 2048, isImage: true }],
    comments: [{ author: "Proveedor (fuera)", body: "Listo", createdAt: "2026-11-24T10:00:00.000Z" }],
  }],
  ...over,
});

test("página: sin scripts, con noindex, todo escapado, formularios a su ruta y «Marcar como hecha» solo si hay columna terminada", () => {
  const html = sharePageHtml(pageData(), t);
  assert.ok(html.includes('<meta name="robots" content="noindex,nofollow">'));
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes("Proveedor &lt;b&gt;") && html.includes("Revisar &lt;planos&gt;"));
  assert.ok(html.includes(`action="/x/${"A".repeat(43)}/t/t1"`));
  assert.ok(html.includes("Marcar como hecha") && html.includes('name="due" value="2026-12-03"') && html.includes('maxlength="2000"'));
  assert.ok(html.includes("Responsable: Ana") && html.includes("☑ Medir") && html.includes("plano.webp") && html.includes("Proveedor (fuera)"));
  assert.ok(html.includes("Este enlace deja de funcionar si nadie lo usa hasta el"));
  assert.ok(!sharePageHtml(pageData({ canMarkDone: false }), t).includes("Marcar como hecha"), "sin columna terminada no sale");
  const done = sharePageHtml(pageData({ tasks: [{ ...pageData().tasks[0]!, done: true }] }), t);
  assert.ok(done.includes(">Hecha<") && !done.includes('value="done"'));
  assert.ok(sharePageHtml(pageData({ notice: "rate" }), t).includes("Demasiados cambios seguidos"));
  assert.ok(sharePageHtml(pageData({ lang: "en" }), makeT("en")).includes("Mark as done"), "en el idioma de la instalación");
  assert.ok(shareMessageHtml("expired", "es", t).includes("Esta lista de tareas ha caducado. Contacta con la persona que te ha dado el enlace."));
  assert.ok(shareMessageHtml("notFound", "es", t).includes("No encontrado"));
});

test("cabeceras: noindex, no-referrer, no-store y una CSP sin scripts", () => {
  const h = shareResponseHeaders(false);
  assert.equal(h["X-Robots-Tag"], "noindex, nofollow, noarchive");
  assert.equal(h["Referrer-Policy"], "no-referrer");
  assert.equal(h["Cache-Control"], "no-store");
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.ok(!("Strict-Transport-Security" in h) && "Strict-Transport-Security" in shareResponseHeaders(true));
  assert.ok(SHARE_PAGE_CSP.includes("default-src 'none'") && !SHARE_PAGE_CSP.includes("script-src"));
});

test("enlace por email: mailto sin destinatario con asunto y cuerpo codificados", () => {
  const m = shareMailto("Tareas de «X»", "Hola & adiós\nhttps://pizarro.example.com/x/abc");
  assert.ok(m.startsWith("mailto:?subject="));
  assert.ok(m.includes(encodeURIComponent("Hola & adiós\n")));
});

test("avisos de lo hecho desde fuera: autor en el extracto, cabecera de «hecha» y cuerpo sin la marca", () => {
  const ex = externalExcerpt("Proveedor (fuera)", "comment", "¿Vale así?");
  assert.deepEqual(externalNotice(ex), { author: "Proveedor (fuera)", what: "comment", text: "¿Vale así?" });
  assert.equal(externalNotice("texto normal"), null);
  assert.equal(noticeActorName(null, ex, "Alguien"), "Proveedor (fuera)");
  assert.equal(noticeActorName("Ana", ex, "Alguien"), "Ana");
  assert.equal(noticeActorName(null, "texto", "Alguien"), "Alguien");
  assert.equal(notificationBody("COMMENT", ex, t, "es-ES"), "¿Vale así?");
  const done = externalExcerpt("Proveedor (fuera)", "done");
  assert.equal(notificationHeadline("COMMENT", t, { actor: "Proveedor (fuera)", task: "«Planos»", excerpt: done }), "Proveedor (fuera) ha marcado como hecha «Planos»");
  assert.equal(notificationBody("COMMENT", done, t, "es-ES"), "");
  const due = externalExcerpt("Proveedor (fuera)", "due", "2026-12-01>2026-12-03");
  assert.match(notificationBody("DUE_CHANGED", due, t, "es-ES"), /1 dic.*→.*3 dic/);
});

test("rol de la columna: «Compartir fuera» sale (al final) solo si el proyecto la tiene, y la marca la fila con rol NONE", () => {
  assert.deepEqual(splitRoleChoices(null, null).first, [...ROLE_CHOICES], "sin la función, como siempre");
  assert.deepEqual(splitRoleChoices(null, null, true).first, [...ROLE_CHOICES, "SHARE"]);
  const { first, more } = splitRoleChoices(["WAITING"], null, true);
  assert.equal(first.at(-1), "SHARE");
  assert.ok(!more.includes("SHARE"));
  assert.ok(splitRoleChoices(["WAITING"], "SHARE").first.includes("SHARE"), "la que tiene la columna nunca se esconde");
  assert.equal(currentRoleChoice({ role: "NONE", assign: false, share: true }), "SHARE");
  assert.equal(isShareColumn({ role: "NONE", share: {} }), true);
  assert.equal(isShareColumn({ role: "WAITING", share: {} }), false, "un deshacer le devolvió otro rol");
  assert.equal(isShareColumn({ role: "NONE", assigneeId: "u1", share: {} }), false);
  assert.equal(isShareColumn({ role: "NONE", share: null }), false);
  assert.deepEqual(shareStateText({ state: "none", endsAt: null }), { key: "Web sin generar", date: null });
});
