// Formato «pizarro.task» (lib/task-json.ts): lo que se copia se vuelve a leer igual, y se entiende lo que escribe una IA.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTaskJson, buildTasksJson, parseDayLoose, parseTaskJson, parseTasksText, strictJsonFormat, stringifyTaskJson, TASK_JSON_MAX_CHARS, TASK_JSON_MAX_LABELS, TASKS_JSON_MAX,
  TASKS_TEXT_MAX_CHARS, tasksExportFileName, type TaskJsonSource, actionTextFits,
} from "../src/lib/task-json";
import { importPreview } from "../src/lib/task-json-form";
import { decideDayOrder, parseDay } from "../src/lib/foreign-import/text";
import { makeT } from "../src/i18n/core";
import { esT } from "../src/i18n/shared";
import { assertFast } from "./timing";

const source: TaskJsonSource = {
  info: { id: "t1", project: "Web", projectId: "p1", url: "https://pizarro.example.com/p/p1?task=t1", createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-02T10:00:00.000Z", createdBy: "Ana" },
  title: "Preparar la demo", description: "Texto **Markdown**\n\n- uno\n- dos", type: "Funcionalidad", column: "En progreso", labels: ["cliente", "urgente"],
  assignee: { id: "u1", name: "Ana Pérez" }, dueDate: "2026-12-01", recurrence: "WEEKLY", recurrenceDay: 2, color: "#ef4444", deliverable: "Entrega 1",
  link: "https://example.com/x", subtasks: [{ text: "Guion", done: true }, { text: "Ensayo", done: false }], dependsOn: { id: "t0", title: "Contratar la sala" },
  googleDocs: [{ kind: "GOOGLE_SHEET", title: "Presupuesto", url: "https://docs.google.com/spreadsheets/d/abc/edit" }],
  attachments: [{ name: "captura.png", url: "https://pizarro.example.com/api/attachments/a1" }],
  enabledFields: ["cost", "hours", "priority", "client", "startDate"],
  startDate: "2026-11-20", priority: "ALTA", client: "Acme", cost: "120.50", costPaid: true, estimatedHours: "8.00", actualHours: "2.50",
};

test("copiar: marcador, versión, claves en orden estable y solo los campos opcionales activos", () => {
  const json = buildTaskJson(source);
  assert.deepEqual(Object.keys(json), [
    "format", "version", "title", "description", "type", "column", "labels", "assignee", "dueDate", "startDate", "priority", "client", "cost", "costPaid",
    "estimatedHours", "actualHours", "recurrence", "color", "deliverable", "link", "subtasks", "dependsOn", "googleDocs", "attachments", "info",
  ]);
  assert.deepEqual([json.format, json.version, json.priority, json.cost, json.estimatedHours, json.recurrence], ["pizarro.task", 1, "high", 120.5, 8, { rule: "weekly", day: 2 }]);
  assert.deepEqual(json.info, { id: "t1", project: "Web", projectId: "p1", url: "https://pizarro.example.com/p/p1?task=t1", createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-02T10:00:00.000Z", createdBy: "Ana" });
  assert.deepEqual([json.assignee, json.dependsOn], [{ id: "u1", name: "Ana Pérez" }, { id: "t0", title: "Contratar la sala" }]);
  // Sin `info` ni lo que solo tiene una tarea guardada (formulario de «Nueva tarea»), esas claves no se escriben.
  const draft = buildTaskJson({ ...source, info: undefined, labels: undefined, color: undefined, link: undefined, dependsOn: undefined, googleDocs: undefined, attachments: undefined });
  for (const k of ["info", "labels", "color", "link", "dependsOn", "googleDocs", "attachments"]) assert.ok(!(k in draft), k);
  const plain = buildTaskJson({ ...source, enabledFields: ["priority"], priority: null, recurrence: "NONE", recurrenceDay: null });
  for (const k of ["cost", "costPaid", "estimatedHours", "actualHours", "client", "startDate"]) assert.ok(!(k in plain), k);
  assert.deepEqual([plain.priority, plain.recurrence], [null, { rule: "none" }]);
  // Legible: sangrado de dos espacios y el mismo texto cada vez.
  assert.equal(stringifyTaskJson(json), stringifyTaskJson(buildTaskJson(source)));
  assert.match(stringifyTaskJson(json), /^\{\n {2}"format": "pizarro\.task",\n {2}"version": 1,\n {2}"title": "Preparar la demo",/);
});

test("ida y vuelta: lo copiado se lee con los mismos valores; adjuntos no se leen e info solo como referencia", () => {
  const parsed = parseTaskJson(stringifyTaskJson(buildTaskJson(source)));
  assert.equal(parsed.kind, "task");
  if (parsed.kind !== "task") return;
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.task, {
    title: "Preparar la demo", description: "Texto **Markdown**\n\n- uno\n- dos", type: "Funcionalidad", column: "En progreso", labels: ["cliente", "urgente"],
    assignee: { id: "u1", name: "Ana Pérez" }, dueDate: "2026-12-01", startDate: "2026-11-20", priority: "ALTA", client: "Acme", cost: "120.5", costPaid: true,
    estimatedHours: "8", actualHours: "2.5", recurrence: { rule: "WEEKLY", day: 2 }, color: "#ef4444", deliverable: "Entrega 1", link: "https://example.com/x",
    subtasks: [{ text: "Guion", done: true }, { text: "Ensayo", done: false }], dependsOn: { id: "t0", title: "Contratar la sala" },
    googleDocs: [{ kind: "GOOGLE_SHEET", title: "Presupuesto", url: "https://docs.google.com/spreadsheets/d/abc/edit" }],
    info: { id: "t1", projectId: "p1" },
  });
  // Una tarea vacía también va y vuelve: null vacía los campos, las listas quedan vacías.
  const empty = parseTaskJson(stringifyTaskJson(buildTaskJson({ ...source, description: "", labels: [], assignee: null, dueDate: null, recurrence: "NONE", recurrenceDay: null, color: null, deliverable: null, link: null, subtasks: [], dependsOn: null, googleDocs: [], attachments: [], enabledFields: [] })));
  assert.equal(empty.kind, "task");
  if (empty.kind !== "task") return;
  assert.deepEqual(empty.task, {
    title: "Preparar la demo", description: "", type: "Funcionalidad", column: "En progreso", labels: [], assignee: null, dueDate: null, recurrence: { rule: "NONE" }, color: null,
    deliverable: null, link: null, subtasks: [], dependsOn: null, googleDocs: [], info: { id: "t1", projectId: "p1" },
  });
});

test("JSON de una IA: claves en español o con mayúsculas, bloque ```json, fechas ISO, prioridad y subtareas variadas", () => {
  const ai = "```json\n" + JSON.stringify({
    Título: "  Llamar al proveedor  ",
    DESCRIPCION: ["Primera línea", "Segunda línea"],
    Tipo: "corrección",
    Estado: "Por hacer",
    Etiquetas: "compras, Urgente; compras",
    Responsable: "Ana Pérez <ANA@example.com>",
    fecha_limite: "2026-12-01T09:30:00+01:00",
    "Fecha de inicio": "15/11/2026",
    Prioridad: "Urgente",
    Coste: "1200,5 €",
    pagado: "sí",
    "horas-estimadas": 3,
    Repetición: { cada: "semana", día: "martes" },
    Subtareas: ["- [x] Buscar el teléfono", "[ ] Preparar preguntas", { titulo: "Enviar resumen", hecha: true }, "", 7],
    "depende de": { id: "abc", title: "Aprobar presupuesto" },
    Enlace: "example.com/proveedor",
    documentos: ["https://docs.google.com/document/d/1/edit", "https://evil.example.com/x", { url: "https://docs.google.com/presentation/d/2/edit", titulo: "Diapositivas", tipo: "slides" }],
    comentario: "esto no es un campo",
  }, null, 2) + "\n```";
  const parsed = parseTaskJson(ai);
  assert.equal(parsed.kind, "task");
  if (parsed.kind !== "task") return;
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.task, {
    title: "Llamar al proveedor", description: "Primera línea\nSegunda línea", type: "corrección", column: "Por hacer", labels: ["compras", "Urgente"],
    assignee: { name: "Ana Pérez", email: "ana@example.com" }, dueDate: "2026-12-01", startDate: "2026-11-15", priority: "URGENTE", cost: "1200.5", costPaid: true,
    estimatedHours: "3", recurrence: { rule: "WEEKLY", day: 2 },
    subtasks: [{ text: "Buscar el teléfono", done: true }, { text: "Preparar preguntas", done: false }, { text: "Enviar resumen", done: true }, { text: "7", done: false }],
    dependsOn: { id: "abc", title: "Aprobar presupuesto" }, link: "example.com/proveedor",
    googleDocs: [
      { kind: "GOOGLE_DOC", title: "https://docs.google.com/document/d/1/edit", url: "https://docs.google.com/document/d/1/edit" },
      { kind: "GOOGLE_SLIDES", title: "Diapositivas", url: "https://docs.google.com/presentation/d/2/edit" },
    ],
  });
});

test("JSON de una IA: solo algunos campos, envuelto en { task }, o en una lista de un elemento", () => {
  const only = parseTaskJson('{"format":"PIZARRO.TASK","dueDate":"2026-01-05","labels":[]}');
  assert.deepEqual(only, { kind: "task", task: { dueDate: "2026-01-05", labels: [] }, problems: [] });
  assert.deepEqual(parseTaskJson('{"task":{"title":"Dentro","assignee":"ana@example.com"}}'), { kind: "task", task: { title: "Dentro", assignee: { email: "ana@example.com" } }, problems: [] });
  assert.deepEqual(parseTaskJson('[{"title":"En lista","priority":null,"recurrence":"daily"}]'), { kind: "task", task: { title: "En lista", priority: null, recurrence: { rule: "DAILY" } }, problems: [] });
  assert.deepEqual(parseTaskJson('{"title":"T","assignee":"Ana","type":null,"column":null}'), { kind: "task", task: { title: "T", assignee: { name: "Ana" } }, problems: [] });
});

test("valores que no se entienden: el campo se omite y se anota, el resto se lee", () => {
  const parsed = parseTaskJson(JSON.stringify({ format: "pizarro.task", title: "Vale", dueDate: "mañana", priority: "altísima", cost: -3, subtasks: 5, labels: { a: 1 }, recurrence: "a veces", assignee: 7, startDate: "2026-02-31" }));
  assert.equal(parsed.kind, "task");
  if (parsed.kind !== "task") return;
  assert.deepEqual(parsed.task, { title: "Vale" });
  assert.deepEqual([...parsed.problems].sort(), ["assignee", "cost", "dueDate", "labels", "priority", "recurrence", "startDate", "subtasks"]);
});

test("lo que no es una tarea no se toca; lo que quiere serlo y no se puede leer es inválido", () => {
  for (const text of ["", "hola", "Un texto con {llaves}", "123", '"cadena"', "[1,2,3]", '{"a":1}', '{"format":"otra.cosa","title":"x"}', '{"title":""}', '{"title":5}', "{ roto", '[{"title":"a"},{"title":"b"}]']) {
    assert.deepEqual(parseTaskJson(text), { kind: "none" }, text);
  }
  assert.deepEqual(parseTaskJson('{"format":"pizarro.task","title":"sin cerrar"'), { kind: "invalid" });
  assert.deepEqual(parseTaskJson('{"format":"pizarro.task","version":1}'), { kind: "invalid" });
  assert.deepEqual(parseTaskJson('{"format":"pizarro.task","dueDate":"ayer"}'), { kind: "invalid" });
  assert.deepEqual(parseTaskJson(JSON.stringify({ format: "pizarro.task", title: "x", description: "a".repeat(TASK_JSON_MAX_CHARS) })), { kind: "invalid" });
  // Un JSON con __proto__ o claves raras no rompe nada.
  assert.deepEqual(parseTaskJson('{"__proto__":{"title":"x"},"constructor":1,"title":"Seguro"}'), { kind: "task", task: { title: "Seguro" }, problems: [] });
});

test("el título queda en una línea: saltos de línea y tabuladores pasan a ser un espacio", () => {
  const parsed = parseTaskJson(JSON.stringify({ format: "pizarro.task", title: "  Uno\tdos  \r\n  tres\n\ncuatro  cinco " }));
  assert.deepEqual(parsed, { kind: "task", task: { title: "Uno dos tres cuatro  cinco" }, problems: [] });
});

test("fechas: AAAA-MM-DD, ISO completa, DD/MM/AAAA; null y vacío la quitan", () => {
  assert.deepEqual(
    ["2026-12-01", "2026-1-5", "2026-12-01T23:59:59Z", "2026-12-01 10:00", "01/12/2026", "1.12.2026", "", null].map((v) => parseDayLoose(v)),
    ["2026-12-01", "2026-01-05", "2026-12-01", "2026-12-01", "2026-12-01", "2026-12-01", null, null],
  );
  for (const bad of ["2026-13-01", "2026-02-30", "12/2026", "mañana", 20261201, {}]) assert.equal(parseDayLoose(bad), undefined, String(bad));
});

test("fechas: MM/DD/AAAA (EE. UU.) cuando no puede ser día/mes; lo ambiguo sigue siendo día/mes", () => {
  assert.equal(parseDayLoose("11/21/2026"), "2026-11-21");
  assert.equal(parseDayLoose("2/29/2028"), "2028-02-29");
  assert.equal(parseDayLoose("03/04/2026"), "2026-04-03");
  assert.equal(parseDayLoose("21/11/2026"), "2026-11-21");
  for (const bad of ["13/13/2026", "2/30/2026", "02/29/2027"]) assert.equal(parseDayLoose(bad), undefined, bad);
});

test("fechas: el año con dos cifras se lee igual que en los CSV («21/12/26» → 2026-12-21)", () => {
  for (const v of ["21/12/26", "1/2/26", "12/21/26", "03.04.26"]) assert.equal(parseDayLoose(v), parseDay(v), v);
  assert.equal(parseDayLoose("21/12/26"), "2026-12-21");
  for (const bad of ["1/2/2", "1/2/026", "29/2/27"]) assert.equal(parseDayLoose(bad), undefined, bad);
});

test("fechas: el JSON lee los mismos formatos que el CSV (parseDay), con puntos siempre día/mes", () => {
  const cases: [string, string][] = [
    ["2026/12/01", "2026-12-01"], ["2026.12.01", "2026-12-01"], ["1.12.2026 10:00", "2026-12-01"], ["1.12.2026.", "2026-12-01"],
    ["1-dic-2026", "2026-12-01"], ["December 1, 2026", "2026-12-01"], ["1 de diciembre de 2026", "2026-12-01"],
  ];
  for (const [v, want] of cases) {
    for (const order of ["dmy", "mdy"] as const) {
      assert.equal(parseDayLoose(v, order), want, `${v} ${order}`);
      assert.equal(parseDayLoose(v, order), parseDay(v, "UTC", order), `${v} ${order} igual que el CSV`);
    }
  }
  // En un JSON de tareas entero, igual que pegado como CSV.
  const json = parseTasksText(JSON.stringify({ tasks: [{ title: "A", dueDate: "2026/12/01", startDate: "1.12.2026 10:00" }] }));
  assert.deepEqual([json.tasks[0]?.task.dueDate, json.tasks[0]?.task.startDate], ["2026-12-01", "2026-12-01"]);
});

// El servidor interpreta el texto que le manda cualquier persona con sesión: ningún JSON de hasta 200 000 caracteres
// puede tenerlo ocupado varios segundos (expresiones regulares o comparaciones cuadráticas) ni hacerle lanzar.
test("textos patológicos: se leen en poco tiempo y sin lanzar (responsable, importes, miles de etiquetas, listas anidadas)", () => {
  const quick = (name: string, raw: string): ReturnType<typeof parseTaskJson> => {
    assert.ok(raw.length <= TASK_JSON_MAX_CHARS, `${name}: cabe en el tope`);
    const t0 = performance.now();
    const out = parseTaskJson(raw);
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `${name}: ${Math.round(ms)} ms`);
    return out;
  };
  const N = 190_000;
  const of = (o: object) => JSON.stringify({ title: "x", ...o });
  // Valores cortos desmesurados: no se intentan entender (se anotan como problema) y el resto se lee.
  for (const [field, value] of [
    ["assignee", `a${" ".repeat(N)}b`], ["assignee", "@".repeat(N)], ["cost", `1${" ".repeat(N)}x`], ["estimatedHours", `1${" ".repeat(N)}x`], ["actualHours", `1${" ".repeat(N)}x`],
  ] as const) {
    assert.deepEqual(quick(field, of({ [field]: value })), { kind: "task", task: { title: "x" }, problems: [field] }, field);
  }
  // Miles de etiquetas distintas: se leen las primeras (por tarea solo caben 20) sin comparar todas con todas.
  const many = Array.from({ length: 30_000 }, (_, i) => i.toString(36));
  for (const labels of [many, many.join(",")]) {
    const out = quick("labels", of({ labels }));
    assert.ok(out.kind === "task" && out.task.labels!.length === TASK_JSON_MAX_LABELS && out.task.labels![0] === "0" && out.problems.length === 0);
  }
  assert.deepEqual((parseTaskJson(of({ labels: ["Rojo", "rojo", "#ROJO", "azul"] })) as { task: { labels: string[] } }).task.labels, ["Rojo", "azul"], "sin repetidas");
  const docs = quick("googleDocs", of({ googleDocs: Array.from({ length: 6000 }, (_, i) => `https://docs.google.com/d/${i % 3000}`) }));
  assert.ok(docs.kind === "task" && docs.task.googleDocs!.length === 3000);
  // Listas dentro de listas: «dependsOn» toma el primer elemento, sin recursión (90 000 niveles agotaban la pila).
  const nested = quick("dependsOn anidado", `{"title":"x","dependsOn":${"[".repeat(90_000)}"y"${"]".repeat(90_000)}}`);
  assert.deepEqual(nested, { kind: "task", task: { title: "x" }, problems: ["dependsOn"] });
  assert.deepEqual((parseTaskJson(of({ dependsOn: ["Otra"] })) as { task: object }).task, { title: "x", dependsOn: { title: "Otra" } });
  assert.deepEqual((parseTaskJson(of({ dependsOn: [null] })) as { task: object }).task, { title: "x", dependsOn: null });
  assert.deepEqual((parseTaskJson(of({ dependsOn: [] })) as { task: object }).task, { title: "x", dependsOn: null });
});

test("JSON de una IA con texto alrededor del bloque de código", () => {
  const r = parseTaskJson('Aquí tienes la tarea:\n\n```json\n{"format":"pizarro.task","version":1,"title":"Desde la IA"}\n```\n\nEspero que te sirva.');
  assert.equal(r.kind, "task");
  if (r.kind === "task") assert.equal(r.task.title, "Desde la IA");
  assert.equal(parseTaskJson("Hola\n```js\nconsole.log(1)\n```").kind, "none");
  assert.equal(parseTaskJson("```".repeat(5000)).kind, "none");
});

// --- Varias tareas (importar y exportar) y Ctrl+V estricto ---

test("info: el proyecto de origen sale de projectId o, si no, del enlace; el responsable también por id", () => {
  const viaUrl = parseTaskJson(JSON.stringify({ format: "pizarro.task", title: "x", info: { id: "t9", url: "https://pizarro.example.com/p/abc_123?task=t9" } }));
  assert.ok(viaUrl.kind === "task");
  if (viaUrl.kind === "task") assert.deepEqual(viaUrl.task.info, { id: "t9", projectId: "abc_123" });
  const who = parseTaskJson('{"title":"x","assignee":{"id":"u7","name":"Ana"}}');
  assert.ok(who.kind === "task" && who.task.assignee?.id === "u7" && who.task.assignee.name === "Ana");
  assert.deepEqual((parseTaskJson('{"title":"x","info":{"createdBy":"Ana"}}') as { task: object }).task, { title: "x" }, "info sin id ni proyecto no se guarda");
});

test("varias tareas: envoltorio, lista, líneas sueltas, bloques ```json y texto alrededor", () => {
  const exported = JSON.stringify(buildTasksJson({ id: "p1", name: "Web" }, [buildTaskJson(source), { ...buildTaskJson(source), title: "Otra", info: undefined }], "2026-11-16T10:00:00.000Z"), null, 2);
  const a = parseTasksText(exported);
  assert.deepEqual([a.total, a.tasks.length, a.failed.length, a.tooMany, a.tooLong], [2, 2, 0, false, false]);
  assert.deepEqual(a.project, { name: "Web", id: "p1" });
  assert.deepEqual(a.tasks.map((x) => [x.n, x.task.title, x.task.info]), [[1, "Preparar la demo", { id: "t1", projectId: "p1" }], [2, "Otra", { projectId: "p1" }]]);
  // Lo exportado se lee igual que cada tarea por separado.
  assert.deepEqual(a.tasks[0]!.task, (parseTaskJson(stringifyTaskJson(buildTaskJson(source))) as { task: object }).task);

  const mixed = [
    "Aquí tienes las tareas que pediste:",
    "",
    "```json",
    '[{"title":"Uno"},{"título":"Dos","fecha_limite":"01/02/2027"}]',
    "```",
    "Y una más, suelta:",
    '{"format":"pizarro.task","title":"Tres"}',
    "",
    '{"title":"Cuatro"} {"title":"Cinco"}',
    "- [x] esto es una lista de Markdown, no JSON",
    '{"title": "rota", }',
    '{"format":"pizarro.task","descripcion":5}',
    '{"otra":"cosa"}',
    "¿Te sirve? {saludos}",
  ].join("\n");
  const b = parseTasksText(mixed);
  assert.deepEqual(b.tasks.map((x) => x.task.title), ["Uno", "Dos", "Tres", "Cuatro", "Cinco"]);
  assert.equal(b.tasks[1]!.task.dueDate, "2027-02-01");
  assert.deepEqual(b.failed.map((f) => f.reason).sort(), ["empty", "json", "notTask"]);
  assert.equal(b.total, 8);

  // Una sola tarea (lo que lee el detalle de la tarea) y nada.
  assert.equal(parseTasksText('{"format":"pizarro.task","dueDate":"2026-01-05"}').tasks.length, 1);
  assert.deepEqual(parseTasksText("hola, sin JSON"), { tasks: [], failed: [], total: 0, tooMany: false, tooLong: false, warnings: [] });
});

test("varias tareas: topes de cantidad y de tamaño", () => {
  const many = JSON.stringify(Array.from({ length: TASKS_JSON_MAX + 20 }, (_, i) => ({ title: `T${i}` })));
  const r = parseTasksText(many);
  assert.deepEqual([r.total, r.tooMany, r.tasks.length], [TASKS_JSON_MAX + 20, true, TASKS_JSON_MAX]);
  assert.equal(parseTasksText("x".repeat(TASKS_TEXT_MAX_CHARS + 1)).tooLong, true);
});

// El servidor vuelve a leer el texto de importar (hasta 5 MB de cualquiera con sesión): nada cuadrático.
test("varias tareas, textos patológicos: tiempo lineal y sin lanzar", () => {
  const N = 4_000_000;
  const cases: [string, string][] = [
    ["llaves sin cerrar", "{".repeat(N)],
    ["corchetes abiertos y cerrados", "[".repeat(N / 2) + "]".repeat(N / 2)],
    ["comillas sin cerrar", `{"title":"${"a".repeat(N)}`],
    ["muchas llaves vacías", "{}".repeat(N / 2)],
    ["texto con llaves sueltas", "a { b } c ".repeat(N / 10)],
    ["vallas de código", "```json\n".repeat(N / 8)],
    ["muchas listas pequeñas", "[x] ".repeat(N / 4)],
    ["escapes", `{"title":"${"\\\\".repeat(N / 2)}"}`],
  ];
  for (const [name, text] of cases) {
    assert.ok(text.length <= TASKS_TEXT_MAX_CHARS, name);
    assertFast(3000, () => parseTasksText(text), name);
  }
  // Muchas tareas pequeñas seguidas: se cuentan todas, se leen las primeras 500.
  const lots = '{"title":"t"}\n'.repeat(300_000);
  const r = assertFast(3000, () => parseTasksText(lots), "300 000 tareas seguidas");
  assert.ok(r.tooMany && r.tasks.length === TASKS_JSON_MAX);
});

test("Ctrl+V estricto: solo un objeto JSON con su marcador, sin nada alrededor", () => {
  const one = stringifyTaskJson(buildTaskJson(source));
  assert.equal(strictJsonFormat(one), "pizarro.task");
  assert.equal(strictJsonFormat(`﻿ \n${one}\n\t `), "pizarro.task", "espacios y BOM alrededor sí");
  assert.equal(strictJsonFormat('{"format":"pizarro.tasks","version":1,"tasks":[]}'), "pizarro.tasks");
  for (const text of [
    "```json\n" + one + "\n```", `Aquí tienes: ${one}`, `${one}\nGracias`, `[${one}]`, `${one}\n${one}`, '{"title":"Sin marcador"}', '{"format":"PIZARRO.TASK","title":"x"}',
    '{"format":"pizarro.task","title":"sin cerrar"', '{"format":"pizarro.tasks"}', "hola", "", '{"formato":"pizarro.task","title":"x"}',
    JSON.stringify({ format: "pizarro.task", description: "a".repeat(TASK_JSON_MAX_CHARS) }),
  ]) {
    assert.equal(strictJsonFormat(text), null, text.slice(0, 60));
  }
});

test("nombre del fichero de exportar: seguro y con la fecha", () => {
  assert.equal(tasksExportFileName("tareas", "Mi Proyecto: Año 2026 / Fase ½", "2026-11-16"), "tareas-mi-proyecto-ano-2026-fase-2026-11-16.json");
  assert.equal(tasksExportFileName("tasks", "../../etc/passwd", "2026-11-16"), "tasks-etc-passwd-2026-11-16.json");
  assert.equal(tasksExportFileName("tareas", "日本語", "2026-11-16"), "tareas-proyecto-2026-11-16.json");
  assert.ok(tasksExportFileName("tareas", "x".repeat(500), "2026-11-16").length < 90);
});

test("el projectId de un envoltorio «pizarro.tasks» vale solo para sus tareas, no para las sueltas ni para otro envoltorio", () => {
  const wrap = (projectId: string, title: string) => JSON.stringify({ format: "pizarro.tasks", version: 1, project: projectId, projectId, tasks: [{ title }] });
  const text = ['{"title":"Suelta antes"}', wrap("p1", "De p1"), '{"title":"Suelta después"}', wrap("p2", "De p2"), '[{"title":"En lista"}]'].join("\n");
  const r = parseTasksText(text);
  assert.deepEqual(r.tasks.map((x) => [x.task.title, x.task.info?.projectId ?? null]), [
    ["Suelta antes", null], ["De p1", "p1"], ["Suelta después", null], ["De p2", "p2"], ["En lista", null],
  ]);
  // El resumen del proyecto, el del primer envoltorio.
  assert.deepEqual(r.project, { name: "p1", id: "p1" });
});

test("actionTextFits: lo que cabe en una acción de servidor (1 MB) medido en JSON y UTF-8", () => {
  assert.equal(actionTextFits("x".repeat(TASK_JSON_MAX_CHARS)), true);
  assert.equal(actionTextFits("ñ".repeat(TASK_JSON_MAX_CHARS)), true);
  assert.equal(actionTextFits("🙂".repeat(TASK_JSON_MAX_CHARS / 2)), true);
  // Sustitutos sueltos o caracteres de control: 6 bytes cada uno al escribirlos en JSON.
  assert.equal(actionTextFits("\ud800".repeat(TASK_JSON_MAX_CHARS)), false);
  assert.equal(actionTextFits("\u0001".repeat(TASK_JSON_MAX_CHARS)), false);
  assert.equal(actionTextFits("x".repeat(1_000_000)), false);
});

test("los nombres de los avisos de la vista previa se recortan sin partir emojis", () => {
  const name = `${"a".repeat(39)}👨‍👩‍👧 y más`;
  const { notices } = importPreview({ column: name }, { columns: [], kinds: [] }, null, esT);
  // Con slice(0, 40) quedaba medio emoji (un sustituto suelto); ahora el emoji entero o nada.
  assert.equal(notices[0], `columna «${"a".repeat(39)}…» (no existe)`);
  const short = importPreview({ column: `${"a".repeat(30)}👨‍👩‍👧${"b".repeat(20)}` }, { columns: [], kinds: [] }, null, esT).notices[0]!;
  assert.equal(short, `columna «${"a".repeat(30)}👨‍👩‍👧b…» (no existe)`);
});

test("task-json-core: sin imports (lo usa el código del navegador) y reexportado por task-json", async () => {
  const { readFileSync } = await import("node:fs");
  const core = await import("../src/lib/task-json-core");
  const src = readFileSync(new URL("../src/lib/task-json-core.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /^\s*(import|export \{[^}]*\} from)\s/m, "task-json-core no importa nada");
  assert.equal(strictJsonFormat, core.strictJsonFormat);
  assert.equal(TASK_JSON_MAX_CHARS, core.TASK_JSON_MAX_CHARS);
  assert.equal(TASKS_TEXT_MAX_CHARS, core.TASKS_TEXT_MAX_CHARS);
  assert.equal(core.isObject({}), true);
  assert.equal(core.isObject([]), false);
});

test("los diálogos que importan tareas leen con la zona horaria de la aplicación y el idioma de quien importa", async () => {
  // Sin zona horaria, la fecha límite de Trello (un instante UTC) caía en el día de UTC: 23:30Z en Madrid ya es el siguiente.
  const card = JSON.stringify({ id: "c", idBoard: "b", name: "Tarjeta", due: "2026-12-15T23:30:00.000Z" });
  assert.equal(parseTasksText(card, { timeZone: "Europe/Madrid" }).tasks[0]!.task.dueDate, "2026-12-16");
  const { readFileSync } = await import("node:fs");
  for (const file of ["NewTaskDialog.tsx", "TaskDialog.tsx", "ImportTasksDialog.tsx"]) {
    const src = readFileSync(new URL(`../src/components/board/${file}`, import.meta.url), "utf8");
    const calls = src.match(/parseTasksText\([^;]*?\}\)/g) ?? [];
    assert.ok(calls.length > 0, file);
    for (const call of calls) assert.match(call, /, \{ t, timeZone: appTimeZone\(\), locale(?:: uiLocale)? \}\)$/, `${file}: ${call}`);
  }
  // Y el error de un formato reconocido que no se puede leer se enseña (no «No hay ninguna tarea en JSON.»).
  const form = readFileSync(new URL("../src/components/board/NewTaskDialog.tsx", import.meta.url), "utf8");
  assert.match(form, /if \(read\.error\) \{\s*toast\(read\.error, "error"\);/);
});

test("fechas con barras: un solo orden día/mes para todo el texto, decidido por las fechas y, si todas son ambiguas, por el idioma", () => {
  const due = (text: string, locale?: "es" | "en") => parseTasksText(text, { locale }).tasks.map((x) => x.task.dueDate);
  // Una que solo puede ser mes/día (03/21) hace que la ambigua (03/04) también lo sea, en cualquier idioma.
  const us = JSON.stringify([{ title: "A", dueDate: "03/04/2026" }, { title: "B", dueDate: "03/21/2026" }]);
  for (const locale of ["es", "en"] as const) assert.deepEqual(due(us, locale), ["2026-03-04", "2026-03-21"], locale);
  // Y una que solo puede ser día/mes (21/03), al revés.
  const eu = JSON.stringify([{ title: "A", dueDate: "03/04/2026" }, { title: "B", dueDate: "21/03/2026" }]);
  for (const locale of ["es", "en"] as const) assert.deepEqual(due(eu, locale), ["2026-04-03", "2026-03-21"], locale);
  // Todas ambiguas: el idioma de quien importa (en → mes/día; es o sin idioma → día/mes).
  const both = JSON.stringify([{ title: "A", dueDate: "03/04/2026" }, { title: "B", dueDate: "05/06/26" }]);
  assert.deepEqual(due(both, "en"), ["2026-03-04", "2026-05-06"]);
  assert.deepEqual(due(both, "es"), ["2026-04-03", "2026-06-05"]);
  assert.deepEqual(due(both), ["2026-04-03", "2026-06-05"]);
  // Cuenta también la fecha de inicio y las tareas sueltas, en bloques o dentro de { task }.
  const loose = `{"title":"A","startDate":"02/25/2026","dueDate":"03/04/2026"}\n\n\`\`\`json\n{"task":{"title":"B","dueDate":"01/02/2026"}}\n\`\`\``;
  const read = parseTasksText(loose, { locale: "es" });
  assert.deepEqual(read.tasks.map((x) => [x.task.startDate, x.task.dueDate]), [["2026-02-25", "2026-03-04"], [undefined, "2026-01-02"]]);
  assert.deepEqual(read.warnings, []);
  assert.equal(read.dateWarning, undefined);
  // Una sola tarea (Importar tarea, pegar): su fecha de inicio decide la límite.
  assert.deepEqual(parseTaskJson('{"title":"T","startDate":"12/31/2026","dueDate":"01/02/2027"}'), { kind: "task", task: { title: "T", startDate: "2026-12-31", dueDate: "2027-01-02" }, problems: [] });
});

test("fechas con barras incompatibles entre sí: se avisa, las ambiguas van por el idioma y las otras de la única manera posible", () => {
  const text = JSON.stringify({ format: "pizarro.tasks", tasks: [{ title: "A", dueDate: "21/03/2026" }, { title: "B", dueDate: "03/21/2026" }, { title: "C", dueDate: "03/04/2026" }] });
  const en = parseTasksText(text, { t: makeT("en"), locale: "en" });
  assert.deepEqual(en.tasks.map((x) => x.task.dueDate), ["2026-03-21", "2026-03-21", "2026-03-04"]);
  assert.equal(en.warnings.length, 1);
  assert.equal(en.dateWarning, en.warnings[0]);
  assert.match(en.dateWarning!, /two formats .* read as month\/day/);
  const es = parseTasksText(text, { locale: "es" });
  assert.deepEqual(es.tasks.map((x) => x.task.dueDate), ["2026-03-21", "2026-03-21", "2026-04-03"]);
  assert.match(es.dateWarning!, /dos formatos .* leído como día\/mes/);
  // Lo mismo en un CSV pegado (y en uno de Jira o Asana: el mismo lector).
  const csv = parseTasksText("Title,Due date\nA,21/03/2026\nB,03/21/2026\nC,03/04/2026", { locale: "en" });
  assert.deepEqual(csv.tasks.map((x) => x.task.dueDate), ["2026-03-21", "2026-03-21", "2026-03-04"]);
  assert.ok(csv.dateWarning && csv.warnings.includes(csv.dateWarning));
});

test("parseDayLoose y decideDayOrder: el orden pedido, y al revés solo si en ese orden el mes no existe", () => {
  assert.equal(parseDayLoose("03/04/2026", "mdy"), "2026-03-04");
  assert.equal(parseDayLoose("03/04/2026", "dmy"), "2026-04-03");
  assert.equal(parseDayLoose("21/03/2026", "mdy"), "2026-03-21");
  assert.equal(parseDayLoose("03/21/2026", "dmy"), "2026-03-21");
  assert.equal(parseDayLoose("13/13/2026", "mdy"), undefined);
  for (const v of ["03/04/2026", "21/03/26", "3.4.2026", "03-21-2026"]) {
    for (const order of ["dmy", "mdy"] as const) assert.equal(parseDayLoose(v, order), parseDay(v, "UTC", order), `${v} ${order}`);
  }
  assert.deepEqual(decideDayOrder(["03/04/2026", "03/21/2026"]), { order: "mdy", mixed: false });
  assert.deepEqual(decideDayOrder(["03/04/2026", "21/03/2026"], "en"), { order: "dmy", mixed: false });
  assert.deepEqual(decideDayOrder(["03/04/2026", "2026-12-31", null, 7, "pronto"], "en"), { order: "mdy", mixed: false });
  assert.deepEqual(decideDayOrder(["03/04/2026"], "es"), { order: "dmy", mixed: false });
  assert.deepEqual(decideDayOrder([]), { order: "dmy", mixed: false });
  assert.deepEqual(decideDayOrder(["21/03/2026", "03/21/2026"], "en"), { order: "mdy", mixed: true });
  assert.deepEqual(decideDayOrder(["21/03/2026", "03/21/2026"], "es"), { order: "dmy", mixed: true });
  // Ni día ni mes (13/13) no decide nada.
  assert.deepEqual(decideDayOrder(["13/13/2026", "03/04/2026"], "en"), { order: "mdy", mixed: false });
});

test("fechas con puntos: siempre día/mes, sea cual sea el idioma o el resto del fichero", () => {
  for (const order of ["dmy", "mdy"] as const) {
    assert.equal(parseDayLoose("1.12.2026", order), "2026-12-01", order);
    assert.equal(parseDayLoose("01.12.26", order), "2026-12-01", order);
    assert.equal(parseDayLoose("03.04.2026", order), "2026-04-03", order);
    for (const v of ["1.12.2026", "01.12.26", "12.31.2026"]) assert.equal(parseDayLoose(v, order), parseDay(v, "UTC", order), `${v} ${order}`);
  }
  // No deciden el orden de las demás ni cuentan como «dos formatos».
  assert.deepEqual(decideDayOrder(["21.03.2026", "03/04/2026"], "en"), { order: "mdy", mixed: false });
  assert.deepEqual(decideDayOrder(["21.03.2026", "03/21/2026"], "es"), { order: "mdy", mixed: false });
  // CSV en inglés con fechas americanas y una con puntos: la de puntos, día/mes; sin aviso de formatos mezclados.
  const csv = parseTasksText("Title,Due date\nA,03/21/2026\nB,1.12.2026\nC,03/04/2026", { locale: "en" });
  assert.deepEqual(csv.tasks.map((x) => x.task.dueDate), ["2026-03-21", "2026-12-01", "2026-03-04"]);
  assert.equal(csv.dateWarning, undefined);
  // JSON propio con el idioma en inglés: igual.
  const json = parseTasksText(JSON.stringify([{ title: "A", dueDate: "01.12.26" }, { title: "B", dueDate: "12/21/2026" }]), { locale: "en" });
  assert.deepEqual(json.tasks.map((x) => x.task.dueDate), ["2026-12-01", "2026-12-21"]);
});
