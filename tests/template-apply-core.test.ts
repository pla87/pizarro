// «Aplicar plantilla» a un proyecto existente: el plan puro (emparejamiento, lo que se añade y lo que se quita).
import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_TEMPLATES } from "../src/lib/builtin-templates";
import { defaultColumns } from "../src/lib/constants";
import { PROJECT_EXAMPLES } from "../src/lib/project-examples";
import { templateInputSchema } from "../src/lib/project-templates";
import {
  nameKey, planAdd, planIsEmpty, planReplace, suggestColumnChoices, suggestKindChoices, summarizePlan,
  type ApplyTemplateShape, type ProjectShape,
} from "../src/lib/template-apply-core";

const GENERALS: ProjectShape["kinds"] = [
  { id: "kind_funcionalidad", name: "Funcionalidad", label: "Funcionalidad", general: true, hidden: false, tasks: 0 },
  { id: "kind_correccion", name: "Corrección", label: "Corrección", general: true, hidden: false, tasks: 0 },
  { id: "kind_respuesta", name: "Respuesta", label: "Respuesta", general: true, hidden: false, tasks: 0 },
];

function project(over: Partial<ProjectShape> = {}): ProjectShape {
  return {
    columns: defaultColumns("es").map((c, i) => ({ id: `c${i}`, name: c.name, role: c.role, isDone: c.isDone, wipLimit: null, active: 0, archived: 0 })),
    kinds: GENERALS.map((k) => ({ ...k })),
    labels: [],
    releaseTemplates: [],
    taskFields: [],
    ...over,
  };
}

function template(over: Partial<ApplyTemplateShape> = {}): ApplyTemplateShape {
  return { name: "T", columns: [], kinds: [], labels: [], hiddenGeneralKinds: [], hideAllGeneralKinds: false, taskFields: [], releaseTemplates: [], ...over };
}

test("nameKey ignora mayúsculas, tildes y espacios sobrantes", () => {
  assert.equal(nameKey("  En   Producción "), "en produccion");
  assert.equal(nameKey("CORRECCIÓN"), nameKey("corrección"));
});

test("las sugerencias de columnas van por nombre, después por rol, después por «terminada»; sin pareja, conservar o quitar si está vacía", () => {
  const p = project({
    columns: [
      { id: "a", name: "backlog", role: "NONE", isDone: false, wipLimit: null, active: 3, archived: 0 },
      { id: "b", name: "Para publicar", role: "NEXT_RELEASE", isDone: false, wipLimit: null, active: 1, archived: 0 },
      { id: "c", name: "Cerrado", role: "NONE", isDone: true, wipLimit: null, active: 0, archived: 4 },
      { id: "d", name: "Varios", role: "NONE", isDone: false, wipLimit: null, active: 2, archived: 0 },
      { id: "e", name: "Vacía", role: "NONE", isDone: false, wipLimit: null, active: 0, archived: 0 },
    ],
  });
  const t = template({ columns: [{ name: "Backlog", role: "NONE", isDone: false }, { name: "Siguiente release", role: "NEXT_RELEASE", isDone: false }, { name: "En producción", role: "IN_PRODUCTION", isDone: true }] });
  assert.deepEqual(suggestColumnChoices(p, t), { a: "t:0", b: "t:1", c: "t:2", d: "keep", e: "drop" });
});

test("un rol que el código no conoce (p. ej. de una plantilla nueva) se empareja igual que los demás", () => {
  const p = project({ columns: [{ id: "x", name: "Temario", role: "PROGRAM", isDone: false, wipLimit: null, active: 5, archived: 0 }] });
  const t = template({ columns: [{ name: "Programa", role: "PROGRAM", isDone: false }, { name: "Hecho", role: "NONE", isDone: true }] });
  assert.deepEqual(suggestColumnChoices(p, t), { x: "t:0" });
  const plan = planReplace(p, t);
  assert.equal(plan.columns[0]!.reuse, "x");
  assert.equal(plan.columns[0]!.role, "PROGRAM");
  assert.equal(plan.columns[1]!.reuse, null);
  // En «añadir lo que falte», una columna con ese rol cuenta como presente.
  assert.deepEqual(planAdd(p, t).addColumns.map((c) => c.name), ["Hecho"]);
});

