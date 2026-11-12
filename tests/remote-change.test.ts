// Canal en vivo con acciones propias en vuelo (p. ej. una subida larga): qué cambios de otras personas se anuncian al
// llegar y cuáles esperan a que termine la acción propia (src/components/board/remoteChange.ts).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { advanceCursor, announceOnArrival, missedWhileClosed, removalOf, settleIncoming, type IncomingChange, type LiveCursor } from "../src/components/board/remoteChange";

describe("canal en vivo con acciones propias en vuelo (una subida larga)", () => {
  test("lo de otras personas (o del sistema) se reenvía al llegar; lo propio espera", () => {
    assert.equal(announceOnArrival({ action: "tasks.addComment", taskId: "t1", userId: "bea" }, "ana"), true);
    assert.equal(announceOnArrival({ action: "jobs.reminder", taskId: "t1", userId: null }, "ana"), true);
    assert.equal(announceOnArrival({ action: "tasks.addComment", taskId: "t1", userId: "ana" }, "ana"), false);
  });

  test("al decidir: no se reenvía dos veces lo ya reenviado ni lo de una acción propia; refresca si hay algo ajeno", () => {
    const bea = { action: "tasks.addComment", taskId: "t1", userId: "bea" };
    const otherTab = { action: "tasks.editComment", taskId: "t1", userId: "ana" };
    const mine = { action: "tasks.addComment", taskId: "t1", userId: "ana" };
    const queue: IncomingChange[] = [
      { cid: "c1", change: bea, announced: true },
      { cid: "c2", change: otherTab, announced: false },
      { cid: "c3", change: mine, announced: false },
    ];
    const own = new Set(["c3", "c9"]);
    assert.deepEqual(settleIncoming(queue, own), { announce: [otherTab], refresh: true });
    assert.deepEqual([...own], ["c9"], "se olvidan los ids ya vistos");
    assert.deepEqual(settleIncoming([{ cid: "c9", change: mine, announced: false }], own), { announce: [], refresh: false });
  });
});

describe("canal cerrado mientras la pestaña está oculta (HTTP/1.1: 6 conexiones por servidor)", () => {
  const hello = (boot: string, seq: number) => JSON.stringify({ boot, seq });
  test("al reabrir, refresca solo si se perdió algún aviso", () => {
    const cursor: { current: LiveCursor | null } = { current: { boot: "b1", seq: 5 } };
    assert.equal(missedWhileClosed(cursor, hello("b1", 5)), false, "nada nuevo: no refresca");
    assert.equal(missedWhileClosed(cursor, hello("b1", 8)), true, "hubo avisos mientras estaba cerrado");
    assert.deepEqual(cursor.current, { boot: "b1", seq: 8 });
    assert.equal(missedWhileClosed(cursor, hello("b1", 8)), false);
    assert.equal(missedWhileClosed(cursor, hello("b2", 0)), true, "servidor reiniciado: no se puede saber, refresca");
    assert.deepEqual(cursor.current, { boot: "b2", seq: 0 });
  });
  test("sin posición previa no refresca (como antes); un saludo ilegible con posición, sí", () => {
    const empty: { current: LiveCursor | null } = { current: null };
    assert.equal(missedWhileClosed(empty, hello("b1", 3)), false);
    assert.deepEqual(empty.current, { boot: "b1", seq: 3 });
    assert.equal(missedWhileClosed(empty, "{roto"), true);
    assert.equal(missedWhileClosed({ current: null }, "{roto"), false);
  });
  test("los datos de la página avanzan la posición (nunca la retroceden)", () => {
    assert.deepEqual(advanceCursor({ boot: "b1", seq: 4 }, { boot: "b1", seq: 9 }), { boot: "b1", seq: 9 });
    assert.deepEqual(advanceCursor({ boot: "b1", seq: 9 }, { boot: "b1", seq: 4 }), { boot: "b1", seq: 9 });
    assert.deepEqual(advanceCursor({ boot: "b1", seq: 9 }, { boot: "b2", seq: 1 }), { boot: "b2", seq: 1 });
    assert.deepEqual(advanceCursor(null, undefined), null);
  });
});

describe("tarea abierta que otra persona borra o archiva", () => {
  test("reconoce borrar y archivar (una o varias) y quién lo hizo", () => {
    assert.deepEqual(removalOf({ action: "tasks.deleteTask", taskId: "t1", userId: "bea" }), { kind: "deleted", taskId: "t1", userId: "bea" });
    assert.deepEqual(removalOf({ action: "tasks.archiveTasks", taskId: null, userId: "bea" }), { kind: "archived", taskId: null, userId: "bea" });
    assert.equal(removalOf({ action: "tasks.deleteTaskLink", taskId: "t1", userId: "bea" }), null);
    assert.equal(removalOf({ action: "tasks.updateTask", taskId: "t1", userId: "bea" }), null);
    assert.equal(removalOf(null), null);
  });
});
