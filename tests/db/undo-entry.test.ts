// «Deshacer» de un aviso concreto (undoEntry) y desvincular Google (admin) contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectFail, expectOk, FORBIDDEN, loginAs, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { deleteAttachment, updateTask } from "../../src/actions/tasks";
import { undoEntry, undoLast } from "../../src/actions/undo";
import { unlinkGoogle } from "../../src/actions/users";
import { externalUndoWhere, SHARE_UNDO_KEYS } from "../../src/lib/share-out-core";
import { encodeLabel } from "../../src/lib/undo-label";

async function attach(taskId: string, userId: string, name: string) {
  return db.taskAttachment.create({ data: { taskId, originalName: name, mimeType: "text/plain", isImage: false, size: 10, createdById: userId } });
}

describe("undoEntry: deshacer exactamente una entrada", () => {
  test("restaura el adjunto aunque haya habido otra acción después, y esa sigue deshaciéndose con undoLast", async () => {
    const user = await makeUser();
    const f = await makeProject();
    await loginAs(user);
    const task = await makeTask(f, { title: "Original" });
    const att = await attach(task.id, user.id, "a.txt");
    const del = expectOk(await deleteAttachment(att.id));
    assert.ok(del.undo.id, "deleteAttachment devuelve el id de la entrada");
    expectOk(await updateTask(task.id, { title: "Cambiado" }));

    const res = expectOk(await undoEntry(del.undo.id!));
    assert.equal(res.remaining, 1);
    assert.equal(await db.taskAttachment.count({ where: { id: att.id } }), 1);
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "Cambiado");
    // Queda su entrada de rehacer y la del cambio de título sigue en pie.
    assert.equal(await db.undoEntry.count({ where: { userId: user.id, kind: "REDO" } }), 1);
    expectOk(await undoLast(f.project.id, task.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title, "Original");
    assert.equal(await db.taskAttachment.count({ where: { id: att.id } }), 1);
  });

  test("una entrada ya aplicada o ajena no se puede deshacer; con la tarea borrada no se restaura nada", async () => {
    const user = await makeUser();
    const f = await makeProject();
    await loginAs(user);
    const task = await makeTask(f);
    const att = await attach(task.id, user.id, "b.txt");
    const id = expectOk(await deleteAttachment(att.id)).undo.id!;
    // Otra persona no puede usar el id.
    const other = await makeUser();
    await loginAs(other);
    expectFail(await undoEntry(id), /ya se ha deshecho/);
    await loginAs(user);
    expectOk(await undoEntry(id));
    expectFail(await undoEntry(id), /ya se ha deshecho/);
    // Tarea borrada entre medias.
    const att2 = await attach(task.id, user.id, "c.txt");
    const id2 = expectOk(await deleteAttachment(att2.id)).undo.id!;
    await db.task.delete({ where: { id: task.id } });
    await undoEntry(id2);
    assert.equal(await db.taskAttachment.count({ where: { id: att2.id } }), 0);
  });
});

describe("updateTask devuelve su entrada de deshacer («Descripción borrada»)", () => {
  test("con otro cambio después, deshacer esa entrada no deshace el otro: lo rechaza; si es la última, devuelve la descripción", async () => {
    const user = await makeUser();
    const f = await makeProject();
    await loginAs(user);
    const task = await makeTask(f, { title: "Original" });
    expectOk(await updateTask(task.id, { description: "texto" }));
    const cleared = expectOk(await updateTask(task.id, { description: "" }));
    assert.ok(cleared.undo.id, "updateTask devuelve el id de la entrada");
    // Otro cambio entretanto (como marcar una subtarea): el «Deshacer» del aviso no lo toca.
    expectOk(await updateTask(task.id, { title: "Cambiado" }));
    expectFail(await undoEntry(cleared.undo.id!), /Solo se puede deshacer el último cambio/);
    const now = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(now.title, "Cambiado");
    assert.equal(now.description, "");
    // Sin nada después, sí: vuelve la descripción.
    const again = expectOk(await updateTask(task.id, { description: "otro" }));
    expectOk(await undoEntry(again.undo.id!));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).description, "");
  });
});

describe("undoEntry con lo hecho desde fuera («Compartir fuera») al final de la pila", () => {
  test("la entrada de fuera no cuenta como «último cambio»: el «Deshacer» del aviso propio sigue valiendo", async () => {
    const user = await makeUser();
    const f = await makeProject();
    await loginAs(user);
    const task = await makeTask(f, { title: "Original" });
    expectOk(await updateTask(task.id, { description: "texto" }));
    const cleared = expectOk(await updateTask(task.id, { description: "" }));
    // Lo último de la pila vino de la web de fuera: su etiqueta empieza por una de SHARE_UNDO_KEYS.
    await db.undoEntry.create({
      data: { userId: user.id, projectId: f.project.id, taskId: task.id, label: encodeLabel({ k: SHARE_UNDO_KEYS.done, p: { who: "Proveedor (fuera)", title: "Original" } }), ops: [] },
    });
    assert.equal(await db.undoEntry.count({ where: { userId: user.id, kind: "UNDO", ...externalUndoWhere() } }), 1);
    expectOk(await undoEntry(cleared.undo.id!));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).description, "texto");
    // Si lo último es un cambio propio, sigue rechazándose uno anterior.
    const again = expectOk(await updateTask(task.id, { description: "" }));
    expectOk(await updateTask(task.id, { title: "Cambiado" }));
    expectFail(await undoEntry(again.undo.id!), /Solo se puede deshacer el último cambio/);
  });
});

describe("unlinkGoogle", () => {
  test("un admin desvincula, se cierran las sesiones y un miembro no puede", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const target = await makeUser();
    await db.user.update({ where: { id: target.id }, data: { googleSub: `sub-${target.id}` } });
    await loginAs(target);
    expectFail(await unlinkGoogle(target.id), FORBIDDEN);
    assert.ok((await db.user.findUniqueOrThrow({ where: { id: target.id } })).googleSub);
    assert.equal(await db.session.count({ where: { userId: target.id } }), 1);

    await loginAs(admin);
    expectOk(await unlinkGoogle(target.id));
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.id } })).googleSub, null);
    assert.equal(await db.session.count({ where: { userId: target.id } }), 0);
    expectFail(await unlinkGoogle(target.id), /no tiene una cuenta de Google/);
    expectFail(await unlinkGoogle("nope"), NOT_FOUND);
  });
});
