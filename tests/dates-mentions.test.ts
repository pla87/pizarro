import assert from "node:assert/strict";
import { test } from "node:test";
import { daysBetween, dueStatus, formatDay, msUntilNextDay } from "../src/lib/dates";
import { excerpt, extractMentionIds, mentionToken, mentionsToMarkdown, mentionsToPlain } from "../src/lib/mentions";

test("estado de plazo", () => {
  const today = "2026-10-18";
  assert.equal(dueStatus(null, false, today), "none");
  assert.equal(dueStatus("2026-10-10", true, today), "done");
  assert.equal(dueStatus("2026-10-17", false, today), "overdue");
  assert.equal(dueStatus("2026-10-18", false, today), "today");
  assert.equal(dueStatus("2026-10-21", false, today), "soon");
  assert.equal(dueStatus("2026-10-30", false, today), "ok");
  assert.equal(daysBetween("2026-10-30", "2026-11-02"), 3);
  assert.match(formatDay("2026-11-02", "2026-10-18"), /2 nov/);
});

test("menciones", () => {
  const text = `Hola ${mentionToken("Ana [QA]", "abc123")} y ${mentionToken("Luis", "def456")} y otra vez ${mentionToken("Ana", "abc123")}`;
  assert.deepEqual(extractMentionIds(text), ["abc123", "def456"]);
  assert.equal(mentionsToPlain("x @[Ana](user:abc123) y"), "x @Ana y");
  assert.equal(mentionsToPlain("x @[Ana](user:abc123) y", false), "x Ana y");
  assert.equal(mentionsToMarkdown("@[Ana](user:abc123)"), "[@Ana](#mention-abc123)");
  assert.deepEqual(extractMentionIds("@[Ana](user:../../x) @[B](javascript:1)"), []);
  assert.equal(excerpt("a".repeat(300)).length, 180);
});

test("fechas límite: solo días reales y años razonables", async () => {
  const { dayIso } = await import("../src/lib/validation");
  assert.equal(dayIso.parse("2026-02-28"), "2026-02-28");
  for (const bad of ["2026-02-31", "2026-13-01", "0000-01-01", "0002-10-18", "26-10-18"]) {
    assert.equal(dayIso.safeParse(bad).success, false, bad);
  }
  assert.equal(dayIso.parse(null), null);
});

test("lo que falta para el día siguiente, en la zona de la app", () => {
  // 23:59:30 en Madrid (UTC+1 en noviembre): faltan 30 s, aunque en UTC sean las 22:59.
  assert.equal(msUntilNextDay("Europe/Madrid", new Date("2026-11-20T22:59:30.000Z")), 30_000);
  assert.equal(msUntilNextDay("UTC", new Date("2026-11-20T12:00:00.250Z")), 12 * 3_600_000 - 250);
  // Justo a medianoche: un día entero.
  assert.equal(msUntilNextDay("America/New_York", new Date("2026-11-21T05:00:00.000Z")), 86_400_000);
});
