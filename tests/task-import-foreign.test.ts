// Importar tareas de otros Kanban (lib/foreign-import/tasks.ts, por parseTasksText de lib/task-json.ts): Trello (tablero,
// tarjeta y lista de tarjetas), CSV de varias herramientas, GitHub Issues, Jira y Asana, con ejemplos inventados. Lo que se
// crea en la base de datos, en tests/db/task-import-foreign.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { makeT } from "../src/i18n/core";
import { compactTrelloBoard, readForeignTasks } from "../src/lib/foreign-import/tasks";
import { foreignPriority } from "../src/lib/foreign-import/csv";
import { decodeText } from "../src/lib/foreign-import/text";
import { parseTasksText, TASKS_JSON_MAX, TASKS_TEXT_MAX_CHARS, type TaskJsonInput } from "../src/lib/task-json";
import { assertFast } from "./timing";

const t = makeT("es");
const en = makeT("en");
const trelloText = readFileSync(new URL("./fixtures/trello-board.json", import.meta.url), "utf8");
const read = (raw: string) => parseTasksText(raw, { t, timeZone: "Europe/Madrid" });
const tasks = (raw: string): TaskJsonInput[] => read(raw).tasks.map((x) => x.task);
const titles = (raw: string) => tasks(raw).map((x) => x.title);

describe("Trello", () => {
  test("tablero: tarjetas abiertas con su lista como columna, etiquetas, checklists, fecha y responsable; avisos de lo que no se trae", () => {
    const r = read(trelloText);
    assert.equal(r.source, "Trello (tablero)");
    assert.deepEqual(r.tasks.map((x) => [x.task.title, x.task.column]), [["Elegir el dominio", "Por hacer"], ["Redactar los textos", "Por hacer"], ["Maquetar la portada", "En curso"]]);
    const textos = r.tasks[1]!.task;
    assert.deepEqual(textos.labels, ["Diseño", "Rojo"]);
    assert.equal(textos.dueDate, "2026-12-16");
    assert.deepEqual(textos.subtasks, [{ text: "Primer borrador", done: true }, { text: "Revisar con Ana", done: false }]);
    assert.deepEqual(textos.assignee, { name: "Ana Ejemplo" });
    // El HTML y los enlaces peligrosos se limpian igual que al importar un proyecto.
    assert.ok(!textos.description!.includes("<img") && !textos.description!.includes("javascript:"), textos.description);
    assert.ok(textos.description!.includes("Tarjeta original en Trello"));
    assert.ok(r.warnings.includes("2 tareas archivadas no se importan."), r.warnings.join(" | "));
    assert.ok(r.warnings.some((w) => w.includes("comentarios de Trello no se importan")));
    assert.ok(r.warnings.some((w) => w.includes("varios responsables")));
    assert.deepEqual([r.failed, r.tooMany, r.error], [[], false, undefined]);
  });

  test("tablero en inglés: el origen y los avisos, traducidos", () => {
    const r = parseTasksText(trelloText, { t: en });
    assert.equal(r.source, "Trello (board)");
    assert.ok(r.warnings.includes("2 archived tasks are not imported."), r.warnings.join(" | "));
  });

  test("una tarjeta (su URL con «.json»): checklists, etiquetas por nombre y, con la lista, su columna; archivada también vale", () => {
    const card = {
      id: "c1", idBoard: "b1", idList: "l1", name: "Preparar la demo", desc: "Con **guion**", closed: true, due: "2027-01-10T09:00:00.000Z",
      labels: [{ id: "x", name: "cliente", color: "green" }], idMembers: [], list: { id: "l1", name: "En curso" },
      checklists: [{ id: "k1", name: "Pasos", checkItems: [{ name: "Guion", state: "complete", pos: 1 }, { name: "Ensayo", state: "incomplete", pos: 2 }] }],
      actions: [{ type: "commentCard", data: { card: { id: "c1" }, text: "¡Hola!" }, memberCreator: { fullName: "Ana" } }],
    };
    const r = read(JSON.stringify(card));
    assert.equal(r.source, "Trello (tarjeta)");
    assert.deepEqual(r.tasks.map((x) => x.task), [{
      title: "Preparar la demo", description: "Con **guion**", column: "En curso", labels: ["cliente"], dueDate: "2027-01-10",
      subtasks: [{ text: "Guion", done: true }, { text: "Ensayo", done: false }],
    }]);
    assert.deepEqual(r.warnings, ["1 comentario de Trello no se importa (al importar tareas no se traen los comentarios)."]);
    // Varias tarjetas (lo que devuelve la API de una lista), sin la lista: sin columna.
    const many = read(JSON.stringify([{ id: "a", idList: "l1", name: "Uno" }, { id: "b", idList: "l1", name: "Dos" }]));
    assert.equal(many.source, "Trello (tarjetas)");
    assert.deepEqual(many.tasks.map((x) => x.task), [{ title: "Uno" }, { title: "Dos" }]);
  });

  test("compactTrelloBoard: sin historial ni adjuntos subidos, se lee igual (y si no es Trello, null)", () => {
    const board = JSON.parse(trelloText);
    board.actions.push(...Array.from({ length: 2000 }, (_, i) => ({ type: "updateCard", data: { card: { id: "c-2" }, old: { desc: "x".repeat(200) } }, id: `a${i}` })));
    const big = JSON.stringify(board);
    const small = compactTrelloBoard(big)!;
    assert.ok(small.length < big.length / 10, `${small.length} / ${big.length}`);
    assert.deepEqual(tasks(small), tasks(big));
    assert.equal(compactTrelloBoard('{"format":"pizarro.tasks","tasks":[]}'), null);
    assert.equal(compactTrelloBoard("title\nA"), null);
  });

  test("más de 500 tarjetas abiertas: se cuentan y no se importan", () => {
    const cards = Array.from({ length: TASKS_JSON_MAX + 20 }, (_, i) => ({ id: `c${i}`, idList: "l", name: `Tarjeta ${i}`, pos: i }));
    const r = read(JSON.stringify({ name: "Grande", lists: [{ id: "l", name: "Lista" }], cards }));
    assert.deepEqual([r.total, r.tooMany, r.tasks.length], [TASKS_JSON_MAX + 20, true, TASKS_JSON_MAX]);
  });
});

