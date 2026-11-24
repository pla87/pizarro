import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_KEYS, BUILTIN_TEMPLATES, canonicalTemplate, CUSTOM_TEMPLATE_KEY, isBuiltinModified, knownTemplateKey, RETIRED_BUILTINS, suggestedColumnRoles } from "../src/lib/builtin-templates";
import { currentRoleChoice, GENERAL_ROLE_CHOICES, ROLE_CHOICES, splitRoleChoices, type ColumnRoleChoice } from "../src/lib/column-role-choices";
import { canonicalTemplateEn } from "../src/lib/builtin-templates-en";
import { COLUMN_ROLES, UNIQUE_COLUMN_ROLES } from "../src/lib/constants";
import { buildTemplateApplication, parseStoredTemplate, sortTemplates, templateInputSchema } from "../src/lib/project-templates";
import { PROJECT_EXAMPLES } from "../src/lib/project-examples";

test("cada plantilla de serie pasa la misma validación que las de los usuarios", () => {
  assert.equal(BUILTIN_TEMPLATES.length, 6);
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
    // Todas tienen columna de terminadas (también «Curso o charla», con «Publicado»): los informes muestran el avance.
    assert.ok(t.columns.some((c) => c.isDone), `${b.key}: columna de terminadas`);
  }
});

test("aplicar una plantilla de serie no pierde tipos ni subtareas", () => {
  const t = canonicalTemplate("trabajo-clientes")!;
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
  const canon = canonicalTemplate("trabajo-clientes")!;
  assert.equal(isBuiltinModified(canon, "trabajo-clientes"), false);
  // Lo que llega de la base de datos pasa por el mismo esquema: sigue sin estar modificada.
  assert.equal(isBuiltinModified(templateInputSchema.parse(JSON.parse(JSON.stringify(canon))), "trabajo-clientes"), false);
  assert.equal(isBuiltinModified({ ...canon, name: "Mi negocio" }, "trabajo-clientes"), true);
  assert.equal(isBuiltinModified({ ...canon, columns: [...canon.columns].reverse() }, "trabajo-clientes"), true);
  assert.equal(isBuiltinModified({ ...canon, labels: canon.labels.slice(1) }, "trabajo-clientes"), true);
  assert.equal(isBuiltinModified({ ...canon, kinds: canon.kinds.map((k, i) => (i === 0 ? { ...k, subtaskTemplate: [] } : k)) }, "trabajo-clientes"), true);
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

test("las seis de serie: claves y nombres; las unidas traen tipos con subtareas y descripción, y pocas etiquetas", () => {
  assert.deepEqual(BUILTIN_TEMPLATES.map((b) => [b.key, b.data.name]), [
    ["vibecoding", "Vibecoding"],
    ["trabajo-clientes", "Trabajo y clientes"],
    ["casa-familia", "Casa y familia"],
    ["eventos-viajes", "Eventos y viajes"],
    ["estudios-tesis", "Estudios y aprendizaje"],
    ["curso-master", "Curso o charla"],
  ]);
  for (const key of ["trabajo-clientes", "casa-familia", "eventos-viajes", "estudios-tesis"]) {
    const t = canonicalTemplate(key)!;
    assert.ok(t.kinds.filter((k) => k.subtaskTemplate.length > 0).length >= 4, `${key} con pocas subtareas`);
    assert.ok(t.kinds.every((k) => k.descriptionTemplate.length > 0), `${key} con tipo sin descripción`);
    assert.ok(t.labels.length >= 3 && t.labels.length <= 5, key);
    assert.ok(t.columns.length <= 7, `${key}: demasiadas columnas`);
    assert.equal(t.hideAllGeneralKinds, true);
  }
  // «Curso o charla»: la de antes con «Publicado» (terminada) al final.
  const course = canonicalTemplate("curso-master")!;
  assert.deepEqual(course.columns.at(-1), { name: "Publicado", role: "NONE", isDone: true });
});

test("ninguna etiqueta repite un campo de la tarea (prioridad, coste, cliente)", () => {
  const dup: Record<string, RegExp> = { priority: /urgent|prioridad|priority/i, cost: /pago|cobro|coste|pagad|payment|paid|cost|bill/i, client: /cliente|client|customer/i };
  for (const b of BUILTIN_TEMPLATES) {
    for (const t of [canonicalTemplate(b.key)!, canonicalTemplateEn(b.key)!]) {
      for (const field of t.taskFields) for (const l of t.labels) assert.ok(!dup[field]?.test(l.name), `${b.key}: la etiqueta «${l.name}» repite el campo ${field}`);
    }
  }
  assert.deepEqual(canonicalTemplate("trabajo-clientes")!.taskFields, ["cost", "priority", "client"]);
});

test("las retiradas: huellas válidas y claves que no vuelven a usarse", () => {
  assert.equal(Object.keys(RETIRED_BUILTINS).length, 12);
  for (const [key, hash] of Object.entries(RETIRED_BUILTINS)) {
    assert.match(hash, /^[0-9a-f]{64}$/, key);
    assert.ok(!BUILTIN_KEYS.includes(key), `${key} sigue de serie`);
  }
});

test("hideAllGeneralKinds oculta todos los generales aunque no estén en la lista", () => {
  const general = [{ id: "1", name: "Funcionalidad" }, { id: "2", name: "Mejora" }, { id: "3", name: "Respuesta" }];
  const base = canonicalTemplate("trabajo-clientes")!;
  const all = buildTemplateApplication({ ...base, hiddenGeneralKinds: [] }, general);
  assert.deepEqual(all.hiddenKindIds, ["1", "2", "3"]);
  // Sin la opción solo se ocultan los listados.
  assert.deepEqual(buildTemplateApplication({ ...base, hideAllGeneralKinds: false, hiddenGeneralKinds: ["mejora"] }, general).hiddenKindIds, ["2"]);
  // Sin tipos propios se deja uno visible.
  const sinPropios = buildTemplateApplication({ ...base, kinds: [] }, general);
  assert.deepEqual(sinPropios.hiddenKindIds, ["2", "3"]);
});

test("el esquema acepta plantillas antiguas sin la opción (falso) y rechaza valores no booleanos", () => {
  const { hideAllGeneralKinds: _omit, ...old } = canonicalTemplate("trabajo-clientes")!;
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
      assert.ok(t.columns.some((c) => c.isDone), `${at}: sin columna terminada`);
    }
    const es = canonicalTemplate(b.key)!;
    const en = canonicalTemplateEn(b.key)!;
    assert.deepEqual(en.taskFields, es.taskFields, `${b.key}: campos de tarea`);
    assert.equal(en.labels.length, es.labels.length, `${b.key}: etiquetas`);
    assert.deepEqual(en.releaseTemplates.map((r) => r.kind), es.releaseTemplates.map((r) => r.kind), `${b.key}: plantillas de release`);
  }
});

