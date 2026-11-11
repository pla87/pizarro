// Caza de bugs (2), lo que no necesita base de datos: sesión caducada en el idioma de la interfaz, ruta de los enlaces de
// email, nombre del ZIP de adjuntos, resumen de importación sin el email repetido, manifiesto de la app e idioma de los
// WhatsApp.
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeT, translate } from "../src/i18n/core";
import { isSessionExpiredMessage, SESSION_EXPIRED, SESSION_EXPIRED_EN } from "../src/components/ui/session-expired";
import { authLinkToken } from "../src/lib/auth-link-path";
import { personLine } from "../src/lib/person-line";
import { releaseZipName } from "../src/lib/release";
import { webManifest } from "../src/lib/web-manifest";
import { whatsappLocale } from "../src/lib/whatsapp";

test("sesión caducada: se reconoce en los dos idiomas, sea cual sea el de la interfaz", () => {
  // El inglés escrito a mano en session-expired.ts debe ser la traducción del diccionario.
  assert.equal(SESSION_EXPIRED_EN, translate("en", SESSION_EXPIRED));
  for (const ui of ["es", "en"] as const) {
    const t = makeT(ui);
    // El servidor, sin saber quién eres, lo manda en el idioma de la instalación: puede ser cualquiera de los dos.
    assert.equal(isSessionExpiredMessage(translate("es", SESSION_EXPIRED), t), true);
    assert.equal(isSessionExpiredMessage(translate("en", SESSION_EXPIRED), t), true);
    assert.equal(isSessionExpiredMessage("Otra cosa", t), false);
  }
});

test("ruta de un enlace de email: token y tipos de enlace", () => {
  assert.deepEqual(authLinkToken("/reset/abc_DEF-123"), { token: "abc_DEF-123", purposes: ["PASSWORD_RESET", "INVITE"] });
  assert.deepEqual(authLinkToken("/confirm/xyz"), { token: "xyz", purposes: ["PASSWORD_CHANGE", "EMAIL_CHANGE"] });
  for (const p of [null, "", "/login", "/reset/", "/reset/a/b", "/reset/a b", `/reset/${"x".repeat(101)}`]) assert.equal(authLinkToken(p), null, String(p));
});

test("nombre del ZIP de adjuntos en el idioma de quien lo descarga", () => {
  assert.equal(releaseZipName({ day: "2026-11-11", number: 12, project: "Web" }), "release-2026-11-11-R12-Web-adjuntos.zip");
  assert.equal(releaseZipName({ day: "2026-11-11", number: 12, project: "Web" }, 2, 3, "es"), "release-2026-11-11-R12-Web-adjuntos-2de3.zip");
  assert.equal(releaseZipName({ day: "2026-11-11", number: 12, project: "Web" }, 1, 1, "en"), "release-2026-11-11-R12-Web-attachments.zip");
  assert.equal(releaseZipName({ day: "2026-11-11" }, 2, 3, "en"), "release-2026-11-11-attachments-2of3.zip");
});

test("resumen de importación: el email no se repite", () => {
  assert.equal(personLine({ name: "", email: "desconocido@example.com" }), "desconocido@example.com");
  assert.equal(personLine({ name: "Desconocido@Example.com", email: "desconocido@example.com" }), "desconocido@example.com");
  assert.equal(personLine({ name: "Ana", email: "ana@example.com" }), "Ana · ana@example.com");
  assert.equal(personLine({ name: "Ana", email: "" }), "Ana");
});

test("manifiesto de la app en el idioma de la instalación", () => {
  const en = webManifest("en");
  assert.equal(en.lang, "en");
  assert.equal(en.description, "Lightweight Kanban and release notes generator.");
  assert.deepEqual(en.shortcuts?.map((s) => s.name), ["My tasks", "Notifications"]);
  const es = webManifest("es");
  assert.equal(es.lang, "es");
  assert.deepEqual(es.shortcuts?.map((s) => s.name), ["Mis tareas", "Avisos"]);
});

test("WhatsApp: el inglés solo con la plantilla en inglés configurada", () => {
  assert.equal(whatsappLocale({ templateLangEn: "" }, "en"), "es");
  assert.equal(whatsappLocale({ templateLangEn: "en" }, "en"), "en");
  assert.equal(whatsappLocale({ templateLangEn: "en" }, "es"), "es");
});
