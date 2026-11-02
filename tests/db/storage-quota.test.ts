// Cuotas de almacenamiento configurables (entorno > ajuste de la aplicación > 10 GB; cuota propia del proyecto) y
// limpieza de espacio por proyecto contra PostgreSQL real, con ficheros de verdad en una carpeta temporal.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { asUser, db, expectFail, expectOk, FORBIDDEN, makeProject, makeTask, makeUser, NOT_FOUND } from "./helpers";
import {
  deleteStorageItem, previewStorageCleanup, refreshProjectStorage, runStorageCleanup, saveStorageQuotas, setProjectStorageQuota,
} from "../../src/actions/storage";
import { createAttachmentWithinLimit } from "../../src/lib/attachment-limit";
import { createDocumentWithinLimit } from "../../src/lib/documents";
import { DEFAULT_PROJECT_QUOTA_MB } from "../../src/lib/quota";
import { invalidateQuotaSettings, getQuotaLimits, saveQuotaSettings } from "../../src/lib/quota-settings";
import { backupsDirBytes, storageAdminView, projectStorage } from "../../src/lib/storage-stats";
import { storageUsage } from "../../src/lib/storage-usage";
import { saveUndo } from "../../src/lib/undo";
import { attachmentPath, documentPath, saveAttachmentFiles, saveDocumentFile, saveRawAttachmentFile, saveReleaseAttachmentFile } from "../../src/lib/uploads";
import { attachmentTotals } from "../../src/lib/board";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-storage-"));
const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const exists = (file: string) => stat(file).then(() => true, () => false);

afterEach(async () => {
  delete process.env.UPLOAD_QUOTA_MB_PER_PROJECT;
  delete process.env.UPLOAD_QUOTA_MB_TOTAL;
  await db.appState.deleteMany({ where: { key: { in: ["uploadQuotaMbPerProject", "uploadQuotaMbTotal"] } } });
  invalidateQuotaSettings();
});

/** Adjunto de tarea con fichero real (y miniatura si es imagen). */
async function attach(taskId: string, size: number, opts: { image?: boolean } = {}) {
  const r = await createAttachmentWithinLimit(
    { taskId, originalName: "f.bin", mimeType: opts.image ? "image/webp" : "application/octet-stream", isImage: !!opts.image, size },
    { id: true },
  );
  assert.ok(r.ok);
  const id = r.attachment.id;
  if (opts.image) await saveAttachmentFiles(id, { full: Buffer.alloc(size), thumb: Buffer.alloc(8), width: 1, height: 1 });
  else await saveRawAttachmentFile(id, Buffer.alloc(size));
  return id;
}

async function release(projectId: string, number: number, ageDays: number) {
  return db.release.create({ data: { projectId, number, title: `R${number}`, content: "texto", deployedAt: new Date(Date.now() - ageDays * DAY) } });
}
async function releaseAttach(releaseId: string, name: string, size: number) {
  const a = await db.releaseAttachment.create({ data: { releaseId, fileName: name, size, isImage: true, position: 0 } });
  await saveReleaseAttachmentFile(a.id, Buffer.alloc(size), "webp");
  return a.id;
}
const relPath = (id: string) => path.join(process.env.UPLOAD_DIR!, "releases", `${id}.webp`);

