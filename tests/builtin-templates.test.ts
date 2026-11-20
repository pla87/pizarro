import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_KEYS, BUILTIN_TEMPLATES, canonicalTemplate, isBuiltinModified } from "../src/lib/builtin-templates";
import { canonicalTemplateEn } from "../src/lib/builtin-templates-en";
import { COLUMN_ROLES, UNIQUE_COLUMN_ROLES } from "../src/lib/constants";
import { buildTemplateApplication, sortTemplates, templateInputSchema } from "../src/lib/project-templates";

test("cada plantilla de serie pasa la misma validación que las de los usuarios", () => {
  assert.equal(BUILTIN_TEMPLATES.length, 15);
  for (const b of BUILTIN_TEMPLATES) {
    const r = templateInputSchema.safeParse(b.data);
    assert.equal(r.success, true, `${b.key}: ${r.success ? "" : r.error.message}`);
  }
});

test("claves y nombres únicos; textos dentro de los límites de los tipos", () => {
  assert.equal(new Set(BUILTIN_KEYS).size, BUILTIN_KEYS.length);
  assert.equal(new Set(BUILTIN_TEMPLATES.map((b) => b.data.name.toLowerCase())).size, BUILTIN_TEMPLATES.length);
  for (const b of BUILTIN_TEMPLATES) {
    const t = canonicalTemplate(b.key)!;
    for (const k of t.kinds) assert.ok(k.descriptionTemplate.length <= 2000, `${b.key}/${k.name}`);
    // Todas tienen columna de terminadas salvo «Curso o máster» (lo hecho se archiva o se queda en su columna).
    assert.equal(t.columns.some((c) => c.isDone), b.key !== "curso-master", `${b.key}: columna de terminadas`);
  }
});

test("aplicar una plantilla de serie no pierde tipos ni subtareas", () => {
  const t = canonicalTemplate("produccion-audiovisual")!;
  const app = buildTemplateApplication(t, [{ id: "1", name: "Funcionalidad" }, { id: "2", name: "Corrección" }, { id: "3", name: "Respuesta" }]);
  assert.equal(app.kinds.length, t.kinds.length);
  assert.deepEqual(app.kinds[1]!.subtaskTemplate, t.kinds[1]!.subtaskTemplate);
  // Plantilla ajena al software: se ocultan todos los generales, también Respuesta.
  assert.deepEqual(app.hiddenKindIds, ["1", "2", "3"]);
});

test("vibecoding tiene los roles de release", () => {
  const roles = canonicalTemplate("vibecoding")!.columns.map((c) => c.role);
  assert.ok(roles.includes("NEXT_RELEASE") && roles.includes("IN_PRODUCTION"));
});

test("isBuiltinModified: igual, editada, sin clave y clave desconocida", () => {
  const canon = canonicalTemplate("negocio")!;
  assert.equal(isBuiltinModified(canon, "negocio"), false);
  // Lo que llega de la base de datos pasa por el mismo esquema: sigue sin estar modificada.
  assert.equal(isBuiltinModified(templateInputSchema.parse(JSON.parse(JSON.stringify(canon))), "negocio"), false);
  assert.equal(isBuiltinModified({ ...canon, name: "Mi negocio" }, "negocio"), true);
  assert.equal(isBuiltinModified({ ...canon, columns: [...canon.columns].reverse() }, "negocio"), true);
  assert.equal(isBuiltinModified({ ...canon, labels: canon.labels.slice(1) }, "negocio"), true);
  assert.equal(isBuiltinModified({ ...canon, kinds: canon.kinds.map((k, i) => (i === 0 ? { ...k, subtaskTemplate: [] } : k)) }, "negocio"), true);
  assert.equal(isBuiltinModified({ ...canon, name: "otro" }, null), false);
  assert.equal(isBuiltinModified({ ...canon, name: "otro" }, "desconocida"), false);
});

