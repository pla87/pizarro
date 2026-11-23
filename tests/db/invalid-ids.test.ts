// Ids con caracteres que PostgreSQL no admite (el nulo) o mal formados: «no encontrado», nunca «Error inesperado» ni
// un error en Logs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { asUser, db, expectFail, loginAs, makeProject, makeUser, NOT_FOUND } from "./helpers";
import { POST as attachRoute } from "../../src/app/api/tasks/[taskId]/attachments/route";
import { POST as documentsRoute } from "../../src/app/api/projects/[projectId]/documents/route";
import { flushLogs } from "../../src/lib/log";
import { resetRateLimit } from "../../src/lib/rate-limit";
import { deleteLabel } from "../../src/actions/projects";
import { markNotificationRead } from "../../src/actions/notifications";
import { GET as reportGet } from "../../src/app/api/projects/[projectId]/report/route";
import { GET as icsGet } from "../../src/app/api/projects/[projectId]/columns/[columnId]/ics/route";
import { GET as weekGet } from "../../src/app/api/projects/[projectId]/columns/[columnId]/week/route";
import { GET as checklistGet } from "../../src/app/api/projects/[projectId]/columns/[columnId]/checklist/route";
import { GET as deliveryGet } from "../../src/app/api/projects/[projectId]/columns/[columnId]/delivery/route";
import { GET as programGet } from "../../src/app/api/projects/[projectId]/columns/[columnId]/program/route";
import { POST as exportPost } from "../../src/app/api/projects/[projectId]/export/route";

test("un id con el carácter nulo se rechaza como no encontrado y no deja un error en el registro", async () => {
  const admin = await makeUser({ role: "ADMIN" });
  await makeProject({ members: [admin] });
  const since = new Date();
  const bad = "abc\u0000def";
  await asUser(admin, async () => {
    expectFail(await deleteLabel(bad), NOT_FOUND);
    expectFail(await markNotificationRead(bad), NOT_FOUND);
  });
  await flushLogs();
  const errors = await db.appLog.count({ where: { userId: admin.id, level: "error", createdAt: { gte: since } } });
  assert.equal(errors, 0);
});

test("subidas: un id de tarea o de proyecto con el carácter nulo da 404, no un 500 ni un error en el registro", async () => {
  const user = await makeUser();
  await makeProject({ members: [user] });
  await loginAs(user);
  const since = new Date();
  const bad = "abc\u0000def";
  const req = (url: string) => {
    const body = new FormData();
    body.append("file", new File(["hola"], "a.txt", { type: "text/plain" }));
    return new Request(url, { method: "POST", body, headers: { origin: "http://localhost", host: "localhost" } });
  };
  const att = await attachRoute(req("http://localhost/api/tasks/x/attachments"), { params: Promise.resolve({ taskId: bad }) });
  assert.equal(att.status, 404);
  const doc = await documentsRoute(req("http://localhost/api/projects/x/documents"), { params: Promise.resolve({ projectId: bad }) });
  assert.equal(doc.status, 404);
  await flushLogs();
  const errors = await db.appLog.count({ where: { userId: user.id, level: "error", createdAt: { gte: since } } });
  assert.equal(errors, 0);
});

test("descargas: informe, columnas y exportar con un id mal formado dan 404, no un 500 ni un error en el registro", async () => {
  const admin = await makeUser({ role: "ADMIN" });
  const f = await makeProject({ members: [admin] });
  await loginAs(admin);
  const since = new Date();
  const get = (path: string) => new Request(`http://localhost${path}`);
  const routes = { ics: icsGet, week: weekGet, checklist: checklistGet, delivery: deliveryGet, program: programGet };
  for (const bad of ["abc\u0000def", "abc.def", "x".repeat(41)]) {
    // Sin topar con los límites de descargas por minuto (no son lo que se prueba).
    for (const key of [...Object.keys(routes).map((k) => `column-${k}`), "column-pdf", "project-report", "project-export"]) resetRateLimit(`${key}:${admin.id}`);
    const report = await reportGet(get("/api/projects/x/report"), { params: Promise.resolve({ projectId: bad }) });
    assert.equal(report.status, 404, `informe con ${JSON.stringify(bad)}`);
    for (const [name, route] of Object.entries(routes)) {
      const byProject = await route(get(`/api/projects/x/columns/y/${name}`), { params: Promise.resolve({ projectId: bad, columnId: f.columns.todo }) });
      assert.equal(byProject.status, 404, `${name} con proyecto ${JSON.stringify(bad)}`);
      const byColumn = await route(get(`/api/projects/x/columns/y/${name}`), { params: Promise.resolve({ projectId: f.project.id, columnId: bad }) });
      assert.equal(byColumn.status, 404, `${name} con columna ${JSON.stringify(bad)}`);
    }
    const exp = await exportPost(
      new Request("http://localhost/api/projects/x/export", {
        method: "POST",
        body: JSON.stringify({ attachments: "without", scope: "board" }),
        headers: { origin: "http://localhost", host: "localhost" },
      }),
      { params: Promise.resolve({ projectId: bad }) },
    );
    assert.equal(exp.status, 404, `exportar con ${JSON.stringify(bad)}`);
  }
  await flushLogs();
  const errors = await db.appLog.count({ where: { userId: admin.id, level: "error", createdAt: { gte: since } } });
  assert.equal(errors, 0);
});
