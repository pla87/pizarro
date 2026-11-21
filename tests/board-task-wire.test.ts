// Tarjetas del tablero en el envío al navegador (src/lib/board-task-wire.ts): sin los campos por defecto, y al llegar,
// la tarjeta completa, igual a la de partida (con los mismos campos: sameTask también los cuenta).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { packBoardTask, unpackBoardTask } from "../src/lib/board-task-wire";
import { sameTask } from "../src/components/board/sameTask";
import type { BoardTask } from "../src/lib/types";

const bare: BoardTask = {
  id: "t1", columnId: "c1", title: "Tarea", kindId: "k1", color: null, linkUrl: null, position: 1024, assigneeId: null, labelIds: [],
  subtaskTotal: 0, subtaskDone: 0, imageCount: 0, fileCount: 0, attachBytes: 0, hasDescription: false, dueDate: null,
  deliverableId: null, commentCount: 0, linkCount: 0, evergreen: false, evergreenEvery: 1, recurrence: "NONE", recurrenceDay: null,
  textVersion: null, columnEnteredAt: "2026-01-01T00:00:00.000Z", blockedBy: null, cost: null, costPaid: false, estimatedHours: null,
  actualHours: null, priority: null, client: null, startDate: null,
};
const full: BoardTask = {
  ...bare, color: "#ff0000", linkUrl: "https://example.com", assigneeId: "u1", labelIds: ["l1", "l2"], subtaskTotal: 3, subtaskDone: 1,
  imageCount: 1, fileCount: 2, attachBytes: 2048, hasDescription: true, dueDate: "2026-02-01", deliverableId: "d1", commentCount: 4,
  linkCount: 1, evergreen: true, evergreenEvery: 2, recurrence: "WEEKLY", recurrenceDay: 3, textVersion: "2026-01-02T00:00:00.000Z",
  blockedBy: { id: "t0", title: "Antes" }, cost: "10.00", costPaid: true, estimatedHours: "2.50", actualHours: "1.00", priority: "ALTA",
  client: "Cliente", startDate: "2026-01-15",
};

describe("tarjetas del tablero en el envío", () => {
  test("sin nada fuera de lo normal solo viajan los campos obligatorios", () => {
    assert.deepEqual(Object.keys(packBoardTask(bare)).sort(), ["columnEnteredAt", "columnId", "id", "kindId", "position", "title"]);
  });

  test("con todo relleno no se pierde nada", () => {
    assert.deepEqual(packBoardTask(full), full);
  });

  test("al llegar, la tarjeta completa y con los mismos campos (también tras pasar por JSON)", () => {
    for (const t of [bare, full, { ...bare, labelIds: ["l1"], commentCount: 2, priority: "BAJA" as const }]) {
      const back = unpackBoardTask(JSON.parse(JSON.stringify(packBoardTask(t))));
      assert.deepEqual(back, t);
      assert.equal(Object.keys(back).length, Object.keys(t).length);
      assert.ok(sameTask(back, t));
    }
  });

  test("cada tarjeta recibida tiene su propia lista de etiquetas", () => {
    const a = unpackBoardTask(packBoardTask(bare));
    const b = unpackBoardTask(packBoardTask(bare));
    assert.notEqual(a.labelIds, b.labelIds);
  });

  test("un tablero normal pesa bastante menos en el envío", () => {
    const tasks = Array.from({ length: 1000 }, (_, i) => ({ ...bare, id: `cm${String(i).padStart(23, "0")}`, title: `Tarea de ejemplo número ${i}`, position: (i + 1) * 1024, ...(i % 3 === 0 ? { labelIds: ["l1"], assigneeId: "u1" } : {}), ...(i % 5 === 0 ? { commentCount: 2, hasDescription: true } : {}) }));
    const before = JSON.stringify(tasks).length;
    const after = JSON.stringify(tasks.map(packBoardTask)).length;
    assert.ok(after < before * 0.6, `${after} de ${before}`);
  });
});
