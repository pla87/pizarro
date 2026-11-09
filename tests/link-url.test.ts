import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLinkUrl } from "../src/lib/link-url";
import { linkUrl } from "../src/lib/validation";

test("enlace sin esquema con forma de dominio: se completa con https://", () => {
  const cases: [string, string][] = [
    ["example.com/x", "https://example.com/x"],
    ["www.example.com", "https://www.example.com"],
    ["  docs.example.com/a?b=1#c  ", "https://docs.example.com/a?b=1#c"],
    ["sub.example.co.uk:8080/ruta", "https://sub.example.co.uk:8080/ruta"],
    ["example.com?q=1", "https://example.com?q=1"],
    ["//example.com/x", "https://example.com/x"],
    ["ejemplo-ñ.es", "https://ejemplo-ñ.es"],
    ["xn--ejemplo-9za.xn--p1ai/x", "https://xn--ejemplo-9za.xn--p1ai/x"],
    ["192.168.1.10/panel", "https://192.168.1.10/panel"],
  ];
  for (const [raw, want] of cases) {
    assert.equal(normalizeLinkUrl(raw), want, raw);
    assert.equal(linkUrl.parse(raw), want, raw);
  }
});

test("con esquema http(s) se deja tal cual", () => {
  for (const url of ["https://example.com/x", "http://example.com", "HTTPS://Example.com/A"]) {
    assert.equal(normalizeLinkUrl(url), url);
    assert.equal(linkUrl.parse(url), url);
  }
});

test("lo que no es un dominio o lleva otro esquema se sigue rechazando", () => {
  for (const bad of [
    "javascript:alert(1)", "JavaScript:alert(1)//example.com", "javascript://example.com/%0aalert(1)", "data:text/html,x", "vbscript:x",
    "ftp://example.com", "mailto:ana@example.com", "ana@example.com", "localhost:3000", "hola", "example", "example.c0m",
    "example.com/a b", "-example.com", "example-.com/x", "http//example.com", "file:///etc/passwd", "example.com:abc",
  ]) {
    assert.equal(linkUrl.safeParse(bad).success, false, bad);
  }
  // Sin forma de dominio, la normalización no lo toca (la validación decide).
  assert.equal(normalizeLinkUrl(" hola "), "hola");
  assert.equal(normalizeLinkUrl("javascript:alert(1)"), "javascript:alert(1)");
  assert.equal(normalizeLinkUrl(""), "");
});

test("vacío quita el enlace y el máximo cuenta el https:// añadido", () => {
  assert.equal(linkUrl.parse(""), null);
  assert.equal(linkUrl.parse(null), null);
  const long = `example.com/${"a".repeat(1988)}`; // 2000 caracteres: con https:// pasaría de 2000
  assert.equal(long.length, 2000);
  assert.equal(linkUrl.safeParse(long).success, false);
});
