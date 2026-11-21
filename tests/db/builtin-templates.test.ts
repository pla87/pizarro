// Plantillas de serie: sembrado único, recuperar y restablecer, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { createProject } from "../../src/actions/projects";
import { deleteTemplate, listTemplates, resetTemplate, restoreDefaultTemplates, saveTemplate } from "../../src/actions/templates";
import { applyTemplateChange } from "../../src/actions/template-apply";
import { BUILTIN_KEYS, canonicalTemplate } from "../../src/lib/builtin-templates";
import { canonicalTemplateEn } from "../../src/lib/builtin-templates-en";
import { resetRateLimit } from "../../src/lib/rate-limit";
import { listTemplatesSorted, seedBuiltinTemplates, templateFingerprint, upgradeBuiltinTemplates } from "../../src/lib/template-store";

describe("plantillas de proyecto de serie", () => {
  test("se siembran una sola vez, se pueden recuperar y restablecer", async () => {
    await db.projectTemplate.deleteMany();
    await db.builtinTemplateSeeded.deleteMany();
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);

    assert.equal((await seedBuiltinTemplates(db)).length, BUILTIN_KEYS.length);
    assert.equal((await seedBuiltinTemplates(db)).length, 0);
    // Al diálogo «Nuevo proyecto» solo van nombre y descripción, por orden alfabético; el resto se queda en el servidor.
    const offered = expectOk(await listTemplates());
    const names = offered.map((t) => t.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "es")));
    assert.ok(offered.every((t) => Object.keys(t).sort().join() === "description,id,name"));
    const list = await listTemplatesSorted(db);
    assert.deepEqual(list.map((t) => [t.id, t.name, t.description]), offered.map((t) => [t.id, t.name, t.description]));
    assert.ok(list.every((t) => t.builtinKey && !t.builtinModified));

    // Borrada: no vuelve al arrancar de nuevo, pero sí con «Recuperar».
    const negocio = list.find((t) => t.builtinKey === "negocio")!;
    expectOk(await deleteTemplate(negocio.id));
    assert.equal((await seedBuiltinTemplates(db)).length, 0);
    assert.equal(await db.projectTemplate.count({ where: { builtinKey: "negocio" } }), 0);
    assert.deepEqual(expectOk(await restoreDefaultTemplates()), { restored: 1, left: 0 });
    assert.deepEqual(expectOk(await restoreDefaultTemplates()), { restored: 0, left: 0 });

    // «Recuperar» no pasa del máximo de 50 plantillas (antes se lo saltaba): solo las que caben, y si no cabe ninguna, error.
    const three = BUILTIN_KEYS.slice(0, 3);
    await db.projectTemplate.deleteMany({ where: { builtinKey: { in: three } } });
    const own = 50 - 1 - (await db.projectTemplate.count());
    await db.projectTemplate.createMany({ data: Array.from({ length: own }, (_, i) => ({ name: `Propia ${i}`, columns: [{ name: "Por hacer" }], position: 100_000 + i })) });
    assert.deepEqual(expectOk(await restoreDefaultTemplates()), { restored: 1, left: 2 });
    assert.equal(await db.projectTemplate.count(), 50);
    expectFail(await restoreDefaultTemplates(), /Máximo 50 plantillas/);
    assert.equal(await db.projectTemplate.count(), 50);
    await db.projectTemplate.deleteMany({ where: { name: { startsWith: "Propia " } } });
    assert.deepEqual(expectOk(await restoreDefaultTemplates()), { restored: 2, left: 0 });

    // Editada: figura como modificada y «Restablecer» la devuelve a su contenido.
    const vibe = (await listTemplatesSorted(db)).find((t) => t.builtinKey === "vibecoding")!;
    expectOk(await saveTemplate({ ...vibe, name: "Mi vibecoding" }, vibe.id));
    const edited = (await listTemplatesSorted(db)).find((t) => t.id === vibe.id)!;
    assert.equal(edited.builtinModified, true);
    expectOk(await resetTemplate(vibe.id));
    const back = (await listTemplatesSorted(db)).find((t) => t.id === vibe.id)!;
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
    const list = await listTemplatesSorted(db);
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
  test("«Curso o máster» de la v1.53 sin tocar pasa sola a la nueva (Ejercicios y exámenes, Plan de trabajo para IA, sin Hecho)", async () => {
    await db.projectTemplate.deleteMany();
    await db.builtinTemplateSeeded.deleteMany();
    await seedBuiltinTemplates(db);
    const canon = canonicalTemplate("curso-master")!;
    // Lo que sembró la v1.53.0: otras columnas y otra descripción; el resto, igual.
    const v153 = {
      ...canon,
      description: "Preparar un curso o máster con ayuda de un agente de IA: programa por sesiones publicable en PDF, materiales, ejercicios, exámenes y seguimiento de alumnos.",
      columns: [
        { name: "Ideas", role: "NONE" as const, isDone: false }, { name: "Materiales", role: "NONE" as const, isDone: false },
        { name: "Ejercicios", role: "NONE" as const, isDone: false }, { name: "Exámenes", role: "NONE" as const, isDone: false },
        { name: "Programa", role: "PROGRAM" as const, isDone: false }, { name: "Seguimiento de alumnos", role: "NONE" as const, isDone: false },
        { name: "Hecho", role: "NONE" as const, isDone: true },
      ],
    };
    await db.projectTemplate.update({ where: { builtinKey: "curso-master" }, data: { description: v153.description, columns: v153.columns } });
    await db.builtinTemplateSeeded.update({ where: { key: "curso-master" }, data: { appliedHash: templateFingerprint(v153) } });
    assert.deepEqual(await upgradeBuiltinTemplates(db), ["curso-master"]);
    const row = await db.projectTemplate.findUniqueOrThrow({ where: { builtinKey: "curso-master" } });
    assert.deepEqual((row.columns as { name: string; role: string; isDone: boolean }[]).map((c) => [c.name, c.role, c.isDone]), [
      ["Ideas", "NONE", false], ["Materiales", "NONE", false], ["Ejercicios y exámenes", "NONE", false],
      ["Plan de trabajo para IA", "AI_PLAN", false], ["Programa", "PROGRAM", false], ["Seguimiento de alumnos", "NONE", false],
    ]);
    // Modificada por el administrador (otro nombre): se respeta.
    await db.projectTemplate.update({ where: { builtinKey: "curso-master" }, data: { name: "Mi máster", columns: v153.columns } });
    await db.builtinTemplateSeeded.update({ where: { key: "curso-master" }, data: { appliedHash: templateFingerprint(v153) } });
    assert.deepEqual(await upgradeBuiltinTemplates(db), []);
    assert.equal((await db.projectTemplate.findUniqueOrThrow({ where: { builtinKey: "curso-master" } })).name, "Mi máster");
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

    const mudanza = list.find((t) => t.name === "House move")!;
    const created = expectOk(await createProject("Move", { templateId: mudanza.id }));
    const cols = await db.column.findMany({ where: { projectId: created.id }, orderBy: { position: "asc" } });
    assert.deepEqual(cols.map((c) => c.name), ["To do", "This week", "Waiting", "Moving day", "Done"]);
    const kinds = await db.taskKind.findMany({ where: { projectId: created.id }, orderBy: { position: "asc" } });
    assert.equal(kinds[0]!.name, "Admin and change of address");
    assert.match(kinds[1]!.descriptionTemplate, /What is being packed/);
    assert.ok((await db.label.findMany({ where: { projectId: created.id } })).some((l) => l.name === "Kitchen"));

    // Modificada por el administrador: se ofrece y se aplica tal como está guardada.
    await db.projectTemplate.update({ where: { builtinKey: "viajes" }, data: { name: "Mis viajes" } });
    const viajes = (await listTemplatesSorted(db, "en")).find((t) => t.builtinKey === "viajes")!;
    assert.equal(viajes.name, "Mis viajes");
    assert.equal(viajes.columns[0]!.name, "Ideas");
    assert.equal(viajes.kinds[0]!.name, "Transporte");
    const trip = expectOk(await createProject("Trip", { templateId: viajes.id }));
    assert.equal((await db.taskKind.findMany({ where: { projectId: trip.id }, orderBy: { position: "asc" } }))[0]!.name, "Transporte");
  });
  test("cada plantilla de serie crea su proyecto sin errores en los dos idiomas, y se puede aplicar a uno con tareas", async () => {
    await db.projectTemplate.deleteMany();
    await db.builtinTemplateSeeded.deleteMany();
    await seedBuiltinTemplates(db);
    const rows = await db.projectTemplate.findMany({ where: { builtinKey: { not: null } }, select: { id: true, builtinKey: true } });
    assert.equal(rows.length, BUILTIN_KEYS.length);
    for (const locale of ["ES", "EN"] as const) {
      const admin = await makeUser({ role: "ADMIN" });
      await db.user.update({ where: { id: admin.id }, data: { locale } });
      await loginAs(admin);
      for (const { id, builtinKey } of rows) {
        const canon = locale === "EN" ? canonicalTemplateEn(builtinKey!)! : canonicalTemplate(builtinKey!)!;
        const at = `${builtinKey} (${locale})`;
        resetRateLimit(`project-create:${admin.id}`); // 10 proyectos por hora y persona
        const created = expectOk(await createProject(`P ${builtinKey} ${locale}`, { templateId: id }));
        const cols = await db.column.findMany({ where: { projectId: created.id }, orderBy: { position: "asc" } });
        assert.deepEqual(cols.map((c) => [c.name, c.role, c.isDone]), canon.columns.map((c) => [c.name, c.role, c.isDone]), at);
        const kinds = await db.taskKind.findMany({ where: { projectId: created.id }, orderBy: { position: "asc" } });
        assert.deepEqual(kinds.map((k) => [k.name, k.subtaskTemplate]), canon.kinds.map((k) => [k.name, k.subtaskTemplate]), at);
        const labels = await db.label.findMany({ where: { projectId: created.id } });
        assert.deepEqual(labels.map((l) => l.name).sort(), canon.labels.map((l) => l.name).sort(), at);
        const project = await db.project.findUniqueOrThrow({ where: { id: created.id }, select: { taskFields: true, description: true } });
        assert.deepEqual([...project.taskFields].sort(), [...canon.taskFields].sort(), at);
        // El proyecto toma la descripción de la plantilla (en su idioma).
        assert.equal(project.description, canon.description.trim(), `${at}: descripción`);
        if (canon.columns.some((c) => c.role === "BUDGET")) assert.ok(project.taskFields.includes("cost"), `${at}: coste`);
      }
      // «Aplicar plantilla» a un proyecto existente con tareas: añadir lo que falte y cambiar a la plantilla (con la
      // sugerencia de emparejamiento) funcionan con todas, y ninguna tarea se pierde.
      for (const { id, builtinKey } of rows) {
        const f = await makeProject({ members: [admin] });
        await makeTask(f, { title: "A", columnId: f.columns.todo });
        await makeTask(f, { title: "B", columnId: f.columns.done });
        const ref = { source: "template" as const, id };
        resetRateLimit(`template-change:user:${admin.id}`); // 20 cambios por hora y persona
        expectOk(await applyTemplateChange(f.project.id, ref, "ADD"));
        expectOk(await applyTemplateChange(f.project.id, ref, "REPLACE"));
        assert.equal(await db.task.count({ where: { projectId: f.project.id } }), 2, `${builtinKey} (${locale}): tareas`);
      }
    }
  });

  test("las de serie de la v1.60 sin tocar pasan solas a la revisión con roles; una editada se respeta", async () => {
    await db.projectTemplate.deleteMany();
    await db.builtinTemplateSeeded.deleteMany();
    await seedBuiltinTemplates(db);
    // Lo que sembró la v1.60.0 para «Mudanza» y «Viajes» (columnas sin roles, otras etiquetas, sin campos).
    const plain = (names: string[], done: string) => names.map((name) => ({ name, role: "NONE" as const, isDone: name === done }));
    const old = {
      mudanza: { ...canonicalTemplate("mudanza")!, columns: plain(["Por hacer", "Esta semana", "Esperando", "Hecho"], "Hecho"), kinds: canonicalTemplate("mudanza")!.kinds.slice(0, 6) },
      viajes: { ...canonicalTemplate("viajes")!, columns: plain(["Ideas", "Por reservar", "Reservado", "Antes de salir", "Durante el viaje", "Hecho"], "Hecho"), taskFields: [] },
    };
    for (const [key, data] of Object.entries(old)) {
      await db.projectTemplate.update({ where: { builtinKey: key }, data: { columns: data.columns, kinds: data.kinds, taskFields: data.taskFields } });
      await db.builtinTemplateSeeded.update({ where: { key }, data: { appliedHash: templateFingerprint(data) } });
    }
    // El administrador había cambiado «Viajes»: se queda como estaba.
    await db.projectTemplate.update({ where: { builtinKey: "viajes" }, data: { name: "Nuestros viajes" } });
    assert.deepEqual(await upgradeBuiltinTemplates(db), ["mudanza"]);
    const mudanza = await db.projectTemplate.findUniqueOrThrow({ where: { builtinKey: "mudanza" } });
    assert.deepEqual((mudanza.columns as { role: string }[]).map((c) => c.role), ["NONE", "WEEKLY_PLAN", "WAITING", "CHECKLIST", "NONE"]);
    const viajes = await db.projectTemplate.findUniqueOrThrow({ where: { builtinKey: "viajes" } });
    assert.equal(viajes.name, "Nuestros viajes");
    assert.ok((viajes.columns as { role: string }[]).every((c) => c.role === "NONE"));
    assert.deepEqual(viajes.taskFields, []);
    assert.deepEqual(await upgradeBuiltinTemplates(db), []);
  });
});
