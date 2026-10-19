import assert from "node:assert/strict";
import { test } from "node:test";
import { nonImageCopyCutoff } from "../src/lib/maintenance";

const now = new Date("2026-06-30T12:00:00Z");

test("copias no imagen: 7 días", () => {
  assert.equal(nonImageCopyCutoff(now).toISOString(), "2026-06-23T12:00:00.000Z");
});
