import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SESSION_SECRET = "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const { mentionRecipientsWhere } = await import("../src/lib/notify");

test("proyecto privado: solo avisa al dueño si lo han mencionado", () => {
  const project = { restricted: false, privateOwnerId: "owner" };
  assert.deepEqual(mentionRecipientsWhere(project, ["otro"], "p1").id, { in: [] });
  assert.deepEqual(mentionRecipientsWhere(project, ["otro", "owner"], "p1").id, { in: ["owner"] });
});

test("proyecto restringido: admins o miembros", () => {
  const where = mentionRecipientsWhere({ restricted: true, privateOwnerId: null }, ["a", "b"], "p1");
  assert.deepEqual(where.id, { in: ["a", "b"] });
  assert.equal(where.active, true);
  assert.ok(where.OR);
});

test("proyecto público: sin condición de acceso extra", () => {
  const where = mentionRecipientsWhere({ restricted: false, privateOwnerId: null }, ["a"], "p1");
  assert.equal(where.OR, undefined);
});
