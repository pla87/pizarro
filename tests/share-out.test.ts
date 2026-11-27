// «Compartir fuera»: la lógica pura (token y huella, caducidad y estado del enlace, mismo origen de los formularios, fechas,
// Markdown de la página, la página entera, los avisos de lo hecho desde fuera y el submenú del rol).
import assert from "node:assert/strict";
import { test } from "node:test";
import { hashFeedToken } from "../src/lib/calendar-feed-core";
import { splitRoleChoices, currentRoleChoice, ROLE_CHOICES } from "../src/lib/column-role-choices";
import { externalExcerpt, externalNotice, noticeActorName, notificationBody, notificationHeadline } from "../src/lib/notification-text";
import { boardShareOf, DEFAULT_SHARE_EXPIRY_DAYS, isShareColumn, isShareExpiry, MAX_SHARE_TASKS, nextShareExpiry, shareExpiryLabel, shareHasUnpublished, shareLinkState, shareMailto, shareStateText } from "../src/lib/share-out-board";
import {
  hashShareToken, inShareGrace, isShareNotice, isShareTokenShape, MAX_SHARE_PAGE_COMMENTS, newShareToken, parseShareDate,
  SHARE_LIMITS, SHARE_PAGE_CSP, SHARE_TOKEN_LENGTH, shareFormAllowed, shareIpKey, shareKeyOf, shareNotifyBucket, shareResponseHeaders, shareUrl,
} from "../src/lib/share-out-core";
import { shareAttachmentPath, shareExpiryDay, shareMarkdownHtml, shareMessageHtml, sharePageHtml, type SharePageData } from "../src/lib/share-out-page";
import { excerpt } from "../src/lib/mentions";
import { rateLimit } from "../src/lib/rate-limit";
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
      "[descargar](/api/attachments/att1) <script>alert(1)</script> ++subrayado++ https://pizarro.example.com/p/autolink",
    ].join("\n\n"),
    { token, attachments: new Set(["att1"]), appOrigin: "https://pizarro.example.com" },
  );
  assert.ok(html.includes("@Ana López") && !html.includes("user:u1"), html);
  assert.ok(html.includes(`src="${shareAttachmentPath(token, "att1", true)}"`), html);
  assert.ok(!html.includes("ajena"), "la imagen de otra tarea queda en su texto");
  assert.ok(html.includes(">otra") || html.includes("otra"));
  assert.ok(!html.includes('href="/p/abc') && html.includes("ver en Pizarro"), "enlace interno: solo su texto");
  assert.ok(!html.includes("pizarro.example.com/p/x"), "enlace a la propia instalación: fuera");
  assert.ok(!html.includes("autolink"), "una dirección interna escrita tal cual desaparece");
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

