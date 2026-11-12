// Resumen diario por email, contra PostgreSQL real: lo que entra en cada apartado.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { makeProject, makeTask, makeUser } from "./helpers";
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
});
