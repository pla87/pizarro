// Ids con caracteres que PostgreSQL no admite (el nulo): «no encontrado», nunca «Error inesperado» ni un error en Logs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { asUser, db, expectFail, loginAs, makeProject, makeUser, NOT_FOUND } from "./helpers";
import { POST as attachRoute } from "../../src/app/api/tasks/[taskId]/attachments/route";
import { POST as documentsRoute } from "../../src/app/api/projects/[projectId]/documents/route";
import { flushLogs } from "../../src/lib/log";
import { deleteLabel } from "../../src/actions/projects";
import { markNotificationRead } from "../../src/actions/notifications";

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
