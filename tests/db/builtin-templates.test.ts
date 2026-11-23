// Plantillas de serie: sembrado único, recuperar y restablecer, contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { createProject } from "../../src/actions/projects";
import { deleteTemplate, resetTemplate, restoreDefaultTemplates, saveTemplate } from "../../src/actions/templates";
import { applyTemplateChange } from "../../src/actions/template-apply";
import { BUILTIN_KEYS, canonicalTemplate } from "../../src/lib/builtin-templates";
import { canonicalTemplateEn } from "../../src/lib/builtin-templates-en";
import { resetRateLimit } from "../../src/lib/rate-limit";
import { listStartTemplates, listTemplatesSorted, retireBuiltinTemplates, seedBuiltinTemplates, templateFingerprint, upgradeBuiltinTemplates } from "../../src/lib/template-store";
import type { TemplateData } from "../../src/lib/project-templates";

describe("plantillas de proyecto de serie", () => {
  test("se siembran una sola vez, se pueden recuperar y restablecer", async () => {
    await db.projectTemplate.deleteMany();
    await db.builtinTemplateSeeded.deleteMany();
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);

    assert.equal((await seedBuiltinTemplates(db)).length, BUILTIN_KEYS.length);
    assert.equal((await seedBuiltinTemplates(db)).length, 0);
    // Al diálogo «Nuevo proyecto» (listStartTemplates, la de la app) solo van nombre, descripción y dos marcas, por orden
    // alfabético; columnas, tipos y textos de release se quedan en el servidor.
    const offered = await listStartTemplates(db, "es");
    const names = offered.map((t) => t.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "es")));
    assert.ok(offered.every((t) => Object.keys(t).sort().join() === "builtin,description,examples,id,name"));
    const list = await listTemplatesSorted(db);
    assert.deepEqual(list.map((t) => [t.id, t.name, t.description]), offered.map((t) => [t.id, t.name, t.description]));
    assert.ok(list.every((t) => t.builtinKey && !t.builtinModified));

    // Borrada: no vuelve al arrancar de nuevo, pero sí con «Recuperar».
    const work = list.find((t) => t.builtinKey === "trabajo-clientes")!;
    expectOk(await deleteTemplate(work.id));
    assert.equal((await seedBuiltinTemplates(db)).length, 0);
    assert.equal(await db.projectTemplate.count({ where: { builtinKey: "trabajo-clientes" } }), 0);
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
    await db.projectTemplate.update({ where: { builtinKey: "eventos-viajes" }, data: { name: "Mis eventos" } });

    const upgraded = await upgradeBuiltinTemplates(db);
    assert.equal(upgraded.includes("eventos-viajes"), false);
    assert.equal(upgraded.includes("trabajo-clientes"), true);
    assert.equal(upgraded.includes("vibecoding"), false); // ya coincidía con la canónica
    assert.equal((await db.projectTemplate.findUniqueOrThrow({ where: { builtinKey: "trabajo-clientes" } })).hideAllGeneralKinds, true);
    const eventos = await db.projectTemplate.findUniqueOrThrow({ where: { builtinKey: "eventos-viajes" } });
    assert.equal(eventos.name, "Mis eventos");
    assert.equal(eventos.hideAllGeneralKinds, false);

    // Idempotente, y la modificada sigue figurando como tal.
    assert.deepEqual(await upgradeBuiltinTemplates(db), []);
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const list = await listTemplatesSorted(db);
    assert.equal(list.find((t) => t.builtinKey === "eventos-viajes")!.builtinModified, true);
    assert.equal(list.find((t) => t.builtinKey === "trabajo-clientes")!.builtinModified, false);

    // Cambio canónico futuro: con huella guardada también se actualiza solo lo no tocado.
    const neg = await db.builtinTemplateSeeded.findUniqueOrThrow({ where: { key: "trabajo-clientes" } });
    assert.equal(neg.appliedHash, templateFingerprint(canonicalTemplate("trabajo-clientes")!));
    await db.builtinTemplateSeeded.update({ where: { key: "trabajo-clientes" }, data: { appliedHash: "huella-de-la-version-anterior" } });
    await db.projectTemplate.update({ where: { builtinKey: "trabajo-clientes" }, data: { description: "otra" } });
    assert.deepEqual(await upgradeBuiltinTemplates(db), []);

    // «Restablecer» deja la huella al día.
    expectOk(await resetTemplate(eventos.id));
    assert.equal((await db.builtinTemplateSeeded.findUniqueOrThrow({ where: { key: "eventos-viajes" } })).appliedHash, templateFingerprint(canonicalTemplate("eventos-viajes")!));
  });
  test("«Curso o máster» y «Estudios o tesis» sin tocar pasan solas a «Curso o charla» y «Estudios y aprendizaje»; modificadas, se respetan", async () => {
    await db.projectTemplate.deleteMany();
    await db.builtinTemplateSeeded.deleteMany();
    await seedBuiltinTemplates(db);
    const canon = canonicalTemplate("curso-master")!;
    // Lo que sembró la v1.53.0: otras columnas, otro nombre y otra descripción; el resto, igual.
    const v153 = {
      ...canon,
      name: "Curso o máster",
      description: "Preparar un curso o máster con ayuda de un agente de IA: programa por sesiones publicable en PDF, materiales, ejercicios, exámenes y seguimiento de alumnos.",
      columns: [
        { name: "Ideas", role: "NONE" as const, isDone: false }, { name: "Materiales", role: "NONE" as const, isDone: false },
        { name: "Ejercicios", role: "NONE" as const, isDone: false }, { name: "Exámenes", role: "NONE" as const, isDone: false },
        { name: "Programa", role: "PROGRAM" as const, isDone: false }, { name: "Seguimiento de alumnos", role: "NONE" as const, isDone: false },
        { name: "Hecho", role: "NONE" as const, isDone: true },
      ],
    };
    // «Estudios o tesis» como la dejó la versión anterior (aquí basta con otro nombre y otras columnas).
    const thesis: TemplateData = {
      ...canonicalTemplate("estudios-tesis")!,
      name: "Estudios o tesis",
      columns: [{ name: "Pendiente", role: "NONE", isDone: false }, { name: "Entregado", role: "NONE", isDone: true }],
    };
    for (const [key, old] of [["curso-master", v153], ["estudios-tesis", thesis]] as const) {
      await db.projectTemplate.update({ where: { builtinKey: key }, data: { name: old.name, description: old.description, columns: old.columns } });
      await db.builtinTemplateSeeded.update({ where: { key }, data: { appliedHash: templateFingerprint(old) } });
    }
    assert.deepEqual((await upgradeBuiltinTemplates(db)).sort(), ["curso-master", "estudios-tesis"]);
    const row = await db.projectTemplate.findUniqueOrThrow({ where: { builtinKey: "curso-master" } });
    assert.equal(row.name, "Curso o charla");
    assert.deepEqual((row.columns as { name: string; role: string; isDone: boolean }[]).map((c) => [c.name, c.role, c.isDone]), [
      ["Ideas", "NONE", false], ["Materiales", "NONE", false], ["Ejercicios y exámenes", "NONE", false],
      ["Plan de trabajo para IA", "AI_PLAN", false], ["Programa", "PROGRAM", false], ["Seguimiento de alumnos", "NONE", false],
      ["Publicado", "NONE", true],
    ]);
    assert.equal((await db.projectTemplate.findUniqueOrThrow({ where: { builtinKey: "estudios-tesis" } })).name, "Estudios y aprendizaje");
    // Modificada por el administrador (otro nombre): se respeta.
    await db.projectTemplate.update({ where: { builtinKey: "curso-master" }, data: { name: "Mi máster", columns: v153.columns } });
    await db.builtinTemplateSeeded.update({ where: { key: "curso-master" }, data: { appliedHash: templateFingerprint(v153) } });
    assert.deepEqual(await upgradeBuiltinTemplates(db), []);
    assert.equal((await db.projectTemplate.findUniqueOrThrow({ where: { builtinKey: "curso-master" } })).name, "Mi máster");
  });

  test("«Cita» de «Casa y familia» deja el rojo (queda para lo vencido): sin tocar se actualiza sola; modificada, se respeta", async () => {
    await db.projectTemplate.deleteMany();
    await db.builtinTemplateSeeded.deleteMany();
    await seedBuiltinTemplates(db);
    const key = "casa-familia";
    const canon = canonicalTemplate(key)!;
    const cita = canon.kinds.find((k) => k.name === "Cita")!;
    assert.notEqual(cita.color, "#ef4444");
    assert.equal(canonicalTemplateEn(key)!.kinds.find((k) => k.name === "Appointment")!.color, cita.color, "la misma en inglés");
    // Lo que sembraron las versiones anteriores: «Cita» en rojo.
    const old: TemplateData = { ...canon, kinds: canon.kinds.map((k) => (k.name === "Cita" ? { ...k, color: "#ef4444" } : k)) };
    await db.projectTemplate.update({ where: { builtinKey: key }, data: { kinds: old.kinds } });
    await db.builtinTemplateSeeded.update({ where: { key }, data: { appliedHash: templateFingerprint(old) } });
    assert.deepEqual(await upgradeBuiltinTemplates(db), [key]);
    const kinds = (await db.projectTemplate.findUniqueOrThrow({ where: { builtinKey: key } })).kinds as { name: string; color: string }[];
    assert.equal(kinds.find((k) => k.name === "Cita")!.color, cita.color);
    // Modificada por el administrador (la «Cita» roja y otro nombre): no se toca.
    await db.projectTemplate.update({ where: { builtinKey: key }, data: { name: "Mi casa", kinds: old.kinds } });
    await db.builtinTemplateSeeded.update({ where: { key }, data: { appliedHash: templateFingerprint(old) } });
    assert.deepEqual(await upgradeBuiltinTemplates(db), []);
    const kept = await db.projectTemplate.findUniqueOrThrow({ where: { builtinKey: key } });
    assert.equal(kept.name, "Mi casa");
    assert.equal((kept.kinds as { name: string; color: string }[]).find((k) => k.name === "Cita")!.color, "#ef4444");
  });
  test("usuario en inglés: plantillas de serie sin tocar en inglés, en el listado y al crear el proyecto; modificadas, tal cual", async () => {
    await db.projectTemplate.deleteMany();
    await db.builtinTemplateSeeded.deleteMany();
    await seedBuiltinTemplates(db);
    const admin = await makeUser({ role: "ADMIN" });
    await db.user.update({ where: { id: admin.id }, data: { locale: "EN" } });
    await loginAs(admin);

    const list = await listStartTemplates(db, "en");
    assert.ok(list.some((t) => t.name === "Home and family"));
    assert.ok(!list.some((t) => t.name === "Casa y familia"));

    const home = list.find((t) => t.name === "Home and family")!;
    const created = expectOk(await createProject("Home", { templateId: home.id }));
    const cols = await db.column.findMany({ where: { projectId: created.id }, orderBy: { position: "asc" } });
    assert.deepEqual(cols.map((c) => c.name), ["To do", "This week", "Waiting", "Shopping list", "Appointments", "Routines", "Done"]);
    const kinds = await db.taskKind.findMany({ where: { projectId: created.id }, orderBy: { position: "asc" } });
    assert.equal(kinds[0]!.name, "Shopping");
    assert.match(kinds[1]!.descriptionTemplate, /What needs doing/);
    assert.ok((await db.label.findMany({ where: { projectId: created.id } })).some((l) => l.name === "Person 1"));

    // Modificada por el administrador: se ofrece y se aplica tal como está guardada.
    await db.projectTemplate.update({ where: { builtinKey: "eventos-viajes" }, data: { name: "Mis viajes" } });
    const viajes = (await listTemplatesSorted(db, "en")).find((t) => t.builtinKey === "eventos-viajes")!;
    assert.equal(viajes.name, "Mis viajes");
    assert.equal(viajes.columns[0]!.name, "Ideas");
    assert.equal(viajes.kinds[0]!.name, "Lugar o alojamiento");
    const trip = expectOk(await createProject("Trip", { templateId: viajes.id }));
    assert.equal((await db.taskKind.findMany({ where: { projectId: trip.id }, orderBy: { position: "asc" } }))[0]!.name, "Lugar o alojamiento");
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

  test("al actualizar: las de serie retiradas sin modificar desaparecen, las modificadas quedan como propias y llegan las nuevas", async () => {
    await db.projectTemplate.deleteMany();
    await db.builtinTemplateSeeded.deleteMany();
    // Una instalación de antes: «Vibecoding» al día y tres de las retiradas (con su huella guardada, como las sembró).
    const vibe = canonicalTemplate("vibecoding")!;
    const old = (name: string): TemplateData => ({ ...vibe, name, columns: [{ name: "Por hacer", role: "NONE", isDone: false }, { name: "Hecho", role: "NONE", isDone: true }], kinds: [] });
    const rows: [string, TemplateData, string | null][] = [
      ["vibecoding", vibe, templateFingerprint(vibe)],
      ["negocio", old("Negocio"), templateFingerprint(old("Negocio"))], // sin tocar: se borra
      ["viajes", old("Nuestros viajes"), templateFingerprint(old("Viajes"))], // renombrada por el administrador: se queda
      ["mudanza", old("Mudanza"), null], // sin huella y distinta de su última definición: se queda (no se pierde nada)
    ];
    for (const [i, [key, data, appliedHash]] of rows.entries()) {
      await db.projectTemplate.create({
        data: {
          builtinKey: key, name: data.name, description: data.description, columns: data.columns, kinds: data.kinds, hiddenGeneralKinds: data.hiddenGeneralKinds,
          hideAllGeneralKinds: data.hideAllGeneralKinds, labels: data.labels, taskFields: data.taskFields, releaseTemplates: data.releaseTemplates, position: i + 1,
        },
      });
      await db.builtinTemplateSeeded.create({ data: { key, appliedHash } });
    }
    // Un proyecto creado antes con «Negocio» no cambia.
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const negocioId = (await db.projectTemplate.findUniqueOrThrow({ where: { builtinKey: "negocio" } })).id;
    const before = expectOk(await createProject("De antes", { templateId: negocioId }));

    // Lo que hace el arranque: retirar, sembrar y poner al día.
    assert.deepEqual(await retireBuiltinTemplates(db), { removed: ["negocio"], kept: ["viajes", "mudanza"] });
    assert.deepEqual((await seedBuiltinTemplates(db)).sort(), BUILTIN_KEYS.filter((k) => k !== "vibecoding").sort());
    await upgradeBuiltinTemplates(db);
    const list = await listTemplatesSorted(db);
    assert.deepEqual(list.filter((t) => t.builtinKey).map((t) => t.builtinKey).sort(), [...BUILTIN_KEYS].sort());
    assert.deepEqual(list.filter((t) => !t.builtinKey).map((t) => t.name).sort(), ["Mudanza", "Nuestros viajes"]);
    // Sus registros de siembra se quedan como lápida: la versión anterior, si se vuelve a ella, no las recrea.
    assert.equal(await db.builtinTemplateSeeded.count({ where: { key: { in: ["negocio", "viajes", "mudanza"] } } }), 3);
    assert.deepEqual((await db.column.findMany({ where: { projectId: before.id }, orderBy: { position: "asc" } })).map((c) => c.name), ["Por hacer", "Hecho"]);
    // Idempotente: el siguiente arranque no toca nada.
    assert.deepEqual(await retireBuiltinTemplates(db), { removed: [], kept: [] });
    assert.deepEqual(await seedBuiltinTemplates(db), []);
    assert.deepEqual(await upgradeBuiltinTemplates(db), []);
    assert.deepEqual(list.map((t) => t.id).sort(), (await listTemplatesSorted(db)).map((t) => t.id).sort());
    // «Recuperar plantillas de serie» recrea las seis si se borran.
    await db.projectTemplate.deleteMany({ where: { builtinKey: { not: null } } });
    assert.deepEqual(expectOk(await restoreDefaultTemplates()), { restored: BUILTIN_KEYS.length, left: 0 });
  });

  test("dos arranques a la vez: cada plantilla retirada la retira uno solo y ninguno falla (antes, P2025 en el segundo)", async () => {
    await db.projectTemplate.deleteMany();
    await db.builtinTemplateSeeded.deleteMany();
    const vibe = canonicalTemplate("vibecoding")!;
    const old = (name: string): TemplateData => ({ ...vibe, name, columns: [{ name: "Por hacer", role: "NONE", isDone: false }, { name: "Hecho", role: "NONE", isDone: true }], kinds: [] });
    const rows: [string, TemplateData, string][] = [
      ["negocio", old("Negocio"), templateFingerprint(old("Negocio"))], // sin tocar: se borra
      ["viajes", old("Nuestros viajes"), templateFingerprint(old("Viajes"))], // modificada: se queda como propia
    ];
    for (const [i, [key, data, appliedHash]] of rows.entries()) {
      await db.projectTemplate.create({
        data: {
          builtinKey: key, name: data.name, description: data.description, columns: data.columns, kinds: data.kinds, hiddenGeneralKinds: data.hiddenGeneralKinds,
          hideAllGeneralKinds: data.hideAllGeneralKinds, labels: data.labels, taskFields: data.taskFields, releaseTemplates: data.releaseTemplates, position: i + 1,
        },
      });
      await db.builtinTemplateSeeded.create({ data: { key, appliedHash } });
    }
    // El otro arranque llega justo después de que este lea las plantillas y las retira antes que él.
    const bind = <T extends object>(o: T, p: string | symbol) => {
      const v = Reflect.get(o, p);
      return typeof v === "function" ? v.bind(o) : v;
    };
    let other: Awaited<ReturnType<typeof retireBuiltinTemplates>> | null = null;
    const racing = new Proxy(db, {
      get(target, prop) {
        if (prop !== "projectTemplate") return bind(target, prop);
        return new Proxy(target.projectTemplate, {
          get(delegate, p) {
            if (p !== "findMany") return bind(delegate, p);
            return async (args: Parameters<typeof db.projectTemplate.findMany>[0]) => {
              const found = await db.projectTemplate.findMany(args);
              other ??= await retireBuiltinTemplates(db);
              return found;
            };
          },
        });
      },
    });
    const late = await retireBuiltinTemplates(racing);
    assert.deepEqual(other, { removed: ["negocio"], kept: ["viajes"] });
    assert.deepEqual(late, { removed: [], kept: [] });
    assert.deepEqual((await db.projectTemplate.findMany({ select: { name: true, builtinKey: true } })), [{ name: "Nuestros viajes", builtinKey: null }]);
  });
});