describe("CSV", () => {
  test("genérico en español con «;»: título, descripción, columna, etiquetas, fecha, prioridad y responsable", () => {
    const r = read("Título;Descripción;Estado;Etiquetas;Fecha límite;Prioridad;Responsable\nMaquetar;La **portada**;En curso;web, urgente;15/01/2027;Alta;Ana Ejemplo\nRevisar;;Hecho;;;;\n");
    assert.equal(r.source, "CSV");
    assert.deepEqual(r.tasks.map((x) => x.task), [
      { title: "Maquetar", description: "La **portada**", column: "En curso", labels: ["web", "urgente"], dueDate: "2027-01-15", priority: "ALTA", assignee: { name: "Ana Ejemplo" } },
      { title: "Revisar", column: "Hecho" },
    ]);
  });

  test("Jira: «Labels» repetidas se juntan, «Issue key» va como referencia, «Parent summary» hace subtareas y «No priority» no avisa", () => {
    const r = read(
      "Summary,Issue key,Issue Type,Status,Priority,Assignee,Due date,Labels,Labels,Parent summary,Description\n" +
        "Arreglar el login,WEB-1,Bug,In Progress,Highest,Ana Ejemplo,2027-02-01,auth,urgente,,Falla con SSO\n" +
        "Probar en móvil,WEB-2,Sub-task,To Do,No priority,,,,,Arreglar el login,\n",
    );
    assert.equal(r.source, "CSV de Jira");
    assert.deepEqual(r.tasks.map((x) => x.task), [{
      title: "Arreglar el login", description: "Falla con SSO\n\n_Referencia original: WEB-1_", column: "In Progress", labels: ["auth", "urgente"], dueDate: "2027-02-01",
      priority: "URGENTE", assignee: { name: "Ana Ejemplo" }, subtasks: [{ text: "Probar en móvil", done: false }],
    }]);
    assert.deepEqual(r.warnings, []);
  });

  test("Jira: las resueltas («Resolution» rellena o «Status Category» Done) no se importan; sus subtareas resueltas, solo bajo una abierta", () => {
    const r = read(
      "Summary,Issue key,Issue Type,Status,Status Category,Resolution,Resolved,Parent summary\n" +
        "Abierta,WEB-1,Task,In Progress,In Progress,,,\n" +
        "Arreglada,WEB-2,Bug,Done,Done,Fixed,2026-10-01,\n" +
        "Descartada,WEB-3,Bug,Won't Do,To Do,Won't Do,2026-10-02,\n" +
        "Sin categoría,WEB-4,Task,Cerrada,Done,,,\n" +
        "Paso hecho,WEB-5,Sub-task,Done,Done,Done,2026-10-03,Abierta\n" +
        "Paso pendiente,WEB-6,Sub-task,To Do,To Do,,,Abierta\n" +
        "Paso de una arreglada,WEB-7,Sub-task,Done,Done,Done,2026-10-04,Arreglada\n" +
        "Paso pendiente de una arreglada,WEB-8,Sub-task,To Do,To Do,Unresolved,,Arreglada\n",
    );
    assert.equal(r.source, "CSV de Jira");
    assert.deepEqual(r.tasks.map((x) => [x.task.title, x.task.subtasks]), [
      ["Abierta", [{ text: "Paso hecho", done: true }, { text: "Paso pendiente", done: false }]],
      // Pendiente aunque su madre esté resuelta: entra como tarea (con la nota «Subtarea de»).
      ["Paso pendiente de una arreglada", undefined],
    ]);
    assert.deepEqual(r.warnings, ["4 incidencias resueltas no se importan."]);
    // Fuera de Jira, una columna «Resolution» no cambia nada.
    assert.deepEqual(titles("Title,Resolution\nUna,Fixed\n"), ["Una"]);
  });

  test("Asana, ClickUp, Trello, Linear, GitHub Projects y Planner: cada uno con su nombre y sus columnas", () => {
    const asana = read("Task ID,Created At,Completed At,Name,Section/Column,Assignee,Assignee Email,Due Date,Tags,Notes,Parent task\n1,2026-11-01,,Diseñar,Por hacer,Ana,ana@example.com,2027-01-20,web,Notas,\n");
    assert.equal(asana.source, "CSV de Asana");
    assert.deepEqual(asana.tasks[0]!.task, { title: "Diseñar", description: "Notas\n\n_Referencia original: 1_", column: "Por hacer", labels: ["web"], dueDate: "2027-01-20", assignee: { name: "Ana", email: "ana@example.com" } });
    const clickup = read('Task ID,Task Name,Task Content,Status,Date Created,Due Date,Priority,Assignees,Tags\nabc,Llamar,Al cliente,in progress,2026-11-01,2027-01-05,urgent,"[Ana Ejemplo]","[ventas, cliente]"\n');
    assert.equal(clickup.source, "CSV de ClickUp");
    assert.deepEqual(clickup.tasks[0]!.task, { title: "Llamar", description: "Al cliente\n\n_Referencia original: abc_", column: "in progress", labels: ["ventas", "cliente"], dueDate: "2027-01-05", priority: "URGENTE", assignee: { name: "Ana Ejemplo" } });
    const trello = read('Card ID,Card Name,Card Description,Labels,Members,Due Date,List Name,Archived\nx1,Portada,Texto,"Urgente (red), Web (sky_dark)",Ana,,Por hacer,false\nx2,Vieja,,,,,Por hacer,true\n');
    assert.equal(trello.source, "CSV de Trello");
    assert.deepEqual(trello.tasks.map((x) => x.task), [{ title: "Portada", description: "Texto\n\n_Referencia original: x1_", column: "Por hacer", labels: ["Urgente", "Web"], assignee: { name: "Ana" } }]);
    assert.deepEqual(trello.warnings, ["1 tarea archivada no se importa."]);
    const linear = read("ID,Team,Title,Description,Status,Priority,Assignee,Labels,Cycle Name,Due Date\nENG-1,Eng,Migrar,,Backlog,No priority,,\"a, b\",,\n");
    assert.equal(linear.source, "CSV de Linear");
    assert.deepEqual(linear.tasks[0]!.task, { title: "Migrar", description: "_Referencia original: ENG-1_", column: "Backlog", labels: ["a", "b"] });
    assert.equal(read("Title,URL,Assignees,Status,Labels,Repository\nUno,https://github.com/example/web/issues/1,,Todo,,example/web\n").source, "CSV de GitHub Projects");
    const planner = read("Task ID,Task Name,Bucket Name,Priority,Assigned To,Due date,Description,Labels\np1,Pedir sala,Pendiente,Important,,20/01/2027,,\n");
    assert.equal(planner.source, "CSV de Microsoft Planner");
    assert.deepEqual(planner.tasks[0]!.task, { title: "Pedir sala", description: "_Referencia original: p1_", column: "Pendiente", priority: "ALTA", dueDate: "2027-01-20" });
  });

  test("Todoist: secciones como columna, sangría como subtareas, prioridad 1 = la más alta, @etiquetas y notas que no se traen", () => {
    const r = read(
      "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE\n" +
        "section,Esta semana,,,,,,,,\n" +
        "task,Preparar la charla @trabajo,Diapositivas,1,1,Ana (1),Ana Ejemplo (1),2027-03-01,es,Europe/Madrid\n" +
        "task,Buscar fotos,,4,2,Ana (1),,,es,Europe/Madrid\n" +
        "note,Acuérdate del proyector,,,,Ana (1),,,,\n" +
        "task,Reservar la sala,,4,1,Ana (1),,,es,Europe/Madrid\n",
    );
    assert.equal(r.source, "CSV de Todoist");
    assert.deepEqual(r.tasks.map((x) => x.task), [
      { title: "Preparar la charla", description: "Diapositivas", column: "Esta semana", labels: ["trabajo"], dueDate: "2027-03-01", priority: "URGENTE", assignee: { name: "Ana Ejemplo" }, subtasks: [{ text: "Buscar fotos", done: false }] },
      { title: "Reservar la sala", column: "Esta semana" },
    ]);
    assert.deepEqual(r.warnings, ["1 comentario de Todoist no se importa."]);
  });

  test("separado por tabuladores (lo copiado de una hoja de cálculo) y con BOM", () => {
    assert.deepEqual(titles("﻿Name\tStatus\nUno\tHecho\nDos\tPor hacer"), ["Uno", "Dos"]);
  });

  test("lo que no es un CSV con título sigue siendo JSON de Pizarro o nada; un CSV sin filas da un error", () => {
    for (const s of ["hola, sin JSON", "Aquí tienes:\n```json\n{\"title\":\"A\"}\n```", "nombre", "uno,dos\ntres,cuatro"]) assert.equal(readForeignTasks(s, { t }), null, s);
    assert.deepEqual(titles('Aquí tienes:\n```json\n{"title":"A"}\n```'), ["A"]);
    const empty = read("Title,Status\n");
    assert.deepEqual([empty.source, empty.error, empty.tasks.length], ["CSV", "El CSV no tiene filas de tareas (solo cabecera o está vacío).", 0]);
    assert.equal(read("Title,Status\n,Hecho\n").error, "El CSV no tiene ninguna fila con título.");
  });

  test("topes: más de 500 filas se cuentan; más de 6000, error; un texto enorme sin saltos de línea no cuesta", () => {
    const rows = (n: number) => `title,status\n${Array.from({ length: n }, (_, i) => `T${i},A`).join("\n")}`;
    const r = read(rows(TASKS_JSON_MAX + 1));
    assert.deepEqual([r.total, r.tooMany, r.tasks.length], [TASKS_JSON_MAX + 1, true, TASKS_JSON_MAX]);
    assert.equal(read(rows(6001)).error, "El CSV tiene demasiadas filas.");
    assertFast(1500, () => read(`title,${"x".repeat(TASKS_TEXT_MAX_CHARS - 10)}`));
    assertFast(1500, () => read(`${"a,".repeat(TASKS_TEXT_MAX_CHARS / 2 - 10)}`));
    assertFast(3000, () => read(`title,description\n${`Tarea,${"ñ".repeat(800)}\n`.repeat(5000)}`));
  });

  test("decodeText de un archivo entero: un Windows-1252 con la «ñ» al final no la pierde (la cabecera sí puede ir cortada)", () => {
    const latin = new Uint8Array([0x50, 0x65, 0xf1, 0x0a]); // «Peñ\n» en Windows-1252
    assert.equal(decodeText(latin, true), "Peñ\n");
    assert.equal(decodeText(new TextEncoder().encode("Peña"), true), "Peña");
    // Solo la cabecera (cortada a mitad de una «ñ» en UTF-8): se queda con lo que se puede leer.
    assert.equal(decodeText(new Uint8Array([0x50, 0x65, 0x70, 0x61, 0xc3])), "Pe");
  });

  test("foreignPriority: las del prototipo («constructor», «toString») no son prioridades", () => {
    assert.deepEqual(["constructor", "toString", "__proto__", "High", "p0"].map(foreignPriority), [null, null, null, "ALTA", "URGENTE"]);
  });
});

