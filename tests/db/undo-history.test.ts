// Deshacer y rehacer también quitan y recrean las entradas del historial de la tarea.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { moveTask } from "../../src/actions/tasks";
import { redoLast, undoLast } from "../../src/actions/undo";

async function setup() {
  const user = await makeUser();
  const f = await makeProject();
  await loginAs(user);
  return { user, f };
}

const events = (taskId: string) => db.taskEvent.count({ where: { taskId } });

describe("historial y deshacer", () => {
  test("mover → 1 evento → deshacer → 0 → rehacer → 1 → deshacer → 0", async () => {
    const { f } = await setup();
    const task = await makeTask(f, { position: 1000 });
    expectOk(await moveTask(task.id, f.columns.doing, null, null));
    assert.equal(await events(task.id), 1);
    const entry = await db.undoEntry.findFirstOrThrow({ where: { projectId: f.project.id, kind: "UNDO" } });
    assert.equal(entry.eventIds.length, 1);

    expectOk(await undoLast(f.project.id));
    assert.equal(await events(task.id), 0);
    expectOk(await redoLast(f.project.id));
    assert.equal(await events(task.id), 1);
    const again = await db.undoEntry.findFirstOrThrow({ where: { projectId: f.project.id, kind: "UNDO" } });
    assert.equal(again.eventIds.length, 1);
    assert.notEqual(again.eventIds[0], entry.eventIds[0]);

    expectOk(await undoLast(f.project.id));
    assert.equal(await events(task.id), 0);
  });

  test("solo se borran los eventos de la acción deshecha", async () => {
    const { f } = await setup();
    const task = await makeTask(f, { position: 1000 });
    expectOk(await moveTask(task.id, f.columns.doing, null, null));
    expectOk(await moveTask(task.id, f.columns.todo, null, null));
    assert.equal(await events(task.id), 2);
    expectOk(await undoLast(f.project.id));
    assert.equal(await events(task.id), 1);
  });
});
