// Texto inicial de la descripción de un tipo: mismo límite que la descripción de una tarea (20 000), sin cortes silenciosos.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { expectFail, expectOk, loginAs, makeProject, makeUser } from "./helpers";
import { createKind, updateKind } from "../../src/actions/kinds";
import { MAX_DESCRIPTION } from "../../src/lib/constants";

describe("tipos de tarea: texto inicial largo", () => {
  test("admite hasta el límite de la descripción y rechaza lo que lo supera", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    const long = "# Prompt\n" + "x".repeat(MAX_DESCRIPTION - 9);
    assert.equal(long.length, MAX_DESCRIPTION);
    const k = expectOk(await createKind({ name: "Largo", color: "#6366f1", descriptionTemplate: long }, f.project.id));
    assert.equal(k.descriptionTemplate.length, MAX_DESCRIPTION);
    expectFail(await updateKind(k.id, { name: "Largo", color: "#6366f1", descriptionTemplate: long + "y" }), /demasiado larga/);
  });
});
