import assert from "node:assert/strict";
import { test } from "node:test";
import { feedHttpsUrl, feedWebcalUrl, FEED_TOKEN_LENGTH, googleSubscribeUrl, hashFeedToken, isFeedTokenShape, newFeedToken, safeEqualHex, sequenceOf, snippet, tokenFromFilename } from "../src/lib/calendar-feed-core";
import { buildIcs, escapeIcsText, foldIcsLine } from "../src/lib/ics";

process.env.SESSION_SECRET ??= "x".repeat(40);

test("el token tiene 32 bytes aleatorios y su hash no es el token", () => {
  const a = newFeedToken();
  const b = newFeedToken();
  assert.notEqual(a, b);
  assert.equal(a.length, FEED_TOKEN_LENGTH);
  assert.equal(Buffer.from(a, "base64url").length, 32);
  assert.ok(isFeedTokenShape(a));
  assert.notEqual(hashFeedToken(a), a);
  assert.equal(hashFeedToken(a), hashFeedToken(a));
  assert.notEqual(hashFeedToken(a), hashFeedToken(b));
});

test("isFeedTokenShape descarta basura", () => {
  assert.equal(isFeedTokenShape(""), false);
  assert.equal(isFeedTokenShape("a".repeat(42)), false);
  assert.equal(isFeedTokenShape("a".repeat(44)), false);
  assert.equal(isFeedTokenShape("a".repeat(42) + "/"), false);
  assert.equal(isFeedTokenShape("a".repeat(43)), true);
});

test("safeEqualHex y tokenFromFilename", () => {
  assert.equal(safeEqualHex("abcd", "abcd"), true);
  assert.equal(safeEqualHex("abcd", "abce"), false);
  assert.equal(safeEqualHex("abcd", "abc"), false);
  assert.equal(tokenFromFilename("abc.ics"), "abc");
  assert.equal(tokenFromFilename("abc"), null);
  assert.equal(tokenFromFilename("abc.ics.txt"), null);
});

test("direcciones: https, webcal y Google Calendar con el webcal codificado", () => {
  const https = feedHttpsUrl("https://app.example.com/", "TOK");
  assert.equal(https, "https://app.example.com/api/calendar/TOK.ics");
  const webcal = feedWebcalUrl(https);
  assert.equal(webcal, "webcal://app.example.com/api/calendar/TOK.ics");
  assert.equal(googleSubscribeUrl(webcal), `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`);
  assert.equal(feedWebcalUrl("http://localhost:3000/x"), "webcal://localhost:3000/x");
});

test("sequenceOf crece con la fecha y cabe en 32 bits", () => {
  const a = sequenceOf(new Date("2026-11-01T10:00:00Z"));
  const b = sequenceOf(new Date("2026-11-01T10:00:01Z"));
  assert.equal(b, a + 1);
  assert.ok(b < 2 ** 31);
});

test("escapado RFC 5545: barra, punto y coma, coma, saltos y controles", () => {
  assert.equal(escapeIcsText("a\\b;c,d\ne\r\nf\u0000g"), "a\\\\b\\;c\\,d\\ne\\nfg");
});

test("plegado a 75 octetos sin partir UTF-8 y sin perder texto", () => {
  const line = "DESCRIPTION:" + "áñ€😀".repeat(40);
  const lines = foldIcsLine(line).split("\r\n");
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(Buffer.byteLength(l, "utf8") <= 75);
  assert.equal(lines.map((l, i) => (i ? l.slice(1) : l)).join(""), line);
});

test("evento de día completo con rango, SEQUENCE, DTSTAMP propio y refresco", () => {
  const modifiedAt = new Date("2026-10-30T08:15:30Z");
  const ics = buildIcs({
    name: "Mis tareas",
    now: new Date("2026-11-02T00:00:00Z"),
    refreshMinutes: 60,
    events: [
      { uid: "t1@pizarro", date: "2026-11-10", endDate: "2026-11-12", summary: "[P] Hacer, algo; ya", description: "Línea 1\nLínea 2", url: "https://app.example.com/p/1?task=t1", modifiedAt, sequence: 1793348130, category: "Tarea" },
      { uid: "d1@pizarro", date: "2026-12-31", summary: "[P] Entrega" },
    ],
  });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "todas las líneas acaban en CRLF");
  assert.match(ics, /REFRESH-INTERVAL;VALUE=DURATION:PT60M/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261110\r\nDTEND;VALUE=DATE:20261113\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n/);
  assert.match(ics, /DTSTAMP:20261030T081530Z/);
  assert.match(ics, /DTSTAMP:20261102T000000Z/);
  assert.match(ics, /LAST-MODIFIED:20261030T081530Z/);
  assert.match(ics, /SEQUENCE:1793348130/);
  assert.match(ics, /SUMMARY:\[P\] Hacer\\, algo\\; ya/);
  assert.match(ics, /DESCRIPTION:Línea 1\\nLínea 2/);
  assert.match(ics, /CATEGORIES:Tarea/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
});

test("sin los campos nuevos la salida del .ics de la Agenda no cambia", () => {
  const ics = buildIcs({ name: "A", now: new Date("2026-11-02T00:00:00Z"), events: [{ uid: "x", date: "2026-11-10", summary: "S" }] });
  assert.ok(!ics.includes("SEQUENCE"));
  assert.ok(!ics.includes("REFRESH-INTERVAL"));
  assert.ok(!ics.includes("LAST-MODIFIED"));
});

test("snippet no parte un par sustituto (emoji) al recortar", () => {
  assert.equal(snippet("corto", 10), "corto");
  // 299 emojis seguidos de más texto: el corte cae justo en medio de un emoji si se corta por unidades UTF-16.
  const out = snippet("😀".repeat(400), 300);
  assert.equal(Array.from(out).length, 300);
  assert.ok(out.endsWith("😀…"));
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(out), "sin sustitutos sueltos");
  assert.equal(snippet("ab cd ef", 5), "ab c…");
  assert.equal(snippet("ab  cd", 4), "ab…");
});
