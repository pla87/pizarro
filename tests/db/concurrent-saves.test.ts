// Acciones a la vez de dos personas, contra PostgreSQL real: el texto de una tarea guardado por dos (conflicto dentro
// de la transacción), una tarea archivada mientras se despliega la release y ocultar a la vez los dos últimos tipos.
import assert from "node:assert/strict";
import type { AsyncLocalStorage } from "node:async_hooks";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeKind, makeProject, makeTask, makeUser, waitForLockWaiter } from "./helpers";
import { createSession } from "../../src/lib/session";
import { updateTask } from "../../src/actions/tasks";
import { deployRelease } from "../../src/actions/releases";
import { setGeneralKindEnabled } from "../../src/actions/project-kinds";
import { textHash } from "../../src/lib/text-version";

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

  test("una sola pestaña guarda varias veces seguidas (título, descripción, autoguardado) sin conflictos falsos", async () => {
    const a = await makeUser();
    const f = await makeProject({ members: [a] });
    const task = await makeTask(f);
    await loginAs(a);
    // Como TaskDialog: cada guardado envía la versión del texto que devolvió el anterior.
    let version: string | null = null;
    for (const patch of [{ description: "<p>1</p>" }, { title: "Título 2" }, { description: "<p>3</p>" }, { title: "Título 4", description: "<p>4</p>" }, { description: "<p>5</p>" }]) {
      version = expectOk(await updateTask(task.id, patch, version)).textVersion;
    }
    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.deepEqual([row.title, row.description], ["Título 4", "<p>5</p>"]);
    // Sin tocar el texto (otro campo) no se manda versión ni cambia.
    expectOk(await updateTask(task.id, { linkUrl: "https://example.com/a" }));
    expectOk(await updateTask(task.id, { description: "<p>6</p>" }, version));
  });

  test("dos pestañas o dispositivos de la misma persona: el segundo guardado no pisa el primero (409)", async () => {
    const a = await makeUser({ name: "Ana" });
    const f = await makeProject({ members: [a] });
    const task = await makeTask(f, { title: "T" });
    await loginAs(a);
    // Las dos pestañas abrieron la tarea con la misma versión del texto.
    const opened = expectOk(await updateTask(task.id, { description: "<p>Inicial</p>" }, null)).textVersion;
    await new Promise((r) => setTimeout(r, 5));
    // Pestaña A guarda su descripción.
    expectOk(await updateTask(task.id, { description: "<p>Desde A</p>" }, opened));
    // Pestaña B guarda la suya sobre la versión de la apertura: antes pasaba (misma persona) y se perdía lo de A.
    expectFail(await updateTask(task.id, { description: "<p>Desde B</p>" }, opened), /Has cambiado el texto de esta tarea en otra pestaña u otro dispositivo/);
    expectFail(await updateTask(task.id, { title: "Título de B" }, opened), /otra pestaña u otro dispositivo/);
    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.deepEqual([row.title, row.description], ["T", "<p>Desde A</p>"]);
  });

  test("dos guardados casi a la vez de la misma persona desde dos pestañas: solo pasa uno", async () => {
    const a = await makeUser();
    const f = await makeProject({ members: [a] });
    const task = await makeTask(f);
    const since = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    const results = await Promise.all([
      asOwnRequest(a, () => updateTask(task.id, { description: "<p>A</p>" }, since)),
      asOwnRequest(a, () => updateTask(task.id, { description: "<p>B</p>" }, since)),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results.map((r) => r.ok || r.error)));
    expectFail(results.find((r) => !r.ok)!, /otra pestaña u otro dispositivo/);
  });
});