describe("GitHub Issues", () => {
  test("API: abiertas con etiquetas, responsable y enlace; cerradas y pull requests no", () => {
    const issues = [
      { number: 1, title: "Falla el login", body: "Pasos:\n1. Entrar", state: "open", html_url: "https://github.com/example/web/issues/1", labels: [{ name: "bug" }, { name: "auth" }], assignees: [{ login: "ana" }, { login: "luis" }], milestone: { title: "v2" } },
      { number: 2, title: "Ya arreglada", body: null, state: "closed", html_url: "https://github.com/example/web/issues/2", labels: [] },
      { number: 3, title: "Una PR", state: "open", html_url: "https://github.com/example/web/pull/3", pull_request: { url: "https://api.github.com/x" } },
    ];
    const r = read(JSON.stringify(issues));
    assert.equal(r.source, "GitHub Issues");
    assert.deepEqual(r.tasks.map((x) => x.task), [{ title: "Falla el login", description: "Pasos:\n1. Entrar", labels: ["bug", "auth"], assignee: { name: "ana" }, link: "https://github.com/example/web/issues/1" }]);
    assert.deepEqual(r.warnings, ["1 incidencia cerrada no se importa.", "1 pull request no se importa.", "1 tarea tenía varios responsables: solo se asigna el primero (si existe aquí)."]);
  });

  test("«gh issue list --json title,body,labels,state» y una sola («gh issue view --json»)", () => {
    const gh = [{ title: "Uno", body: "", labels: [{ name: "docs", color: "0075ca" }], state: "OPEN" }, { title: "Dos", body: "b", labels: [], state: "CLOSED" }];
    assert.deepEqual(tasks(JSON.stringify(gh)), [{ title: "Uno", labels: ["docs"] }]);
    assert.deepEqual(tasks(JSON.stringify({ title: "Sola", body: "x", state: "OPEN", url: "https://github.com/example/web/issues/9" })), [{ title: "Sola", description: "x", link: "https://github.com/example/web/issues/9" }]);
    // Sin estado ni URL de GitHub: es la lista de tareas de Pizarro de siempre.
    assert.equal(read(JSON.stringify([{ title: "A", body: "b" }])).source, undefined);
  });
});

