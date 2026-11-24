// Topes de ritmo de las descargas de una columna y del informe del proyecto: cada tipo con su propio contador. Antes
// compartían `report:<usuario>` con 5/min, así que bajar unas cuantas veces un PDF dejaba sin los demás.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { db, loginAs, makeProject, makeTask, makeUser } from "./helpers";
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

// El tablero las pide con fetch y las guarda sin abrir otra pestaña (columnDownload.ts): el servidor las sirve como descarga.
describe("PDF de la semana y de la lista consolidada: se descargan", () => {
  test("Content-Disposition attachment", async () => {
    const me = await makeUser();
    await loginAs(me);
    const f = await makeProject({ members: [me] });
    for (const k of ["week", "checklist"] as const) resetRateLimit(columnRateKey(k, me.id));
    resetRateLimit(`column-pdf:${me.id}`);
    await db.column.update({ where: { id: f.columns.todo }, data: { role: "WEEKLY_PLAN" } });
    await db.column.update({ where: { id: f.columns.doing }, data: { role: "CHECKLIST" } });
    await makeTask(f, { columnId: f.columns.todo });
    await makeTask(f, { columnId: f.columns.doing, subtasks: ["Pan"] });
    for (const [get, columnId, query] of [[weekGet, f.columns.todo, "?by=person"], [checklistGet, f.columns.doing, "?by=kind"]] as const) {
      const res = await get(req(`/x${query}`), colParams(f.project.id, columnId));
      assert.equal(res.status, 200, await res.clone().text().catch(() => ""));
      assert.match(res.headers.get("Content-Disposition") ?? "", /^attachment; filename=".+\.pdf"$/);
      await res.body?.cancel();
    }
    // Los dos PDF de la semana no se llaman igual: el nombre lleva el modo («semana-por-dia-…», «semana-por-persona-…»).
    const names: string[] = [];
    for (const by of ["day", "person"]) {
      resetRateLimit(columnRateKey("week", me.id));
      resetRateLimit(`column-pdf:${me.id}`);
      const res = await weekGet(req(`/x?by=${by}`), colParams(f.project.id, f.columns.todo));
      names.push(/filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "");
      await res.body?.cancel();
    }
    assert.match(names[0]!, /^semana-por-dia-.+-\d{4}-\d{2}-\d{2}\.pdf$/);
    assert.match(names[1]!, /^semana-por-persona-.+-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});
