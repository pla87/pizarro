// «Importar tareas» con lo exportado de otros Kanban (lib/foreign-import/tasks.ts): un tablero de Trello y un CSV de Jira
// se crean en un proyecto que ya existe con las reglas de siempre (columna por nombre o la primera, etiquetas nuevas,
// subtareas, responsable por nombre único, un solo deshacer) y los avisos de lo que no se trae. La lectura, en
// tests/task-import-foreign.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeUser } from "./helpers";
import { importTasks } from "../../src/lib/task-import";
import { undoLast } from "../../src/actions/undo";

const trelloText = readFileSync(new URL("../fixtures/trello-board.json", import.meta.url), "utf8");

const loadTasks = (projectId: string) =>
  db.task.findMany({
    where: { projectId },
    orderBy: { title: "asc" },
    include: { column: { select: { name: true } }, labels: { include: { label: { select: { name: true } } } }, subtasks: { orderBy: { position: "asc" } }, assignee: { select: { name: true } } },
  });

describe("importTasks desde otros Kanban", () => {
  test("tablero de Trello: tarjetas abiertas, lista → columna por nombre, etiquetas, checklists y responsable por nombre; se deshace de una vez", async () => {
    const ana = await makeUser({ name: "Ana Ejemplo" });
    const f = await makeProject({ members: [ana] });
    await loginAs(ana);
    const res = expectOk(await importTasks(f.project.id, trelloText));
    assert.deepEqual(res.tasks.map((t) => t.title).sort(), ["Elegir el dominio", "Maquetar la portada", "Redactar los textos"]);
    assert.ok(res.warnings.includes("2 tareas archivadas no se importan."), res.warnings.join(" | "));
    assert.ok(res.warnings.some((w) => w.includes("comentarios de Trello")));
    const rows = await loadTasks(f.project.id);
    const byTitle = new Map(rows.map((r) => [r.title, r]));
    const textos = byTitle.get("Redactar los textos")!;
    assert.equal(textos.column.name, "Por hacer");
    assert.deepEqual(textos.labels.map((l) => l.label.name).sort(), ["Diseño", "Rojo"]);
    assert.deepEqual(textos.subtasks.map((s) => [s.title, s.done]), [["Primer borrador", true], ["Revisar con Ana", false]]);
    assert.equal(textos.assignee?.name, "Ana Ejemplo");
    assert.equal(textos.dueDate?.toISOString().slice(0, 10), "2026-12-16");
    assert.equal(textos.createdById, ana.id);
    assert.equal(byTitle.get("Maquetar la portada")!.column.name, "En curso");
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.task.count({ where: { projectId: f.project.id } }), 0);
    assert.equal(await db.label.count({ where: { projectId: f.project.id } }), 0);
  });

  test("CSV de Jira: columnas que no existen van a la primera con aviso, etiquetas repetidas juntas, subtareas por «Parent summary»", async () => {
    const user = await makeUser({ name: "Luis Muestra" });
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const csv =
      "Summary,Issue key,Status,Priority,Assignee,Due date,Labels,Labels,Parent summary,Description\n" +
      "Arreglar el login,WEB-1,En curso,High,Luis Muestra,2027-02-01,auth,urgente,,Falla con SSO\n" +
      "Probar en móvil,WEB-2,To Do,,,,,,Arreglar el login,\n" +
      "Documentar,WEB-3,Backlog,,Nadie Conocido,,docs,,,\n";
    const res = expectOk(await importTasks(f.project.id, csv));
    assert.deepEqual(res.tasks.map((t) => t.title).sort(), ["Arreglar el login", "Documentar"]);
    const rows = new Map((await loadTasks(f.project.id)).map((r) => [r.title, r]));
    const login = rows.get("Arreglar el login")!;
    assert.deepEqual([login.column.name, login.assignee?.name, login.description], ["En curso", "Luis Muestra", "Falla con SSO\n\n_Referencia original: WEB-1_"]);
    assert.deepEqual(login.labels.map((l) => l.label.name).sort(), ["auth", "urgente"]);
    assert.deepEqual(login.subtasks.map((s) => s.title), ["Probar en móvil"]);
    const doc = rows.get("Documentar")!;
    assert.equal(doc.column.name, "Por hacer");
    const notices = res.notices.filter((n) => n.title === "Documentar").map((n) => n.text);
    assert.ok(notices.includes("columna «Backlog» (no existe)"), notices.join(" | "));
    assert.ok(notices.some((n) => n.startsWith("responsable «Nadie Conocido»")), notices.join(" | "));
    // La prioridad no está activa en el proyecto: se avisa en la tarea que la traía.
    assert.ok(res.notices.some((n) => n.title === "Arreglar el login" && n.text.includes("campo no activado")));
  });

  test("CSV que se reconoce pero no se puede leer: el error del lector; texto sin tareas: el de siempre", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    expectFail(await importTasks(f.project.id, "Title,Status\n"), /no tiene filas de tareas/);
    expectFail(await importTasks(f.project.id, JSON.stringify([{ number: 1, title: "Cerrada", state: "closed", html_url: "https://github.com/example/web/issues/1" }])), /No hay ninguna tarea que importar: 1 incidencia cerrada/);
  });
});