describe("updateTask: conflicto de texto campo a campo", () => {
  // Como TaskDialog: la versión del texto que se está editando y las huellas del título y la descripción de esa versión.
  const makeTextTask = async (f: Awaited<ReturnType<typeof makeProject>>, description: string) => {
    const t = await makeTask(f, { title: "T" });
    return db.task.update({ where: { id: t.id }, data: { description } });
  };
  const sinceOf = (row: { contentUpdatedAt: Date | null; title: string; description: string }) => ({
    version: row.contentUpdatedAt?.toISOString() ?? null,
    title: textHash(row.title),
    description: textHash(row.description),
  });

  test("otra persona cambió solo la descripción: el título se guarda; la descripción sí choca", async () => {
    const a = await makeUser({ name: "Ana" });
    const b = await makeUser({ name: "Bea" });
    const f = await makeProject({ members: [a, b] });
    const task = await makeTextTask(f, "<p>D</p>");
    const opened = sinceOf(await db.task.findUniqueOrThrow({ where: { id: task.id } }));
    await new Promise((r) => setTimeout(r, 5));
    await loginAs(b);
    expectOk(await updateTask(task.id, { description: "<p>De Bea</p>" }, opened));
    await loginAs(a);
    // Antes: 409 y el título escrito se perdía.
    const saved = expectOk(await updateTask(task.id, { title: "Título de Ana" }, opened));
    let row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.deepEqual([row.title, row.description], ["Título de Ana", "<p>De Bea</p>"]);
    // Su descripción se escribió sobre la anterior: eso sí es un conflicto (aunque envíe la versión de su último guardado
    // junto a la huella de la descripción que tenía).
    expectFail(await updateTask(task.id, { description: "<p>De Ana</p>" }, opened), /Bea ha cambiado el texto de esta tarea/);
    expectOk(await updateTask(task.id, { title: "Otra vez Ana" }, { ...opened, version: saved.textVersion, title: textHash("Título de Ana") }));
    row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.deepEqual([row.title, row.description], ["Otra vez Ana", "<p>De Bea</p>"]);
  });

  test("otra persona cambió el título: guardar el título choca y no lo pisa; la descripción se guarda", async () => {
    const a = await makeUser({ name: "Ana" });
    const b = await makeUser({ name: "Bea" });
    const f = await makeProject({ members: [a, b] });
    const task = await makeTextTask(f, "<p>D</p>");
    const opened = sinceOf(await db.task.findUniqueOrThrow({ where: { id: task.id } }));
    await new Promise((r) => setTimeout(r, 5));
    await loginAs(b);
    expectOk(await updateTask(task.id, { title: "Título de Bea" }, opened));
    await loginAs(a);
    expectFail(await updateTask(task.id, { title: "Título de Ana" }, opened), /Bea ha cambiado el texto de esta tarea/);
    expectFail(await updateTask(task.id, { title: "Título de Ana", description: "<p>De Ana</p>" }, opened), /Bea ha cambiado/);
    expectOk(await updateTask(task.id, { description: "<p>De Ana</p>" }, opened));
    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.deepEqual([row.title, row.description], ["Título de Bea", "<p>De Ana</p>"]);
  });

  test("dos pestañas de la misma persona: la descripción guardada en una choca con la de la otra, no con su título", async () => {
    const a = await makeUser();
    const f = await makeProject({ members: [a] });
    const task = await makeTextTask(f, "<p>Inicial</p>");
    await loginAs(a);
    const opened = sinceOf(await db.task.findUniqueOrThrow({ where: { id: task.id } }));
    await new Promise((r) => setTimeout(r, 5));
    expectOk(await updateTask(task.id, { description: "<p>Desde A</p>" }, opened));
    expectFail(await updateTask(task.id, { description: "<p>Desde B</p>" }, opened), /otra pestaña u otro dispositivo/);
    expectOk(await updateTask(task.id, { title: "Título desde B" }, opened));
    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.deepEqual([row.title, row.description], ["Título desde B", "<p>Desde A</p>"]);
  });

  test("dentro de la transacción: un cambio de la descripción que entra a la vez no rechaza el título, sí la descripción", async () => {
    const a = await makeUser({ name: "Ana" });
    const b = await makeUser({ name: "Bea" });
    const f = await makeProject({ members: [a, b] });
    for (const [patch, ok] of [[{ title: "De Bea" }, true], [{ description: "<p>De Bea</p>" }, false]] as const) {
      const task = await makeTextTask(f, "<p>D</p>");
      const opened = sinceOf(task);
      // Ana «está guardando» su descripción (fila bloqueada); el guardado de Bea pasa la comprobación rápida, espera al
      // candado y la repite con el texto ya cambiado.
      let pending: ReturnType<typeof updateTask> | null = null;
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Task" WHERE "id" = ${task.id} FOR UPDATE`;
        pending = asOwnRequest(b, () => updateTask(task.id, patch, opened));
        await waitForLockWaiter();
        await tx.task.update({ where: { id: task.id }, data: { description: "<p>De Ana</p>", contentUpdatedAt: new Date(), contentUpdatedById: a.id } });
      }, { timeout: 10_000 });
      if (ok) expectOk(await pending!);
      else expectFail(await pending!, /Ana ha cambiado el texto de esta tarea/);
      const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
      assert.deepEqual([row.title, row.description], [ok ? "De Bea" : "T", "<p>De Ana</p>"]);
    }
  });

  test("una versión con forma rara no se acepta", async () => {
    const a = await makeUser();
    const f = await makeProject({ members: [a] });
    const task = await makeTask(f, { title: "T" });
    await loginAs(a);
    expectFail(await updateTask(task.id, { title: "x" }, { version: 1, title: "x".repeat(100) } as never));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "T");
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