describe("cuotas: precedencia", () => {
  test("sin nada configurado: 10 GB por proyecto y sin cuota total", async () => {
    const f = await makeProject({ members: [] });
    const l = await getQuotaLimits(f.project.id);
    assert.equal(DEFAULT_PROJECT_QUOTA_MB, 10240);
    assert.equal(l.projectMb, 10240);
    assert.equal(l.projectSource, "default");
    assert.equal(l.total, null);
  });

  test("ajuste de la aplicación > predeterminado, y la variable de entorno manda sobre el ajuste", async () => {
    const f = await makeProject({ members: [] });
    await saveQuotaSettings({ project: { mode: "custom", mb: 500 }, total: { mode: "custom", mb: 9000 } });
    let l = await getQuotaLimits(f.project.id);
    assert.deepEqual([l.projectMb, l.projectSource, l.totalMb, l.totalSource], [500, "app", 9000, "app"]);
    process.env.UPLOAD_QUOTA_MB_PER_PROJECT = "300";
    process.env.UPLOAD_QUOTA_MB_TOTAL = "7000";
    l = await getQuotaLimits(f.project.id);
    assert.deepEqual([l.projectMb, l.projectSource, l.totalMb, l.totalSource], [300, "env", 7000, "env"]);
    // Una variable inválida o 0 se ignora y vale el ajuste.
    process.env.UPLOAD_QUOTA_MB_PER_PROJECT = "0";
    assert.equal((await getQuotaLimits(f.project.id)).projectMb, 500);
  });

  test("«sin límite» en la aplicación; la cuota propia del proyecto manda sobre todo lo demás", async () => {
    const a = await makeProject({ members: [] });
    const b = await makeProject({ members: [] });
    await saveQuotaSettings({ project: { mode: "unlimited" }, total: { mode: "default" } });
    assert.equal((await getQuotaLimits(a.project.id)).project, null);
    process.env.UPLOAD_QUOTA_MB_PER_PROJECT = "300";
    await db.project.update({ where: { id: b.project.id }, data: { storageQuotaMb: 50 } });
    const lb = await getQuotaLimits(b.project.id);
    assert.deepEqual([lb.projectMb, lb.projectSource], [50, "project"]);
    assert.equal((await getQuotaLimits(a.project.id)).projectMb, 300);
  });

  test("la subida respeta la cuota del proyecto y el error dice qué hacer", async () => {
    const f = await makeProject({ members: [] });
    const task = await makeTask(f);
    await db.project.update({ where: { id: f.project.id }, data: { storageQuotaMb: 5 } });
    await attach(task.id, 4 * MB);
    const over = await createAttachmentWithinLimit({ taskId: task.id, originalName: "g.bin", mimeType: "x/y", isImage: false, size: 2 * MB }, { id: true });
    assert.ok(!over.ok && over.reason === "quota" && over.quota.scope === "project" && over.quota.limitMb === 5);
    const { quotaError } = await import("../../src/lib/quota-message");
    const t = (k: string, vars?: Record<string, string | number>) => k.replace(/\{(\w+)\}/g, (_, n) => String(vars?.[n]));
    const member = quotaError(t, over.quota, { projectId: f.project.id, isAdmin: false });
    assert.match(member.message, /Cuota de almacenamiento del proyecto superada \(4 de 5 MB\)\. Libera espacio en Ajustes del proyecto → Adjuntos y límites, o pide a un administrador que la amplíe\./);
    assert.equal(member.status, 413);
    const admin = quotaError(t, over.quota, { projectId: f.project.id, isAdmin: true });
    assert.ok(admin.message.includes(`/p/${f.project.id}/settings?tab=adjuntos`));
    // Sin cuota propia (null) vuelve a la general (10 GB): cabe.
    await db.project.update({ where: { id: f.project.id }, data: { storageQuotaMb: null } });
    assert.ok((await createAttachmentWithinLimit({ taskId: task.id, originalName: "g.bin", mimeType: "x/y", isImage: false, size: 2 * MB }, { id: true })).ok);
  });
});

describe("acciones de cuota: permisos", () => {
  test("solo un administrador cambia las cuotas generales y la de un proyecto", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    const f = await makeProject({ members: [member] });
    await asUser(member, async () => {
      expectFail(await saveStorageQuotas({ project: { mode: "custom", mb: 100 }, total: { mode: "default" } }), FORBIDDEN);
      expectFail(await setProjectStorageQuota(f.project.id, 100), FORBIDDEN);
    });
    await asUser(admin, async () => {
      expectOk(await saveStorageQuotas({ project: { mode: "custom", mb: 100 }, total: { mode: "custom", mb: 5000 } }));
      expectFail(await saveStorageQuotas({ project: { mode: "custom", mb: 0 }, total: { mode: "default" } }));
      expectOk(await setProjectStorageQuota(f.project.id, 77));
    });
    const l = await getQuotaLimits(f.project.id);
    assert.deepEqual([l.projectMb, l.projectSource, l.totalMb], [77, "project", 5000]);
    assert.equal((await getQuotaLimits(null)).projectMb, 100);
    await asUser(admin, async () => {
      expectOk(await setProjectStorageQuota(f.project.id, null));
      expectOk(await saveStorageQuotas({ project: { mode: "default" }, total: { mode: "default" } }));
    });
    assert.equal((await getQuotaLimits(f.project.id)).projectMb, 10240);
    assert.equal(await db.appState.count({ where: { key: { startsWith: "uploadQuota" } } }), 0);
  });
});