test("REPLACE: la primera columna emparejada se reutiliza y las demás le pasan sus tareas y se quitan", () => {
  const p = project({
    columns: [
      { id: "a", name: "Ideas", role: "NONE", isDone: false, wipLimit: null, active: 2, archived: 1 },
      { id: "b", name: "Backlog", role: "NONE", isDone: false, wipLimit: null, active: 5, archived: 0 },
      { id: "c", name: "Hecho", role: "NONE", isDone: true, wipLimit: null, active: 7, archived: 0 },
    ],
  });
  const t = template({ columns: [{ name: "Por hacer", role: "NONE", isDone: false }, { name: "Hecho", role: "NONE", isDone: true }] });
  const plan = planReplace(p, t, { columns: { a: "t:0", b: "t:0" } });
  assert.equal(plan.columns[0]!.reuse, "a");
  assert.deepEqual(plan.columns[0]!.absorb, ["b"]);
  assert.equal(plan.columns[0]!.incoming, 5);
  assert.equal(plan.columns[1]!.reuse, "c");
  const lines = summarizePlan(plan, p, t);
  assert.ok(lines.some((l) => l.text === "Se moverán {n} tareas a otra columna" && l.n === 5));
  assert.ok(lines.some((l) => l.text === "Se quitará {n} columna que se queda vacía" && l.n === 1));
});

test("REPLACE: nunca se quita una columna ni un tipo con tareas, aunque se pida", () => {
  const p = project({
    columns: [{ id: "a", name: "Con archivadas", role: "NONE", isDone: false, wipLimit: null, active: 0, archived: 2 }],
    kinds: [...GENERALS, { id: "k1", name: "Propio", label: "Propio", general: false, hidden: false, tasks: 3 }],
  });
  const t = template({ columns: [{ name: "Nueva", role: "NONE", isDone: false }] });
  const plan = planReplace(p, t, { columns: { a: "drop" }, kinds: { k1: "drop" } });
  assert.deepEqual(plan.dropColumns, []);
  assert.deepEqual(plan.kept.map((k) => k.id), ["a"]);
  assert.deepEqual(plan.dropKinds, []);
});

test("REPLACE: una columna conservada pierde un rol único que ya usa la plantilla; uno que se puede repetir lo mantiene", () => {
  const p = project({
    columns: [
      { id: "a", name: "Salto", role: "NEXT_RELEASE", isDone: false, wipLimit: null, active: 1, archived: 0 },
      { id: "b", name: "Esperando", role: "WAITING", isDone: false, wipLimit: null, active: 1, archived: 0 },
    ],
  });
  const t = template({ columns: [{ name: "Release", role: "NEXT_RELEASE", isDone: false }, { name: "Espera", role: "WAITING", isDone: false }] });
  const plan = planReplace(p, t, { columns: { a: "keep", b: "keep" } });
  assert.deepEqual(plan.kept, [
    { id: "a", name: "Salto", role: "NONE", roleCleared: true },
    { id: "b", name: "Esperando", role: "WAITING", roleCleared: false },
  ]);
});

test("REPLACE: tipos — los del mismo nombre se emparejan, los propios sin tareas se quitan y los generales ocultos solo si no tienen tareas", () => {
  const p = project({
    kinds: [
      { id: "kind_funcionalidad", name: "Funcionalidad", label: "Funcionalidad", general: true, hidden: false, tasks: 4 },
      { id: "kind_correccion", name: "Corrección", label: "Corrección", general: true, hidden: false, tasks: 0 },
      { id: "kind_respuesta", name: "Respuesta", label: "Respuesta", general: true, hidden: true, tasks: 0 },
      { id: "k1", name: "compras", label: "compras", general: false, hidden: false, tasks: 2 },
      { id: "k2", name: "Viejo", label: "Viejo", general: false, hidden: false, tasks: 0 },
    ],
  });
  const t = template({
    kinds: [{ name: "Compras", color: "#22c55e", titleTemplate: "", descriptionTemplate: "", subtaskTemplate: [] }, { name: "Casa", color: "#f97316", titleTemplate: "", descriptionTemplate: "", subtaskTemplate: [] }],
    hideAllGeneralKinds: true,
  });
  assert.deepEqual(suggestKindChoices(p, t), { kind_funcionalidad: "keep", kind_correccion: "keep", k1: "t:0", k2: "drop" });
  const plan = planReplace(p, t);
  // «compras» ya es el tipo «Compras» de la plantilla: no se crea otro ni se mueve nada.
  assert.deepEqual(plan.kindTargets, [{ existing: "k1" }, { create: true }]);
  assert.deepEqual(plan.kindMoves, []);
  assert.deepEqual(plan.dropKinds, ["k2"]);
  // Funcionalidad tiene tareas: no se oculta. Corrección sí. Respuesta ya lo estaba.
  assert.deepEqual(plan.hideGenerals, ["kind_correccion"]);
  assert.deepEqual(plan.showGenerals, []);
  // Si sus tareas pasan a «Casa», Funcionalidad también se oculta.
  const moved = planReplace(p, t, { kinds: { kind_funcionalidad: "t:1" } });
  assert.deepEqual(moved.kindMoves, [{ from: "kind_funcionalidad", to: null, toNew: 1, tasks: 4 }]);
  assert.deepEqual(moved.hideGenerals.sort(), ["kind_correccion", "kind_funcionalidad"]);
});

