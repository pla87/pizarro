import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_KEYS, canonicalTemplate } from "../src/lib/builtin-templates";
import { canonicalTemplateEn } from "../src/lib/builtin-templates-en";
import { EXAMPLE_LABEL, hasExamples, PROJECT_EXAMPLES, resolveExamples, validateExample, type ExampleLocale } from "../src/lib/project-examples";
import { buildTemplateApplication } from "../src/lib/project-templates";

const LOCALES: ExampleLocale[] = ["es", "en"];
const canon = (key: string, locale: ExampleLocale) => (locale === "en" ? canonicalTemplateEn(key)! : canonicalTemplate(key)!);
const withLabel = (key: string, locale: ExampleLocale) => {
  const t = canon(key, locale);
  return { ...t, labels: [...t.labels, EXAMPLE_LABEL[locale]] };
};

test("cada plantilla de serie tiene sus tarjetas de ejemplo, una sola vez", () => {
  assert.deepEqual(PROJECT_EXAMPLES.map((e) => e.key).sort(), [...BUILTIN_KEYS].sort());
  assert.ok(BUILTIN_KEYS.every((k) => hasExamples(k)));
  assert.equal(hasExamples("negocio"), false);
  assert.equal(hasExamples(null), false);
});

test("las tarjetas de ejemplo son válidas con su plantilla canónica, en español y en inglés", () => {
  for (const ex of PROJECT_EXAMPLES) {
    for (const locale of LOCALES) {
      assert.deepEqual(validateExample(ex[locale], withLabel(ex.key, locale)), [], `${ex.key}/${locale}`);
      // La primera explica el tablero.
      assert.match(ex[locale].tasks[0]!.title, locale === "es" ? /^Bienvenida/ : /^Welcome/, `${ex.key}/${locale}`);
    }
  }
});

test("las dos versiones tienen la misma estructura", () => {
  for (const ex of PROJECT_EXAMPLES) {
    const { es, en } = ex;
    assert.deepEqual((en.deliverables ?? []).map((d) => d.dueInDays), (es.deliverables ?? []).map((d) => d.dueInDays), `${ex.key}: entregables`);
    assert.equal(en.tasks.length, es.tasks.length, `${ex.key}: tarjetas`);
    es.tasks.forEach((t, i) => {
      const e = en.tasks[i]!;
      const shape = (x: typeof t) => [x.column, !!x.kind, x.generalKind, (x.labels ?? []).length, (x.subtasks ?? []).length, x.dueInDays, x.startInDays, x.deliverable, x.recurrence, x.recurrenceDay, x.priority, x.cost, x.estimatedHours, !!x.client, !!x.evergreen];
      assert.deepEqual(shape(e), shape(t), `${ex.key}: tarjeta ${i + 1}`);
      // El tipo inglés es el de la misma posición en la plantilla inglesa.
      if (t.kind) {
        const pos = canon(ex.key, "es").kinds.findIndex((k) => k.name === t.kind);
        assert.equal(canon(ex.key, "en").kinds[pos]!.name, e.kind, `${ex.key}: tipo de la tarjeta ${i + 1}`);
      }
    });
  }
});

test("la versión inglesa no deja restos de español en los textos", () => {
  const spanish = /[áéíóúñ¿¡]|\b(el|la|los|las|del|para|con|sin|una?|que|por)\b/i;
  for (const ex of PROJECT_EXAMPLES) {
    const en = ex.en;
    const texts = [
      ...(en.deliverables ?? []).flatMap((d) => [d.name, d.description ?? ""]),
      ...en.tasks.flatMap((t) => [t.title, t.description ?? "", ...(t.subtasks ?? []), t.client ?? ""]),
    ];
    for (const text of texts) assert.ok(!spanish.test(text), `${ex.key}: «${text.slice(0, 50)}» parece español`);
  }
});