test("las plantillas de trabajo real usan los roles de columna (espera, rutinas, presupuesto, listas…)", () => {
  const expected: Record<string, string[]> = {
    "trabajo-clientes": ["WAITING", "REVIEW", "ROUTINES"],
    "casa-familia": ["WEEKLY_PLAN", "WAITING", "CHECKLIST", "ROUTINES"],
    "eventos-viajes": ["WAITING", "BUDGET", "CHECKLIST"],
    "estudios-tesis": ["ROUTINES", "WAITING", "REVIEW"],
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

test("Vibecoding: las subtareas de sus tipos son criterios comprobables, no pasos de la persona (llegan al plan para IA)", () => {
  const steps = /^(pedir|revisar|probar|escribir|contrastar|anotar|cubrir|aplicar|comprobar|desplegar|ask|review|try|write|cross-check|note|cover|apply|check|deploy)\b/i;
  for (const t of [canonicalTemplate("vibecoding")!, canonicalTemplateEn("vibecoding")!]) {
    assert.ok(t.kinds.every((k) => k.subtaskTemplate.length >= 2), t.name);
    for (const k of t.kinds) for (const s of k.subtaskTemplate) {
      assert.ok(!steps.test(s), `${k.name}: «${s}»`);
      assert.ok(s.length <= 50, `${k.name}: «${s}» es largo`);
    }
  }
  // Las subtareas de las tarjetas de ejemplo, tampoco.
  const exampleSteps = /^(pedir|revisar|probar|escribir|reproducir|arreglar|ask|review|try|write|reproduce|fix)\b/i;
  const ex = PROJECT_EXAMPLES.find((e) => e.key === "vibecoding")!;
  for (const task of [...ex.es.tasks, ...ex.en.tasks]) for (const s of task.subtasks ?? []) {
    assert.ok(!exampleSteps.test(s), `${task.title}: «${s}»`);
    assert.ok(s.length <= 50, `${task.title}: «${s}» es largo`);
  }
});

test("roles retirados (Agenda, Entrega al cliente): ninguna plantilla de serie los usa y una guardada antigua los lee como «Sin rol»", () => {
  for (const b of BUILTIN_TEMPLATES) {
    for (const t of [canonicalTemplate(b.key)!, canonicalTemplateEn(b.key)!]) {
      for (const c of t.columns) assert.ok((COLUMN_ROLES as readonly string[]).includes(c.role), `${b.key}: «${c.name}» con el rol ${c.role}`);
    }
  }
  const old = parseStoredTemplate({
    id: "x", name: "Antigua", description: "",
    columns: [{ name: "Citas", role: "AGENDA", isDone: false }, { name: "Entrega", role: "DELIVERY", isDone: false }, { name: "Hecho", role: "NONE", isDone: true }],
    kinds: [], hiddenGeneralKinds: [], labels: [],
  });
  assert.deepEqual(old.columns.map((c) => c.role), ["NONE", "NONE", "NONE"]);
  assert.ok(!(COLUMN_ROLES as readonly string[]).includes("AGENDA") && !(COLUMN_ROLES as readonly string[]).includes("DELIVERY"), "ya no están en el enum (v1.69)");
});

test("roles sugeridos por plantilla: claves de serie, propias y sin plantilla", () => {
  // Cada plantilla de serie tiene su lista, con los roles que ya usan sus columnas (lo que trae no sale en «Más roles…»).
  for (const b of BUILTIN_TEMPLATES) {
    const list = suggestedColumnRoles(b.key, []);
    assert.ok(list, b.key);
    for (const c of b.data.columns) if (c.role !== "NONE") assert.ok(list.includes(c.role as ColumnRoleChoice), `${b.key}: ${c.role}`);
  }
  const casa = suggestedColumnRoles("casa-familia", [])!;
  assert.ok(!casa.includes("NEXT_RELEASE") && !casa.includes("AI_PLAN") && casa.includes("ASSIGN"));
  // Sin plantilla conocida: todos (null).
  assert.equal(suggestedColumnRoles(null, []), null);
  assert.equal(suggestedColumnRoles("ya-no-existe", []), null);
  // Claves heredadas de Object (un .pizarro.zip fabricado con «constructor»): sin plantilla, no un fallo del tablero.
  for (const k of ["constructor", "tostring", "hasownproperty", "__proto__"]) assert.equal(suggestedColumnRoles(k, []), null, k);
  assert.equal(suggestedColumnRoles("toString", []), null);
  // Al importar solo se guarda una clave conocida.
  assert.equal(knownTemplateKey("casa-familia"), "casa-familia");
  assert.equal(knownTemplateKey(CUSTOM_TEMPLATE_KEY), CUSTOM_TEMPLATE_KEY);
  assert.equal(knownTemplateKey("constructor"), null);
  assert.equal(knownTemplateKey(undefined), null);
  // Propia: los de sus columnas más los generales.
  const own = suggestedColumnRoles(CUSTOM_TEMPLATE_KEY, [{ role: "BUDGET" }, { role: "NONE", assigneeId: "u1" }])!;
  assert.deepEqual(own, ROLE_CHOICES.filter((r) => [...GENERAL_ROLE_CHOICES, "BUDGET"].includes(r)));
});

test("el submenú del rol: sugeridos primero, el resto en «Más roles…» y nunca se esconde el actual", () => {
  assert.deepEqual(splitRoleChoices(null, null), { first: [...ROLE_CHOICES], more: [] });
  const { first, more } = splitRoleChoices(["WAITING", "ASSIGN"], "NEXT_RELEASE");
  assert.deepEqual(first, ["NEXT_RELEASE", "WAITING", "ASSIGN"]);
  assert.equal(first.length + more.length, ROLE_CHOICES.length);
  assert.ok(!more.includes("NEXT_RELEASE"));
  assert.equal(currentRoleChoice({ role: "NONE", assign: true }), "ASSIGN");
  assert.equal(currentRoleChoice({ role: "NONE", assign: false }), null);
});