describe("Jira", () => {
  const issue = {
    id: "10001", key: "WEB-7", self: "https://example.atlassian.net/rest/api/3/issue/10001",
    fields: {
      summary: "Migrar el servidor", duedate: "2027-04-01", labels: ["infra", "infra", "urgente"], status: { name: "In Progress" }, priority: { name: "High" },
      assignee: { displayName: "Ana Ejemplo", emailAddress: "ana@example.com" },
      description: { type: "doc", version: 1, content: [
        { type: "paragraph", content: [{ type: "text", text: "Mover a " }, { type: "text", text: "la nube", marks: [{ type: "strong" }] }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "copia" }] }] }] },
      ] },
      subtasks: [{ key: "WEB-8", fields: { summary: "Copia", status: { name: "Done", statusCategory: { key: "done" } } } }, { key: "WEB-9", fields: { summary: "DNS", status: { name: "To Do", statusCategory: { key: "new" } } } }],
    },
  };
  test("una incidencia de la API REST (v3, descripción ADF) y una búsqueda («issues»)", () => {
    const one = read(JSON.stringify(issue));
    assert.equal(one.source, "Jira");
    assert.deepEqual(one.tasks[0]!.task, {
      title: "Migrar el servidor", description: "Mover a la nube\n\n- copia\n\n_Referencia original: WEB-7_", column: "In Progress", labels: ["infra", "urgente"], dueDate: "2027-04-01",
      priority: "ALTA", assignee: { name: "Ana Ejemplo", email: "ana@example.com" }, subtasks: [{ text: "Copia", done: true }, { text: "DNS", done: false }], link: "https://example.atlassian.net/browse/WEB-7",
    });
    const search = read(JSON.stringify({ startAt: 0, total: 2, issues: [issue, { key: "WEB-10", fields: { summary: "Otra", description: "Texto *wiki* de la v2" } }] }));
    assert.deepEqual(search.tasks.map((x) => [x.task.title, x.task.description]), [["Migrar el servidor", one.tasks[0]!.task.description], ["Otra", "Texto *wiki* de la v2\n\n_Referencia original: WEB-10_"]]);
  });
  // Antes entraban como pendientes; ahora, como las cerradas de GitHub o las completadas de Asana, no se importan (con aviso).
  test("las incidencias resueltas (categoría de estado «done») no se importan, con aviso contado", () => {
    const done = (key: string) => ({ key, fields: { summary: `Hecha ${key}`, status: { name: "Done", statusCategory: { key: "done" } } } });
    const one = read(JSON.stringify({ issues: [issue, done("WEB-20")] }));
    assert.deepEqual(one.tasks.map((x) => x.task.title), ["Migrar el servidor"]);
    assert.deepEqual(one.warnings, ["1 incidencia resuelta no se importa."]);
    const two = read(JSON.stringify({ issues: [issue, done("WEB-20"), done("WEB-21")] }));
    assert.deepEqual(two.warnings, ["2 incidencias resueltas no se importan."]);
    assert.deepEqual(parseTasksText(JSON.stringify({ issues: [issue, done("WEB-20"), done("WEB-21")] }), { t: en, timeZone: "Europe/Madrid" }).warnings, ["2 resolved issues are not imported."]);
  });
  test("ADF muy anidado: se corta sin desbordar la pila", () => {
    // Escrito a mano: JSON.stringify de tantos niveles desborda la pila de la propia prueba (JSON.parse, no).
    const depth = 3000;
    const node = `${'{"type":"paragraph","content":['.repeat(depth)}{"type":"text","text":"fondo"}${"]}".repeat(depth)}`;
    const text = `{"key":"X-1","fields":{"summary":"Profunda","description":{"type":"doc","content":[${node}]}}}`;
    const r = assertFast(500, () => read(text));
    assert.deepEqual([r.tasks[0]!.task.title, r.tasks[0]!.task.description], ["Profunda", "_Referencia original: X-1_"]);
  });
});