test("enseñan lo que hace cada rol: repeticiones en rutinas, entregables con fecha, coste y sesiones en «Programa»", () => {
  const tasks = (key: string) => PROJECT_EXAMPLES.find((e) => e.key === key)!.es.tasks;
  const roleOf = (key: string, column: number) => canonicalTemplate(key)!.columns[column]!.role;
  for (const key of ["casa-familia", "trabajo-clientes", "estudios-tesis"]) {
    assert.ok(tasks(key).some((t) => t.recurrence && roleOf(key, t.column) === "ROUTINES"), key);
  }
  const events = PROJECT_EXAMPLES.find((e) => e.key === "eventos-viajes")!.es;
  assert.ok((events.deliverables ?? []).length >= 3);
  assert.ok(events.tasks.some((t) => t.cost && roleOf("eventos-viajes", t.column) === "BUDGET"));
  assert.ok(events.tasks.some((t) => (t.subtasks ?? []).length && roleOf("eventos-viajes", t.column) === "CHECKLIST"));
  assert.ok(tasks("trabajo-clientes").some((t) => t.client));
  assert.equal(tasks("curso-master").filter((t) => roleOf("curso-master", t.column) === "PROGRAM").length, 3);
  assert.ok(tasks("curso-master").some((t) => canonicalTemplate("curso-master")!.columns[t.column]!.isDone));
  assert.ok(tasks("vibecoding").some((t) => t.generalKind === "feature") && tasks("vibecoding").some((t) => t.generalKind === "bugfix"));
});

test("resolveExamples: idioma de las tarjetas según la plantilla, etiqueta «Ejemplo» añadida una vez", () => {
  const es = canonicalTemplate("casa-familia")!;
  const en = canonicalTemplateEn("casa-familia")!;
  const a = resolveExamples("casa-familia", es, "en")!;
  assert.equal(a.exampleLabel, "Ejemplo", "plantilla en español → tarjetas en español aunque la persona use el inglés");
  assert.equal(a.canonical.columns[0]!.name, "Por hacer");
  assert.ok(a.template.labels.some((l) => l.name === "Ejemplo"));
  const b = resolveExamples("casa-familia", en, "es")!;
  assert.equal(b.exampleLabel, "Example");
  // Una plantilla modificada sin nombres en común: el idioma de quien crea el proyecto.
  const odd = { ...es, columns: [{ name: "Uno", role: "NONE" as const, isDone: false }], kinds: [] };
  assert.equal(resolveExamples("casa-familia", odd, "en")!.exampleLabel, "Example");
  // Si ya tiene la etiqueta, no se repite.
  const labelled = { ...es, labels: [...es.labels, { name: "ejemplo", color: "#a855f7" as const }] };
  assert.equal(resolveExamples("casa-familia", labelled, "es")!.template.labels.length, labelled.labels.length);
  assert.equal(resolveExamples("negocio", es, "es"), null);
  // Se aplica como cualquier plantilla.
  const app = buildTemplateApplication(a.template, [{ id: "g1", name: "Funcionalidad" }, { id: "g2", name: "Corrección" }, { id: "g3", name: "Respuesta" }]);
  assert.ok(app.labels.some((l) => l.name === "Ejemplo"));
});

test("validateExample detecta errores de datos", () => {
  const base = structuredClone(PROJECT_EXAMPLES.find((e) => e.key === "vibecoding")!.es);
  const tpl = withLabel("vibecoding", "es");
  assert.ok(validateExample({ ...base, tasks: [{ ...base.tasks[0]!, column: 99 }] }, tpl).some((e) => /columna/.test(e)));
  assert.ok(validateExample({ ...base, tasks: [{ ...base.tasks[0]!, kind: "Inexistente" }] }, tpl).some((e) => /tipo/.test(e)));
  assert.ok(validateExample({ ...base, tasks: [{ ...base.tasks[0]!, labels: ["Nada"] }] }, tpl).some((e) => /etiqueta/.test(e)));
  assert.ok(validateExample({ ...base, tasks: [{ ...base.tasks[0]!, client: "X" }] }, tpl).some((e) => /campo/.test(e)));
  assert.ok(validateExample({ ...base, tasks: [{ ...base.tasks[0]!, deliverable: 3 }] }, tpl).some((e) => /entregable/.test(e)));
  const home = withLabel("casa-familia", "es");
  assert.ok(validateExample({ tasks: [{ title: "x", column: 0, generalKind: "feature" }] }, home).some((e) => /oculta los tipos generales/.test(e)));
});
