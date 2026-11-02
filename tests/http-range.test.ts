import assert from "node:assert/strict";
import { test } from "node:test";
import { ifRangeMatches, parseRange, strongEtag } from "../src/lib/http-range";

test("parseRange: sin cabecera, otra unidad o varios rangos se sirve entero", () => {
  assert.deepEqual(parseRange(null, 100), { kind: "full" });
  assert.deepEqual(parseRange("", 100), { kind: "full" });
  assert.deepEqual(parseRange("items=0-5", 100), { kind: "full" });
  assert.deepEqual(parseRange("bytes=0-5,10-20", 100), { kind: "full" });
});

test("parseRange: rangos válidos", () => {
  assert.deepEqual(parseRange("bytes=0-0", 100), { kind: "partial", start: 0, end: 0 });
  assert.deepEqual(parseRange("bytes=10-19", 100), { kind: "partial", start: 10, end: 19 });
  assert.deepEqual(parseRange("bytes=90-", 100), { kind: "partial", start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=90-5000", 100), { kind: "partial", start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { kind: "partial", start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-500", 100), { kind: "partial", start: 0, end: 99 });
  assert.deepEqual(parseRange(" Bytes = 1-2 ", 100), { kind: "partial", start: 1, end: 2 });
});

test("parseRange: rangos inválidos o fuera del archivo (416)", () => {
  for (const h of ["bytes=100-", "bytes=100-120", "bytes=20-10", "bytes=-0", "bytes=-", "bytes=abc", "bytes=1-2-3", "bytes=a-b", "bytes=99999999999999999999-"]) {
    assert.deepEqual(parseRange(h, 100), { kind: "invalid" }, h);
  }
  assert.deepEqual(parseRange("bytes=0-", 0), { kind: "invalid" });
  assert.deepEqual(parseRange("bytes=-5", 0), { kind: "invalid" });
});

test("ETag y If-Range", () => {
  const e = strongEtag("abc", 1234, new Date(1700000000000));
  assert.equal(e, '"abc-1234-1700000000000"');
  assert.notEqual(e, strongEtag("abc", 1235, new Date(1700000000000)));
  assert.notEqual(e, strongEtag("abc", 1234, new Date(1700000000001)));
  assert.equal(ifRangeMatches(null, e), true);
  assert.equal(ifRangeMatches(e, e), true);
  assert.equal(ifRangeMatches('"otro"', e), false);
  assert.equal(ifRangeMatches("Wed, 21 Oct 2015 07:28:00 GMT", e), false);
});
