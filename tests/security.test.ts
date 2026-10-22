import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SESSION_SECRET = "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const { mentionRecipientsWhere } = await import("../src/lib/notify");
const { visibleProjectsWhere } = await import("../src/lib/access");
const { isMaskedLog, logWhere } = await import("../src/lib/log-query");

test("proyecto privado: solo avisa a sus miembros (nunca a admins ajenos)", () => {
  const where = mentionRecipientsWhere({ restricted: false, isPrivate: true }, ["a", "b"], "p1");
  assert.deepEqual(where.id, { in: ["a", "b"] });
  assert.equal(where.active, true);
  assert.deepEqual(where.memberships, { some: { projectId: "p1" } });
  assert.equal(where.OR, undefined);
});

test("proyecto restringido: admins o miembros", () => {
  const where = mentionRecipientsWhere({ restricted: true, isPrivate: false }, ["a", "b"], "p1");
  assert.deepEqual(where.id, { in: ["a", "b"] });
  assert.equal(where.active, true);
  assert.ok(where.OR);
});

test("proyecto público: sin condición de acceso extra", () => {
  const where = mentionRecipientsWhere({ restricted: false, isPrivate: false }, ["a"], "p1");
  assert.equal(where.OR, undefined);
});

const user = (role: "ADMIN" | "MEMBER") => ({ id: "u1", role }) as Parameters<typeof visibleProjectsWhere>[0];

test("visibilidad: un privado solo lo ven sus miembros, también siendo admin", () => {
  const member = { members: { some: { userId: "u1" } } };
  // Admin: todos los no privados, más los privados de los que es miembro.
  assert.deepEqual(visibleProjectsWhere(user("ADMIN")), { OR: [{ isPrivate: false }, member] });
  // Usuario normal: públicos no restringidos y aquellos en los que es miembro (privados incluidos).
  assert.deepEqual(visibleProjectsWhere(user("MEMBER")), { OR: [{ isPrivate: false, restricted: false }, member] });
});

test("logs: el detalle de un privado solo es visible para sus miembros", () => {
  assert.equal(isMaskedLog({ privateProjectId: null }, []), false);
  assert.equal(isMaskedLog({ privateProjectId: "p1" }, []), true);
  assert.equal(isMaskedLog({ privateProjectId: "p1" }, ["p2"]), true);
  assert.equal(isMaskedLog({ privateProjectId: "p1" }, ["p1", "p2"]), false);
  const f = { range: "24h", level: "error", category: "", userId: "", q: "", reads: true };
  const where = JSON.stringify(logWhere(f, ["p1"]));
  assert.ok(where.includes('"privateProjectId":null') && where.includes('"privateProjectId":{"in":["p1"]}'));
});
