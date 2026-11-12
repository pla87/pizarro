// Búsquedas sin distinguir mayúsculas ni tildes: la del navegador (normalizeSearch, buscadores del tablero, documentos,
// changelog, menciones y «Bloqueada por») y la que se compara con translate() en PostgreSQL (foldAccents).
import assert from "node:assert/strict";
import { test } from "node:test";
import { foldAccents, foldedContains, normalizeSearch, slugify } from "../src/lib/search-accents";

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

test("slugify: sin tildes, minúsculas y con guiones; da lo mismo que las copias que sustituye", () => {
  assert.equal(slugify("Canción nº 2"), "cancion-n-2");
  assert.equal(slugify("  --Mi Proyecto Ñandú: v2!--  "), "mi-proyecto-nandu-v2");
  assert.equal(slugify("¡¡¡"), "");
  // Las versiones anteriores (informes y .ics; .pizarro.zip; anclas de la web), tal como estaban.
  const pdf = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  const zip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const anchor = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const alphabet = ["a", "Z", "é", "Ñ", "ü", "İ", "K", "Å", "ß", "ẞ", "1", " ", "-", "_", ".", "😀", "ç", "Ω", "\u0301", "ﬁ", "²"];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let n = 0; n < 5000; n++) {
    let s = "";
    for (let i = 0, len = 1 + Math.floor(rnd() * 12); i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    const out = slugify(s);
    assert.equal(out, pdf(s), JSON.stringify(s));
    assert.equal(out, zip(s), JSON.stringify(s));
    assert.equal(out, anchor(s), JSON.stringify(s));
  }
});