test("REPLACE: un tipo que recibe tareas no se quita ni pasa a otro (sin cadenas)", () => {
  const p = project({
    kinds: [...GENERALS, { id: "k1", name: "A", label: "A", general: false, hidden: false, tasks: 1 }, { id: "k2", name: "B", label: "B", general: false, hidden: false, tasks: 0 }],
  });
  const t = template({ kinds: [{ name: "C", color: "#22c55e", titleTemplate: "", descriptionTemplate: "", subtaskTemplate: [] }] });
  const plan = planReplace(p, t, { kinds: { k1: "g:kind_correccion", kind_correccion: "t:0", k2: "drop" } });
  assert.deepEqual(plan.kindMoves, [{ from: "k1", to: "kind_correccion", toNew: null, tasks: 1 }]);
  assert.deepEqual(plan.dropKinds.sort(), ["k1", "k2"]);
});

test("REPLACE: las etiquetas en uso se conservan; las que no se usan y no están en la plantilla se quitan", () => {
  const p = project({ labels: [{ id: "l1", name: "Urgente", tasks: 0 }, { id: "l2", name: "Cliente", tasks: 3 }, { id: "l3", name: "Vieja", tasks: 0 }] });
  const t = template({ columns: [{ name: "X", role: "NONE", isDone: false }], labels: [{ name: "urgente", color: "#ef4444" }, { name: "Nueva", color: "#22c55e" }] });
  const plan = planReplace(p, t);
  assert.deepEqual(plan.removeLabels, ["l3"]);
  assert.deepEqual(plan.addLabels.map((l) => l.name), ["Nueva"]);
});

test("ADD: solo lo que falta, sin quitar nada; un proyecto que ya lo tiene todo no cambia", () => {
  const p = project({
    labels: [{ id: "l1", name: "Urgente", tasks: 0 }],
    releaseTemplates: [{ kind: "HEADER", name: "Contexto" }],
    taskFields: ["priority"],
  });
  const t = template({
    columns: [{ name: "backlog", role: "NONE", isDone: false }, { name: "Revisión", role: "REVIEW", isDone: false }, { name: "Salto", role: "NEXT_RELEASE", isDone: false }],
    kinds: [{ name: "funcionalidad", color: "#000000", titleTemplate: "", descriptionTemplate: "", subtaskTemplate: [] }, { name: "Mejora", color: "#0ea5e9", titleTemplate: "", descriptionTemplate: "", subtaskTemplate: [] }],
    labels: [{ name: "URGENTE", color: "#ef4444" }, { name: "Frontend", color: "#0ea5e9" }],
    taskFields: ["priority", "hours"],
    releaseTemplates: [{ kind: "HEADER", name: "contexto", content: "x" }, { kind: "FOOTER", name: "Checklist", content: "- [ ] ok" }],
  });
  const plan = planAdd(p, t);
  assert.deepEqual(plan.addColumns.map((c) => c.name), ["Revisión"]);
  assert.deepEqual(plan.addKinds, [1]);
  assert.deepEqual(plan.addLabels.map((l) => l.name), ["Frontend"]);
  assert.deepEqual(plan.addedFields, ["hours"]);
  assert.deepEqual(plan.addReleaseTemplates.map((r) => r.name), ["Checklist"]);
  assert.equal(planIsEmpty(plan, p, t), false);
  const full = project({
    columns: [...p.columns, { id: "r", name: "Revisión", role: "REVIEW", isDone: false, wipLimit: null, active: 0, archived: 0 }],
    kinds: [...GENERALS, { id: "m", name: "Mejora", label: "Mejora", general: false, hidden: false, tasks: 0 }],
    labels: [{ id: "l1", name: "Urgente", tasks: 0 }, { id: "l2", name: "Frontend", tasks: 0 }],
    releaseTemplates: [{ kind: "HEADER", name: "Contexto" }, { kind: "FOOTER", name: "Checklist" }],
    taskFields: ["hours", "priority"],
  });
  assert.equal(planIsEmpty(planAdd(full, t), full, t), true);
});

