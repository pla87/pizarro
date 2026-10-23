import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SESSION_SECRET = "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const { mentionRecipientsWhere } = await import("../src/lib/notify");
const { visibleProjectsWhere, workingProjectsWhere } = await import("../src/lib/access");
const { sharePermissionBodies } = await import("../src/lib/google");
const { isMaskedLog, logWhere } = await import("../src/lib/log-query");

test("proyecto privado: solo avisa a sus miembros (nunca a admins ajenos)", () => {
  const where = mentionRecipientsWhere({ isPrivate: true }, ["a", "b"], "p1");
  assert.deepEqual(where.id, { in: ["a", "b"] });
  assert.equal(where.active, true);
  assert.deepEqual(where.memberships, { some: { projectId: "p1" } });
  assert.equal(where.OR, undefined);
});

test("proyecto de equipo: admins o miembros asignados", () => {
  const where = mentionRecipientsWhere({ isPrivate: false }, ["a", "b"], "p1");
  assert.deepEqual(where.id, { in: ["a", "b"] });
  assert.equal(where.active, true);
  assert.deepEqual(where.OR, [{ role: "ADMIN" }, { memberships: { some: { projectId: "p1" } } }]);
});

const user = (role: "ADMIN" | "MEMBER") => ({ id: "u1", role }) as Parameters<typeof visibleProjectsWhere>[0];

test("visibilidad: un privado solo lo ven sus miembros, también siendo admin", () => {
  const member = { members: { some: { userId: "u1" } } };
  // Admin: todos los no privados, más los privados de los que es miembro.
  assert.deepEqual(visibleProjectsWhere(user("ADMIN")), { OR: [{ isPrivate: false }, member] });
  // Usuario normal: solo aquellos en los que está asignado (privados o de equipo).
  assert.deepEqual(visibleProjectsWhere(user("MEMBER")), member);
});

test("proyectos de trabajo: el admin solo ve los de equipo que ha elegido y sus privados", () => {
  assert.deepEqual(workingProjectsWhere(user("ADMIN")), {
    OR: [{ isPrivate: false, adminPicks: { some: { userId: "u1" } } }, { members: { some: { userId: "u1" } } }],
  });
  assert.deepEqual(workingProjectsWhere(user("MEMBER")), visibleProjectsWhere(user("MEMBER")));
});

test("Drive: los proyectos privados se comparten solo con los emails de sus miembros", () => {
  const env = { domain: "empresa.com", role: "writer" };
  assert.deepEqual(sharePermissionBodies({ type: "domain" }, env), [{ type: "domain", domain: "empresa.com", role: "writer" }]);
  assert.deepEqual(sharePermissionBodies({ type: "users", emails: ["A@x.com", "a@x.com", "b@x.com"] }, env), [
    { type: "user", emailAddress: "a@x.com", role: "writer" },
    { type: "user", emailAddress: "b@x.com", role: "writer" },
  ]);
  assert.deepEqual(sharePermissionBodies({ type: "users", emails: ["a@x.com"] }, { role: "none" }), []);
  assert.deepEqual(sharePermissionBodies({ type: "domain" }, { role: "reader" }), []);
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
