// Formato «pizarro.task» (lib/task-json.ts): lo que se copia se vuelve a leer igual, y se entiende lo que escribe una IA.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTaskJson, parseDayLoose, parseTaskJson, stringifyTaskJson, TASK_JSON_MAX_CHARS, TASK_JSON_MAX_LABELS, type TaskJsonSource } from "../src/lib/task-json";

const source: TaskJsonSource = {
  id: "t1", project: "Web", url: "https://pizarro.example.com/p/p1?task=t1", createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-02T10:00:00.000Z", createdBy: "Ana",
  title: "Preparar la demo", description: "Texto **Markdown**\n\n- uno\n- dos", type: "Funcionalidad", column: "En progreso", labels: ["cliente", "urgente"],
  assignee: { name: "Ana Pérez", email: "ana@example.com" }, dueDate: "2026-12-01", recurrence: "WEEKLY", recurrenceDay: 2, color: "#ef4444", deliverable: "Entrega 1",
  link: "https://example.com/x", subtasks: [{ text: "Guion", done: true }, { text: "Ensayo", done: false }], dependsOn: "Contratar la sala",
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
  assert.deepEqual(json.info, { id: "t1", project: "Web", url: "https://pizarro.example.com/p/p1?task=t1", createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-02T10:00:00.000Z", createdBy: "Ana" });
  const plain = buildTaskJson({ ...source, enabledFields: ["priority"], priority: null, recurrence: "NONE", recurrenceDay: null });
  for (const k of ["cost", "costPaid", "estimatedHours", "actualHours", "client", "startDate"]) assert.ok(!(k in plain), k);
  assert.deepEqual([plain.priority, plain.recurrence], [null, { rule: "none" }]);
  // Legible: sangrado de dos espacios y el mismo texto cada vez.
  assert.equal(stringifyTaskJson(json), stringifyTaskJson(buildTaskJson(source)));
  assert.match(stringifyTaskJson(json), /^\{\n {2}"format": "pizarro\.task",\n {2}"version": 1,\n {2}"title": "Preparar la demo",/);
});

test("ida y vuelta: lo copiado se lee con los mismos valores; adjuntos e info no se leen", () => {
  const parsed = parseTaskJson(stringifyTaskJson(buildTaskJson(source)));
  assert.equal(parsed.kind, "task");
  if (parsed.kind !== "task") return;
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.task, {
    title: "Preparar la demo", description: "Texto **Markdown**\n\n- uno\n- dos", type: "Funcionalidad", column: "En progreso", labels: ["cliente", "urgente"],
    assignee: { name: "Ana Pérez", email: "ana@example.com" }, dueDate: "2026-12-01", startDate: "2026-11-20", priority: "ALTA", client: "Acme", cost: "120.5", costPaid: true,
    estimatedHours: "8", actualHours: "2.5", recurrence: { rule: "WEEKLY", day: 2 }, color: "#ef4444", deliverable: "Entrega 1", link: "https://example.com/x",
    subtasks: [{ text: "Guion", done: true }, { text: "Ensayo", done: false }], dependsOn: { title: "Contratar la sala" },
    googleDocs: [{ kind: "GOOGLE_SHEET", title: "Presupuesto", url: "https://docs.google.com/spreadsheets/d/abc/edit" }],
  });
  // Una tarea vacía también va y vuelve: null vacía los campos, las listas quedan vacías.
  const empty = parseTaskJson(stringifyTaskJson(buildTaskJson({ ...source, description: "", labels: [], assignee: null, dueDate: null, recurrence: "NONE", recurrenceDay: null, color: null, deliverable: null, link: null, subtasks: [], dependsOn: null, googleDocs: [], attachments: [], enabledFields: [] })));
  assert.equal(empty.kind, "task");
  if (empty.kind !== "task") return;
  assert.deepEqual(empty.task, {
    title: "Preparar la demo", description: "", type: "Funcionalidad", column: "En progreso", labels: [], assignee: null, dueDate: null, recurrence: { rule: "NONE" }, color: null,
    deliverable: null, link: null, subtasks: [], dependsOn: null, googleDocs: [],
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

test("fechas: AAAA-MM-DD, ISO completa, DD/MM/AAAA; null y vacío la quitan", () => {
  assert.deepEqual(
    ["2026-12-01", "2026-1-5", "2026-12-01T23:59:59Z", "2026-12-01 10:00", "01/12/2026", "1.12.2026", "", null].map(parseDayLoose),
    ["2026-12-01", "2026-01-05", "2026-12-01", "2026-12-01", "2026-12-01", "2026-12-01", null, null],
  );
  for (const bad of ["2026-13-01", "2026-02-30", "12/2026", "mañana", 20261201, {}]) assert.equal(parseDayLoose(bad), undefined, String(bad));
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
