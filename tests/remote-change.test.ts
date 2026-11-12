// Canal en vivo con acciones propias en vuelo (p. ej. una subida larga): qué cambios de otras personas se anuncian al
// llegar y cuáles esperan a que termine la acción propia (src/components/board/remoteChange.ts).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { announceOnArrival, settleIncoming, type IncomingChange } from "../src/components/board/remoteChange";

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
