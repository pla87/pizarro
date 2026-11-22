// Sin MAX_USERS no hay tope de usuarios activos: altas, invitaciones y reactivaciones pasan de los 10 de antes. Con la
// variable, el tope y sus carreras se prueban en tests/db/max-users.test.ts (otro proceso: el tope se lee al cargar).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, loginAs, makeProject, makeUser } from "./helpers";

delete process.env.MAX_USERS;
const { MAX_USERS, MAX_USERS_SOURCE } = await import("../../src/lib/limits");
const { createUser, inviteToProject, updateUser } = await import("../../src/actions/users");

describe("sin MAX_USERS", () => {
  test("no hay tope: con más de 10 activos se puede dar de alta, invitar y reactivar", async () => {
    assert.equal(MAX_USERS, null);
    assert.equal(MAX_USERS_SOURCE, "default");
    const admin = await makeUser({ role: "ADMIN" });
    // Más de los 10 que había por defecto.
    for (let i = (await db.user.count({ where: { active: true } })); i < 12; i++) await makeUser();
    await loginAs(admin);
    const tag = Date.now().toString(36);
    const created = await createUser({ name: "Alta sin tope", email: `alta-${tag}@example.com`, role: "MEMBER", password: "una-clave-larga-1" });
    assert.equal(created.ok, true, JSON.stringify(created));
    const f = await makeProject({ members: [] });
    const email = `invitada-${tag}@example.com`;
    const invited = await inviteToProject(f.project.id, email);
    assert.equal(invited.ok, true, JSON.stringify(invited));
    assert.equal(await db.user.count({ where: { email, active: true } }), 1);
    const off = await makeUser({ active: false });
    const back = await updateUser(off.id, { name: off.name, email: off.email, role: "MEMBER", active: true, expected: { name: off.name, email: off.email, role: "MEMBER", active: false } });
    assert.equal(back.ok, true, JSON.stringify(back));
    assert.ok((await db.user.count({ where: { active: true } })) > 12);
  });
});
