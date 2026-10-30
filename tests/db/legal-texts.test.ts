// Textos legales editables: solo administradores, guardado, restauración, fecha, registro y validación.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, makeUser } from "./helpers";
import { saveLegalIdentity, saveLegalPage } from "../../src/actions/legal";
import { getLegalSettings } from "../../src/lib/legal";
import { LEGAL_MAX, pickLegalText } from "../../src/lib/legal-core";
import { flushLogs } from "../../src/lib/log";

afterEach(async () => {
  await db.appState.deleteMany({ where: { key: { startsWith: "legal." } } });
  await db.appState.deleteMany({ where: { key: "google.publicContactEmail" } });
});

async function admin() {
  await loginAs(await makeUser({ role: "ADMIN" }));
}

describe("textos legales", () => {
  test("solo administradores", async () => {
    await loginAs(await makeUser());
    expectFail(await saveLegalPage({ kind: "privacy", es: "Hola", en: "" }), FORBIDDEN);
    expectFail(await saveLegalIdentity({ responsible: "X", email: "" }), FORBIDDEN);
    const s = await getLegalSettings();
    assert.equal(s.texts.privacy.es, "");
    assert.equal(s.responsible, "");
  });

  test("guarda por página e idioma, anota la fecha y vacío vuelve al texto por defecto", async () => {
    await admin();
    const ok = expectOk(await saveLegalPage({ kind: "terms", es: "  ## Condiciones\r\nHola {responsable}  ", en: "" }));
    assert.equal(ok.texts.es, "## Condiciones\nHola {responsable}");
    assert.ok(ok.updatedAt);
    let s = await getLegalSettings();
    assert.equal(s.texts.terms.es, "## Condiciones\nHola {responsable}");
    assert.equal(s.texts.privacy.es, "");
    assert.equal(s.updatedAt.privacy, null);
    // En inglés sin texto propio gana el español propio
    assert.equal(pickLegalText(s.texts.terms, "en").source, "custom-es-fallback");
    expectOk(await saveLegalPage({ kind: "terms", es: "", en: "" }));
    s = await getLegalSettings();
    assert.equal(s.texts.terms.es, "");
    assert.equal(s.updatedAt.terms, null);
    assert.equal(pickLegalText(s.texts.terms, "en").source, "default");
    assert.equal(await db.appState.count({ where: { key: { startsWith: "legal.terms" } } }), 0);
  });

  test("valida página, tamaño y tipos; el contenido no va al registro", async () => {
    await admin();
    expectFail(await saveLegalPage({ kind: "otra", es: "x", en: "" }), /Página no válida/);
    expectFail(await saveLegalPage({ kind: "privacy", es: "x".repeat(LEGAL_MAX + 1), en: "" }), /demasiado largo/);
    expectFail(await saveLegalPage({ kind: "privacy", es: "", en: "y".repeat(LEGAL_MAX + 1) }), /demasiado largo/);
    expectFail(await saveLegalPage({ kind: "privacy", es: 5 as unknown as string, en: "" }), /no es válido/);
    expectOk(await saveLegalPage({ kind: "privacy", es: "x".repeat(LEGAL_MAX), en: "" }));
    expectOk(await saveLegalPage({ kind: "privacy", es: "SECRETO-LEGAL <script>alert(1)</script>", en: "" }));
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { action: "legal.savePage" }, select: { message: true, details: true } });
    assert.ok(logs.length >= 1);
    assert.equal(JSON.stringify(logs).includes("SECRETO-LEGAL"), false);
  });

  test("responsable y email: se normalizan, se validan y se comparte el email con Ajustes de Google", async () => {
    await admin();
    expectFail(await saveLegalIdentity({ responsible: "x".repeat(201), email: "" }), /demasiado largo/);
    expectFail(await saveLegalIdentity({ responsible: "A", email: "no-es-un-email" }), /no es válido/);
    expectOk(await saveLegalIdentity({ responsible: "  Empresa   Ejemplo  ", email: " privacidad@example.com " }));
    const s = await getLegalSettings();
    assert.equal(s.responsible, "Empresa Ejemplo");
    assert.equal(s.email, "privacidad@example.com");
    assert.equal((await db.appState.findUnique({ where: { key: "google.publicContactEmail" } }))?.value, "privacidad@example.com");
    expectOk(await saveLegalIdentity({ responsible: "", email: "" }));
    assert.equal((await getLegalSettings()).responsible, "");
  });
});
