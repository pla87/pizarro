import assert from "node:assert/strict";
import { test } from "node:test";
import { intlLocale, toLocale, translate } from "../src/i18n/core";
import { formatDate, formatDateTimeZone, formatTimeZone } from "../src/lib/format";
import { formatDay } from "../src/lib/dates";

test("español: devuelve la clave con sus variables", () => {
  assert.equal(translate("es", "Hola"), "Hola");
  assert.equal(translate("es", "{n} tareas", { n: 3 }), "3 tareas");
});

test("inglés: sin traducción, cae al español; variables desconocidas se quedan", () => {
  assert.equal(translate("en", "Texto que no existe en el diccionario"), "Texto que no existe en el diccionario");
  assert.equal(translate("en", "{x} y {y}", { x: 1 }), "1 y {y}");
});

test("locales", () => {
  assert.equal(toLocale("EN"), "en");
  assert.equal(toLocale(null), "es");
  assert.equal(intlLocale("en"), "en-US");
  assert.equal(intlLocale("es"), "es-ES");
});

// Inglés americano también en las fechas (antes, en-GB: «21 Nov 2026», «21/11/2026», «08:05»).
test("fechas en inglés: formato de EE. UU. (mes primero, AM/PM); en español, día primero y 24 horas", () => {
  const prev = process.env.APP_TIMEZONE;
  process.env.APP_TIMEZONE = "Europe/Madrid";
  try {
    const en = intlLocale("en");
    const es = intlLocale("es");
    const morning = "2026-11-21T07:05:09Z"; // 08:05:09 en Madrid
    const evening = "2026-11-21T19:05:09Z"; // 20:05:09 en Madrid
    assert.equal(formatDate(morning, "dateNumeric", en), "11/21/2026");
    assert.equal(formatDate(morning, "date", en), "Nov 21, 2026");
    assert.equal(formatDate(morning, "dateLong", en), "November 21, 2026");
    assert.equal(formatDate(morning, "dateTime", en), "Nov 21, 2026, 8:05 AM");
    assert.equal(formatDate(evening, "dateTimeSeconds", en), "Nov 21, 2026, 8:05:09 PM");
    assert.equal(formatDate(morning, "timeHm", en), "8:05 AM");
    assert.equal(formatDate(evening, "time", en), "8:05 PM");
    assert.equal(formatDateTimeZone(evening, en), "Nov 21, 2026, 8:05 PM (GMT+1)");
    assert.equal(formatTimeZone(evening, en), "8:05 PM GMT+1");
    assert.equal(formatDay("2026-11-21", undefined, en), "Nov 21, 2026");
    assert.equal(formatDay("2026-11-21", "2026-01-01", en), "Nov 21");
    // En español no cambia nada.
    assert.equal(formatDate(morning, "dateNumeric", es), "21/11/2026");
    assert.equal(formatDate(morning, "date", es), "21 nov 2026");
    assert.equal(formatDate(morning, "timeHm", es), "08:05");
    assert.equal(formatDate(evening, "timeHm", es), "20:05");
    assert.equal(formatTimeZone(morning, es), "08:05 CET");
    assert.equal(formatDay("2026-11-21", undefined, es), "21 nov 2026");
  } finally {
    if (prev === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = prev;
  }
});

// Según la versión de ICU, «8:05 AM» lleva un espacio normal o uno fino (U+202F): servidor y navegador deben coincidir.
test("fechas: solo espacios normales (el HTML del servidor y el del navegador coinciden)", () => {
  const styles = ["date", "dateShort", "dateLong", "dateTime", "dateTimeSeconds", "dateTimeShort", "time", "timeHm", "dateNumeric"] as const;
  for (const locale of [intlLocale("en"), intlLocale("es")]) {
    for (const style of styles) assert.doesNotMatch(formatDate("2026-11-21T19:05:09Z", style, locale), /[\u00a0\u2009\u202f]/, `${locale} ${style}`);
    assert.doesNotMatch(formatDateTimeZone("2026-11-21T19:05:09Z", locale), /[\u00a0\u2009\u202f]/, locale);
    assert.doesNotMatch(formatTimeZone("2026-11-21T19:05:09Z", locale), /[\u00a0\u2009\u202f]/, locale);
  }
});
