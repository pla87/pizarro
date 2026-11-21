// Canal en vivo del tablero (api/projects/[id]/events) y aviso de tarea abierta (api/tasks/[id]/viewers) contra
// PostgreSQL real: una pestaña que se cierra mientras se abre el canal no deja nada registrado (ni persona fantasma ni
// hueco de canal ocupado), y cerrar el diálogo quita a la persona por los dos caminos (canal y aviso con caducidad).
// También las tarjetas sueltas (api/projects/[id]/board-tasks): solo las activas del proyecto, con su acceso, y qué
// tarjetas anuncia el canal por cada acción.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { db, expectOk, inRequest, loginAs, logout, makeProject, makeTask, makeUser } from "./helpers";
import { GET as eventsRoute } from "../../src/app/api/projects/[projectId]/events/route";
import { GET as boardTasksRoute } from "../../src/app/api/projects/[projectId]/board-tasks/route";
import { DELETE as viewersDelete, GET as viewersGet } from "../../src/app/api/tasks/[taskId]/viewers/route";
import { duplicateTask, moveTask, moveTasks, updateTask } from "../../src/actions/tasks";
import { LIVE_PATCH_MAX } from "../../src/components/board/livePatch";
import { openStreamCount, subscribeProject } from "../../src/lib/realtime";
import { activeUsers, presenceSnapshot, taskViewersExcept } from "../../src/lib/presence";
import { destroySession } from "../../src/lib/session";

const events = (projectId: string, signal: AbortSignal) =>
  eventsRoute(new Request(`http://localhost/api/projects/${projectId}/events`, { signal }), { params: Promise.resolve({ projectId }) });

describe("canal en vivo: cortado mientras se abre", () => {
  test("ya cortado al llegar: respuesta vacía y nada registrado", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const ac = new AbortController();
    ac.abort();
    const res = await events(f.project.id, ac.signal);
    assert.equal(res.status, 204);
    assert.equal(openStreamCount(user.id), 0, "sin hueco de canal ocupado");
    assert.deepEqual(presenceSnapshot(f.project.id).users, [], "sin persona fantasma en «Quién está»");
  });

  test("cortado mientras se comprueban la sesión y el proyecto: tampoco queda nada", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const ac = new AbortController();
    const pending = events(f.project.id, ac.signal);
    ac.abort();
    const res = await pending;
    await res.body?.cancel().catch(() => {});
    assert.equal(openStreamCount(user.id), 0);
    assert.deepEqual(presenceSnapshot(f.project.id).users, []);
  });

  test("abierto con normalidad: cuenta mientras dura y al cortarse se suelta", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const ac = new AbortController();
    const res = await events(f.project.id, ac.signal);
    assert.equal(res.status, 200);
    assert.equal(openStreamCount(user.id), 1);
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /retry: 3000/);
    ac.abort();
    assert.equal(openStreamCount(user.id), 0);
    await reader.cancel().catch(() => {});
  });
});

describe("tarea abierta: cerrar el diálogo", () => {
  test("con ?stream= de un canal que el servidor no conoce, el DELETE también quita el aviso con caducidad", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const f = await makeProject({ members: [user, other] });
    const task = await makeTask(f);
    const ctx = { params: Promise.resolve({ taskId: task.id }) };
    const url = `http://localhost/api/tasks/${task.id}/viewers?stream=${randomUUID()}&open=m1`;
    await loginAs(user);
    const res = await viewersGet(new Request(url), ctx);
    assert.equal((await res.json()).live, false, "canal desconocido: aviso con caducidad");
    assert.deepEqual(taskViewersExcept(task.id, f.project.id, other.id).map((p) => p.id), [user.id]);
    const del = await viewersDelete(new Request(url, { method: "DELETE", headers: { origin: "http://localhost", host: "localhost" } }), ctx);
    assert.equal(del.status, 204);
    assert.deepEqual(taskViewersExcept(task.id, f.project.id, other.id), [], "deja de tenerla abierta al momento, no a los 150 s");
  });
});

describe("tarea abierta: ?stream= sin ?open= (pestañas de antes de la v1.60) ya no se admite", () => {
  test("GET y DELETE con canal pero sin montaje, o con alguno mal formado: 400 y nada anotado", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const f = await makeProject({ members: [user, other] });
    const task = await makeTask(f);
    const ctx = { params: Promise.resolve({ taskId: task.id }) };
    await loginAs(user);
    const base = `http://localhost/api/tasks/${task.id}/viewers`;
    for (const query of [`?stream=${randomUUID()}`, `?stream=${randomUUID()}&open=`, `?stream=${randomUUID()}&open=a-b`, "?stream=x&open=m1"]) {
      assert.equal((await viewersGet(new Request(`${base}${query}`), ctx)).status, 400, query);
      const del = await viewersDelete(new Request(`${base}${query}`, { method: "DELETE", headers: { origin: "http://localhost", host: "localhost" } }), ctx);
      assert.equal(del.status, 400, query);
    }
    assert.deepEqual(taskViewersExcept(task.id, f.project.id, other.id), [], "ni aviso con caducidad ni tarea retenida");
    // Sin canal (sondeo de respaldo), sin parámetros: sigue valiendo.
    const res = await viewersGet(new Request(base), ctx);
    assert.equal((await res.json()).live, false);
    assert.deepEqual(taskViewersExcept(task.id, f.project.id, other.id).map((p) => p.id), [user.id]);
  });
});

