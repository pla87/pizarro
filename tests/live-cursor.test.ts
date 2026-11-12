// Posición del canal en vivo de cada proyecto (src/lib/realtime.ts): la pestaña que reabre el canal (estaba oculta) sabe
// por el saludo del servidor si se perdió algún aviso y solo entonces pide el tablero.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveCursor, publishChange, subscribeProject } from "../src/lib/realtime";

test("cada aviso avanza la posición de su proyecto (y solo la suya), haya o no alguien escuchando", () => {
  const a0 = liveCursor("proj-a");
  const b0 = liveCursor("proj-b");
  assert.equal(a0.seq, 0);
  publishChange({ projectId: "proj-a", userId: "u1", action: "tasks.updateTask", taskId: "t1" });
  const a1 = liveCursor("proj-a");
  assert.ok(a1.seq > a0.seq);
  assert.equal(a1.boot, a0.boot);
  assert.deepEqual(liveCursor("proj-b"), b0);
  const seen: number[] = [];
  const off = subscribeProject("proj-b", (c) => seen.push(c.seq));
  publishChange({ projectId: "proj-b", userId: "u1", action: "tasks.deleteTask", taskId: "t2" });
  off();
  assert.equal(seen.length, 1);
  assert.equal(liveCursor("proj-b").seq, seen[0], "el aviso lleva el mismo número que el saludo");
  assert.ok(seen[0]! > a1.seq, "el número crece en todo el proceso");
});
