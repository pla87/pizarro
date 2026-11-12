// Idioma de las pantallas de quien se identifica sin sesión: el de la persona de un enlace de email (/reset, /confirm)
// o del segundo paso pendiente (/login/verify); si no, el de la instalación. Contra PostgreSQL real.
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { db, logout, makeUser } from "./helpers";
import { getLocale } from "../../src/i18n/server";
import { issueAuthToken } from "../../src/lib/auth-token";
import { AUTH_LINK_HEADER } from "../../src/lib/auth-link-path";
import { startChallenge } from "../../src/lib/two-factor";

const request = (globalThis as unknown as { __pzTestRequest: { headers?: Record<string, string> } }).__pzTestRequest;
afterEach(() => {
  delete request.headers;
});

describe("idioma de quien se identifica sin sesión", () => {
  test("/reset/<token> y /confirm/<token>: el de la persona del enlace", async () => {
    logout();
    const user = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { locale: "EN" } });
    assert.equal(await getLocale(), "es", "sin nada, el de la instalación");
    const reset = await issueAuthToken(user.id, "PASSWORD_RESET");
    request.headers = { [AUTH_LINK_HEADER]: `/reset/${reset}` };
    assert.equal(await getLocale(), "en");
    const confirm = await issueAuthToken(user.id, "EMAIL_CHANGE", { newEmail: "nuevo@example.com" });
    request.headers = { [AUTH_LINK_HEADER]: `/confirm/${confirm}` };
    assert.equal(await getLocale(), "en");
    // Un enlace de otro tipo para esa ruta, o uno que no existe: el de la instalación.
    request.headers = { [AUTH_LINK_HEADER]: `/confirm/${reset}` };
    assert.equal(await getLocale(), "es");
    request.headers = { [AUTH_LINK_HEADER]: "/reset/noexiste" };
    assert.equal(await getLocale(), "es");
  });

  test("/login/verify: el de la persona del segundo paso pendiente", async () => {
    logout();
    const admin = await makeUser({ role: "ADMIN" });
    await db.user.update({ where: { id: admin.id }, data: { locale: "EN" } });
    assert.equal(await getLocale(), "es");
    await startChallenge(admin.id, "SETUP");
    assert.equal(await getLocale(), "en");
    logout();
  });
});