test("los topes de columnas y etiquetas impiden aplicar con un aviso", () => {
  const many = Array.from({ length: 29 }, (_, i) => ({ id: `c${i}`, name: `Col ${i}`, role: "NONE", isDone: false, wipLimit: null, active: 1, archived: 0 }));
  const p = project({ columns: many, labels: Array.from({ length: 49 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, tasks: 1 })) });
  const t = template({ columns: [{ name: "Nueva 1", role: "NONE", isDone: false }, { name: "Nueva 2", role: "NONE", isDone: false }], labels: [{ name: "A", color: "#ef4444" }, { name: "B", color: "#ef4444" }] });
  const add = planAdd(p, t);
  assert.ok(add.errors.some((e) => e.text.startsWith("No caben las columnas")));
  assert.ok(add.errors.some((e) => e.text.startsWith("No caben las etiquetas")));
  assert.ok(planReplace(p, t).errors.some((e) => e.text.startsWith("Quedarían")));
});

test("todas las plantillas de serie y de los ejemplos se pueden aplicar en los dos modos a un proyecto por defecto", () => {
  const sources = [
    ...BUILTIN_TEMPLATES.map((b) => templateInputSchema.parse(b.data)),
    ...PROJECT_EXAMPLES.flatMap((e) => (["es", "en"] as const).map((l) => templateInputSchema.parse(e[l].template))),
  ];
  for (const t of sources) {
    const shape: ApplyTemplateShape = { ...t, columns: t.columns.map((c) => ({ ...c, wipLimit: c.wipLimit ?? null })) };
    const p = project({ columns: project().columns.map((c) => ({ ...c, active: 2 })) });
    assert.deepEqual(planAdd(p, shape).errors, [], t.name);
    const plan = planReplace(p, shape);
    assert.deepEqual(plan.errors, [], t.name);
    // Cada columna de la plantilla está en el resultado y ninguna actual con tareas se pierde.
    assert.equal(plan.columns.length, t.columns.length);
    const placed = new Set([...plan.columns.flatMap((c) => [c.reuse, ...c.absorb]), ...plan.kept.map((k) => k.id)]);
    for (const c of p.columns) assert.ok(placed.has(c.id), `${t.name}: ${c.name}`);
    // Un tipo de la plantilla que se llama como uno general no crea otro.
    assert.ok(plan.kindTargets.every((k, i) => !("create" in k) || !GENERALS.some((g) => nameKey(g.name) === nameKey(t.kinds[i]!.name))));
  }
});

test("REPLACE: si varias columnas van a la misma, se reutiliza la que ya se llama como ella", () => {
  const p = project({
    columns: [
      { id: "a", name: "Pendiente", role: "NONE", isDone: false, wipLimit: null, active: 3, archived: 0 },
      { id: "b", name: "en curso", role: "NONE", isDone: false, wipLimit: null, active: 2, archived: 1 },
    ],
  });
  const t = template({ columns: [{ name: "En curso", role: "NONE", isDone: false }] });
  const plan = planReplace(p, t, { columns: { a: "t:0", b: "t:0" } });
  assert.equal(plan.columns[0]!.reuse, "b");
  assert.deepEqual(plan.columns[0]!.absorb, ["a"]);
  assert.equal(plan.columns[0]!.incoming, 3);
});

