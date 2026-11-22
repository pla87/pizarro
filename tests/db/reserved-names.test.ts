// Nombres reservados (imitan a Pizarro o a su administración, reserved-names.ts) al dar de alta, editar o cambiar el propio
// nombre, contra PostgreSQL real. Solo se valida al poner o cambiar un nombre: los que ya existen se pueden seguir guardando.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeUser } from "./helpers";
import { updateProfileName } from "../../src/actions/profile";

// El tope de usuarios se lee al cargar el módulo: los demás ficheros ya han creado muchos.
process.env.MAX_USERS = "100000";
const { createUser, inviteToProject, updateUser } = await import("../../src/actions/users");

const RESERVED = /reservado porque podría confundirse con un mensaje de Pizarro/;
const email = (tag: string) => `${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;

describe("nombres reservados", () => {
  test("alta de usuario: se rechazan «Pizarro», «Soporte técnico», «System»…; «Administrador» vale", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    for (const name of ["Pizarro", "soporte  TÉCNICO", "System", "Administración"]) {
      expectFail(await createUser({ name, email: email("r"), role: "MEMBER" }), RESERVED);
    }
    expectOk(await createUser({ name: "Administrador", email: email("admin"), role: "ADMIN" }));
    expectOk(await createUser({ name: "Ana Pizarro", email: email("ana"), role: "MEMBER" }));
  });

  test("editar a alguien: solo al cambiarle el nombre; el que ya tenía se conserva al cambiar otra cosa", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    // Un nombre de antes de la regla.
    const legacy = await makeUser({ name: "Soporte" });
    await loginAs(admin);
    const expected = { name: legacy.name, email: legacy.email, role: "MEMBER" as const, active: true };
    expectOk(await updateUser(legacy.id, { ...expected, role: "ADMIN", expected }));
    const other = await makeUser();
    const exp2 = { name: other.name, email: other.email, role: "MEMBER" as const, active: true };
    expectFail(await updateUser(other.id, { ...exp2, name: "Administrador del sistema", expected: exp2 }), RESERVED);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: other.id }, select: { name: true } })).name, other.name);
  });

  test("Mi perfil: no se puede cambiar el propio nombre a uno reservado; el que ya se tenía, sí se guarda", async () => {
    const me = await makeUser();
    await loginAs(me);
    expectFail(await updateProfileName("Pizarro"), RESERVED);
    expectOk(await updateProfileName("Ana Pérez"));
    const legacy = await makeUser({ name: "Sistema" });
    await loginAs(legacy);
    expectOk(await updateProfileName(" Sistema "));
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: legacy.id }, select: { name: true } })).name, "Sistema");
  });

  test("invitar por email a soporte@…: el nombre provisional es el email, no «Soporte»", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [admin] });
    await loginAs(admin);
    const to = "soporte@example.com";
    const res = expectOk(await inviteToProject(f.project.id, to));
    assert.equal(res.name, to);
  });
});
