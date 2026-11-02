// La sesión se consulta una sola vez por petición (también en acciones y rutas API, donde React.cache no memoriza nada)
// y su caducidad en la BD se desliza con la última actividad: 14 días desde el último uso, no entre 7 y 14.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import pg from "pg";
import { db, expectFail, expectOk, inRequest, loginAs, logout, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { moveTask, updateTask } from "../../src/actions/tasks";
import { createSession, destroySession, getCurrentUser, getPendingUser, requireUser } from "../../src/lib/session";
import { getT } from "../../src/i18n/server";
import { SESSION_MAX_AGE_SECONDS } from "../../src/lib/session-config";

// Cuenta las lecturas de la tabla Session que llegan a PostgreSQL. `failNext` hace fallar la siguiente (fallo de BD).
let sessionReads = 0;
let allQueries = 0;
let failNext = false;
const origQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
  const q = args[0];
  const text = typeof q === "string" ? q : (q as { text?: string } | undefined)?.text ?? "";
  if (!/"AppLog"/.test(text)) allQueries++;
  if (/^\s*SELECT\b/i.test(text) && /FROM "public"\."Session"/.test(text)) {
    sessionReads++;
    if (failNext) {
      failNext = false;
      const err = new Error("fallo de BD simulado");
      // pg-pool llama a query con callback; sin él, se espera una promesa.
      const cb = args.find((a): a is (e: Error) => void => typeof a === "function");
      if (!cb) return Promise.reject(err);
      process.nextTick(() => cb(err));
      return undefined;
    }
  }
  return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
} as typeof pg.Client.prototype.query;

async function reads<T>(fn: () => Promise<T>, label?: string): Promise<{ value: T; reads: number }> {
  const start = sessionReads;
  const startAll = allQueries;
  const value = await fn();
  if (label) totals[label] = allQueries - startAll;
  return { value, reads: sessionReads - start };
}

const counts: Record<string, number> = {};
/** Consultas totales de cada acción (sin las del registro), solo informativas. */
const totals: Record<string, number> = {};
process.on("exit", () => console.log("[lecturas de sesión por petición]", JSON.stringify(counts), "[consultas totales]", JSON.stringify(totals)));

describe("sesión: una consulta por petición", () => {
  test("una acción típica (editar, mover, fallar) lee la sesión una sola vez", async () => {
    const user = await makeUser();
    const f = await makeProject({ members: [user] });
    const task = await makeTask(f);
    await loginAs(user);

    const edit = await reads(() => inRequest(() => updateTask(task.id, { title: "Nuevo título" })), "updateTask");
    expectOk(edit.value);
    counts.updateTask = edit.reads;

    const move = await reads(() => inRequest(() => moveTask(task.id, f.columns.doing, null, null)), "moveTask");
    expectOk(move.value);
    counts.moveTask = move.reads;

    // Con error: además de requireUser, el registro y la traducción del error vuelven a pedir el usuario.
    const fail = await reads(() => inRequest(() => updateTask("c".padEnd(25, "0"), { title: "x" })), "updateTaskError");
    expectFail(fail.value, NOT_FOUND);
    counts.updateTaskError = fail.reads;

    assert.deepEqual(counts, { updateTask: 1, moveTask: 1, updateTaskError: 1 });
  });

  test("seguidas o a la vez, dentro de la misma petición comparten la consulta; getT y getPendingUser también", async () => {
    const user = await makeUser();
    await loginAs(user);
    const seq = await reads(() =>
      inRequest(async () => {
        const a = await getCurrentUser();
        const b = await requireUser();
        const pending = await getPendingUser();
        await getT();
        return [a, b, pending, await getCurrentUser()] as const;
      }),
    );
    assert.equal(seq.reads, 1, "seguidas");
    assert.equal(seq.value[0]?.id, user.id);
    assert.equal(seq.value[1].id, user.id);
    assert.equal(seq.value[2], null);
    assert.equal(seq.value[3]?.id, user.id);
    const parallel = await reads(() => inRequest(async () => Promise.all([getCurrentUser(), requireUser(), getPendingUser(), getT()])));
    assert.equal(parallel.reads, 1, "a la vez");
  });

  test("no se reutiliza entre peticiones distintas ni entre usuarios", async () => {
    const a = await makeUser({ name: "Ana" });
    const b = await makeUser({ name: "Beto" });
    await loginAs(a);
    const first = await reads(() => inRequest(() => getCurrentUser()));
    const second = await reads(() => inRequest(() => getCurrentUser()));
    assert.equal(first.reads + second.reads, 2, "cada petición consulta la suya");
    await loginAs(b);
    assert.equal((await inRequest(() => getCurrentUser()))?.id, b.id);
    // La siguiente petición ve los cambios de la BD (aquí, la cuenta desactivada).
    await db.user.update({ where: { id: b.id }, data: { active: false } });
    assert.equal(await inRequest(() => getCurrentUser()), null);
    // Sin petición (fuera de inRequest), cada llamada es una petición aparte.
    await loginAs(a);
    const loose = await reads(async () => [await getCurrentUser(), await getCurrentUser()]);
    assert.equal(loose.reads, 2);
  });

  test("abrir o cerrar sesión en mitad de la petición cambia el token y se vuelve a consultar", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await loginAs(a);
    await inRequest(async () => {
      assert.equal((await getCurrentUser())?.id, a.id);
      await createSession(b.id);
      assert.equal((await getCurrentUser())?.id, b.id, "tras createSession, el usuario nuevo");
      await destroySession();
      assert.equal(await getCurrentUser(), null, "tras destroySession, nadie");
    });
    logout();
  });

  test("si la consulta falla no se queda memorizado el fallo", async () => {
    const user = await makeUser();
    await loginAs(user);
    await inRequest(async () => {
      failNext = true;
      await assert.rejects(getCurrentUser(), /fallo de BD simulado/);
      assert.equal((await getCurrentUser())?.id, user.id, "el siguiente intento vuelve a consultar");
    });
  });
});

