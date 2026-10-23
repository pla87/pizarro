// Plantillas de serie: sembrado único, recuperar y restablecer, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeUser } from "./helpers";
import { deleteTemplate, listTemplates, resetTemplate, restoreDefaultTemplates, saveTemplate } from "../../src/actions/templates";
import { BUILTIN_KEYS } from "../../src/lib/builtin-templates";
import { seedBuiltinTemplates } from "../../src/lib/template-store";

describe("plantillas de proyecto de serie", () => {
  test("se siembran una sola vez, se pueden recuperar y restablecer", async () => {
    await db.projectTemplate.deleteMany();
    await db.builtinTemplateSeeded.deleteMany();
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);

    assert.equal((await seedBuiltinTemplates(db)).length, BUILTIN_KEYS.length);
    assert.equal((await seedBuiltinTemplates(db)).length, 0);
    const list = expectOk(await listTemplates());
    const names = list.map((t) => t.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "es")));
    assert.ok(list.every((t) => t.builtinKey && !t.builtinModified));

    // Borrada: no vuelve al arrancar de nuevo, pero sí con «Recuperar».
    const negocio = list.find((t) => t.builtinKey === "negocio")!;
    expectOk(await deleteTemplate(negocio.id));
    assert.equal((await seedBuiltinTemplates(db)).length, 0);
    assert.equal(await db.projectTemplate.count({ where: { builtinKey: "negocio" } }), 0);
    assert.equal(expectOk(await restoreDefaultTemplates()).restored, 1);
    assert.equal(expectOk(await restoreDefaultTemplates()).restored, 0);

    // Editada: figura como modificada y «Restablecer» la devuelve a su contenido.
    const vibe = expectOk(await listTemplates()).find((t) => t.builtinKey === "vibecoding")!;
    expectOk(await saveTemplate({ ...vibe, name: "Mi vibecoding" }, vibe.id));
    const edited = expectOk(await listTemplates()).find((t) => t.id === vibe.id)!;
    assert.equal(edited.builtinModified, true);
    expectOk(await resetTemplate(vibe.id));
    const back = expectOk(await listTemplates()).find((t) => t.id === vibe.id)!;
    assert.equal(back.name, "Vibecoding");
    assert.equal(back.builtinModified, false);
  });
});
