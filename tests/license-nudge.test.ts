// Recordatorio de licencia para administradores (tipo WinRAR): cuándo se muestra, y textos de la web del producto.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { makeT } from "../src/i18n/core";
import {
  LICENSE_NUDGE_GRACE_DAYS, LICENSE_NUDGE_SNOOZE_DAYS, licenseStatus, nudgeSnoozeUntil, parseLicense, parsePersonalUse, shouldShowLicenseNudge,
  type NudgeInput,
} from "../src/lib/license-core";
import { landingIncludes, licenseFaq } from "../src/lib/landing-content";
import { siteText } from "../src/lib/site-content";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-20T10:00:00Z");
const base: NudgeInput = { role: "ADMIN", status: "none", installedAt: new Date(now.getTime() - 30 * DAY), snoozedUntil: null, now };

describe("recordatorio de licencia", () => {
  test("solo a administradores de una instalación sin licencia ni declaración de uso personal", () => {
    assert.equal(shouldShowLicenseNudge(base), true);
    assert.equal(shouldShowLicenseNudge({ ...base, role: "MEMBER" }), false);
    assert.equal(shouldShowLicenseNudge({ ...base, status: "licensed" }), false);
    assert.equal(shouldShowLicenseNudge({ ...base, status: "personal" }), false);
    assert.equal(shouldShowLicenseNudge({ ...base, installedAt: null }), false);
  });

  test("nunca en los primeros 7 días tras crear la instalación", () => {
    assert.equal(LICENSE_NUDGE_GRACE_DAYS, 7);
    assert.equal(shouldShowLicenseNudge({ ...base, installedAt: now }), false);
    assert.equal(shouldShowLicenseNudge({ ...base, installedAt: new Date(now.getTime() - 7 * DAY + 60_000) }), false);
    assert.equal(shouldShowLicenseNudge({ ...base, installedAt: new Date(now.getTime() - 7 * DAY) }), true);
  });

  test("como mucho una vez cada 30 días: pospuesto hasta una fecha futura no sale", () => {
    assert.equal(LICENSE_NUDGE_SNOOZE_DAYS, 30);
    const until = nudgeSnoozeUntil(now);
    assert.equal(until.getTime() - now.getTime(), 30 * DAY);
    assert.equal(shouldShowLicenseNudge({ ...base, snoozedUntil: until }), false);
    assert.equal(shouldShowLicenseNudge({ ...base, snoozedUntil: until, now: new Date(until.getTime() - 1) }), false);
    assert.equal(shouldShowLicenseNudge({ ...base, snoozedUntil: until, now: until }), true);
    assert.equal(shouldShowLicenseNudge({ ...base, snoozedUntil: new Date(now.getTime() - DAY) }), true);
  });

  test("estado: la licencia registrada manda; lo ilegible no cuenta", () => {
    assert.deepEqual(parseLicense(JSON.stringify({ holder: "Empresa Ejemplo" })), { holder: "Empresa Ejemplo", reference: "", email: "", date: "" });
    assert.equal(parsePersonalUse(null), null);
    assert.equal(parsePersonalUse("{roto"), null);
    assert.equal(parsePersonalUse(JSON.stringify({ personal: false })), null);
    assert.deepEqual(parsePersonalUse(JSON.stringify({ personal: true, date: "2026-11-02" })), { date: "2026-11-02" });
    const lic = { holder: "Empresa Ejemplo", reference: "", email: "", date: "2026-11-02" };
    assert.equal(licenseStatus(lic, { date: "2026-11-01" }).kind, "licensed");
    assert.equal(licenseStatus(null, { date: "2026-11-01" }).kind, "personal");
    assert.equal(licenseStatus(null, null).kind, "none");
  });
});

describe("web del producto (getpizarro.com)", () => {
  test("una descripción por cada función y textos en inglés", () => {
    for (const locale of ["es", "en"] as const) {
      const t = makeT(locale);
      const s = siteText(t, 100);
      assert.equal(s.featureTexts.length, landingIncludes(t).length);
      assert.equal(s.boardCards.length, s.boardCols.length);
    }
    const en = makeT("en");
    assert.equal(siteText(en, 100).soon, "Coming soon");
    assert.match(licenseFaq(en, 100)[1]?.a ?? "", /€100 \+ VAT/);
  });
});
