// Búsquedas sin distinguir mayúsculas ni tildes: la del navegador (normalizeSearch, buscadores del tablero, documentos,
// changelog, menciones y «Bloqueada por») y la que se compara con translate() en PostgreSQL (foldAccents).
import assert from "node:assert/strict";
import { test } from "node:test";
import { foldAccents, foldedContains, normalizeSearch } from "../src/lib/search-accents";

test("normalizeSearch: minúsculas y sin marcas diacríticas", () => {
  assert.equal(normalizeSearch("Canción del PINGÜINO"), "cancion del pinguino");
  assert.equal(normalizeSearch("Ñandú · Çà"), "nandu · ca");
  // Compuesta o descompuesta da lo mismo.
  assert.equal(normalizeSearch("Guía"), normalizeSearch("Guía"));
  assert.equal(normalizeSearch("sin tildes 123"), "sin tildes 123");
});

test("normalizeSearch y foldAccents coinciden en el español", () => {
  for (const s of ["Revisar el CAMIÓN", "Pingüino", "Año nuevo", "Acción rápida"]) assert.equal(normalizeSearch(s), foldAccents(s), s);
  assert.equal(foldedContains("50%_ya"), "%50\\%\\_ya%");
});
