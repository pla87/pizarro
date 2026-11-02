// Deshacer/rehacer avisa si otra persona cambió lo mismo después (undoChecked/redoChecked), contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { addComment, archiveTasks, createTask, moveTask, restoreTask, updateTask } from "../../src/actions/tasks";
import { redoChecked, undoChecked, undoLast } from "../../src/actions/undo";

async function team() {
  const me = await makeUser({ name: "Yo Mismo" });
  const ana = await makeUser({ name: "Ana Pruebas" });
  const luis = await makeUser({ name: "Luis Pruebas" });
  const f = await makeProject({ members: [me, ana, luis] });
  return { me, ana, luis, f };
}

describe("deshacer con cambios ajenos posteriores", () => {
  test("sin cambios ajenos se aplica a la primera, como undoLast", async () => {
    const { me, ana, f } = await team();
    const task = await makeTask(f, { title: "Uno" });
    // Ana tocó la tarea ANTES de mi acción: no cuenta.
    await loginAs(ana);
    expectOk(await updateTask(task.id, { title: "Uno (Ana)" }));
    await loginAs(me);
    expectOk(await updateTask(task.id, { title: "Uno (yo)" }));
    const res = expectOk(await undoChecked(f.project.id));
    assert.equal(res.conflict, undefined);
    assert.equal(res.applied?.skipped, 0);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "Uno (Ana)");
  });

  test("mis propios cambios posteriores no cuentan", async () => {
    const { me, f } = await team();
    const task = await makeTask(f, { title: "Propia" });
    await loginAs(me);
    expectOk(await updateTask(task.id, { title: "Propia 2" }));
    expectOk(await moveTask(task.id, f.columns.doing, null, null));
    assert.equal(expectOk(await undoChecked(f.project.id)).conflict, undefined); // deshace el movimiento
    assert.equal(expectOk(await undoChecked(f.project.id)).conflict, undefined); // y la edición
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "Propia");
  });

  test("deshacer la creación: avisa con su nombre y con lo que añadió (que se borraría); aceptar la borra", async () => {
    const { me, ana, f } = await team();
    await loginAs(me);
    const created = expectOk(await createTask({ projectId: f.project.id, columnId: f.columns.todo, title: "Nueva", kindId: f.kindId }));
    await loginAs(ana);
    expectOk(await addComment(created.id, "Un comentario de Ana"));
    await db.taskAttachment.create({ data: { taskId: created.id, originalName: "ana.png", size: 10, createdById: ana.id } });

    await loginAs(me);
    const res = expectOk(await undoChecked(f.project.id));
    assert.ok(res.conflict, "debe pedir confirmación");
    assert.equal(res.applied, undefined);
    assert.match(res.conflict.message, /^Ana Pruebas cambió esta tarea después\. También se borrará lo que añadieron: 1 comentario, 1 adjunto\. ¿Deshacer igualmente\?$/);
    assert.equal(res.conflict.danger, true);
    assert.equal(res.conflict.confirmLabel, "Deshacer igualmente");
    // Sin confirmar no se ha tocado nada y la entrada sigue ahí.
    assert.equal(await db.task.count({ where: { id: created.id } }), 1);
    assert.equal(await db.undoEntry.count({ where: { id: res.conflict.entryId } }), 1);

    const done = expectOk(await undoChecked(f.project.id, null, res.conflict.entryId));
    assert.ok(done.applied);
    assert.equal(await db.task.count({ where: { id: created.id } }), 0);
  });

  test("varias personas en varias tareas (archivado masivo): «Otras personas (…) cambiaron N de estas tareas»", async () => {
    const { me, ana, luis, f } = await team();
    const tasks = await Promise.all([1, 2, 3, 4].map((i) => makeTask(f, { title: `A${i}`, position: i * 1000 })));
    await loginAs(me);
    expectOk(await archiveTasks(tasks.map((t) => t.id)));
    await loginAs(ana);
    expectOk(await restoreTask(tasks[0]!.id));
    await loginAs(luis);
    expectOk(await restoreTask(tasks[1]!.id));
    await loginAs(me);
    const res = expectOk(await undoChecked(f.project.id));
    assert.equal(res.conflict?.message, "Otras personas (Ana Pruebas, Luis Pruebas) cambiaron 2 de estas tareas después. ¿Deshacer igualmente?");
    assert.equal(res.conflict?.danger, false);
    // Lo antiguo sigue funcionando sin preguntar (p. ej. el «Deshacer» de los avisos del detalle).
    expectOk(await undoLast(f.project.id));
    assert.equal(await db.task.count({ where: { id: { in: tasks.map((t) => t.id) }, archivedAt: null } }), 4);
  });

  test("una sola persona en una de varias tareas", async () => {
    const { me, ana, f } = await team();
    const tasks = await Promise.all([1, 2, 3].map((i) => makeTask(f, { title: `B${i}`, position: i * 1000 })));
    await loginAs(me);
    expectOk(await archiveTasks(tasks.map((t) => t.id)));
    await loginAs(ana);
    expectOk(await restoreTask(tasks[2]!.id));
    await loginAs(me);
    assert.equal(expectOk(await undoChecked(f.project.id)).conflict?.message, "Ana Pruebas cambió 1 de estas tareas después. ¿Deshacer igualmente?");
  });

  test("un comentario ajeno no cuenta como conflicto al devolver campos (no se pisa nada)", async () => {
    const { me, ana, f } = await team();
    const task = await makeTask(f, { title: "Campos" });
    await loginAs(me);
    expectOk(await updateTask(task.id, { title: "Campos 2" }));
    await loginAs(ana);
    expectOk(await addComment(task.id, "solo comento"));
    await loginAs(me);
    assert.equal(expectOk(await undoChecked(f.project.id)).conflict, undefined);
  });

  test("si entretanto cambia la última entrada, la confirmación antigua no aplica otra cosa", async () => {
    const { me, ana, f } = await team();
    const task = await makeTask(f, { title: "C" });
    await loginAs(me);
    expectOk(await updateTask(task.id, { title: "C1" }));
    await loginAs(ana);
    expectOk(await updateTask(task.id, { color: "#ef4444" }));
    await loginAs(me);
    const res = expectOk(await undoChecked(f.project.id));
    assert.ok(res.conflict);
    const other = await makeTask(f, { title: "Otra" });
    expectOk(await updateTask(other.id, { title: "Otra 2" }));
    expectFail(await undoChecked(f.project.id, null, res.conflict.entryId), /Ha cambiado entretanto/);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: other.id } })).title, "Otra 2");
  });
});

