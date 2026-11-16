// Ids con caracteres que PostgreSQL no admite (el nulo): «no encontrado», nunca «Error inesperado» ni un error en Logs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { asUser, db, expectFail, makeProject, makeUser, NOT_FOUND } from "./helpers";
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
