// Refresco en vivo de tarjetas sueltas (src/components/board/livePatch.ts): qué avisos del canal piden solo sus tarjetas
// y cuáles recargan el tablero entero, qué ids se piden y cómo se aplican al tablero las tarjetas recibidas.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyTaskPatch, LIVE_PATCH_MAX, liveTasksUrl, liveUpdatePlan, patchRequestIds, withPatchedTasks } from "../src/components/board/livePatch";
import { PENDING_COPY_PREFIX } from "../src/components/board/groupDrag";
import type { BoardTask } from "../src/lib/types";

function task(id: string, over: Partial<BoardTask> = {}): BoardTask {
  return {
    id, columnId: "c1", title: id, kindId: "k", color: null, linkUrl: null, position: 1024, assigneeId: null, labelIds: [],
    subtaskTotal: 0, subtaskDone: 0, imageCount: 0, fileCount: 0, attachBytes: 0, hasDescription: false, dueDate: null,
    deliverableId: null, commentCount: 0, linkCount: 0, evergreen: false, evergreenEvery: 1, recurrence: "NONE", recurrenceDay: null,
    textVersion: null, columnEnteredAt: "2026-01-01T00:00:00.000Z", blockedBy: null, cost: null, costPaid: false, estimatedHours: null,
    actualHours: null, priority: null, client: null, startDate: null, ...over,
  };
}
const COLS = new Set(["c1", "c2"]);

describe("liveUpdatePlan: tarjetas sueltas o tablero entero", () => {
  test("acciones de tarjeta con su lista de tareas: solo esas, juntando los avisos seguidos sin repetir", () => {
    assert.deepEqual(liveUpdatePlan([
      { action: "tasks.moveTask", taskIds: ["a"] },
      { action: "tasks.updateTask", taskIds: ["b", "a"] },
      { action: "tasks.addComment", taskIds: ["c"] },
      { action: "attachments.upload", taskIds: ["d"] },
      { action: "tasks.deleteTasks", taskIds: ["e", "f"] },
    ]), { full: false, ids: ["a", "b", "c", "d", "e", "f"] });
  });

  test("cambios de estructura, deshacer, importar o cualquier acción desconocida: tablero entero", () => {
    for (const action of ["columns.renameColumn", "columns.createColumn", "projects.createLabel", "kinds.updateKind", "templateApply.applyTemplateChange", "projects.removeProjectMember", "undo.undoLast", "tasks.importTasks", "tasks.createTasks", "tasks.pasteTaskJson", "releases.deployRelease", "users.updateUser", "documents.upload"]) {
      assert.deepEqual(liveUpdatePlan([{ action, taskIds: ["a"] }]), { full: true }, action);
    }
    // Basta uno en el lote.
    assert.deepEqual(liveUpdatePlan([{ action: "tasks.moveTask", taskIds: ["a"] }, { action: "columns.moveColumn" }]), { full: true });
  });

  test("con `full` (renumeró la columna, creó etiquetas), sin lista (lote grande) o ilegible: tablero entero", () => {
    assert.deepEqual(liveUpdatePlan([{ action: "tasks.moveTask", taskIds: ["a"], full: true }]), { full: true });
    assert.deepEqual(liveUpdatePlan([{ action: "tasks.moveTasks", taskId: null }]), { full: true });
    assert.deepEqual(liveUpdatePlan([{ action: "tasks.moveTask", taskIds: [] }]), { full: true });
    assert.deepEqual(liveUpdatePlan([{ action: "tasks.moveTask", taskIds: [3] }]), { full: true });
    assert.deepEqual(liveUpdatePlan([null]), { full: true });
    assert.deepEqual(liveUpdatePlan(["texto"]), { full: true });
  });

  test("más de LIVE_PATCH_MAX tarjetas entre todos los avisos: tablero entero", () => {
    const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => `t${from + i}`);
    assert.equal(liveUpdatePlan([{ action: "tasks.moveTasks", taskIds: ids(0, LIVE_PATCH_MAX) }]).full, false);
    assert.deepEqual(liveUpdatePlan([{ action: "tasks.moveTasks", taskIds: ids(0, LIVE_PATCH_MAX) }, { action: "tasks.moveTask", taskIds: ["otra"] }]), { full: true });
  });
});

describe("patchRequestIds: qué se pide", () => {
  test("las cambiadas y las que dependen de ellas (bloqueadas por una que se borra); nunca una copia provisional", () => {
    const tasks = [task("a"), task("b", { blockedBy: { id: "a", title: "a" } }), task("c", { blockedBy: { id: "z", title: "z" } })];
    assert.deepEqual(patchRequestIds(tasks, ["a"]), ["a", "b"]);
    assert.deepEqual(patchRequestIds(tasks, [`${PENDING_COPY_PREFIX}1`]), []);
  });

  test("la ruta lleva los ids separados por comas", () => {
    assert.equal(liveTasksUrl("p1", ["a", "b"]), "/api/projects/p1/board-tasks?ids=a,b");
  });
});