describe("liberar espacio del proyecto", () => {
  test("adjuntos de tareas archivadas: borra filas, ficheros y miniaturas, respeta las activas y la antigüedad", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const active = await makeTask(f);
    const oldArchived = await makeTask(f);
    const freshArchived = await makeTask(f);
    await db.task.update({ where: { id: oldArchived.id }, data: { archivedAt: new Date(Date.now() - 100 * DAY) } });
    await db.task.update({ where: { id: freshArchived.id }, data: { archivedAt: new Date(Date.now() - 2 * DAY) } });
    const keep = await attach(active.id, MB);
    const oldImg = await attach(oldArchived.id, 2 * MB, { image: true });
    const oldFile = await attach(oldArchived.id, 3 * MB);
    const fresh = await attach(freshArchived.id, 4 * MB);
    // Una entrada de deshacer que retiene el adjunto borrado y otra ajena a él.
    const row = { id: oldFile, taskId: oldArchived.id, originalName: "f.bin", mimeType: "x/y", isImage: false, width: null, height: null, size: 3 * MB, createdById: null, createdAt: new Date().toISOString() };
    await saveUndo(admin.id, f.project.id, "Borró un adjunto", [{ t: "attachment.restore", row }], oldArchived.id);
    await saveUndo(admin.id, f.project.id, "Otra cosa", [{ t: "attachment.remove", id: keep }], active.id);
    assert.equal((await storageUsage(f.project.id)).project, 10 * MB);

    const b = await projectStorage(f.project.id);
    assert.deepEqual([b.taskActive.bytes, b.taskArchived.bytes, b.taskArchived.count], [MB, 9 * MB, 3]);

    await asUser(admin, async () => {
      const prev = expectOk(await previewStorageCleanup(f.project.id, "archivedTasks", 90));
      assert.deepEqual(prev, { count: 2, bytes: 5 * MB });
      const res = expectOk(await runStorageCleanup(f.project.id, "archivedTasks", 90, 2));
      assert.deepEqual(res, { count: 2, bytes: 5 * MB });
    });
    assert.equal(await exists(attachmentPath(oldImg, "full")), false);
    assert.equal(await exists(attachmentPath(oldImg, "thumb")), false);
    assert.equal(await exists(attachmentPath(oldFile, "file")), false);
    assert.equal(await exists(attachmentPath(fresh, "file")), true);
    assert.equal(await exists(attachmentPath(keep, "file")), true);
    assert.equal(await db.taskAttachment.count({ where: { id: { in: [oldImg, oldFile] } } }), 0);
    assert.deepEqual(await attachmentTotals(oldArchived.id), { imageCount: 0, fileCount: 0, attachBytes: 0 });
    assert.equal((await storageUsage(f.project.id)).project, 5 * MB);
    // La entrada que mencionaba el fichero borrado se descarta; la otra se conserva.
    const undo = await db.undoEntry.findMany({ where: { projectId: f.project.id } });
    assert.deepEqual(undo.map((u) => u.label), ["Otra cosa"]);

    // Con 0 días caen todas las archivadas.
    await asUser(admin, async () => {
      assert.deepEqual(expectOk(await runStorageCleanup(f.project.id, "archivedTasks", 0, 1)), { count: 1, bytes: 4 * MB });
    });
    assert.equal(await exists(attachmentPath(fresh, "file")), false);
    assert.equal((await storageUsage(f.project.id)).project, MB);
  });

  test("papelera de documentación: vacía filas y ficheros, no toca los documentos vivos", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const mk = async (size: number, trashed: boolean) => {
      const r = await createDocumentWithinLimit({ projectId: f.project.id, name: "d.txt", mimeType: "text/plain", size, kind: "TEXT", createdById: admin.id });
      assert.ok(r.ok);
      await saveDocumentFile(r.document.id, Buffer.alloc(size));
      if (trashed) await db.projectDocument.update({ where: { id: r.document.id }, data: { deletedAt: new Date(), deletedById: admin.id } });
      return r.document.id;
    };
    const live = await mk(MB, false);
    const t1 = await mk(2 * MB, true);
    const t2 = await mk(3 * MB, true);
    await asUser(admin, async () => {
      assert.deepEqual(expectOk(await previewStorageCleanup(f.project.id, "documentsTrash", 0)), { count: 2, bytes: 5 * MB });
      assert.deepEqual(expectOk(await runStorageCleanup(f.project.id, "documentsTrash", 0, 2)), { count: 2, bytes: 5 * MB });
    });
    assert.equal(await exists(documentPath(t1)) || await exists(documentPath(t2)), false);
    assert.equal(await exists(documentPath(live)), true);
    assert.equal(await db.projectDocument.count({ where: { projectId: f.project.id } }), 1);
    assert.equal((await storageUsage(f.project.id)).project, MB);
  });

  test("adjuntos de releases antiguas: conserva la release y su texto", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const old = await release(f.project.id, 1, 200);
    const recent = await release(f.project.id, 2, 5);
    const a1 = await releaseAttach(old.id, "F1_a.webp", 2 * MB);
    const a2 = await releaseAttach(old.id, "F2_b.webp", MB);
    const a3 = await releaseAttach(recent.id, "F1_c.webp", 4 * MB);
    await asUser(admin, async () => {
      assert.deepEqual(expectOk(await previewStorageCleanup(f.project.id, "oldReleases", 90)), { count: 2, bytes: 3 * MB });
      assert.deepEqual(expectOk(await runStorageCleanup(f.project.id, "oldReleases", 90, 2)), { count: 2, bytes: 3 * MB });
    });
    assert.equal(await exists(relPath(a1)) || await exists(relPath(a2)), false);
    assert.equal(await exists(relPath(a3)), true);
    assert.equal(await db.release.count({ where: { projectId: f.project.id } }), 2);
    assert.equal((await db.release.findUniqueOrThrow({ where: { id: old.id } })).content, "texto");
    assert.equal((await storageUsage(f.project.id)).project, 4 * MB);
  });

  test("borrar un fichero concreto (tarea, release, documento) y la lista de los más grandes", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const other = await makeProject({ members: [] });
    const task = await makeTask(f, { title: "Con adjunto" });
    const otherTask = await makeTask(other);
    const att = await attach(task.id, 5 * MB);
    const foreign = await attach(otherTask.id, MB);
    const rel = await release(f.project.id, 1, 1);
    const ra = await releaseAttach(rel.id, "F1_x.webp", 3 * MB);
    const doc = await createDocumentWithinLimit({ projectId: f.project.id, name: "grande.pdf", mimeType: "application/pdf", size: 2 * MB, kind: "PDF", createdById: admin.id });
    assert.ok(doc.ok);
    await saveDocumentFile(doc.document.id, Buffer.alloc(2 * MB));
    await asUser(admin, async () => {
      const { storage, largest } = expectOk(await refreshProjectStorage(f.project.id));
      assert.equal(storage.usedBytes, 10 * MB);
      assert.deepEqual(largest.map((l) => [l.kind, l.size]), [["task", 5 * MB], ["release", 3 * MB], ["document", 2 * MB]]);
      assert.equal(largest[0]!.parent, "Con adjunto");
      // No se puede borrar un fichero de otro proyecto a través de este.
      expectFail(await deleteStorageItem(f.project.id, "task", foreign), /ya no existe/);
      expectOk(await deleteStorageItem(f.project.id, "task", att));
      expectOk(await deleteStorageItem(f.project.id, "release", ra));
      expectOk(await deleteStorageItem(f.project.id, "document", doc.document.id));
      expectFail(await deleteStorageItem(f.project.id, "task", att), /ya no existe/);
    });
    assert.equal(await exists(attachmentPath(att, "file")), false);
    assert.equal(await exists(relPath(ra)), false);
    assert.equal(await exists(documentPath(doc.document.id)), false);
    assert.equal(await exists(attachmentPath(foreign, "file")), true);
    assert.equal((await storageUsage(f.project.id)).project, 0);
  });

  test("permisos: un miembro de un proyecto de equipo no puede; en uno privado sí el miembro y no un admin ajeno", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    const team = await makeProject({ members: [member] });
    const owner = await makeUser();
    const priv = await makeProject({ visibility: "PRIVATE", owner });
    const teamTask = await makeTask(team);
    const privTask = await makeTask(priv);
    await db.task.updateMany({ where: { id: { in: [teamTask.id, privTask.id] } }, data: { archivedAt: new Date() } });
    const a = await attach(teamTask.id, MB);
    const b = await attach(privTask.id, MB);
    await asUser(member, async () => {
      expectFail(await runStorageCleanup(team.project.id, "archivedTasks", 0, 1), FORBIDDEN);
      expectFail(await previewStorageCleanup(team.project.id, "archivedTasks", 0), FORBIDDEN);
      expectFail(await deleteStorageItem(team.project.id, "task", a), FORBIDDEN);
      expectFail(await runStorageCleanup(priv.project.id, "archivedTasks", 0, 1), NOT_FOUND);
    });
    await asUser(admin, async () => {
      expectFail(await runStorageCleanup(priv.project.id, "archivedTasks", 0, 1), NOT_FOUND);
      expectFail(await runStorageCleanup(team.project.id, "archivedTasks", 8, 1)); // antigüedad no permitida
    });
    await asUser(owner, async () => {
      assert.equal(expectOk(await runStorageCleanup(priv.project.id, "archivedTasks", 0, 1)).count, 1);
    });
    assert.equal(await db.taskAttachment.count({ where: { id: a } }), 1);
    assert.equal(await db.taskAttachment.count({ where: { id: b } }), 0);
  });

  test("vista de administración: desglose, ficheros y proyectos privados sin nombre", async () => {
    const f = await makeProject({ members: [] });
    const owner = await makeUser();
    const priv = await makeProject({ visibility: "PRIVATE", owner });
    const task = await makeTask(f);
    const ptask = await makeTask(priv);
    await attach(task.id, 2 * MB);
    await attach(ptask.id, 40 * MB);
    const v = await storageAdminView();
    assert.equal(v.uploadDir, process.env.UPLOAD_DIR);
    assert.ok(v.categories.taskAttachments >= 42 * MB);
    assert.equal(v.trackedBytes, v.categories.taskAttachments + v.categories.releaseAttachments + v.categories.documents + v.categories.documentsTrash);
    const top = v.topProjects.find((p) => p.id === priv.project.id);
    assert.ok(top && top.name === null && top.bytes >= 40 * MB);
    assert.equal(v.topProjects.find((p) => p.id === f.project.id)?.name, f.project.name);
    assert.ok(v.topProjects.length <= 10);
    assert.deepEqual([v.effective.projectMb, v.effective.projectSource], [10240, "default"]);
  });

  test("vista de administración: el tamaño de las copias se recalcula como mucho cada 10 min", async () => {
    const dir = path.join(process.env.UPLOAD_DIR!, "backups", "files", "ab");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "uno"), Buffer.alloc(1000));
    const now = Date.now() + 60 * 60 * 1000; // por delante de cualquier recorrido anterior de este proceso
    const first = await backupsDirBytes(now);
    await writeFile(path.join(dir, "dos"), Buffer.alloc(500));
    assert.equal(await backupsDirBytes(now + 9 * 60 * 1000), first, "dentro de los 10 min, el valor guardado");
    assert.equal(await backupsDirBytes(now + 11 * 60 * 1000), first + 500, "pasados, se vuelve a recorrer");
  });
});