describe("sesión: caducidad deslizante de 14 días", () => {
  const DAY = 24 * 60 * 60_000;
  const MAX_MS = SESSION_MAX_AGE_SECONDS * 1000;

  async function sessionRow(userId: string) {
    return db.session.findFirstOrThrow({ where: { userId }, select: { id: true, expiresAt: true, lastSeenAt: true } });
  }

  test("al anotar la actividad (cada 5 min) la caducidad pasa a ser ahora + 14 días", async () => {
    const user = await makeUser();
    await loginAs(user);
    const { id } = await sessionRow(user.id);
    // Sesión usada hace 6 minutos y a la que (con el criterio anterior) aún le quedan 10 días: antes no se renovaba.
    await db.session.update({ where: { id }, data: { lastSeenAt: new Date(Date.now() - 6 * 60_000), expiresAt: new Date(Date.now() + 10 * DAY) } });
    const before = Date.now();
    assert.equal((await inRequest(() => getCurrentUser()))?.id, user.id);
    const row = await sessionRow(user.id);
    assert.ok(row.expiresAt.getTime() >= before + MAX_MS - 1000, `caduca a los 14 días del último uso (${row.expiresAt.toISOString()})`);
    assert.ok(row.lastSeenAt.getTime() >= before - 1000);
  });

  test("dentro de los 5 minutos no se escribe nada", async () => {
    const user = await makeUser();
    await loginAs(user);
    const { id } = await sessionRow(user.id);
    const expiresAt = new Date(Date.now() + 10 * DAY);
    const lastSeenAt = new Date(Date.now() - 60_000);
    await db.session.update({ where: { id }, data: { lastSeenAt, expiresAt } });
    await inRequest(() => getCurrentUser());
    const row = await sessionRow(user.id);
    assert.equal(row.expiresAt.getTime(), expiresAt.getTime());
    assert.equal(row.lastSeenAt.getTime(), lastSeenAt.getTime());
  });

  test("una sesión caducada no vale ni se renueva", async () => {
    const user = await makeUser();
    await loginAs(user);
    const { id } = await sessionRow(user.id);
    const expiresAt = new Date(Date.now() - 1000);
    await db.session.update({ where: { id }, data: { lastSeenAt: new Date(Date.now() - 15 * DAY), expiresAt } });
    assert.equal(await inRequest(() => getCurrentUser()), null);
    assert.equal((await sessionRow(user.id)).expiresAt.getTime(), expiresAt.getTime());
  });
});