describe("rehacer con cambios ajenos posteriores", () => {
  test("con historial: pregunta con su nombre y, aceptado, rehace (antes se rechazaba sin más)", async () => {
    const { me, ana, f } = await team();
    const task = await makeTask(f, { title: "R" });
    await loginAs(me);
    expectOk(await updateTask(task.id, { title: "R mío" }));
    expectOk(await undoChecked(f.project.id));
    await loginAs(ana);
    expectOk(await updateTask(task.id, { title: "R de Ana" }));
    await loginAs(me);
    const res = expectOk(await redoChecked(f.project.id));
    assert.equal(res.conflict?.message, "Ana Pruebas cambió esta tarea después. ¿Rehacer igualmente?");
    assert.equal(res.conflict?.confirmLabel, "Rehacer igualmente");
    expectOk(await redoChecked(f.project.id, null, res.conflict!.entryId));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "R mío");
  });

  test("sin historial (reordenar en la misma columna): la huella lo delata y el aviso es genérico", async () => {
    const { me, ana, f } = await team();
    const a = await makeTask(f, { title: "a", position: 1000 });
    const b = await makeTask(f, { title: "b", position: 2000 });
    await loginAs(me);
    expectOk(await moveTask(a.id, f.columns.doing, null, null));
    expectOk(await undoChecked(f.project.id));
    await loginAs(ana);
    expectOk(await moveTask(a.id, f.columns.todo, b.id, null)); // misma columna: no deja historial
    await loginAs(me);
    const res = expectOk(await redoChecked(f.project.id));
    assert.equal(res.conflict?.message, "Otra persona ha cambiado esto después. ¿Rehacer igualmente?");
  });
});
