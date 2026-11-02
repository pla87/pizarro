import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMN_ROLES } from "../src/lib/constants";
import { EXAMPLE_KEYS, EXAMPLE_LABEL, listExamples, PROJECT_EXAMPLES, resolveExample, validateExample, type ExampleLocale } from "../src/lib/project-examples";
import { buildTemplateApplication } from "../src/lib/project-templates";

const LOCALES: ExampleLocale[] = ["es", "en"];

test("hay los cuatro ejemplos previstos, con claves únicas", () => {
  assert.deepEqual([...EXAMPLE_KEYS].sort(), ["empresa-clientes", "equipo-software", "eventos", "familia-casa"]);
  assert.equal(new Set(EXAMPLE_KEYS).size, EXAMPLE_KEYS.length);
});

test("cada ejemplo es válido en español y en inglés (columnas, tipos, etiquetas, campos, tarjetas)", () => {
  for (const ex of PROJECT_EXAMPLES) {
    for (const locale of LOCALES) {
      assert.deepEqual(validateExample(ex[locale]), [], `${ex.key}/${locale}`);
      const resolved = resolveExample(ex.key, locale)!;
      assert.ok(resolved.template.columns.every((c) => (COLUMN_ROLES as readonly string[]).includes(c.role)));
      assert.ok(resolved.template.columns.some((c) => c.isDone), `${ex.key}/${locale}: sin columna terminada`);
      // Aplicable como cualquier plantilla (columnas, tipos y etiquetas con posiciones).
      const app = buildTemplateApplication(resolved.template, [{ id: "g1", name: "Funcionalidad" }, { id: "g2", name: "Corrección" }, { id: "g3", name: "Respuesta" }], locale);
      assert.equal(app.columns.length, resolved.template.columns.length);
      assert.ok(app.labels.some((l) => l.name === EXAMPLE_LABEL[locale].name));
    }
  }
});

test("las dos versiones tienen la misma estructura", () => {
  for (const ex of PROJECT_EXAMPLES) {
    const { es, en } = ex;
    assert.deepEqual(en.template.columns.map((c) => [c.role, c.isDone]), es.template.columns.map((c) => [c.role, c.isDone]), `${ex.key}: columnas`);
    assert.deepEqual(en.template.kinds.map((k) => k.color), es.template.kinds.map((k) => k.color), `${ex.key}: tipos`);
    assert.deepEqual(en.template.labels.map((l) => l.color), es.template.labels.map((l) => l.color), `${ex.key}: etiquetas`);
    assert.deepEqual(en.template.hiddenGeneralKinds, es.template.hiddenGeneralKinds, `${ex.key}: generales ocultos`);
    assert.deepEqual(en.template.taskFields, es.template.taskFields, `${ex.key}: campos`);
    assert.equal((en.template.releaseTemplates ?? []).length, (es.template.releaseTemplates ?? []).length, `${ex.key}: releases`);
    assert.deepEqual((en.deliverables ?? []).map((d) => d.dueInDays), (es.deliverables ?? []).map((d) => d.dueInDays), `${ex.key}: entregables`);
    assert.equal(en.tasks.length, es.tasks.length, `${ex.key}: tarjetas`);
    es.tasks.forEach((t, i) => {
      const e = en.tasks[i]!;
      const shape = (x: typeof t) => [x.column, !!x.kind, x.generalKind, (x.labels ?? []).length, (x.subtasks ?? []).length, x.dueInDays, x.deliverable, x.recurrence, x.recurrenceDay, x.priority, x.cost, x.estimatedHours, !!x.client];
      assert.deepEqual(shape(e), shape(t), `${ex.key}: tarjeta ${i + 1}`);
    });
  }
});

test("la versión inglesa no deja restos de español en los textos", () => {
  const spanish = /[áéíóúñ¿¡]|\b(el|la|los|las|del|para|con|sin|una?|que|por)\b/i;
  for (const ex of PROJECT_EXAMPLES) {
    const en = ex.en;
    const texts = [
      en.name, en.description,
      ...en.template.columns.map((c) => c.name),
      ...(en.template.kinds ?? []).flatMap((k) => [k.name, k.titleTemplate ?? "", k.descriptionTemplate ?? ""]),
      ...(en.template.labels ?? []).map((l) => l.name),
      ...(en.template.releaseTemplates ?? []).flatMap((r) => [r.name, r.content]),
      ...(en.deliverables ?? []).flatMap((d) => [d.name, d.description ?? ""]),
      ...en.tasks.flatMap((t) => [t.title, t.description ?? "", ...(t.subtasks ?? []), t.client ?? ""]),
    ];
    for (const text of texts.filter((x): x is string => typeof x === "string")) assert.ok(!spanish.test(text), `${ex.key}: «${text.slice(0, 50)}» parece español`);
  }
});

test("el software usa funcionalidad, corrección y mejora y plantillas de release; rutinas y calendario donde procede", () => {
  const sw = resolveExample("equipo-software", "es")!;
  assert.ok(sw.template.columns.some((c) => c.role === "NEXT_RELEASE") && sw.template.columns.some((c) => c.role === "IN_PRODUCTION"));
  assert.ok(sw.template.releaseTemplates.some((r) => r.kind === "HEADER") && sw.template.releaseTemplates.some((r) => r.kind === "FOOTER"));
  assert.ok(sw.content.tasks.some((t) => t.generalKind === "feature") && sw.content.tasks.some((t) => t.generalKind === "bugfix") && sw.template.kinds.some((k) => k.name === "Mejora"));
  const home = resolveExample("familia-casa", "es")!;
  assert.ok(home.content.tasks.some((t) => t.recurrence && home.template.columns[t.column]!.role === "ROUTINES"));
  assert.ok((resolveExample("eventos", "es")!.content.deliverables ?? []).length >= 3);
  assert.ok(resolveExample("empresa-clientes", "es")!.template.taskFields.includes("client"));
});

test("el selector lista los ejemplos en el idioma pedido y una clave desconocida no se resuelve", () => {
  assert.ok(listExamples("es").some((e) => e.name === "Equipo de software"));
  assert.ok(listExamples("en").some((e) => e.name === "Software team"));
  assert.equal(resolveExample("no-existe", "es"), null);
});

test("validateExample detecta errores de datos", () => {
  const base = structuredClone(PROJECT_EXAMPLES[0]!.es);
  assert.ok(validateExample({ ...base, tasks: [{ ...base.tasks[0]!, column: 99 }] }).some((e) => /columna/.test(e)));
  assert.ok(validateExample({ ...base, tasks: [{ ...base.tasks[0]!, kind: "Inexistente" }] }).some((e) => /tipo/.test(e)));
  assert.ok(validateExample({ ...base, tasks: [{ ...base.tasks[0]!, labels: ["Nada"] }] }).some((e) => /etiqueta/.test(e)));
  assert.ok(validateExample({ ...base, tasks: [{ ...base.tasks[0]!, client: "X" }] }).some((e) => /campo/.test(e)));
  assert.ok(validateExample({ ...base, tasks: [{ ...base.tasks[0]!, deliverable: 3 }] }).some((e) => /entregable/.test(e)));
});
