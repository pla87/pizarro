// Zonas horarias del campo con búsqueda (/setup y Administración → Ajustes → Instalación): nombres actuales, las
// habituales arriba, y lo escrito a mano → una zona de la lista.
import assert from "node:assert/strict";
import { test } from "node:test";
import { validTimeZone } from "../src/lib/format";
import { currentTimeZoneName, matchTimeZone, timeZoneOptions } from "../src/lib/time-zones";

const supported = Intl.supportedValuesOf("timeZone");
const options = timeZoneOptions(supported);
/** Las habituales, arriba de la lista y en este orden (COMMON_TIME_ZONES de lib/time-zones.ts). */
const COMMON = [
  "Europe/Madrid", "Atlantic/Canary", "Europe/Lisbon", "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles",
  "America/Mexico_City", "America/Bogota", "America/Lima", "America/Santiago", "America/Argentina/Buenos_Aires", "America/Sao_Paulo", "UTC",
];

test("las habituales primero, en su orden; luego el resto por orden alfabético, sin repetir y con UTC", () => {
  assert.deepEqual(options.slice(0, COMMON.length), COMMON);
  assert.deepEqual(options.slice(0, 3), ["Europe/Madrid", "Atlantic/Canary", "Europe/Lisbon"]);
  const rest = options.slice(COMMON.length);
  // Ninguna habitual se repite entre el resto.
  for (const z of COMMON) assert.equal(rest.includes(z), false, z);
  assert.deepEqual(rest, [...rest].sort());
  assert.equal(new Set(options).size, options.length);
  assert.ok(options.includes("UTC"));
  assert.ok(options.length > 300, String(options.length));
});

test("nombres actuales: ni Asia/Calcutta ni Europe/Kiev (Intl aún los da), sí Asia/Kolkata y Europe/Kyiv", () => {
  for (const old of ["Asia/Calcutta", "Europe/Kiev", "Asia/Saigon", "America/Buenos_Aires"]) assert.equal(options.includes(old), false, old);
  for (const now of ["Asia/Kolkata", "Europe/Kyiv", "Asia/Ho_Chi_Minh", "America/Argentina/Buenos_Aires"]) assert.ok(options.includes(now), now);
  // Todas valen para Intl (y por tanto para guardarlas: saveInstanceSettings y el asistente usan validTimeZone).
  for (const z of options) assert.ok(validTimeZone(z), z);
});

test("una zona antigua ya guardada sigue valiendo y se muestra con su nombre actual", () => {
  assert.ok(validTimeZone("Asia/Calcutta"));
  assert.equal(currentTimeZoneName("Asia/Calcutta"), "Asia/Kolkata");
  assert.equal(currentTimeZoneName("Europe/Madrid"), "Europe/Madrid");
  assert.equal(matchTimeZone("Europe/Kiev", options), "Europe/Kyiv");
});

test("lo escrito: tal cual, sin distinguir mayúsculas ni «_»/espacios; lo que no es una zona, null", () => {
  assert.equal(matchTimeZone("Europe/Madrid", options), "Europe/Madrid");
  assert.equal(matchTimeZone("  europe/madrid ", options), "Europe/Madrid");
  assert.equal(matchTimeZone("america/new york", options), "America/New_York");
  assert.equal(matchTimeZone("asia/calcutta", options), "Asia/Kolkata");
  assert.equal(matchTimeZone("Madrid", options), null);
  assert.equal(matchTimeZone("", options), null);
  assert.equal(matchTimeZone("Marte/Olimpo", options), null);
});

test("sin Intl.supportedValuesOf (solo la zona por defecto): la lista sigue teniendo esa zona y UTC", () => {
  assert.deepEqual(timeZoneOptions(["Europe/Madrid"]), ["Europe/Madrid", "UTC"]);
  // Una habitual que este Intl no conoce no sale; las conocidas, en el orden de las habituales aunque lleguen en otro.
  assert.deepEqual(timeZoneOptions(["America/Lima", "Asia/Tokyo", "Europe/Madrid"]), ["Europe/Madrid", "America/Lima", "UTC", "Asia/Tokyo"]);
});
