// Exportar e importar varias tareas como JSON (exportTasksJson / importTasks): ida y vuelta, permisos, dependencias dentro
// del lote, etiquetas creadas que se borran al deshacer, topes y rendimiento con 500 tareas.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import pg from "pg";
import { assign, db, expectFail, expectOk, loginAs, logout, makeProject, makeTask, makeUser, NOT_FOUND, expectApplied } from "./helpers";
import { exportTasksJson } from "../../src/actions/task-json";
import { importTasks } from "../../src/lib/task-import";
import { POST as importRoute } from "../../src/app/api/projects/[projectId]/import-tasks/route";
import { assertFastAsync } from "../timing";
import { redoChecked, undoLast } from "../../src/actions/undo";
import { TASKS_JSON_MAX } from "../../src/lib/task-json";

const undoCount = (projectId: string) => db.undoEntry.count({ where: { projectId, kind: "UNDO" } });
const titles = async (projectId: string) => (await db.task.findMany({ where: { projectId }, orderBy: [{ column: { position: "asc" } }, { position: "asc" }] })).map((t) => t.title);
const lines = (...objs: unknown[]) => objs.map((o) => JSON.stringify(o)).join("\n");

/** Consultas SQL y tiempo de `fn`: una consulta por tarea se notaría en las dos cifras. */
async function measure<T>(fn: () => Promise<T>): Promise<{ result: T; queries: number; ms: number }> {
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const orig = proto.query;
  let queries = 0;
  proto.query = function (this: unknown, ...args: unknown[]) {
    queries++;
    return orig.apply(this, args);
  };
  const start = performance.now();
  try {
    const result = await fn();
    return { result, queries, ms: performance.now() - start };
  } finally {
    proto.query = orig;
  }
}

/** Proyecto con dos tareas, una bloqueada por la otra, etiquetas, subtareas y responsable. */
async function exportFixture() {
  const user = await makeUser({ name: "Exportadora" });
  const f = await makeProject({ members: [user] });
  const label = await db.label.create({ data: { projectId: f.project.id, name: "cliente", color: "#ef4444" } });
  const first = await db.task.create({
    data: {
      projectId: f.project.id, columnId: f.columns.todo, title: "Primera", kindId: f.kindId, position: 1000, assigneeId: user.id, createdById: user.id,
      description: "Uno **dos**", labels: { create: [{ labelId: label.id }] }, subtasks: { create: [{ title: "a", done: true, position: 1000 }] },
    },
  });
  const second = await db.task.create({ data: { projectId: f.project.id, columnId: f.columns.doing, title: "Segunda", kindId: f.kindId, position: 1000, blockedById: first.id } });
  return { user, f, first, second };
}

describe("exportTasksJson", () => {
  test("exporta las elegidas en el orden del tablero, con su envoltorio y nombre de fichero, sin emails", async () => {
    const { user, f, first, second } = await exportFixture();
    await loginAs(user);
    const res = expectOk(await exportTasksJson(f.project.id, [second.id, first.id]));
    assert.equal(res.count, 2);
    assert.match(res.fileName, /^tareas-proyecto-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.json$/);
    const json = JSON.parse(res.text);
    assert.deepEqual([json.format, json.version, json.project, json.projectId], ["pizarro.tasks", 1, f.project.name, f.project.id]);
    assert.deepEqual(json.tasks.map((t: { title: string }) => t.title), ["Primera", "Segunda"]);
    assert.deepEqual(json.tasks[1].dependsOn, { id: first.id, title: "Primera" });
    assert.deepEqual(json.tasks[0].assignee, { id: user.id, name: "Exportadora" });
    assert.ok(!res.text.includes(user.email));
    // Exportar no cambia nada.
    assert.equal(await undoCount(f.project.id), 0);
  });

  test("solo tareas del proyecto y visibles: las de otro proyecto se ignoran; sin acceso, nada", async () => {
    const { user, f, first } = await exportFixture();
    const other = await makeProject({ members: [] });
    const foreign = await makeTask(other, { title: "Ajena" });
    await loginAs(user);
    const res = expectOk(await exportTasksJson(f.project.id, [first.id, foreign.id]));
    assert.deepEqual(JSON.parse(res.text).tasks.map((t: { title: string }) => t.title), ["Primera"]);
    expectFail(await exportTasksJson(other.project.id, [foreign.id]), NOT_FOUND);
    expectFail(await exportTasksJson(f.project.id, [foreign.id]), /No hay tareas que exportar/);
    expectFail(await exportTasksJson(f.project.id, Array.from({ length: TASKS_JSON_MAX + 1 }, (_, i) => `id${i}`)), /como mucho 500/);
  });
});