test("REPLACE: el resumen dice qué tareas fijas pasan a normales (su columna pierde el rol de release)", () => {
  const p = project({
    columns: [
      { id: "rel", name: "Para publicar", role: "NEXT_RELEASE", isDone: false, wipLimit: null, active: 4, archived: 0 },
      { id: "hecho", name: "Hecho", role: "NONE", isDone: true, wipLimit: null, active: 1, archived: 0 },
    ],
    evergreen: [
      { id: "e1", title: "Revisar dependencias", columnId: "rel" },
      { id: "e2", title: "Actualizar el changelog", columnId: "rel" },
      { id: "e3", title: "Probar en móvil", columnId: "rel" },
    ],
  });
  // La plantilla no tiene columna de release: «Para publicar» se empareja o se conserva, pero sin ese rol no hay fijas.
  const sinRelease = template({ columns: [{ name: "Por hacer", role: "NONE", isDone: false }, { name: "Hecho", role: "NONE", isDone: true }] });
  const plan = planReplace(p, sinRelease, { columns: { rel: "t:0" } });
  assert.deepEqual(plan.unpinTasks, ["e1", "e2", "e3"]);
  const line = summarizePlan(plan, p, sinRelease).find((l) => l.text.startsWith("{n} tareas fijas pasarán a ser normales"));
  assert.equal(line?.n, 3);
  assert.deepEqual(line?.names, ["Revisar dependencias", "Actualizar el changelog", "Probar en móvil"]);
  // Conservada al final sin pareja, mantiene su rol (la plantilla no lo usa): siguen fijas.
  assert.deepEqual(planReplace(p, sinRelease, { columns: { rel: "keep" } }).unpinTasks, []);
  // La plantilla tiene release y se empareja con ella: siguen fijas y el resumen no dice nada.
  const conRelease = template({ columns: [{ name: "Siguiente release", role: "NEXT_RELEASE", isDone: false }, { name: "Hecho", role: "NONE", isDone: true }] });
  const keep = planReplace(p, conRelease);
  assert.deepEqual(keep.unpinTasks, []);
  assert.ok(!summarizePlan(keep, p, conRelease).some((l) => l.text.includes("fija")));
  // Conservada al final cuando la plantilla ya usa el rol: lo pierde y sus fijas pasan a normales.
  assert.deepEqual(planReplace(p, conRelease, { columns: { rel: "keep" } }).unpinTasks, ["e1", "e2", "e3"]);
  // Muchas: como mucho 10 nombres y «…».
  const many = project({ ...p, evergreen: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, title: `Fija ${i}`, columnId: "rel" })) });
  const names = summarizePlan(planReplace(many, sinRelease, { columns: { rel: "t:0" } }), many, sinRelease).find((l) => l.text.includes("fijas"))!.names!;
  assert.equal(names.length, 11);
  assert.equal(names.at(-1), "…");
});

test("ADD: vuelven a verse los tipos generales ocultos que usa la plantilla (y el resumen lo dice)", () => {
  const hidden = (ids: string[]) => GENERALS.map((k) => ({ ...k, hidden: ids.includes(k.id) }));
  // Plantilla que usa los generales (no oculta ninguno): vuelven los dos ocultos.
  const p = project({ kinds: hidden(["kind_correccion", "kind_respuesta"]) });
  const usaTodos = template({ columns: [{ name: "Hecho", role: "NONE", isDone: true }] });
  const plan = planAdd(p, usaTodos);
  assert.deepEqual(plan.showGenerals, ["kind_correccion", "kind_respuesta"]);
  const line = summarizePlan(plan, p, usaTodos).find((l) => l.text === "Volverán a verse {n} tipos generales");
  assert.deepEqual(line?.names, ["Corrección", "Respuesta"]);
  assert.equal(planIsEmpty(plan, p, usaTodos), false);
  // Plantilla que oculta «Corrección»: solo vuelve «Respuesta».
  assert.deepEqual(planAdd(p, template({ hiddenGeneralKinds: ["corrección"] })).showGenerals, ["kind_respuesta"]);
  // Plantilla que los oculta todos pero tiene un tipo que se llama como uno general: ese sí vuelve (y no se crea otro).
  const conTipo = template({ hideAllGeneralKinds: true, kinds: [{ name: "Respuesta", color: "#000000", titleTemplate: "", descriptionTemplate: "", subtaskTemplate: [] }] });
  const plan2 = planAdd(p, conTipo);
  assert.deepEqual(plan2.showGenerals, ["kind_respuesta"]);
  assert.deepEqual(plan2.addKinds, []);
  // Si ninguno está oculto, no hay nada que mostrar.
  assert.deepEqual(planAdd(project(), usaTodos).showGenerals, []);
});