describe("tarea abierta: tope de ritmo", () => {
  test("el aviso admite 120 por minuto y persona; después, 429", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const task = await makeTask(f);
    const ctx = { params: Promise.resolve({ taskId: task.id }) };
    await loginAs(user);
    for (let i = 0; i < 120; i++) assert.equal((await viewersGet(new Request(`http://localhost/api/tasks/${task.id}/viewers?stream=${randomUUID()}&open=m${i}`), ctx)).status, 200);
    assert.equal((await viewersGet(new Request(`http://localhost/api/tasks/${task.id}/viewers`), ctx)).status, 429);
  });
});

describe("cerrar sesión", () => {
  test("quien cierra sesión con el tablero abierto deja de salir en «Quién está» al momento", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    const ac = new AbortController();
    const res = await events(f.project.id, ac.signal);
    assert.deepEqual(activeUsers(f.project.id).map((u) => u.id), [user.id]);
    await inRequest(() => destroySession());
    assert.equal(openStreamCount(user.id), 0, "su canal se corta");
    assert.deepEqual(activeUsers(f.project.id), [], "y no sigue 5 minutos entre los activos");
    await res.body?.cancel().catch(() => {});
  });
});

describe("tarjetas sueltas (refresco en vivo sin recargar el tablero)", () => {
  const boardTasks = (projectId: string, ids: string[]) =>
    boardTasksRoute(new Request(`http://localhost/api/projects/${projectId}/board-tasks?ids=${ids.join(",")}`), { params: Promise.resolve({ projectId }) });

  test("solo las activas de ESE proyecto: ni archivadas, ni de otro proyecto, ni inexistentes; sin acceso, 404", async () => {
    const user = await makeUser();
    const outsider = await makeUser();
    const f = await makeProject({ members: [user] });
    const other = await makeProject({ members: [user] });
    const active = await makeTask(f, { title: "Activa" });
    const archived = await makeTask(f, { title: "Archivada", position: 2000 });
    await db.task.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    const foreign = await makeTask(other, { title: "De otro proyecto" });
    await loginAs(user);
    const res = await boardTasks(f.project.id, [active.id, archived.id, foreign.id, "no_existe"]);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    const body = (await res.json()) as { boot: string; tasks: { id: string; title: string; columnId: string }[] };
    assert.deepEqual(body.tasks.map((t) => t.title), ["Activa"]);
    assert.equal(body.tasks[0]!.columnId, f.columns.todo);
    assert.equal(typeof body.boot, "string");
    // Desde el otro proyecto tampoco sale la tarea de este.
    const cross = (await (await boardTasks(other.project.id, [active.id, foreign.id])).json()) as { tasks: { id: string }[] };
    assert.deepEqual(cross.tasks.map((t) => t.id), [foreign.id]);
    await loginAs(outsider);
    assert.equal((await boardTasks(f.project.id, [active.id])).status, 404, "quien no ve el proyecto no recibe nada");
  });

  test("sin ids, con un id mal formado o con más de LIVE_PATCH_MAX: 400; sin sesión: 401", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await loginAs(user);
    assert.equal((await boardTasks(f.project.id, [])).status, 400);
    assert.equal((await boardTasks(f.project.id, ["a%00b"])).status, 400);
    assert.equal((await boardTasks(f.project.id, Array.from({ length: LIVE_PATCH_MAX + 1 }, (_, i) => `t${i}`))).status, 400);
    logout();
    assert.equal((await boardTasks(f.project.id, ["t1"])).status, 401);
  });

  test("el aviso del canal lleva todas las tarjetas que tocó la acción (también en bloque, la copia y la siguiente aparición)", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const a = await makeTask(f, { title: "A", position: 1000 });
    const b = await makeTask(f, { title: "B", position: 2000 });
    const daily = await makeTask(f, { title: "Diaria", position: 3000, recurrence: "DAILY" });
    await loginAs(user);
    const seen: { action: string; taskIds?: string[]; full?: boolean }[] = [];
    const stop = subscribeProject(f.project.id, (c) => seen.push(c));
    try {
      expectOk(await moveTasks([a.id, b.id], f.columns.doing));
      expectOk(await updateTask(a.id, { title: "A2" }));
      const copy = expectOk(await duplicateTask(b.id));
      const moved = expectOk(await moveTask(daily.id, f.columns.done, null, null));
      assert.equal(moved.spawned.length, 1);
      assert.deepEqual(seen.map((c) => c.action), ["tasks.moveTasks", "tasks.updateTask", "tasks.duplicateTask", "tasks.moveTask"]);
      assert.deepEqual(new Set(seen[0]!.taskIds), new Set([a.id, b.id]));
      assert.deepEqual(seen[1]!.taskIds, [a.id]);
      assert.deepEqual(new Set(seen[2]!.taskIds), new Set([b.id, copy.id]));
      assert.deepEqual(new Set(seen[3]!.taskIds), new Set([daily.id, moved.spawned[0]!.id]));
      assert.ok(seen.every((c) => !c.full), "sin renumerar ni crear etiquetas: solo esas tarjetas");
    } finally {
      stop();
    }
  });
});
