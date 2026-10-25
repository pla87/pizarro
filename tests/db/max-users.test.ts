// Tope de usuarios activos (MAX_USERS) con altas y reactivaciones simultáneas, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, loginAs, makeUser } from "./helpers";

// El tope se lee al cargar el módulo: se fija justo por encima de los usuarios que ya hay antes de importarlo.
const admin = await makeUser({ role: "ADMIN" });
process.env.MAX_USERS = String((await db.user.count({ where: { active: true } })) + 1);
const { createUser, updateUser } = await import("../../src/actions/users");

describe("MAX_USERS", () => {
  test("dos altas a la vez con una sola plaza libre: solo entra una", async () => {
    await loginAs(admin);
    const tag = Date.now().toString(36);
    const results = await Promise.all(
      ["a", "b"].map((s) => createUser({ name: `Nueva ${s}`, email: `nueva-${s}-${tag}@example.com`, role: "MEMBER", password: "una-clave-larga-1" })),
    );
    assert.equal(results.filter((r) => r.ok).length, 1);
    const failed = results.find((r) => !r.ok) as { ok: false; error: string };
    assert.match(failed.error, /máximo de \d+ usuarios activos/);
    assert.equal(await db.user.count({ where: { active: true } }), Number(process.env.MAX_USERS));
  });

  test("reactivar a alguien con el tope lleno se rechaza", async () => {
    await loginAs(admin);
    const off = await makeUser({ active: false });
    const res = await updateUser(off.id, { name: off.name, email: off.email, role: "MEMBER", active: true });
    assert.equal(res.ok, false);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: off.id } })).active, false);
  });
});