describe("importTasks", () => {
  test("ida y vuelta: lo exportado se importa en otro proyecto; la dependencia dentro del lote apunta a la nueva", async () => {
    const { user, f, first, second } = await exportFixture();
    const g = await makeProject({ members: [user] });
    await loginAs(user);
    const { text } = expectOk(await exportTasksJson(f.project.id, [first.id, second.id]));
    const res = expectOk(await importTasks(g.project.id, text));
    assert.equal(res.tasks.length, 2);
    assert.deepEqual(res.failed, []);
    const made = await db.task.findMany({ where: { projectId: g.project.id }, include: { labels: { include: { label: true } }, subtasks: true }, orderBy: { title: "asc" } });
    assert.deepEqual(made.map((t) => [t.title, t.createdById, t.assigneeId]), [["Primera", user.id, user.id], ["Segunda", user.id, null]]);
    assert.equal(made[0]!.columnId, g.columns.todo);
    assert.equal(made[1]!.columnId, g.columns.doing, "la columna con el mismo nombre");
    assert.equal(made[1]!.blockedById, made[0]!.id, "bloqueada por la nueva, no por la original");
    assert.deepEqual(made[0]!.labels.map((l) => [l.label.name, l.label.projectId]), [["cliente", g.project.id]]);
    assert.deepEqual(made[0]!.subtasks.map((s) => [s.title, s.done]), [["a", true]]);
    assert.equal(made[0]!.description, "Uno **dos**");
    // Historial de cada una y un solo deshacer.
    assert.equal(await db.taskEvent.count({ where: { taskId: { in: made.map((t) => t.id) }, label: { contains: "Importó la tarea desde JSON" } } }), 2);
    assert.equal(await undoCount(g.project.id), 1);
  });

  test("deshacer borra todas las importadas y las etiquetas que creó (si nadie más las usa); rehacer las devuelve", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const keep = await db.label.create({ data: { projectId: f.project.id, name: "ya estaba", color: "#ef4444" } });
    await loginAs(user);
    const text = lines(
      { format: "pizarro.task", title: "Uno", labels: ["ya estaba", "nueva A"] },
      { format: "pizarro.task", title: "Dos", labels: ["nueva A", "nueva B"] },
    );
    expectOk(await importTasks(f.project.id, text));
    assert.equal(await db.label.count({ where: { projectId: f.project.id } }), 3);
    // Otra persona pone «nueva B» en una tarea suya: esa no se borra al deshacer.
    const other = await makeTask(f, { title: "De otra persona" });
    const b = await db.label.findFirstOrThrow({ where: { projectId: f.project.id, name: "nueva B" } });
    await db.taskLabel.create({ data: { taskId: other.id, labelId: b.id } });
    expectOk(await undoLast(f.project.id));
    assert.deepEqual(await titles(f.project.id), ["De otra persona"]);
    assert.deepEqual((await db.label.findMany({ where: { projectId: f.project.id }, orderBy: { name: "asc" } })).map((l) => l.name), ["nueva B", "ya estaba"]);
    expectApplied(await redoChecked(f.project.id));
    const back = await db.task.findMany({ where: { projectId: f.project.id, title: { in: ["Uno", "Dos"] } }, include: { labels: { include: { label: true } } }, orderBy: { title: "asc" } });
    assert.deepEqual(back.map((t) => [t.title, t.labels.map((l) => l.label.name).sort()]), [["Dos", ["nueva A", "nueva B"]], ["Uno", ["nueva A", "ya estaba"]]]);
    assert.ok(keep);
  });

  test("lee varios formatos: líneas sueltas, bloques ```json, una lista y texto alrededor; lo que no se lee se cuenta", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const text = [
      "Aquí tienes las tareas:",
      "```json", JSON.stringify({ title: "Bloque 1" }), "```",
      "```json", JSON.stringify([{ título: "Lista 1" }, { Titulo: "Lista 2", columna: "Hecho" }]), "```",
      JSON.stringify({ format: "pizarro.task", title: "Suelta" }),
      '{"title": "rota", }',
      JSON.stringify({ format: "pizarro.task", description: "sin título" }),
      "Fin.",
    ].join("\n");
    const res = expectOk(await importTasks(f.project.id, text));
    assert.deepEqual(res.tasks.map((t) => t.title).sort(), ["Bloque 1", "Lista 1", "Lista 2", "Suelta"]);
    assert.deepEqual(res.failed.map((x) => x.text).sort(), ["no es un JSON válido", "no tiene título"]);
    assert.equal(res.tasks.find((t) => t.title === "Lista 2")!.columnId, f.columns.done);
  });

  test("columna: la de cada tarea si existe, si no la primera (con aviso); o una forzada para todas", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const text = lines({ title: "A", column: "En curso" }, { title: "B", column: "No existe" }, { title: "C" });
    const res = expectOk(await importTasks(f.project.id, text));
    const col = (title: string) => res.tasks.find((t) => t.title === title)!.columnId;
    assert.deepEqual([col("A"), col("B"), col("C")], [f.columns.doing, f.columns.todo, f.columns.todo]);
    assert.deepEqual(res.notices, [{ n: 2, title: "B", text: "columna «No existe» (no existe)" }]);
    const forced = expectOk(await importTasks(f.project.id, text, { columnId: f.columns.done }));
    assert.ok(forced.tasks.every((t) => t.columnId === f.columns.done));
    assert.deepEqual(forced.notices, []);
    // Una columna de otro proyecto no vale.
    const other = await makeProject({ members: [user] });
    expectFail(await importTasks(f.project.id, text, { columnId: other.columns.todo }), /La columna no existe/);
  });

  test("tipos de serie entre idiomas: exportado en inglés («Bug fix», «Reply») se importa en español, y al revés", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const g = await makeProject({ members: [user] });
    const fix = await makeTask(f, { title: "Arreglo" });
    const reply = await makeTask(f, { title: "Contestación" });
    await db.task.update({ where: { id: fix.id }, data: { kindId: "kind_correccion" } });
    await db.task.update({ where: { id: reply.id }, data: { kindId: "kind_respuesta" } });
    // Exporta con la interfaz en inglés: los tipos salen traducidos.
    await db.user.update({ where: { id: user.id }, data: { locale: "EN" } });
    await loginAs(user);
    const { text: english } = expectOk(await exportTasksJson(f.project.id, [fix.id, reply.id]));
    assert.deepEqual((JSON.parse(english) as { tasks: { type: string }[] }).tasks.map((t) => t.type).sort(), ["Bug fix", "Reply"]);
    // Importa en español.
    await db.user.update({ where: { id: user.id }, data: { locale: "ES" } });
    await loginAs(user);
    const es = expectOk(await importTasks(g.project.id, english));
    assert.deepEqual(es.notices, []);
    const kinds = async (projectId: string) => (await db.task.findMany({ where: { projectId, title: { in: ["Arreglo", "Contestación"] } }, orderBy: { title: "asc" } })).map((t) => t.kindId);
    assert.deepEqual(await kinds(g.project.id), ["kind_correccion", "kind_respuesta"]);
    // Al revés: exportado en español («Corrección», «Respuesta») e importado con la interfaz en inglés.
    const { text: spanish } = expectOk(await exportTasksJson(f.project.id, [fix.id, reply.id]));
    assert.deepEqual((JSON.parse(spanish) as { tasks: { type: string }[] }).tasks.map((t) => t.type).sort(), ["Corrección", "Respuesta"]);
    const h = await makeProject({ members: [user] });
    await db.user.update({ where: { id: user.id }, data: { locale: "EN" } });
    await loginAs(user);
    const en = expectOk(await importTasks(h.project.id, spanish));
    assert.deepEqual(en.notices, []);
    assert.deepEqual(await kinds(h.project.id), ["kind_correccion", "kind_respuesta"]);
    await db.user.update({ where: { id: user.id }, data: { locale: "ES" } });
  });

  test("dependencias: por título dentro del lote, por título en el proyecto, de otro proyecto ignorada sin aviso, sin círculos", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const existing = await makeTask(f, { title: "Ya existía" });
    await loginAs(user);
    const text = lines(
      { title: "Base" },
      { title: "Encima", dependsOn: "base" },
      { title: "Sobre existente", dependsOn: "ya existía" },
      { title: "De fuera", dependsOn: { id: "abc", title: "Otra" }, info: { id: "x1", projectId: "otroproyecto" } },
      { title: "Ciclo 1", dependsOn: "Ciclo 2" },
      { title: "Ciclo 2", dependsOn: "Ciclo 1" },
      { title: "Perdida", dependsOn: "No existe en ningún sitio" },
    );
    const res = expectOk(await importTasks(f.project.id, text));
    const byTitle = new Map((await db.task.findMany({ where: { projectId: f.project.id } })).map((t) => [t.title, t]));
    assert.equal(byTitle.get("Encima")!.blockedById, byTitle.get("Base")!.id);
    assert.equal(byTitle.get("Sobre existente")!.blockedById, existing.id);
    assert.equal(byTitle.get("De fuera")!.blockedById, null);
    assert.equal(byTitle.get("Ciclo 1")!.blockedById, byTitle.get("Ciclo 2")!.id);
    assert.equal(byTitle.get("Ciclo 2")!.blockedById, null, "la que cerraría el círculo se descarta");
    assert.deepEqual(res.notices.map((n) => `${n.title}: ${n.text}`), ["Ciclo 2: dependencia «Ciclo 1»", "Perdida: dependencia «No existe en ningún sitio»"]);
  });

  test("permisos: sin acceso al proyecto no se importa; el responsable debe tener acceso; el email solo para administradores", async () => {
    const user = await makeUser({ name: "Miembro" });
    const mate = await makeUser({ name: "Compañera" });
    const outsider = await makeUser({ name: "Ajena" });
    const f = await makeProject({ members: [user] });
    await assign(f, mate);
    await loginAs(outsider);
    expectFail(await importTasks(f.project.id, lines({ title: "Intrusa" })), NOT_FOUND);
    await loginAs(user);
    const res = expectOk(await importTasks(f.project.id, lines({ title: "A", assignee: { name: "Ajena" } }, { title: "B", assignee: mate.email }, { title: "C", assignee: { id: mate.id, name: "Otro nombre" } })));
    const a = (title: string) => res.tasks.find((t) => t.title === title)!.assigneeId;
    assert.deepEqual([a("A"), a("B"), a("C")], [null, null, mate.id]);
    assert.equal(res.notices.length, 2);
    await loginAs(await makeUser({ role: "ADMIN" }));
    const admin = expectOk(await importTasks(f.project.id, lines({ title: "D", assignee: mate.email })));
    assert.equal(admin.tasks[0]!.assigneeId, mate.id);
    assert.ok((await db.task.findMany({ where: { projectId: f.project.id } })).every((t) => t.projectId === f.project.id));
  });

  test("topes: más de 500 tareas, tope de la columna «Programa del curso», tope de tareas activas del proyecto", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const many = Array.from({ length: TASKS_JSON_MAX + 1 }, (_, i) => ({ title: `T${i}` }));
    expectFail(await importTasks(f.project.id, JSON.stringify({ format: "pizarro.tasks", version: 1, tasks: many })), /Hay 501 tareas y se importan como mucho 500/);
    await db.column.update({ where: { id: f.columns.doing }, data: { role: "PROGRAM" } });
    await db.task.createMany({ data: Array.from({ length: 99 }, (_, i) => ({ projectId: f.project.id, columnId: f.columns.doing, title: `S${i}`, kindId: f.kindId, position: i + 1 })) });
    expectFail(await importTasks(f.project.id, lines({ title: "X" }, { title: "Y" }), { columnId: f.columns.doing }), /admite como mucho 100 sesiones/);
    assert.equal(await db.task.count({ where: { projectId: f.project.id, title: { in: ["X", "Y"] } } }), 0, "todo o nada");
    expectFail(await importTasks(f.project.id, "hola, esto no es JSON"), /No hay ninguna tarea que importar/);
    expectFail(await importTasks(f.project.id, "x".repeat(5_000_001)), /demasiado largo/);
  });

  test("500 tareas con etiquetas, subtareas y dependencias: consultas por lotes (las mismas que con 50) y tiempo proporcional", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const g = await makeProject({ members: [user] });
    await loginAs(user);
    const batch = (n: number) => JSON.stringify({
      format: "pizarro.tasks", version: 1,
      tasks: Array.from({ length: n }, (_, i) => ({
        format: "pizarro.task", title: `Tarea ${i}`, column: ["Por hacer", "En curso", "Hecho"][i % 3], labels: [`e${i % 10}`],
        subtasks: [{ text: "uno", done: i % 2 === 0 }, "dos"], dependsOn: i > 0 ? `Tarea ${i - 1}` : null, assignee: { id: user.id },
        googleDocs: [`https://docs.google.com/document/d/d${i}/edit`],
      })),
    });
    const small = await measure(() => importTasks(g.project.id, batch(50)));
    expectOk(small.result);
    const big = await measure(() => importTasks(f.project.id, batch(TASKS_JSON_MAX)));
    const res = expectOk(big.result);
    assert.equal(res.tasks.length, TASKS_JSON_MAX);
    assert.equal(await db.subtask.count({ where: { task: { projectId: f.project.id } } }), TASKS_JSON_MAX * 2);
    assert.equal(await db.taskLink.count({ where: { task: { projectId: f.project.id } } }), TASKS_JSON_MAX);
    assert.equal(await db.task.count({ where: { projectId: f.project.id, blockedById: { not: null } } }), TASKS_JSON_MAX - 1);
    assert.equal(await db.taskEvent.count({ where: { projectId: f.project.id } }), TASKS_JSON_MAX, "una línea de historial por tarea");
    // Por lotes: 10 veces más tareas no son más consultas (salvo alguna de margen); una por tarea serían cientos.
    assert.ok(big.queries <= small.queries + 10, `500 tareas: ${big.queries} consultas; 50 tareas: ${small.queries}`);
    // Y el tiempo crece como mucho en proporción (un coste cuadrático serían 100 veces más).
    assert.ok(big.ms < small.ms * 30 + 3000, `500 tareas: ${Math.round(big.ms)} ms; 50 tareas: ${Math.round(small.ms)} ms`);
    // Se deshace de una vez, etiquetas creadas incluidas.
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.task.count({ where: { projectId: f.project.id } }), 0);
    assert.equal(await db.label.count({ where: { projectId: f.project.id } }), 0);
  });
});

