// Deshacer/rehacer seguidos con «Mover a…» de 300 tarjetas con descripciones largas: cuántas consultas hace y cuánto
// lee (la huella de cada entrada se calculaba entrada a entrada, en paralelo, con las descripciones completas).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import pg from "pg";
import { db, expectOk, loginAs, makeProject, makeUser } from "./helpers";
import { moveTasks } from "../../src/actions/tasks";
import { redoChecked, undoChecked } from "../../src/actions/undo";

/** Cuenta las consultas SQL (y lo que devuelven) mientras corre `fn`, y cuántas llegan a ir a la vez. */
async function measure<T>(fn: () => Promise<T>): Promise<{ result: T; queries: number; bytes: number; peak: number; ms: number }> {
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const orig = proto.query;
  let queries = 0;
  let bytes = 0;
  let live = 0;
  let peak = 0;
  const done = (res: unknown) => {
    live--;
    const rows = (res as { rows?: unknown[] } | undefined)?.rows;
    if (rows?.length) bytes += JSON.stringify(rows).length;
  };
  proto.query = function (this: unknown, ...args: unknown[]) {
    queries++;
    peak = Math.max(peak, ++live);
    const cb = args.findIndex((a) => typeof a === "function");
    if (cb >= 0) {
      const inner = args[cb] as (err: unknown, res: unknown) => void;
      args[cb] = (err: unknown, res: unknown) => {
        done(res);
        inner(err, res);
      };
      return orig.apply(this, args);
    }
    const out = orig.apply(this, args);
    if (out && typeof (out as Promise<unknown>).then === "function") {
      return (out as Promise<unknown>).then(
        (res) => (done(res), res),
        (err) => {
          done(undefined);
          throw err;
        },
      );
    }
    live--;
    return out;
  };
  const start = performance.now();
  try {
    const result = await fn();
    return { result, queries, bytes, peak, ms: Math.round(performance.now() - start) };
  } finally {
    proto.query = orig;
  }
}

describe("deshacer/rehacer con 300 tarjetas con descripciones largas", () => {
  test("consultas y lectura acotadas, sin avisos falsos de cambios ajenos", async () => {
    const me = await makeUser();
    const f = await makeProject({ members: [me] });
    const N = 300;
    // Descripciones de 10-20 KB (texto poco comprimible, como el de verdad tras TOAST).
    await db.task.createMany({
      data: Array.from({ length: N }, (_, i) => ({
        projectId: f.project.id, columnId: f.columns.todo, kindId: f.kindId, title: `Tarjeta ${i}`, position: (i + 1) * 1000,
        description: randomBytes(5000 + Math.floor(Math.random() * 5000)).toString("hex"),
      })),
    });
    const ids = (await db.task.findMany({ where: { projectId: f.project.id }, select: { id: true } })).map((t) => t.id);
    await db.subtask.createMany({ data: ids.flatMap((taskId) => [1, 2].map((p) => ({ taskId, title: `s${p}`, position: p * 1000 }))) });
    await loginAs(me);
    const MOVES = 8;
    for (let i = 0; i < MOVES; i++) expectOk(await moveTasks(ids, i % 2 ? f.columns.todo : f.columns.doing));

    // Ctrl+Z ×8 (deja 8 entradas de rehacer con huella), Ctrl+Y ×8 (8 de deshacer con huella) y Ctrl+Z ×4.
    const seq: ("undo" | "redo")[] = [...Array(MOVES).fill("undo"), ...Array(MOVES).fill("redo"), ...Array(4).fill("undo")];
    let worst = 0;
    const m = await measure(async () => {
      for (const s of seq) {
        const t0 = performance.now();
        const res = expectOk(await (s === "undo" ? undoChecked(f.project.id) : redoChecked(f.project.id)));
        assert.equal(res.conflict, undefined, "son cambios propios: no debe pedir confirmación");
        assert.equal(res.applied?.skipped, 0);
        worst = Math.max(worst, performance.now() - t0);
      }
    });
    // Tras 8 deshacer + 8 rehacer + 4 deshacer, las tarjetas están donde las dejó el 4.º movimiento (en «Por hacer»).
    assert.equal(await db.task.count({ where: { id: { in: ids }, columnId: f.columns.todo } }), N);
    const perStep = Math.round(m.queries / seq.length);
    console.log(
      `[undo-perf] ${seq.length} pasos: ${m.queries} consultas (${perStep}/paso), ${(m.bytes / 1e6).toFixed(1)} MB leídos, ` +
        `pico de ${m.peak} consultas a la vez, ${m.ms} ms (peor paso ${Math.round(worst)} ms)`,
    );
    // v1.47: ~148 consultas y ~65 MB leídos por paso, con el pool entero (10) ocupado; ahora ~54 y <1 MB, como mucho 5 a
    // la vez. Margen amplio: lo que se vigila es que no vuelvan la lectura por entrada ni las descripciones.
    assert.ok(perStep < 80, `demasiadas consultas por paso: ${perStep}`);
    assert.ok(m.bytes / seq.length < 3e6, `demasiados datos leídos por paso: ${m.bytes}`);
    assert.ok(m.peak <= 6, `demasiadas consultas a la vez: ${m.peak}`);
  });
});
