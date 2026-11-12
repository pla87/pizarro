// Acciones a la vez de dos personas, contra PostgreSQL real: el texto de una tarea guardado por dos (conflicto dentro
// de la transacción), una tarea archivada mientras se despliega la release y ocultar a la vez los dos últimos tipos.
import assert from "node:assert/strict";
import type { AsyncLocalStorage } from "node:async_hooks";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeKind, makeProject, makeTask, makeUser } from "./helpers";
import { createSession } from "../../src/lib/session";
import { updateTask } from "../../src/actions/tasks";
import { deployRelease } from "../../src/actions/releases";
import { setGeneralKindEnabled } from "../../src/actions/project-kinds";

/**
 * Ejecuta `fn` como una petición de `user` con su propia cookie (no la del «jar» global), para que dos personas
 * distintas puedan tener acciones en curso a la vez (Promise.all).
 */
async function asOwnRequest<T>(user: { id: string }, fn: () => Promise<T>): Promise<T> {
  const { scope } = (globalThis as unknown as { __pzTestRequest: { scope: AsyncLocalStorage<unknown> } }).__pzTestRequest;
  const jar = new Map<string, string>();
  const store = {
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: unknown) => void jar.set(name, String(value)),
    delete: (name: string) => void jar.delete(name),
    has: (name: string) => jar.has(name),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  };
  return scope.run(store, async () => {
    await createSession(user.id);
    return fn();
  });
}

/** Espera a que alguna conexión de la base quede bloqueada esperando un candado (la acción ya llegó a la transacción). */
async function waitForLockWaiter(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const [row] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (row && row.n > 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("la acción no llegó a esperar el candado");
}

describe("updateTask: conflicto de texto dentro de la transacción", () => {
  test("un guardado que entra justo después de otro (de otra persona) recibe 409 y no pisa su texto", async () => {
    const a = await makeUser({ name: "Ana" });
    const b = await makeUser({ name: "Bea" });
    const f = await makeProject({ members: [a, b] });
    const task = await makeTask(f, { title: "T" });
    const since = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await loginAs(b);
    // Ana «está guardando»: tiene la fila bloqueada. El guardado de Bea pasa la comprobación rápida (aún no ha cambiado
    // nada), espera al candado y, cuando Ana confirma su texto, debe ver el cambio y rechazarse.
    let pending: ReturnType<typeof updateTask> | null = null;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id" = ${task.id} FOR UPDATE`;
      pending = updateTask(task.id, { description: "<p>De Bea</p>" }, since);
      await waitForLockWaiter();
      await tx.task.update({ where: { id: task.id }, data: { description: "<p>De Ana</p>", contentUpdatedAt: new Date(), contentUpdatedById: a.id } });
    }, { timeout: 10_000 });
    expectFail(await pending!, /Ana ha cambiado el texto de esta tarea/);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).description, "<p>De Ana</p>");
  });

  test("dos personas guardan a la vez la descripción cargada a la misma hora: solo pasa una", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const f = await makeProject({ members: [a, b] });
    const task = await makeTask(f);
    const since = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    const results = await Promise.all([
      asOwnRequest(a, () => updateTask(task.id, { description: "<p>A</p>" }, since)),
      asOwnRequest(b, () => updateTask(task.id, { description: "<p>B</p>" }, since)),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results.map((r) => r.ok || r.error)));
    expectFail(results.find((r) => !r.ok)!, /ha cambiado el texto de esta tarea/);
    const winner = results[0]!.ok ? "<p>A</p>" : "<p>B</p>";
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).description, winner);
  });

  test("la misma persona puede volver a guardar sin conflicto", async () => {
    const a = await makeUser();
    const f = await makeProject({ members: [a] });
    const task = await makeTask(f);
    const since = new Date().toISOString();
    await loginAs(a);
    expectOk(await updateTask(task.id, { description: "<p>1</p>" }, since));
    expectOk(await updateTask(task.id, { description: "<p>2</p>" }, since));
  });
});

describe("deployRelease: tarea archivada mientras se despliega", () => {
  test("si se archiva una tarea entre la lectura y la transacción, 409 y nada cambia", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    await db.column.create({ data: { projectId: f.project.id, name: "En producción", position: 4000, role: "IN_PRODUCTION" } });
    const keep = await makeTask(f, { columnId: f.columns.done });
    const gone = await makeTask(f, { columnId: f.columns.done });
    await loginAs(user);
    let pending: ReturnType<typeof deployRelease> | null = null;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id" = ${gone.id} FOR UPDATE`;
      pending = deployRelease({ projectId: f.project.id, title: "R", content: "Cambios", destination: "IN_PRODUCTION", taskIds: [keep.id, gone.id] });
      await waitForLockWaiter();
      await tx.task.update({ where: { id: gone.id }, data: { archivedAt: new Date(), archivedFromColumnId: f.columns.done } });
    }, { timeout: 10_000 });
    expectFail(await pending!, /Una de las tareas ya no está en el tablero/);
    assert.equal(await db.release.count({ where: { projectId: f.project.id } }), 0);
    const [k, g] = await Promise.all([db.task.findUniqueOrThrow({ where: { id: keep.id } }), db.task.findUniqueOrThrow({ where: { id: gone.id } })]);
    assert.equal(k.columnId, f.columns.done);
    assert.equal(g.columnId, f.columns.done);
    assert.ok(g.archivedAt, "la archivada sigue archivada");
  });
});

describe("setGeneralKindEnabled: ocultar a la vez los dos últimos tipos", () => {
  test("solo se oculta uno: el proyecto nunca queda sin tipos", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    // Proyecto con solo dos tipos usables: dos generales (se ocultan los demás generales y se borra el propio).
    const g1 = await makeKind(null);
    const g2 = await makeKind(null);
    await db.task.deleteMany({ where: { projectId: f.project.id } });
    await db.taskKind.delete({ where: { id: f.kindId } });
    const others = await db.taskKind.findMany({ where: { projectId: null, id: { notIn: [g1.id, g2.id] } }, select: { id: true } });
    if (others.length) await db.projectHiddenKind.createMany({ data: others.map((k) => ({ projectId: f.project.id, kindId: k.id })), skipDuplicates: true });
    await loginAs(user);
    const results = await Promise.all([
      setGeneralKindEnabled(f.project.id, g1.id, false, null),
      setGeneralKindEnabled(f.project.id, g2.id, false, null),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
    expectFail(results.find((r) => !r.ok)!, /al menos un tipo de tarea/);
    const hidden = await db.projectHiddenKind.count({ where: { projectId: f.project.id, kindId: { in: [g1.id, g2.id] } } });
    assert.equal(hidden, 1);
  });
});
