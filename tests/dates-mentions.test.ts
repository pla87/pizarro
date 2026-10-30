import assert from "node:assert/strict";
import { test } from "node:test";
import { daysBetween, dueStatus, formatDay } from "../src/lib/dates";
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