describe("applyTaskPatch: aplicar las tarjetas recibidas", () => {
  test("cambia la que ha cambiado, añade la nueva y quita la pedida que no llega (borrada, archivada, de otro proyecto)", () => {
    const a = task("a"), b = task("b", { position: 2048 }), c = task("c", { position: 3072 });
    const prev = [a, b, c];
    const moved = task("b", { columnId: "c2" });
    const fresh = task("n", { position: 4096 });
    const res = applyTaskPatch(prev, ["b", "c", "n"], [moved, fresh], COLS)!;
    assert.deepEqual(res.tasks.map((t) => t.id), ["a", "b", "n"]);
    assert.equal(res.tasks[0], a, "las no pedidas conservan su objeto");
    assert.equal(res.tasks[1], moved);
    assert.deepEqual(res.removed, ["c"]);
  });

  test("si lo recibido es igual a lo que hay, conserva los objetos y la misma lista (no se vuelve a dibujar nada)", () => {
    const prev = [task("a"), task("b", { position: 2048 })];
    const res = applyTaskPatch(prev, ["a"], [task("a")], COLS)!;
    assert.equal(res.tasks, prev);
    assert.deepEqual(res.removed, []);
  });

  test("ignora lo que no se ha pedido y no toca las copias provisionales", () => {
    const copy = task(`${PENDING_COPY_PREFIX}1`, { position: 1024 });
    const prev = [task("a"), copy];
    const res = applyTaskPatch(prev, ["a"], [task("a", { title: "nuevo" }), task("x", { position: 9999 })], COLS)!;
    assert.deepEqual(res.tasks.map((t) => t.id), ["a", copy.id]);
    assert.equal(res.tasks[1], copy);
  });

  test("columna que el tablero no tiene (creada por otra persona): recarga entera", () => {
    assert.equal(applyTaskPatch([task("a")], ["a"], [task("a", { columnId: "nueva" })], COLS), null);
  });

  test("dos tarjetas de una columna con la misma posición (la columna se renumeró): recarga entera", () => {
    const prev = [task("a", { position: 1024 }), task("b", { columnId: "c2", position: 1024 })];
    assert.equal(applyTaskPatch(prev, ["b"], [task("b", { columnId: "c1", position: 1024 })], COLS), null);
    assert.ok(applyTaskPatch(prev, ["b"], [task("b", { columnId: "c1", position: 1536 })], COLS));
  });
});

describe("withPatchedTasks: recarga completa que llega después de aplicar tarjetas sueltas", () => {
  test("sin tarjetas parcheadas, los datos de la recarga tal cual (la misma lista)", () => {
    const server = [task("a"), task("b", { position: 2048 })];
    assert.equal(withPatchedTasks(server, new Map(), COLS), server);
  });

  test("las parcheadas conservan su versión: cambiada, nueva o quitada; las demás, las de la recarga", () => {
    const moved = task("a", { columnId: "c2", title: "movida" });
    const created = task("n", { position: 4096 });
    const server = [task("a"), task("b", { position: 2048, title: "de la recarga" }), task("x", { position: 3072 })];
    const out = withPatchedTasks(server, new Map<string, BoardTask | null>([["a", moved], ["n", created], ["x", null]]), COLS)!;
    assert.deepEqual(out.map((t) => t.id), ["a", "b", "n"]);
    assert.equal(out[0], moved);
    assert.equal(out[1], server[1]);
    assert.equal(out[2], created);
    // La quitada por el parche (archivada, borrada) no vuelve aunque la recarga, pedida antes, aún la traiga.
    assert.ok(!out.some((t) => t.id === "x"));
  });

  test("una parcheada en una columna que la recarga ya no trae, o con la posición de otra (columna renumerada): null", () => {
    assert.equal(withPatchedTasks([task("a")], new Map([["a", task("a", { columnId: "quitada" })]]), COLS), null);
    const server = [task("a", { position: 1024 }), task("b", { position: 2048 })];
    assert.equal(withPatchedTasks(server, new Map([["b", task("b", { position: 1024 })]]), COLS), null);
    assert.ok(withPatchedTasks(server, new Map([["b", task("b", { position: 1536 })]]), COLS));
    // Las quitadas no cuentan para las columnas.
    assert.ok(withPatchedTasks(server, new Map([["z", null]]), new Set(["c1"])));
  });
});
