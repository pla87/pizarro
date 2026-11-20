// Resumen diario por email, contra PostgreSQL real: lo que entra en cada apartado.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { updateCollabPrefs } from "../../src/actions/collab-prefs";
import { gatherDigest } from "../../src/lib/periodic-mail";
import { digestDue } from "../../src/lib/schedule";

describe("resumen diario", () => {
  test("«Tareas nuevas» no incluye las que creó la propia persona", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const f = await makeProject({ members: [user, other] });
    await makeTask(f, { title: "Mía", createdById: user.id });
    await makeTask(f, { title: "De otra persona", createdById: other.id });
    await makeTask(f, { title: "Sin autor", createdById: null });
    const now = new Date();
    const d = await gatherDigest({ id: user.id, role: "MEMBER" }, now, now.toISOString().slice(0, 10));
    assert.deepEqual(d.created.filter((x) => x.projectId === f.project.id).map((x) => x.title).sort(), ["De otra persona", "Sin autor"]);
  });

  // Antes, una tarea terminada y archivada antes del envío desaparecía de «Terminadas» (se filtraba por archivedAt).
  test("«Terminadas» incluye las que se terminaron y luego se archivaron, pero no las de proyectos ajenos", async () => {
    const user = await makeUser();
    const other = await makeUser();
    const f = await makeProject({ members: [user, other] });
    const foreign = await makeProject({ visibility: "PRIVATE", owner: other, members: [other] });
    const done = async (fx: typeof f, title: string, archived: boolean) => {
      const task = await makeTask(fx, { title, columnId: fx.columns.done });
      await db.taskEvent.create({ data: { taskId: task.id, projectId: fx.project.id, userId: other.id, userName: "Otra", code: "done", label: "Terminó la tarea" } });
      if (archived) await db.task.update({ where: { id: task.id }, data: { archivedAt: new Date(), archivedFromColumnId: fx.columns.done } });
    };
    await done(f, "Terminada", false);
    await done(f, "Terminada y archivada", true);
    await done(foreign, "De un proyecto ajeno", true);
    const now = new Date();
    const d = await gatherDigest({ id: user.id, role: "MEMBER" }, now, now.toISOString().slice(0, 10));
    assert.deepEqual(d.done.filter((x) => [f.project.id, foreign.project.id].includes(x.projectId)).map((x) => x.title).sort(), ["Terminada", "Terminada y archivada"]);
  });
});

describe("preferencias del resumen diario", () => {
  const prefs = { notifyAssignedEmail: true, notifyDueEmail: true, notifyCommentEmail: true };
  test("ni cambiar la hora tras recibirlo ni desactivarlo y volver a activarlo reinician el «ya enviado hoy»", async () => {
    const user = await makeUser();
    await loginAs(user);
    const sent = new Date();
    await db.user.update({ where: { id: user.id }, data: { dailyDigest: true, digestHour: 7, lastDigestAt: sent } });
    expectOk(await updateCollabPrefs({ ...prefs, dailyDigest: true, digestHour: 20 }));
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { digestHour: true, lastDigestAt: true } });
    assert.equal(after.digestHour, 20);
    assert.equal(after.lastDigestAt?.getTime(), sent.getTime(), "no llega otro resumen con lo mismo el mismo día");
    expectOk(await updateCollabPrefs({ ...prefs, dailyDigest: false, digestHour: 20 }));
    expectOk(await updateCollabPrefs({ ...prefs, dailyDigest: true, digestHour: 20 }));
    // Desactivarlo y volver a activarlo el mismo día no lo reinicia (antes llegaba otro resumen igual).
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).lastDigestAt?.getTime(), sent.getTime());
  });

  test("activarlo por primera vez, o con un envío de otro día, lo deja pendiente", async () => {
    const now = new Date();
    for (const last of [null, new Date(now.getTime() - 3 * 86_400_000)]) {
      const user = await makeUser();
      await loginAs(user);
      await db.user.update({ where: { id: user.id }, data: { dailyDigest: false, lastDigestAt: last } });
      expectOk(await updateCollabPrefs({ ...prefs, dailyDigest: true, digestHour: 0 }));
      const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { dailyDigest: true, digestHour: true, lastDigestAt: true } });
      assert.equal(row.dailyDigest, true);
      assert.equal(digestDue(now, "UTC", { hour: row.digestHour, lastSentAt: row.lastDigestAt }), true, String(last));
    }
  });
});
