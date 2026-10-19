import assert from "node:assert/strict";
import { test } from "node:test";
import { isPrivateExpired, nonImageCopyCutoff, privateExpiryCutoff } from "../src/lib/maintenance";

const now = new Date("2026-06-30T12:00:00Z");

test("caducidad de proyectos privados bloqueados: 30 días", () => {
  assert.equal(privateExpiryCutoff(now).toISOString(), "2026-05-31T12:00:00.000Z");
  assert.equal(isPrivateExpired(null, now), false);
  assert.equal(isPrivateExpired(new Date("2026-06-01T00:00:00Z"), now), false);
  assert.equal(isPrivateExpired(new Date("2026-05-30T00:00:00Z"), now), true);
});

test("copias no imagen: 7 días", () => {
  assert.equal(nonImageCopyCutoff(now).toISOString(), "2026-06-23T12:00:00.000Z");
});