test("un comentario normal no puede hacerse pasar por un aviso de fuera: el extracto quita los caracteres de control", () => {
  const forged = excerpt("\u001EX\u001Edone\u001E");
  assert.equal(forged, "Xdone");
  assert.equal(externalNotice(forged), null);
  assert.equal(notificationHeadline("COMMENT", t, { actor: "Ana", task: "«Planos»", excerpt: forged }), notificationHeadline("COMMENT", t, { actor: "Ana", task: "«Planos»", excerpt: "hola" }));
  // Los saltos de línea y tabuladores siguen siendo espacios; NUL, DEL y los demás de control, fuera.
  assert.equal(excerpt("uno\ndos\t\ttres\u0000cuatro\u007Fcinco\u001F"), "uno dos trescuatrocinco");
  // Lo de fuera, igual: su texto va tras la marca, sin poder añadir otra.
  assert.equal(externalNotice(externalExcerpt("Proveedor (fuera)", "comment", excerpt("a\u001Edone\u001Eb")))?.text, "adoneb");
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

// --- Arreglos de la revisión (ronda 68) ---------------------------------------------------------------------------------

test("tope por IP de /x/: en el mapa general del limitador (no echa del de seguridad los bloqueos de inicio de sesión)", () => {
  const key = shareIpKey("203.0.113.9");
  assert.ok(!key.startsWith("share-out:"), key);
  rateLimit(key, SHARE_LIMITS.ip.limit, SHARE_LIMITS.ip.windowMs);
  const stores = (globalThis as unknown as { __pzRateStores: { general: { map: Map<string, unknown> }; security: { map: Map<string, unknown> } } }).__pzRateStores;
  assert.ok(stores.general.map.has(key) && !stores.security.map.has(key));
  // Los topes que solo nacen con un token válido, y el de los avisos (coste), sí van al de seguridad.
  for (const k of [`share-out:change:${shareKeyOf(newShareToken())}`, `notify:${shareNotifyBucket("s1")}`]) {
    rateLimit(k, 10, 60_000);
    assert.ok(stores.security.map.has(k) && !stores.general.map.has(k), k);
  }
  assert.equal(SHARE_LIMITS.notify.limit, 10, "avisos externos por enlace y hora");
});

test("pie de la página: el día de caducidad en la zona horaria de la instalación, no en UTC", () => {
  // 03:00 UTC del 26 es todavía el 25 en Nueva York.
  assert.equal(shareExpiryDay("2026-11-26T03:00:00.000Z", "es-ES", "America/New_York"), "25 de noviembre de 2026");
  assert.equal(shareExpiryDay("2026-11-26T03:00:00.000Z", "es-ES", "Europe/Madrid"), "26 de noviembre de 2026");
  const html = sharePageHtml(pageData({ expiresAt: "2026-12-26T03:00:00.000Z", timeZone: "America/New_York" }), t);
  assert.ok(html.includes("hasta el 25 de diciembre de 2026"), "la página usa la zona de la instalación");
});

test("página: botones con el título de su tarea para lectores de pantalla, contraste en oscuro y comentarios anteriores", () => {
  const html = sharePageHtml(pageData(), t);
  assert.ok(html.includes('<h2 id="h-t1">'));
  for (const label of ["Marcar como hecha", "Cambiar fecha", "Comentar"]) {
    assert.match(html, new RegExp(`<button type="submit"[^>]*aria-describedby="h-t1"[^>]*>${label}</button>`), label);
  }
  // Texto blanco sobre el botón: #4f46e5 en claro y en oscuro (6,3:1); antes, en oscuro, #818cf8 (3,0:1).
  const dark = /@media \(prefers-color-scheme:dark\)\{:root\{([^}]*)\}\}/.exec(html)![1]!;
  assert.match(dark, /--btn:#4f46e5/);
  assert.ok(html.includes("button{background:var(--btn);color:#fff"));
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };
  assert.ok(ratio("#ffffff", "#4f46e5") >= 4.5);
  const link = /--brand:(#[0-9a-f]{6})/.exec(dark)![1]!;
  const card = /--card:(#[0-9a-f]{6})/.exec(dark)![1]!;
  assert.ok(ratio(link, card) >= 4.5, "los enlaces y el botón secundario en oscuro");
  assert.ok(!html.includes("anteriores que no se muestran"));
  const older = sharePageHtml(pageData({ tasks: [{ ...pageData().tasks[0]!, olderComments: 12 }] }), t);
  assert.ok(older.includes("Hay 12 comentarios anteriores que no se muestran."));
  assert.ok(sharePageHtml(pageData({ tasks: [{ ...pageData().tasks[0]!, olderComments: 1 }] }), t).includes("Hay 1 comentario anterior que no se muestra."));
  assert.equal(MAX_SHARE_PAGE_COMMENTS, 30);
});

// --- Segunda vuelta (cliente): la marca dice «Enlace revocado» tras revocar, no «caducado» -----------------------------

test("marca de la cabecera: revocado o caducado", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const used = new Date("2026-06-10T12:00:00Z");
  const base = { columnId: "c1", tokenHash: "h", expiryDays: 30, generatedAt: used, generatedByName: null, lastUsedAt: null, revokedAt: null, taskIds: [] };
  // «Revocar enlace» con el enlace activo.
  const revoked = boardShareOf({ ...base, revokedAt: new Date("2026-06-12T08:00:00Z") }, now);
  assert.deepEqual([revoked.state, revoked.revoked], ["ended", true]);
  assert.deepEqual(shareStateText(revoked), { key: "Enlace revocado", date: null });
  // Caducado sin uso.
  const expired = boardShareOf({ ...base, generatedAt: new Date(now.getTime() - 31 * DAY) }, now);
  assert.deepEqual([expired.state, expired.revoked], ["ended", false]);
  assert.deepEqual(shareStateText(expired), { key: "Enlace caducado", date: null });
  // Caducado y después revocado (apagar la función los marca todos): sigue siendo «caducado».
  const gen = new Date(now.getTime() - 40 * DAY);
  assert.equal(boardShareOf({ ...base, generatedAt: gen, revokedAt: now }, now).revoked, false);
  // El selector de caducidad deja un enlace caducado terminado donde estaba (revokedAt = cuándo caducó) y cambia los días.
  for (const days of [7, 90]) {
    const frozen = boardShareOf({ ...base, generatedAt: gen, expiryDays: days, revokedAt: new Date(gen.getTime() + 30 * DAY) }, now);
    assert.deepEqual([frozen.state, frozen.revoked], ["ended", false], `${days} días`);
  }
  assert.equal(boardShareOf(base, now).revoked, false);
  assert.equal(shareStateText({ state: "ended", endsAt: null }).key, "Enlace caducado");
});

// --- Ronda 69 --------------------------------------------------------------------------------------------------------

test("cambios sin publicar: el conjunto de ids de la columna frente a lo publicado, solo con el enlace activo y con el tope", () => {
  const info = (taskIds: string[], state: "none" | "active" | "ended" = "active") => ({ state, taskIds });
  assert.equal(shareHasUnpublished(info(["a", "b"]), ["b", "a"]), false, "mismo conjunto, otro orden: nada que publicar");
  assert.equal(shareHasUnpublished(info(["a", "b"]), ["a", "b", "c"]), true, "una tarea nueva");
  assert.equal(shareHasUnpublished(info(["a", "b"]), ["a"]), true, "una tarea que ya no está");
  assert.equal(shareHasUnpublished(info(["a", "b"]), ["a", "c"]), true, "una por otra");
  assert.equal(shareHasUnpublished(info(["a"], "ended"), ["x"]), false, "sin enlace activo no hay nada que actualizar");
  assert.equal(shareHasUnpublished(info([], "none"), ["x"]), false);
  const many = Array.from({ length: MAX_SHARE_TASKS + 20 }, (_, i) => `t${i}`);
  assert.equal(shareHasUnpublished(info(many.slice(0, MAX_SHARE_TASKS)), many), false, "las que no caben no cuentan como cambio");
  // Una publicada que ahora está en una columna terminada se sigue leyendo en vivo: no es una tarea quitada.
  assert.equal(shareHasUnpublished(info(["a", "b"]), ["a"], new Set(["b"])), false, "b pasó a «Hecho»");
  assert.equal(shareHasUnpublished(info(["a", "b"]), [], new Set(["a", "b"])), false, "columna vacía: todas en «Hecho»");
  assert.equal(shareHasUnpublished(info(["a", "b"]), [], new Set(["b"])), true, "columna vacía y a salió por otro lado: sí hay cambio");
  assert.equal(shareHasUnpublished(info(["a", "b"]), ["a", "c"], new Set(["b"])), true, "una nueva sigue contando");
  assert.equal(shareHasUnpublished(info(["a"]), ["a"], new Set(["a"])), false, "sigue en la columna: nada que ver con «Hecho»");
});

test("quién revocó: el nombre solo sale si el enlace terminó revocado; el tablero lleva los ids publicados solo si está activo", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const base = { columnId: "c1", tokenHash: "h", expiryDays: 30, generatedAt: new Date("2026-06-10T12:00:00Z"), lastUsedAt: null, revokedAt: null, taskIds: ["a", "b"] };
  const active = boardShareOf(base, now, "Marta");
  assert.deepEqual([active.revokedBy, active.taskIds], [null, ["a", "b"]]);
  const revoked = boardShareOf({ ...base, revokedAt: new Date("2026-06-12T08:00:00Z") }, now, "Marta");
  assert.deepEqual([revoked.revoked, revoked.revokedBy, revoked.taskIds], [true, "Marta", []]);
  assert.equal(boardShareOf({ ...base, revokedAt: new Date("2026-06-12T08:00:00Z") }, now).revokedBy, null, "cuenta borrada: sin nombre");
  assert.equal(boardShareOf({ ...base, generatedAt: new Date(now.getTime() - 40 * DAY) }, now, "Marta").revokedBy, null, "caducado: nadie lo revocó");
});

test("página: quién la comparte, imágenes como bloque, miniaturas de los adjuntos, sin apartados vacíos y el aviso en la tarjeta", () => {
  const task = { ...pageData().tasks[0]!, description: "**Por qué:**\n\n**Riesgo:** sin cambios\n\nTexto ![p](/api/attachments/a1) fin" };
  const html = sharePageHtml(pageData({ sharedBy: "Marta", tasks: [task] }), t);
  assert.ok(html.includes("Compartida por Marta desde Pizarro"), html);
  assert.ok(sharePageHtml(pageData({ sharedBy: null }), t).includes("Compartida desde Pizarro"));
  assert.ok(/\.desc img\{[^}]*display:block/.test(html), "la imagen de la descripción es un bloque");
  assert.ok(!html.includes("Por qué:") && html.includes("Riesgo:"), "el apartado vacío de la plantilla no sale");
  const files = html.slice(html.indexOf('<ul class="files">'));
  const thumb = shareAttachmentPath(pageData().token, "a1", "thumb");
  assert.ok(thumb.endsWith("?inline=thumb"));
  assert.ok(files.includes(`<a href="${shareAttachmentPath(pageData().token, "a1", "open")}" target="_blank" rel="noopener noreferrer"><img src="${thumb}" alt="plano.webp" loading="lazy"></a>`), "miniatura de la imagen adjunta: abre la imagen en otra pestaña (no la descarga)");
  assert.ok(files.includes(`href="${shareAttachmentPath(pageData().token, "a1")}">plano.webp</a>`), "el nombre sigue siendo la descarga");
  // «Cambiar fecha»: no antes de la fecha de inicio; avisos propios; y «copia tu texto» solo si falló un comentario.
  const dated = { ...pageData().tasks[0]!, startDate: "2026-12-01" };
  assert.ok(sharePageHtml(pageData({ tasks: [dated] }), t).includes('name="due" value="2026-12-03" min="2026-12-01"'));
  assert.ok(!sharePageHtml(pageData(), t).includes(' min="'));
  assert.ok(sharePageHtml(pageData({ notice: "early", noticeTaskId: "t1", tasks: [dated] }), t).includes("La fecha no puede ser anterior al 1 de diciembre de 2026."));
  assert.ok(sharePageHtml(pageData({ notice: "same", noticeTaskId: "t1" }), t).includes("La fecha no ha cambiado."));
  assert.ok(sharePageHtml(pageData({ notice: "invalid", noticeTaskId: "t1", noticeFromComment: true }), t).includes("No se ha podido guardar: revisa los datos. Copia tu texto antes de volver a intentarlo."));
  assert.ok(!sharePageHtml(pageData({ notice: "invalid", noticeTaskId: "t1" }), t).includes("Copia tu texto"));
  assert.ok(!sharePageHtml(pageData({ notice: "comment", noticeTaskId: "t1", noticeFromComment: true }), t).includes("Copia tu texto"));
  // El aviso, en la tarjeta de su tarea; sin tarea, arriba del todo.
  const here = sharePageHtml(pageData({ notice: "done", noticeTaskId: "t1" }), t);
  const card = here.slice(here.indexOf('<section class="card" id="t-t1">'));
  assert.ok(card.startsWith('<section class="card" id="t-t1"><p class="notice"') && card.includes("Tarea marcada como hecha."));
  assert.equal(here.split("Tarea marcada como hecha.").length - 1, 1, "una sola vez");
  const top = sharePageHtml(pageData({ notice: "done" }), t);
  assert.ok(top.indexOf("Tarea marcada como hecha.") < top.indexOf('<section class="card"'));
});

test("enlace revocado: la página no dice «ha caducado»", () => {
  const html = shareMessageHtml("revoked", "es", t);
  assert.ok(html.includes("Esta lista de tareas ya no está disponible. Contacta con la persona que te ha dado el enlace.") && !html.includes("caducado"));
  assert.ok(shareMessageHtml("revoked", "en", makeT("en")).includes("no longer available"));
});
