// «Tipo por defecto» de una columna (el tipo con el que se abre «Nueva tarea» desde ella): elegirlo, quitarlo, deshacer,
// tipos que no valen, borrar el tipo y exportar e importar el proyecto. Además, «Generar plan» se descarga (attachment).
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { ADMIN_EXPORT, db, expectFail, expectOk, loginAs, makeKind, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import { setColumnAssignee, setColumnDefaultKind } from "../../src/actions/columns";
import { undoLast } from "../../src/actions/undo";
import { flushLogs } from "../../src/lib/log";
import { buildProjectExport } from "../../src/lib/project-export/export";
import { importProjectFile } from "../../src/lib/project-export/import";
import { streamZip } from "../../src/lib/zip-stream";
import { resetRateLimit } from "../../src/lib/rate-limit";
import { stopPdfWorker } from "../../src/lib/report-render";
import { GET as planGet } from "../../src/app/api/projects/[projectId]/columns/[columnId]/plan/route";

process.env.UPLOAD_DIR ??= await mkdtemp(path.join(tmpdir(), "pz-default-kind-"));
const work = await mkdtemp(path.join(tmpdir(), "pz-default-kind-zip-"));
after(async () => {
  stopPdfWorker();
  await rm(work, { recursive: true, force: true });
});

const defaultKindOf = async (columnId: string) => (await db.column.findUniqueOrThrow({ where: { id: columnId }, select: { defaultKindId: true } })).defaultKindId;

describe("tipo por defecto de una columna", () => {
  test("se elige y se quita, con su registro y su deshacer", async () => {
    const me = await makeUser();
    const f = await makeProject({ members: [me] });
    await loginAs(me);
    const kind = await db.taskKind.findUniqueOrThrow({ where: { id: f.kindId } });
    const since = new Date();
    expectOk(await setColumnDefaultKind(f.columns.todo, f.kindId));
    assert.equal(await defaultKindOf(f.columns.todo), f.kindId);
    // El mismo: nada que cambiar (ni registro ni deshacer).
    const undos = await db.undoEntry.count({ where: { projectId: f.project.id } });
    expectOk(await setColumnDefaultKind(f.columns.todo, f.kindId));
    assert.equal(await db.undoEntry.count({ where: { projectId: f.project.id } }), undos);
    expectOk(await setColumnDefaultKind(f.columns.todo, null));
    assert.equal(await defaultKindOf(f.columns.todo), null);
    await flushLogs();
    const logs = await db.appLog.findMany({ where: { projectId: f.project.id, action: "columns.setColumnDefaultKind", createdAt: { gte: since } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { message: true } });
    // (La llamada sin cambio solo deja el «OK» de siempre.)
    assert.deepEqual(logs.map((l) => l.message).filter((m) => m !== "OK"), [
      `Puso el tipo por defecto «${kind.name}» a la columna «Por hacer»`,
      "Quitó el tipo por defecto de la columna «Por hacer»",
    ]);
    expectOk(await undoLast(f.project.id));
    assert.equal(await defaultKindOf(f.columns.todo), f.kindId);
  });

  test("solo un tipo visible del proyecto; si el tipo se borra, la columna se queda sin él (también al deshacer)", async () => {
    const me = await makeUser();
    const f = await makeProject({ members: [me] });
    const other = await makeProject({ members: [me] });
    await loginAs(me);
    expectFail(await setColumnDefaultKind(f.columns.todo, other.kindId), NOT_FOUND);
    // Un tipo general oculto en el proyecto tampoco vale.
    const general = await makeKind(null);
    await db.projectHiddenKind.create({ data: { projectId: f.project.id, kindId: general.id } });
    expectFail(await setColumnDefaultKind(f.columns.todo, general.id), NOT_FOUND);
    await db.projectHiddenKind.deleteMany({ where: { projectId: f.project.id, kindId: general.id } });
    expectOk(await setColumnDefaultKind(f.columns.todo, general.id));
    // Se cambia a otro y se borra el general: deshacer no puede devolverlo y la columna queda sin tipo por defecto.
    expectOk(await setColumnDefaultKind(f.columns.todo, f.kindId));
    await db.taskKind.delete({ where: { id: general.id } });
    expectOk(await undoLast(f.project.id));
    assert.equal(await defaultKindOf(f.columns.todo), null);
    // Borrar el tipo elegido: la clave foránea la deja en null.
    const own = await makeKind(f.project.id);
    expectOk(await setColumnDefaultKind(f.columns.doing, own.id));
    await db.taskKind.delete({ where: { id: own.id } });
    assert.equal(await defaultKindOf(f.columns.doing), null);
  });

  test("viaja al exportar e importar el proyecto, por el nombre del tipo", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    await loginAs(admin);
    const own = await db.taskKind.create({ data: { name: "Cita médica", color: "#3b82f6", position: 2, projectId: f.project.id } });
    expectOk(await setColumnDefaultKind(f.columns.todo, own.id));
    // Una columna con un rol retirado (de antes de la migración) sale como «Sin rol».
    await db.column.update({ where: { id: f.columns.doing }, data: { role: "AGENDA" } });
    const parts: Buffer[] = [];
    for await (const c of streamZip((await buildProjectExport(f.project.id, { attachments: false, scope: "board" }, ADMIN_EXPORT)).entries)) parts.push(c);
    const file = path.join(work, "exp.zip");
    await writeFile(file, Buffer.concat(parts));
    const imported = await importProjectFile(file, { id: admin.id, name: admin.name, email: admin.email, role: "ADMIN" }, { isPrivate: false });
    const cols = await db.column.findMany({ where: { projectId: imported.projectId }, select: { name: true, role: true, defaultKind: { select: { name: true, projectId: true } } } });
    const byName = new Map(cols.map((c) => [c.name, c]));
    assert.deepEqual(byName.get("Por hacer")!.defaultKind, { name: "Cita médica", projectId: imported.projectId });
    assert.equal(byName.get("En curso")!.defaultKind, null);
    assert.equal(byName.get("En curso")!.role, "NONE");
  });
});

describe("«Generar plan»: el PDF se descarga", () => {
  test("Content-Disposition attachment", async () => {
    const me = await makeUser();
    const f = await makeProject({ members: [me] });
    await loginAs(me);
    expectOk(await setColumnAssignee(f.columns.todo, { assigneeId: me.id, dueDays: null }));
    await makeTask(f, { columnId: f.columns.todo });
    await db.task.updateMany({ where: { columnId: f.columns.todo }, data: { assigneeId: me.id } });
    resetRateLimit(`column-plan:${me.id}`);
    resetRateLimit(`column-pdf:${me.id}`);
    const res = await planGet(new Request("http://localhost/x"), { params: Promise.resolve({ projectId: f.project.id, columnId: f.columns.todo }) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Content-Disposition") ?? "", /^attachment; filename="plan-.+\.pdf"$/);
    await res.body?.cancel();
  });
});
