import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, parseExportRange, startOfDayInZone } from "../src/lib/log-range";

const tz = "Europe/Madrid";
const now = new Date("2026-10-24T10:00:00Z");

test("por defecto: de ayer a hoy, días enteros en la zona de la app", () => {
  const r = parseExportRange(null, "", { now, tz, retentionDays: 7 });
  assert.ok(r.ok);
  assert.equal(r.from, "2026-10-23");
  assert.equal(r.to, "2026-10-24");
  assert.equal(r.gte.toISOString(), "2026-10-22T22:00:00.000Z"); // 00:00 CEST
  assert.equal(r.lt.toISOString(), "2026-10-24T22:00:00.000Z"); // 00:00 del 25 (CEST aún hasta el 25 a las 03:00)
});

test("cambio de hora: el día siguiente empieza con el nuevo desfase", () => {
  assert.equal(startOfDayInZone("2026-10-26", tz).toISOString(), "2026-10-25T23:00:00.000Z"); // CET
});

test("valida fechas, orden y duración máxima", () => {
  const o = { now, tz, retentionDays: 7 };
  assert.deepEqual(parseExportRange("2026-02-31", "2026-03-01", o), { ok: false, error: "invalid" });
  assert.deepEqual(parseExportRange("hoy", "2026-10-24", o), { ok: false, error: "invalid" });
  assert.deepEqual(parseExportRange("2026-10-24", "2026-10-23", o), { ok: false, error: "order" });
  assert.deepEqual(parseExportRange("2026-10-16", "2026-10-24", o), { ok: false, error: "too_long" });
  assert.ok(parseExportRange("2026-10-17", "2026-10-24", o).ok);
  assert.ok(parseExportRange("2026-10-24", "2026-10-24", o).ok);
});

test("addDays cruza meses y años", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("días del periodo personalizado: de hoy hacia atrás, escritos en el idioma de la interfaz (no en el del navegador)", async () => {
  const { logDayOptions } = await import("../src/lib/log-range");
  const es = logDayOptions("2026-11-24", 7, "es-ES");
  assert.equal(es.length, 8);
  assert.deepEqual(es[0], { value: "2026-11-24", label: "mar, 24 nov" });
  assert.equal(es.at(-1)!.value, "2026-11-17");
  assert.deepEqual(logDayOptions("2026-11-24", 1, "en-US"), [{ value: "2026-11-24", label: "Tue, Nov 24" }, { value: "2026-11-23", label: "Mon, Nov 23" }]);
  // El cambio de hora no salta ni repite días (aritmética de calendario).
  assert.deepEqual(logDayOptions("2026-10-26", 2, "es-ES").map((d) => d.value), ["2026-10-26", "2026-10-25", "2026-10-24"]);
});
