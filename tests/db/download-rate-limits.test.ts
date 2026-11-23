// Topes de ritmo de las descargas de una columna y del informe del proyecto: cada tipo con su propio contador. Antes
// compartían `report:<usuario>` con 5/min, así que bajar unas cuantas veces un PDF dejaba sin los demás.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loginAs, makeProject, makeUser } from "./helpers";
import { columnRateKey } from "../../src/lib/column-route";
import { rateLimit, resetRateLimit } from "../../src/lib/rate-limit";
import { GET as weekGet } from "../../src/app/api/projects/[projectId]/columns/[columnId]/week/route";
import { GET as checklistGet } from "../../src/app/api/projects/[projectId]/columns/[columnId]/checklist/route";
import { GET as reportGet } from "../../src/app/api/projects/[projectId]/report/route";

const colParams = (projectId: string, columnId: string) => ({ params: Promise.resolve({ projectId, columnId }) });
const req = (path: string) => new Request(`http://localhost${path}`);

describe("topes de ritmo de las descargas", () => {
  test("cada PDF de columna, 5/min con su propio contador; el informe del proyecto, aparte", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const f = await makeProject();
    for (const k of ["week", "checklist", "program", "plan"] as const) resetRateLimit(columnRateKey(k, admin.id));
    resetRateLimit(`column-pdf:${admin.id}`);
    resetRateLimit(`project-report:${admin.id}`);
    // La semana se agota con su tope de 5.
    for (let i = 0; i < 5; i++) assert.ok(rateLimit(columnRateKey("week", admin.id), 5, 60_000));
    assert.equal((await weekGet(req("/x"), colParams(f.project.id, f.columns.todo))).status, 429, "la semana, agotada");
    // No afecta a la lista (aquí 404: la columna no es una lista) ni al informe del proyecto.
    assert.equal((await checklistGet(req("/x"), colParams(f.project.id, f.columns.doing))).status, 404);
    const report = await reportGet(req(`/api/projects/${f.project.id}/report`), { params: Promise.resolve({ projectId: f.project.id }) });
    assert.notEqual(report.status, 429, "el informe del proyecto tiene su propio contador");
    await report.body?.cancel();
  });
});
