// Plantillas de serie: sembrado único, recuperar y restablecer, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeUser } from "./helpers";
import { createProject } from "../../src/actions/projects";
import { deleteTemplate, listTemplates, resetTemplate, restoreDefaultTemplates, saveTemplate } from "../../src/actions/templates";
import { BUILTIN_KEYS, canonicalTemplate } from "../../src/lib/builtin-templates";
import { seedBuiltinTemplates, templateFingerprint, upgradeBuiltinTemplates } from "../../src/lib/template-store";

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

  test("las de serie sin tocar se actualizan solas a la nueva definición; las modificadas se respetan", async () => {
    await db.projectTemplate.deleteMany();
    await db.builtinTemplateSeeded.deleteMany();
    await seedBuiltinTemplates(db);
    // Instalación anterior: sin la opción nueva y sin huella guardada.
    await db.projectTemplate.updateMany({ where: { builtinKey: { not: null } }, data: { hideAllGeneralKinds: false } });
    await db.builtinTemplateSeeded.updateMany({ data: { appliedHash: null } });
    // El administrador cambió el nombre de una.
    await db.projectTemplate.update({ where: { builtinKey: "eventos" }, data: { name: "Mis eventos" } });

    const upgraded = await upgradeBuiltinTemplates(db);
    assert.equal(upgraded.includes("eventos"), false);
    assert.equal(upgraded.includes("negocio"), true);
    assert.equal(upgraded.includes("vibecoding"), false); // ya coincidía con la canónica
    assert.equal((await db.projectTemplate.findUniqueOrThrow({ where: { builtinKey: "negocio" } })).hideAllGeneralKinds, true);
    const eventos = await db.projectTemplate.findUniqueOrThrow({ where: { builtinKey: "eventos" } });
    assert.equal(eventos.name, "Mis eventos");
    assert.equal(eventos.hideAllGeneralKinds, false);

    // Idempotente, y la modificada sigue figurando como tal.
    assert.deepEqual(await upgradeBuiltinTemplates(db), []);
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const list = expectOk(await listTemplates());
    assert.equal(list.find((t) => t.builtinKey === "eventos")!.builtinModified, true);
    assert.equal(list.find((t) => t.builtinKey === "negocio")!.builtinModified, false);

    // Cambio canónico futuro: con huella guardada también se actualiza solo lo no tocado.
    const neg = await db.builtinTemplateSeeded.findUniqueOrThrow({ where: { key: "negocio" } });
    assert.equal(neg.appliedHash, templateFingerprint(canonicalTemplate("negocio")!));
    await db.builtinTemplateSeeded.update({ where: { key: "negocio" }, data: { appliedHash: "huella-de-la-version-anterior" } });
    await db.projectTemplate.update({ where: { builtinKey: "negocio" }, data: { description: "otra" } });
    assert.deepEqual(await upgradeBuiltinTemplates(db), []);

    // «Restablecer» deja la huella al día.
    expectOk(await resetTemplate(eventos.id));
    assert.equal((await db.builtinTemplateSeeded.findUniqueOrThrow({ where: { key: "eventos" } })).appliedHash, templateFingerprint(canonicalTemplate("eventos")!));
  });
  test("usuario en inglés: plantillas de serie sin tocar en inglés, en el listado y al crear el proyecto; modificadas, tal cual", async () => {
    await db.projectTemplate.deleteMany();
    await db.builtinTemplateSeeded.deleteMany();
    await seedBuiltinTemplates(db);
    const admin = await makeUser({ role: "ADMIN" });
    await db.user.update({ where: { id: admin.id }, data: { locale: "EN" } });
    await loginAs(admin);

    const list = expectOk(await listTemplates());
    assert.ok(list.some((t) => t.name === "House move"));
    assert.ok(!list.some((t) => t.name === "Mudanza"));

    const mudanza = list.find((t) => t.builtinKey === "mudanza")!;
    const created = expectOk(await createProject("Move", { templateId: mudanza.id }));
    const cols = await db.column.findMany({ where: { projectId: created.id }, orderBy: { position: "asc" } });
    assert.deepEqual(cols.map((c) => c.name), ["To do", "This week", "Waiting", "Done"]);
    const kinds = await db.taskKind.findMany({ where: { projectId: created.id }, orderBy: { position: "asc" } });
    assert.equal(kinds[0]!.name, "Admin and change of address");
    assert.match(kinds[1]!.descriptionTemplate, /What is being packed/);
    assert.ok((await db.label.findMany({ where: { projectId: created.id } })).some((l) => l.name === "Kitchen"));

    // Modificada por el administrador: se ofrece y se aplica tal como está guardada.
    await db.projectTemplate.update({ where: { builtinKey: "viajes" }, data: { name: "Mis viajes" } });
    const viajes = expectOk(await listTemplates()).find((t) => t.builtinKey === "viajes")!;
    assert.equal(viajes.name, "Mis viajes");
    assert.equal(viajes.columns[0]!.name, "Ideas");
    assert.equal(viajes.kinds[0]!.name, "Transporte");
    const trip = expectOk(await createProject("Trip", { templateId: viajes.id }));
    assert.equal((await db.taskKind.findMany({ where: { projectId: trip.id }, orderBy: { position: "asc" } }))[0]!.name, "Transporte");
  });
});