describe("importar más de 1 MB por la ruta, avisos de etiquetas y rehacer con el tope de etiquetas", () => {
  const post = (projectId: string, body: string, headers: Record<string, string> = {}, query = "") =>
    importRoute(
      new Request(`http://localhost/api/projects/${projectId}/import-tasks${query}`, { method: "POST", body, headers: { origin: "http://localhost", host: "localhost", "content-type": "text/plain;charset=UTF-8", ...headers } }),
      { params: Promise.resolve({ projectId }) },
    );

  test("la ruta importa un JSON de más de 1 MB (con caracteres de varios bytes) y lo exportado se vuelve a importar", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const g = await makeProject({ members: [user] });
    await loginAs(user);
    const tasks = Array.from({ length: 300 }, (_, i) => ({ format: "pizarro.task", title: `Grande ${i} 🙂`, description: `Descripción «${i}» con eñes y €: ${"ñ€🙂 ".repeat(800)}` }));
    const text = JSON.stringify({ format: "pizarro.tasks", version: 1, tasks }, null, 2);
    assert.ok(Buffer.byteLength(text) > 2 * 1024 * 1024, `${Buffer.byteLength(text)} bytes`);
    const res = await post(f.project.id, text);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: { tasks: { title: string }[] } };
    assert.equal(body.ok, true);
    assert.equal(body.data.tasks.length, 300);
    const back = await db.task.findFirstOrThrow({ where: { projectId: f.project.id, title: "Grande 7 🙂" } });
    assert.equal(back.description, tasks[7]!.description);
    // El registro y el deshacer, como con la acción.
    assert.equal(await undoCount(f.project.id), 1);
    // Exportar las 300 y volver a importarlas en otro proyecto (columna forzada por la dirección).
    const ids = (await db.task.findMany({ where: { projectId: f.project.id }, select: { id: true } })).map((t) => t.id);
    const exported = expectOk(await exportTasksJson(f.project.id, ids));
    const again = await post(g.project.id, exported.text, {}, `?columnId=${g.columns.doing}`);
    const reBody = (await again.json()) as { ok: boolean; data: { tasks: { columnId: string }[] } };
    assert.equal(reBody.ok, true);
    assert.equal(reBody.data.tasks.length, 300);
    assert.ok(reBody.data.tasks.every((t) => t.columnId === g.columns.doing));
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.task.count({ where: { projectId: f.project.id } }), 0);
  });

  test("la ruta: otro origen 403, sin sesión 401, demasiado grande 413 (declarado o al leer), errores de la importación con 200 y ok: false", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const other = await makeProject({ members: [] });
    await loginAs(user);
    assert.equal((await post(f.project.id, "{}", { origin: "https://example.com" })).status, 403);
    assert.equal((await post(f.project.id, "x".repeat(10), { "content-length": String(15_000_001) })).status, 413);
    const tooLong = await post(f.project.id, "x".repeat(5_000_001));
    assert.equal(tooLong.status, 413);
    assert.match(((await tooLong.json()) as { error: string }).error, /demasiado largo/);
    // Sin acceso al proyecto: 404 antes de ocupar un hueco de subida y de leer el cuerpo (aunque se declare enorme).
    const deniedRes = await post(other.project.id, '{"title":"Ajena"}');
    assert.equal(deniedRes.status, 404);
    const denied = (await deniedRes.json()) as { ok: boolean; error: string };
    assert.equal(denied.ok, false);
    assert.match(denied.error, NOT_FOUND);
    assert.equal((await post(other.project.id, "x", { "content-length": "14000000" })).status, 404);
    assert.equal((await post("no válido", "x")).status, 404);
    logout();
    const anon = await post(f.project.id, '{"title":"Sin sesión"}');
    assert.equal(anon.status, 401);
    assert.match(((await anon.json()) as { error: string }).error, /Sesión caducada/);
    assert.equal(await db.task.count({ where: { projectId: f.project.id } }), 0);
  });

  test("500 tareas con 20 etiquetas que no se pueden crear: rápido (sin coste cuadrático) y unos pocos avisos por tarea", async () => {
    const user = await makeUser();
    await loginAs(user);
    const text = JSON.stringify({
      format: "pizarro.tasks", version: 1,
      tasks: Array.from({ length: TASKS_JSON_MAX }, (_, i) => ({ title: `T${i}`, labels: Array.from({ length: 20 }, (_, j) => `${"x".repeat(40)}-${i}-${j}`) })),
    });
    // Cada intento, en un proyecto nuevo (500 tareas por intento; el tope del proyecto es 1000).
    const projects = await Promise.all([0, 1, 2].map(() => makeProject({ members: [user] })));
    // Antes: 30-40 s de CPU sin soltar el hilo (cada etiqueta fallida recorría todas las tareas y sus etiquetas).
    const res = expectOk(await assertFastAsync(10_000, (i) => importTasks(projects[i]!.project.id, text), "500×20 etiquetas no válidas"));
    assert.equal(res.tasks.length, TASKS_JSON_MAX);
    const mine = res.notices.filter((n) => n.title === "T7").map((n) => n.text);
    assert.equal(mine.length, 4, mine.join(" | "));
    assert.match(mine[0]!, /^etiqueta «x{39}…» \(no se ha podido crear\)$/);
    assert.equal(mine[3], "17 etiquetas más (no se han podido crear)");
  });

  test("rehacer una importación con el proyecto en el tope de 50 etiquetas: no se recrean y las tareas quedan sin ellas", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    expectOk(await importTasks(f.project.id, lines({ title: "Con etiqueta", labels: ["nueva"] })));
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.label.count({ where: { projectId: f.project.id } }), 0);
    // Mientras tanto, el proyecto llega al tope.
    await db.label.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ projectId: f.project.id, name: `e${i}`, color: "#ef4444" })) });
    const redo = expectApplied(await redoChecked(f.project.id));
    assert.equal(redo.skipped, 1, "la etiqueta que no vuelve cuenta como parte que no se pudo aplicar");
    assert.equal(await db.label.count({ where: { projectId: f.project.id } }), 50);
    const task = await db.task.findFirstOrThrow({ where: { projectId: f.project.id, title: "Con etiqueta" }, include: { labels: true } });
    assert.equal(task.labels.length, 0);
  });

  test("rehacer cuando la etiqueta creada siguió existiendo (otra persona la usó): no cuenta como parte que ya no existía", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    expectOk(await importTasks(f.project.id, lines({ title: "Uno", labels: ["compartida"] })));
    const label = await db.label.findFirstOrThrow({ where: { projectId: f.project.id, name: "compartida" } });
    const other = await makeTask(f, { title: "De otra persona" });
    await db.taskLabel.create({ data: { taskId: other.id, labelId: label.id } });
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.label.count({ where: { id: label.id } }), 1);
    const redo = expectApplied(await redoChecked(f.project.id));
    assert.equal(redo.skipped, 0);
    const uno = await db.task.findFirstOrThrow({ where: { projectId: f.project.id, title: "Uno" }, include: { labels: true } });
    assert.deepEqual(uno.labels.map((l) => l.labelId), [label.id]);
  });

  test("exportar: si el JSON no cabe en el tope de la importación, no se exporta (y se avisa)", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const big = "a".repeat(19_000);
    await db.task.createMany({ data: Array.from({ length: 300 }, (_, i) => ({ projectId: f.project.id, columnId: f.columns.todo, kindId: f.kindId, title: `Larga ${i}`, description: big, position: (i + 1) * 1000 })) });
    const ids = (await db.task.findMany({ where: { projectId: f.project.id }, select: { id: true } })).map((t) => t.id);
    expectFail(await exportTasksJson(f.project.id, ids), /no se podrían volver a importar/);
    // Con menos, sí.
    const res = expectOk(await exportTasksJson(f.project.id, ids.slice(0, 100)));
    assert.ok(res.text.length <= 5_000_000);
  });
});