test("sortTemplates ordena en español sin distinguir mayúsculas ni tildes", () => {
  const names = sortTemplates([{ name: "Vibecoding" }, { name: "Éxito" }, { name: "ñu" }, { name: "negocio" }, { name: "Eventos" }, { name: "Zeta" }]).map((x) => x.name);
  assert.deepEqual(names, ["Eventos", "Éxito", "negocio", "ñu", "Vibecoding", "Zeta"]);
});

test("solo Vibecoding conserva los tipos generales; el resto los oculta todos y trae sus propios tipos", () => {
  for (const b of BUILTIN_TEMPLATES) {
    const t = canonicalTemplate(b.key)!;
    assert.equal(t.hideAllGeneralKinds, b.key !== "vibecoding", b.key);
    if (b.key !== "vibecoding") assert.ok(t.kinds.length >= 4, b.key);
  }
});

test("las plantillas añadidas después de las primeras existen, con subtareas y etiquetas válidas", () => {
  for (const key of ["soporte-clientes", "seleccion-personal", "reformas-obras", "viajes", "estudios-tesis", "mudanza", "mantenimiento", "ventas"]) {
    const t = canonicalTemplate(key);
    assert.ok(t, key);
    assert.ok(t.kinds.some((k) => k.subtaskTemplate.length > 0), `${key} sin subtareas`);
    assert.ok(t.kinds.every((k) => k.descriptionTemplate.length > 0), `${key} con tipo sin descripción`);
    assert.ok(t.labels.length >= 4, key);
    assert.equal(t.hideAllGeneralKinds, true);
  }
});

test("hideAllGeneralKinds oculta todos los generales aunque no estén en la lista", () => {
  const general = [{ id: "1", name: "Funcionalidad" }, { id: "2", name: "Mejora" }, { id: "3", name: "Respuesta" }];
  const base = canonicalTemplate("negocio")!;
  const all = buildTemplateApplication({ ...base, hiddenGeneralKinds: [] }, general);
  assert.deepEqual(all.hiddenKindIds, ["1", "2", "3"]);
  // Sin la opción solo se ocultan los listados.
  assert.deepEqual(buildTemplateApplication({ ...base, hideAllGeneralKinds: false, hiddenGeneralKinds: ["mejora"] }, general).hiddenKindIds, ["2"]);
  // Sin tipos propios se deja uno visible.
  const sinPropios = buildTemplateApplication({ ...base, kinds: [] }, general);
  assert.deepEqual(sinPropios.hiddenKindIds, ["2", "3"]);
});

test("el esquema acepta plantillas antiguas sin la opción (falso) y rechaza valores no booleanos", () => {
  const { hideAllGeneralKinds: _omit, ...old } = canonicalTemplate("negocio")!;
  assert.equal(templateInputSchema.parse(old).hideAllGeneralKinds, false);
  assert.equal(templateInputSchema.safeParse({ ...old, hideAllGeneralKinds: "si" }).success, false);
});

