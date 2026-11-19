// Resumen diario por email, contra PostgreSQL real: lo que entra en cada apartado.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, makeProject, makeTask, makeUser } from "./helpers";
import { gatherDigest } from "../../src/lib/periodic-mail";

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
