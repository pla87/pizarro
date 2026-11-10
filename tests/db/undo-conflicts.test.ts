// Deshacer/rehacer avisa si otra persona cambió lo mismo después (undoChecked/redoChecked), contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { addComment, archiveTasks, createTask, deleteAttachment, deleteSubtask, deleteTaskLink, editComment, moveTask, restoreTask, updateSubtask, updateTask } from "../../src/actions/tasks";
import { redoChecked, undoChecked, undoLast } from "../../src/actions/undo";
import { fingerprintOps, type UndoOp } from "../../src/lib/undo";

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

// La huella cuenta la descripción por su sha256 (calculado en PostgreSQL) y lee las filas de varias entradas a la vez:
// tiene que seguir delatando lo mismo que cuando llevaba el texto entero. Los cambios se hacen directamente en la BD,
// sin historial, para que solo la huella pueda verlos.
describe("la huella delata cambios ajenos sin historial", () => {
  const GENERIC_REDO = "Otra persona ha cambiado esto después. ¿Rehacer igualmente?";
  const GENERIC_UNDO = "Otra persona ha cambiado esto después. ¿Deshacer igualmente?";

  async function rich() {
    const me = await makeUser({ name: "Yo Huella" });
    const f = await makeProject({ members: [me] });
    const task = await makeTask(f, { title: "Con todo", subtasks: ["s1", "s2"] });
    await db.task.update({ where: { id: task.id }, data: { description: "a".repeat(15_000) } });
    const comment = await db.taskComment.create({ data: { taskId: task.id, authorId: me.id, body: "c" } });
    const attachment = await db.taskAttachment.create({ data: { taskId: task.id, originalName: "a.png", size: 10, createdById: me.id } });
    const link = await db.taskLink.create({ data: { taskId: task.id, kind: "GOOGLE_DOC", title: "Doc", url: "https://docs.example.com/d/1", createdById: me.id } });
    await loginAs(me);
    return { me, f, task, comment, attachment, link };
  }

  /** Cambios de «otra persona» en la tarea y sus hijos. */
  const foreign: [string, (taskId: string) => Promise<unknown>][] = [
    ["un carácter en medio de la descripción (15 KB)", (id) => db.task.update({ where: { id }, data: { description: `${"a".repeat(7_500)}b${"a".repeat(7_499)}` } })],
    ["el título de una subtarea", (id) => db.subtask.updateMany({ where: { taskId: id, title: "s1" }, data: { title: "s1 de otra" } })],
    ["marcar una subtarea", (id) => db.subtask.updateMany({ where: { taskId: id, title: "s2" }, data: { done: true } })],
    ["una subtarea nueva", (id) => db.subtask.create({ data: { taskId: id, title: "s3", position: 9000 } })],
    ["un comentario nuevo", (id) => db.taskComment.create({ data: { taskId: id, authorId: null, body: "ajeno" } })],
    ["editar un comentario", (id) => db.taskComment.updateMany({ where: { taskId: id }, data: { body: "editado", editedAt: new Date() } })],
    ["borrar un comentario", (id) => db.taskComment.updateMany({ where: { taskId: id }, data: { body: "", deletedAt: new Date() } })],
    ["un adjunto nuevo", (id) => db.taskAttachment.create({ data: { taskId: id, originalName: "b.png", size: 10 } })],
    ["quitar un adjunto", (id) => db.taskAttachment.deleteMany({ where: { taskId: id } })],
    ["un enlace nuevo", (id) => db.taskLink.create({ data: { taskId: id, kind: "GOOGLE_SHEET", title: "Hoja", url: "https://docs.example.com/s/2" } })],
    ["renombrar un enlace", (id) => db.taskLink.updateMany({ where: { taskId: id }, data: { title: "Doc de otra" } })],
  ];

  test("sin cambios ajenos rehace y vuelve a deshacer sin preguntar", async () => {
    const { f, task } = await rich();
    expectOk(await updateTask(task.id, { title: "Mío" }));
    expectOk(await undoChecked(f.project.id));
    assert.ok((await db.undoEntry.findFirstOrThrow({ where: { kind: "REDO", projectId: f.project.id } })).fingerprint?.startsWith("v2:"));
    assert.equal(expectOk(await redoChecked(f.project.id)).conflict, undefined);
    assert.equal(expectOk(await undoChecked(f.project.id)).conflict, undefined);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "Con todo");
  });

  for (const [what, change] of foreign) {
    test(`rehacer tras deshacer: ${what}`, async () => {
      const { f, task } = await rich();
      expectOk(await updateTask(task.id, { title: "Mío" }));
      expectOk(await undoChecked(f.project.id));
      await change(task.id);
      const res = expectOk(await redoChecked(f.project.id));
      assert.equal(res.conflict?.message, GENERIC_REDO);
      assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "Con todo");
    });
  }

  test("deshacer tras rehacer: un cambio ajeno en la descripción se pregunta (undoChecked) y bloquea undoLast", async () => {
    const { f, task } = await rich();
    expectOk(await updateTask(task.id, { title: "Mío" }));
    expectOk(await undoChecked(f.project.id));
    expectOk(await redoChecked(f.project.id));
    await db.task.update({ where: { id: task.id }, data: { description: `${"a".repeat(14_999)}!` } });
    assert.equal(expectOk(await undoChecked(f.project.id)).conflict?.message, GENERIC_UNDO);
    expectFail(await undoLast(f.project.id), /Otra persona ha cambiado esto después de rehacerlo/);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "Mío");
  });

  test("rehacer de una subtarea, un comentario, un adjunto o un enlace (huella por la fila hija): delata la descripción ajena", async () => {
    // Cada acción deja, al deshacerla, una entrada de rehacer que nombra la fila hija (no la tarea): la huella busca su tarea.
    const cases: [string, (x: Awaited<ReturnType<typeof rich>>) => Promise<unknown>][] = [
      ["subtask.set", async (x) => expectOk(await updateSubtask((await db.subtask.findFirstOrThrow({ where: { taskId: x.task.id } })).id, { title: "otra" }))],
      ["subtask.remove", async (x) => expectOk(await deleteSubtask((await db.subtask.findFirstOrThrow({ where: { taskId: x.task.id } })).id))],
      ["comment.set", async (x) => expectOk(await editComment(x.comment.id, "editado por mí"))],
      ["attachment.remove", async (x) => expectOk(await deleteAttachment(x.attachment.id))],
      ["link.remove", async (x) => expectOk(await deleteTaskLink(x.link.id))],
    ];
    for (const [op, act] of cases) {
      for (const meddle of [false, true]) {
        const x = await rich();
        await act(x);
        expectOk(await undoChecked(x.f.project.id));
        const redo = await db.undoEntry.findFirstOrThrow({ where: { kind: "REDO", projectId: x.f.project.id } });
        assert.ok((redo.ops as { t: string }[]).some((o) => o.t === op), `${op}: ${JSON.stringify(redo.ops)}`);
        if (meddle) await db.task.update({ where: { id: x.task.id }, data: { description: "cambiada por otra persona" } });
        const res = expectOk(await redoChecked(x.f.project.id));
        assert.equal(res.conflict?.message, meddle ? GENERIC_REDO : undefined, `${op} (${meddle ? "con" : "sin"} cambio ajeno)`);
      }
    }
  });

  test("las huellas de antes de la versión 2 (sin prefijo, con la descripción entera) siguen valiendo y se ponen al día", async () => {
    const { f, task } = await rich();
    const other = await makeTask(f, { title: "Otra" });
    expectOk(await updateTask(task.id, { title: "Mío" }));
    expectOk(await updateTask(other.id, { title: "Otra mía" }));
    expectOk(await undoChecked(f.project.id));
    expectOk(await undoChecked(f.project.id));
    // Como si se hubieran guardado con la versión anterior: la huella de entonces (fingerprintOps la calcula así con `stored` sin prefijo).
    const entries = await db.undoEntry.findMany({ where: { kind: "REDO", projectId: f.project.id } });
    for (const e of entries) {
      const legacy = await fingerprintOps(f.project.id, e.ops as unknown as UndoOp[], "antigua");
      assert.ok(!legacy.startsWith("v2:"));
      await db.undoEntry.update({ where: { id: e.id }, data: { fingerprint: legacy } });
    }
    // Se rehace la de «task» (la última que se deshizo); la de «other», que sigue intacta, pasa a la huella nueva.
    assert.equal(expectOk(await redoChecked(f.project.id)).conflict, undefined);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "Mío");
    const left = await db.undoEntry.findFirstOrThrow({ where: { kind: "REDO", projectId: f.project.id } });
    assert.ok(left.fingerprint?.startsWith("v2:"));
    // Y sigue delatando un cambio ajeno.
    await db.task.update({ where: { id: other.id }, data: { description: "ajena" } });
    assert.equal(expectOk(await redoChecked(f.project.id)).conflict?.message, GENERIC_REDO);

    // Una antigua con un cambio ajeno en la descripción también se delata.
    const x = await rich();
    expectOk(await updateTask(x.task.id, { title: "Mío" }));
    expectOk(await undoChecked(x.f.project.id));
    const e = await db.undoEntry.findFirstOrThrow({ where: { kind: "REDO", projectId: x.f.project.id } });
    await db.undoEntry.update({ where: { id: e.id }, data: { fingerprint: await fingerprintOps(x.f.project.id, e.ops as unknown as UndoOp[], "antigua") } });
    await db.task.update({ where: { id: x.task.id }, data: { description: `${"a".repeat(14_999)}b` } });
    assert.equal(expectOk(await redoChecked(x.f.project.id)).conflict?.message, GENERIC_REDO);
  });
});