describe("Asana", () => {
  test("API: { data: [...] } con sección, etiquetas, fecha y enlace; las completadas no", () => {
    const r = read(JSON.stringify({ data: [
      { gid: "1", resource_type: "task", name: "Diseñar el logo", notes: "Tres propuestas", completed: false, due_on: "2027-05-02", tags: [{ gid: "t", name: "marca" }],
        memberships: [{ project: { gid: "p", name: "Web" }, section: { gid: "s", name: "En curso" } }], assignee: { gid: "u", name: "Ana Ejemplo" }, permalink_url: "https://app.asana.com/0/1/1" },
      { gid: "2", resource_type: "task", name: "Hecha", completed: true },
    ] }));
    assert.equal(r.source, "Asana");
    assert.deepEqual(r.tasks.map((x) => x.task), [{ title: "Diseñar el logo", description: "Tres propuestas", column: "En curso", labels: ["marca"], dueDate: "2027-05-02", assignee: { name: "Ana Ejemplo" }, link: "https://app.asana.com/0/1/1" }]);
    assert.deepEqual(r.warnings, ["1 tarea completada no se importa."]);
    assert.deepEqual(titles(JSON.stringify({ data: { gid: "3", name: "Una sola", html_notes: "<body>Con <b>HTML</b></body>" } })), ["Una sola"]);
    assert.equal(tasks(JSON.stringify({ data: { gid: "3", name: "Una sola", html_notes: "<body>Con <b>HTML</b></body>" } }))[0]!.description, "Con HTML");
  });
});

describe("JSON de Pizarro", () => {
  test("lo propio no cambia: envoltorio, lista y objetos seguidos (sin origen)", () => {
    const own = read(JSON.stringify({ format: "pizarro.tasks", version: 1, tasks: [{ format: "pizarro.task", title: "A", column: "Hecho" }] }));
    assert.deepEqual([own.source, own.tasks.map((x) => x.task.title)], [undefined, ["A"]]);
    assert.deepEqual(titles('{"title":"Uno"}\n{"title":"Dos"}'), ["Uno", "Dos"]);
    assert.equal(read('[{"title":"Uno","name":"x"}]').source, undefined);
  });
});
