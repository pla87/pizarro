// Canal en vivo del tablero (api/projects/[id]/events) y aviso de tarea abierta (api/tasks/[id]/viewers) contra
// PostgreSQL real: una pestaña que se cierra mientras se abre el canal no deja nada registrado (ni persona fantasma ni
// hueco de canal ocupado), y cerrar el diálogo quita a la persona por los dos caminos (canal y aviso con caducidad).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { inRequest, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { GET as eventsRoute } from "../../src/app/api/projects/[projectId]/events/route";
import { DELETE as viewersDelete, GET as viewersGet } from "../../src/app/api/tasks/[taskId]/viewers/route";
import { openStreamCount } from "../../src/lib/realtime";
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
    const url = `http://localhost/api/tasks/${task.id}/viewers?stream=${randomUUID()}`;
    await loginAs(user);
    const res = await viewersGet(new Request(url), ctx);
    assert.equal((await res.json()).live, false, "canal desconocido: aviso con caducidad");
    assert.deepEqual(taskViewersExcept(task.id, f.project.id, other.id).map((p) => p.id), [user.id]);
    const del = await viewersDelete(new Request(url, { method: "DELETE", headers: { origin: "http://localhost", host: "localhost" } }), ctx);
    assert.equal(del.status, 204);
    assert.deepEqual(taskViewersExcept(task.id, f.project.id, other.id), [], "deja de tenerla abierta al momento, no a los 150 s");
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