// Revisión de las plantillas de serie para trabajo real (ronda 57): cada una aprovecha los roles de columna, no repite
// en etiquetas lo que ya dicen las columnas o los tipos y su versión inglesa activa lo mismo.
test("cada plantilla de serie, en los dos idiomas: roles válidos y únicos donde toca, sin nombres repetidos ni redundantes", () => {
  const generals = ["funcionalidad", "corrección", "respuesta", "feature", "bug fix", "reply"];
  const key = (s: string) => s.trim().toLowerCase();
  for (const b of BUILTIN_TEMPLATES) {
    for (const [lang, t] of [["es", canonicalTemplate(b.key)!], ["en", canonicalTemplateEn(b.key)!]] as const) {
      const at = `${b.key} (${lang})`;
      for (const c of t.columns) assert.ok((COLUMN_ROLES as readonly string[]).includes(c.role), `${at}: rol «${c.role}»`);
      for (const role of UNIQUE_COLUMN_ROLES) assert.ok(t.columns.filter((c) => c.role === role).length <= 1, `${at}: ${role} repetido`);
      // Una columna terminada no lleva rol de espera ni de rutinas (no avisaría ni tendría sentido repetir desde ahí).
      for (const c of t.columns.filter((c) => c.isDone)) assert.ok(!["WAITING", "ROUTINES", "BUDGET", "CHECKLIST"].includes(c.role), `${at}: «${c.name}» terminada con rol ${c.role}`);
      for (const list of [t.columns, t.kinds, t.labels]) assert.equal(new Set(list.map((x) => key(x.name))).size, list.length, `${at}: nombres repetidos`);
      // Un tipo propio con el nombre de uno general se omitiría al aplicar la plantilla.
      for (const k of t.kinds) assert.ok(!generals.includes(key(k.name)), `${at}: el tipo «${k.name}» choca con uno general`);
      // Una etiqueta que repite una columna o un tipo sobra: la tarjeta ya lo dice por su columna o su tipo.
      const taken = new Set([...t.columns, ...t.kinds].map((x) => key(x.name)));
      for (const l of t.labels) assert.ok(!taken.has(key(l.name)), `${at}: la etiqueta «${l.name}» repite una columna o un tipo`);
      assert.ok(t.columns.some((c) => c.isDone) || b.key === "curso-master", `${at}: sin columna terminada`);
    }
    const es = canonicalTemplate(b.key)!;
    const en = canonicalTemplateEn(b.key)!;
    assert.deepEqual(en.taskFields, es.taskFields, `${b.key}: campos de tarea`);
    assert.equal(en.labels.length, es.labels.length, `${b.key}: etiquetas`);
    assert.deepEqual(en.releaseTemplates.map((r) => r.kind), es.releaseTemplates.map((r) => r.kind), `${b.key}: plantillas de release`);
  }
});

test("las plantillas de trabajo real usan los roles de columna (espera, rutinas, agenda, presupuesto, listas…)", () => {
  const expected: Record<string, string[]> = {
    "tareas-familiares": ["WEEKLY_PLAN", "CHECKLIST", "AGENDA", "ROUTINES"],
    "produccion-audiovisual": ["BUDGET", "AGENDA", "WAITING", "DELIVERY"],
    negocio: ["WEEKLY_PLAN", "WAITING", "ROUTINES"],
    "marketing-contenidos": ["ROUTINES", "REVIEW", "AGENDA"],
    eventos: ["WAITING", "BUDGET", "CHECKLIST"],
    "soporte-clientes": ["WAITING"],
    "seleccion-personal": ["AGENDA", "WAITING", "REVIEW"],
    "reformas-obras": ["WAITING", "AGENDA", "REVIEW", "BUDGET"],
    viajes: ["BUDGET", "CHECKLIST"],
    "estudios-tesis": ["WAITING", "REVIEW"],
    mudanza: ["WEEKLY_PLAN", "WAITING", "CHECKLIST"],
    mantenimiento: ["ROUTINES", "AGENDA", "WAITING"],
    ventas: ["AGENDA", "WAITING"],
  };
  for (const [k, roles] of Object.entries(expected)) {
    const t = canonicalTemplate(k)!;
    assert.ok(t, k);
    assert.deepEqual([...new Set(t.columns.map((c) => c.role).filter((r) => r !== "NONE"))].sort(), [...roles].sort(), k);
    // Con columna de presupuesto siempre va el coste.
    if (roles.includes("BUDGET")) assert.ok(t.taskFields.includes("cost"), `${k}: coste`);
  }
  // Las de software y cursos no se tocan aquí (las lleva el propietario).
  assert.deepEqual(Object.keys(expected).sort(), BUILTIN_KEYS.filter((k) => k !== "vibecoding" && k !== "curso-master").sort());
});

test("en las columnas de lista consolidada, los tipos pensados para ellas traen elementos de la lista, no pasos", () => {
  const steps = /^(hacer la lista|comprar|guardar|preparar la maleta|make the list|buy|put away|pack the bags)$/i;
  for (const b of BUILTIN_TEMPLATES) {
    for (const t of [canonicalTemplate(b.key)!, canonicalTemplateEn(b.key)!]) {
      if (!t.columns.some((c) => c.role === "CHECKLIST")) continue;
      for (const k of t.kinds) for (const s of k.subtaskTemplate) assert.ok(!steps.test(s), `${b.key}/${k.name}: «${s}»`);
    }
  }
});
