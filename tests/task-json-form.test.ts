// «Nueva tarea» y la tarea en JSON (lib/task-json-form.ts): copiar el formulario y rellenarlo con una tarea importada.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTasksText, strictJsonFormat, stringifyTaskJson } from "../src/lib/task-json";
import { fillNewTaskForm, importPreview, newTaskFormJson, type FormProject } from "../src/lib/task-json-form";
import { EMPTY_FIELDS_FORM } from "../src/lib/fields-form";
import { esT } from "../src/i18n/shared";

const project: FormProject = {
  kinds: [{ id: "k1", name: "Funcionalidad" }, { id: "kind_respuesta", name: "Respuesta" }],
  columns: [{ id: "c1", name: "Backlog" }, { id: "c2", name: "Siguiente salto a producción" }],
  users: [{ id: "u1", name: "Ana" }],
  deliverables: [],
  labels: [{ id: "l1", name: "Cliente" }, { id: "l2", name: "Urgente" }],
  enabledFields: [],
};

const readOne = (text: string) => {
  const r = parseTasksText(text);
  assert.equal(r.tasks.length, 1);
  return r.tasks[0]!;
};

/** Una tarea copiada de otra instalación (datos inventados), como la que no se podía pegar en «Nueva tarea». */
const DESCRIPTION = [
  "Respondo a las preguntas y lo que necesitas de mi:",
  "",
  "**1. ¿Qué versión hay en producción?**",
  "",
  "- La v2 --> la que salió el lunes",
  "- La rama `main_estable` (con guion bajo: main\\_estable)",
  "  - sublista con *cursiva*",
  "",
  "1. Primero",
  "2. Segundo --> y tercero",
  "",
  "Ruta en Windows: C:\\\\datos\\\\informes y un \\_escape\\_ de Markdown.",
  "",
  "x".repeat(4000),
].join("\n");
const COPIED = stringifyTaskJson({
  format: "pizarro.task",
  version: 1,
  title: "Responder a las dudas de la migración",
  description: DESCRIPTION,
  type: "Respuesta",
  column: "Siguiente salto a producción",
  labels: [],
  assignee: null,
  dueDate: null,
  recurrence: { rule: "none" },
  color: null,
  deliverable: null,
  link: null,
  subtasks: [],
  dependsOn: null,
  attachments: [{ name: "captura.png", url: "https://otra.example.com/api/attachments/att_inventado" }],
  info: { id: "tarea_inventada", project: "Otro", projectId: "proyecto_inventado", url: "https://otra.example.com/p/proyecto_inventado?task=tarea_inventada", createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-02T10:00:00.000Z", createdBy: "Persona Inventada" },
});

test("R54C1: una tarea copiada de otra instalación (Markdown largo, «-->», barras escapadas) se importa entera en «Nueva tarea»", () => {
  assert.equal(strictJsonFormat(COPIED), "pizarro.task");
  const one = readOne(COPIED);
  const { form, notices } = fillNewTaskForm(one.task, one.problems, project, 50, esT);
  assert.deepEqual(notices, []);
  assert.equal(form.title, "Responder a las dudas de la migración");
  assert.equal(form.description, DESCRIPTION);
  assert.equal(form.kindId, "kind_respuesta");
  assert.equal(form.columnId, "c2");
  assert.deepEqual(form.labelIds, []);
  assert.equal(form.color, null);
  assert.equal(form.linkUrl, "");
  assert.equal(form.assigneeId, "");
  assert.equal(form.recurrence, "NONE");
});

test("tipo general por su nombre guardado aunque se vea traducido («Respuesta» con la interfaz en inglés)", () => {
  const en: FormProject = { ...project, kinds: [{ id: "kind_respuesta", name: "Reply", codeName: "Respuesta" }] };
  const one = readOne(COPIED);
  assert.equal(fillNewTaskForm(one.task, one.problems, en, 50, esT).form.kindId, "kind_respuesta");
  assert.deepEqual(importPreview(one.task, en, null, esT).notices, []);
});

test("columna: la del JSON si existe en el proyecto; si no, no se toca (se queda la de partida) y se avisa", () => {
  const ok = readOne('{"format":"pizarro.task","title":"a","column":"siguiente SALTO a produccion"}');
  assert.equal(fillNewTaskForm(ok.task, ok.problems, project, 50, esT).form.columnId, "c2");
  const no = readOne('{"format":"pizarro.task","title":"a","column":"No existe"}');
  const r = fillNewTaskForm(no.task, no.problems, project, 50, esT);
  assert.equal(r.form.columnId, undefined);
  assert.deepEqual(r.notices, ["columna «No existe» (no existe)"]);
});

test("etiquetas: solo las que existen (sin mirar mayúsculas ni tildes, sin repetir); de las demás se avisa", () => {
  const one = readOne(JSON.stringify({ format: "pizarro.task", title: "a", labels: ["urgente", "Nueva", "CLIENTE", "Urgente", "Otra", "Tercera", "Cuarta", "Quinta"] }));
  const { form, notices } = fillNewTaskForm(one.task, one.problems, project, 50, esT);
  assert.deepEqual(form.labelIds, ["l2", "l1"]);
  assert.deepEqual(notices, [
    "etiqueta «Nueva» (no existe en el proyecto)", "etiqueta «Otra» (no existe en el proyecto)", "etiqueta «Tercera» (no existe en el proyecto)",
    "2 etiquetas más (no existen en el proyecto)",
  ]);
  // null o [] las quitan.
  const none = readOne('{"format":"pizarro.task","title":"a","labels":null}');
  assert.deepEqual(fillNewTaskForm(none.task, none.problems, project, 50, esT).form.labelIds ?? [], []);
});

test("etiquetas: como mucho 20 por tarea", () => {
  const many: FormProject = { ...project, labels: Array.from({ length: 25 }, (_, i) => ({ id: `l${i}`, name: `e${i}` })) };
  const one = readOne(JSON.stringify({ format: "pizarro.task", title: "a", labels: many.labels.map((l) => l.name) }));
  const { form, notices } = fillNewTaskForm(one.task, one.problems, many, 50, esT);
  assert.equal(form.labelIds?.length, 20);
  assert.deepEqual(notices, ["etiquetas (máximo 20 por tarea)"]);
});

test("color de la paleta y enlace (con la normalización del detalle); fuera de la paleta o enlace no http se avisan", () => {
  const ok = readOne('{"format":"pizarro.task","title":"a","color":"#EF4444","link":"example.com/x"}');
  const r = fillNewTaskForm(ok.task, ok.problems, project, 50, esT);
  assert.deepEqual([r.form.color, r.form.linkUrl, r.notices], ["#ef4444", "https://example.com/x", []]);
  const bad = readOne('{"format":"pizarro.task","title":"a","color":"#123456","link":"javascript:alert(1)"}');
  const b = fillNewTaskForm(bad.task, bad.problems, project, 50, esT);
  assert.deepEqual([b.form.color, b.form.linkUrl, b.notices], [undefined, undefined, ["color", "enlace"]]);
  const cleared = readOne('{"format":"pizarro.task","title":"a","color":null,"link":null}');
  const c = fillNewTaskForm(cleared.task, cleared.problems, project, 50, esT);
  assert.deepEqual([c.form.color, c.form.linkUrl], [null, ""]);
});

test("ya no avisa de etiquetas, color ni enlace como «no se pueden poner al crear»; sí de dependencia y documentos", () => {
  const one = readOne(JSON.stringify({
    format: "pizarro.task", title: "a", labels: ["Cliente"], color: "#ef4444", link: "https://example.com",
    dependsOn: { title: "Otra" }, googleDocs: [{ kind: "doc", title: "Acta", url: "https://docs.google.com/document/d/x/edit" }],
  }));
  const { notices } = fillNewTaskForm(one.task, one.problems, project, 50, esT);
  assert.deepEqual(notices, ["dependencia, documentos de Google (no se pueden poner al crear: añádelos en el detalle)"]);
});

test("copiar «Nueva tarea» lleva etiquetas (por nombre, en el orden del proyecto), color y enlace normalizado; y se vuelve a leer igual", () => {
  const json = newTaskFormJson({
    title: "Escrita", kindId: "k1", description: "", columnId: "c1", assigneeId: "", dueDate: "", deliverableId: "", recurrence: "NONE", recurrenceDay: null,
    subtasks: [], fields: EMPTY_FIELDS_FORM, labelIds: ["l2", "l1"], color: "#22c55e", linkUrl: " example.com/doc ",
  }, project);
  assert.deepEqual([json.labels, json.color, json.link], [["Cliente", "Urgente"], "#22c55e", "https://example.com/doc"]);
  const back = readOne(stringifyTaskJson(json));
  const { form, notices } = fillNewTaskForm(back.task, back.problems, project, 50, esT);
  assert.deepEqual([form.labelIds, form.color, form.linkUrl, notices], [["l1", "l2"], "#22c55e", "https://example.com/doc", []]);
  // Sin nada elegido: etiquetas vacías y color y enlace a null.
  const empty = newTaskFormJson({ title: "b", kindId: "k1", description: "", columnId: "c1", assigneeId: "", dueDate: "", deliverableId: "", recurrence: "NONE", recurrenceDay: null, subtasks: [], fields: EMPTY_FIELDS_FORM, labelIds: [], color: null, linkUrl: "" }, project);
  assert.deepEqual([empty.labels, empty.color, empty.link], [[], null, null]);
});
