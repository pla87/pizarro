// Papelera de documentación contra PostgreSQL real: borrado lógico, exclusión de la lista, restauración (con máximo
// y cuota), borrado definitivo, purga con «ahora» falso y que la limpieza de huérfanos respete lo que está en la papelera.
import assert from "node:assert/strict";
import { mkdtemp, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { asUser, db, expectFail, expectOk, loginAs, makeProject, makeUser, NOT_FOUND } from "./helpers";
import { deleteDocument, deleteDocumentForever, renameDocument, restoreDocument } from "../../src/actions/documents";
import { DOCUMENT_TRASH_DAYS, DOCUMENTS_MAX_PER_PROJECT } from "../../src/lib/document-kind";
import { createDocumentWithinLimit, listProjectDocuments, listTrashedDocuments, purgeTrashedDocuments, trashDaysLeft } from "../../src/lib/documents";
import { runJob } from "../../src/lib/jobs";
import { MAINTENANCE_JOBS } from "../../src/lib/maintenance";
import { storageUsage } from "../../src/lib/storage-usage";
import { documentPath, saveDocumentFile } from "../../src/lib/uploads";
import { GET as fileRoute } from "../../src/app/api/documents/[documentId]/route";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-docs-trash-"));
const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

const row = (projectId: string, createdById: string, size = 10, name = "nota.txt") =>
  ({ projectId, name, mimeType: "text/plain", size, kind: "TEXT" as const, createdById });

async function userOf(id: string) {
  return { ...(await db.user.findUniqueOrThrow({ where: { id } })), theme: "SYSTEM", accent: "BLUE", locale: "ES" } as never;
}
const exists = (id: string) => stat(documentPath(id)).then(() => true, () => false);

async function withQuota<T>(mb: number, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.UPLOAD_QUOTA_MB_PER_PROJECT;
  process.env.UPLOAD_QUOTA_MB_PER_PROJECT = String(mb);
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.UPLOAD_QUOTA_MB_PER_PROJECT;
    else process.env.UPLOAD_QUOTA_MB_PER_PROJECT = prev;
  }
}

describe("papelera de documentos", () => {
  test("borrar es lógico: sale de la lista, entra en la papelera con quién y cuándo, y el fichero se conserva", async () => {
    const m = await makeUser({ name: "Persona Uno" });
    const f = await makeProject({ members: [m] });
    const doc = await db.projectDocument.create({ data: row(f.project.id, m.id) });
    await saveDocumentFile(doc.id, Buffer.from("hola"));
    await asUser(m, async () => {
      expectOk(await deleteDocument(doc.id));
      expectFail(await deleteDocument(doc.id), NOT_FOUND);
    });
    const u = await userOf(m.id);
    assert.equal((await listProjectDocuments(u, f.project.id)).length, 0);
    const trash = await listTrashedDocuments(u, f.project.id);
    assert.equal(trash.length, 1);
    assert.equal(trash[0]!.deletedByName, "Persona Uno");
    assert.equal(trash[0]!.daysLeft, DOCUMENT_TRASH_DAYS);
    assert.ok(await exists(doc.id));
    const after = await db.projectDocument.findUniqueOrThrow({ where: { id: doc.id } });
    assert.equal(after.deletedById, m.id);
    // Se puede previsualizar (la ruta del fichero responde) desde la papelera.
    await loginAs(m);
    const res = await fileRoute(new Request(`http://localhost/api/documents/${doc.id}`), { params: Promise.resolve({ documentId: doc.id }) });
    assert.equal(res.status, 200);
    // Registro de la acción.
    await asUser(m, async () => {
      expectOk(await restoreDocument(doc.id));
      expectOk(await deleteDocument(doc.id));
      expectOk(await deleteDocumentForever(doc.id));
    });
    const { flushLogs } = await import("../../src/lib/log");
    await flushLogs();
    const actions = (await db.appLog.findMany({ where: { userId: m.id }, select: { action: true } })).map((l) => l.action);
    for (const name of ["documents.deleteDocument", "documents.restoreDocument", "documents.deleteDocumentForever"]) assert.ok(actions.includes(name), name);
  });

  test("un ajeno al proyecto no ve la papelera ni restaura ni borra definitivamente", async () => {
    const m = await makeUser();
    const outsider = await makeUser();
    const f = await makeProject({ members: [m] });
    const doc = await db.projectDocument.create({ data: { ...row(f.project.id, m.id), deletedAt: new Date(), deletedById: m.id } });
    await saveDocumentFile(doc.id, Buffer.from("x"));
    await assert.rejects(listTrashedDocuments(await userOf(outsider.id), f.project.id), NOT_FOUND);
    await asUser(outsider, async () => {
      expectFail(await restoreDocument(doc.id), NOT_FOUND);
      expectFail(await deleteDocumentForever(doc.id), NOT_FOUND);
    });
    assert.ok(await exists(doc.id));
  });

  test("restaurar devuelve el documento a la lista; en la papelera no se renombra ni los vivos se borran para siempre", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const doc = await db.projectDocument.create({ data: row(f.project.id, m.id) });
    await saveDocumentFile(doc.id, Buffer.from("hola"));
    await asUser(m, async () => {
      expectFail(await deleteDocumentForever(doc.id), NOT_FOUND); // vivo: solo se envía a la papelera
      expectFail(await restoreDocument(doc.id), NOT_FOUND); // vivo: nada que restaurar
      expectOk(await deleteDocument(doc.id));
      expectFail(await renameDocument(doc.id, "otro.txt"), NOT_FOUND);
      expectOk(await restoreDocument(doc.id));
    });
    const after = await db.projectDocument.findUniqueOrThrow({ where: { id: doc.id } });
    assert.equal(after.deletedAt, null);
    assert.equal(after.deletedById, null);
    assert.equal((await listProjectDocuments(await userOf(m.id), f.project.id)).length, 1);
  });

  test("el máximo de documentos cuenta solo los vivos y restaurar lo vuelve a comprobar", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const pid = f.project.id;
    await db.projectDocument.createMany({ data: Array.from({ length: DOCUMENTS_MAX_PER_PROJECT - 1 }, (_, i) => row(pid, m.id, 1, `d${i}.txt`)) });
    const trashed = await db.projectDocument.create({ data: { ...row(pid, m.id, 1, "papelera.txt"), deletedAt: new Date(), deletedById: m.id } });
    await saveDocumentFile(trashed.id, Buffer.from("x"));
    // 199 vivos + 1 en la papelera: aún cabe uno más.
    const extra = await createDocumentWithinLimit(row(pid, m.id, 1, "extra.txt"));
    assert.equal(extra.ok, true);
    // Ahora hay 200 vivos: no cabe otro y restaurar falla con un mensaje claro; el documento sigue en la papelera.
    const full = await createDocumentWithinLimit(row(pid, m.id, 1, "otro.txt"));
    assert.deepEqual(full, { ok: false, reason: "count", limit: DOCUMENTS_MAX_PER_PROJECT });
    await asUser(m, async () => {
      expectFail(await restoreDocument(trashed.id), /máximo de documentos/);
    });
    assert.ok((await db.projectDocument.findUniqueOrThrow({ where: { id: trashed.id } })).deletedAt);
  });

  test("la papelera cuenta en la cuota hasta la purga, y restaurar falla si la cuota se redujo", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const pid = f.project.id;
    const big = await db.projectDocument.create({ data: { ...row(pid, m.id, MB), deletedAt: new Date(), deletedById: m.id } });
    await saveDocumentFile(big.id, Buffer.alloc(8));
    assert.equal((await storageUsage(pid)).project, MB);
    await withQuota(1, async () => {
      const r = await createDocumentWithinLimit(row(pid, m.id, 1));
      assert.equal(r.ok, false);
      assert.equal(r.ok === false && r.reason, "quota");
      // Restaurar cabe: su tamaño ya estaba contado.
      await asUser(m, async () => { expectOk(await restoreDocument(big.id)); });
      await asUser(m, async () => { expectOk(await deleteDocument(big.id)); });
    });
    // Con la cuota reducida por debajo de lo usado, restaurar falla; borrar definitivamente libera sitio.
    await db.projectDocument.update({ where: { id: big.id }, data: { size: 3 * MB } });
    await withQuota(2, async () => {
      await asUser(m, async () => { expectFail(await restoreDocument(big.id), /cuota/); });
      await asUser(m, async () => { expectOk(await deleteDocumentForever(big.id)); });
      assert.equal((await createDocumentWithinLimit(row(pid, m.id, 1))).ok, true);
    });
  });

  test("borrar definitivamente quita la fila y el fichero", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const doc = await db.projectDocument.create({ data: row(f.project.id, m.id) });
    await saveDocumentFile(doc.id, Buffer.from("hola"));
    await asUser(m, async () => {
      expectOk(await deleteDocument(doc.id));
      expectOk(await deleteDocumentForever(doc.id));
      expectFail(await deleteDocumentForever(doc.id), NOT_FOUND);
    });
    assert.equal(await db.projectDocument.count({ where: { id: doc.id } }), 0);
    assert.equal(await exists(doc.id), false);
  });

  test("la purga borra fila y fichero de lo que lleva más de 7 días y respeta lo reciente y lo vivo", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const pid = f.project.id;
    const now = new Date(); // «ahora» fijo y cercano al real, para no purgar la papelera reciente de otros tests
    const mk = async (name: string, deletedAt: Date | null) => {
      const d = await db.projectDocument.create({ data: { ...row(pid, m.id, 5, name), deletedAt, deletedById: deletedAt ? m.id : null } });
      await saveDocumentFile(d.id, Buffer.from("12345"));
      return d;
    };
    const old = await mk("viejo.txt", new Date(now.getTime() - (DOCUMENT_TRASH_DAYS * DAY + 1000)));
    const edge = await mk("justo.txt", new Date(now.getTime() - (DOCUMENT_TRASH_DAYS * DAY - 1000)));
    const recent = await mk("reciente.txt", new Date(now.getTime() - DAY));
    const live = await mk("vivo.txt", null);
    assert.equal(trashDaysLeft(edge.deletedAt!, now), 1);
    assert.equal(trashDaysLeft(recent.deletedAt!, now), 6);
    assert.equal(trashDaysLeft(old.deletedAt!, now), 0);

    // La purga es global: se comprueba lo de este test.
    const purged = await purgeTrashedDocuments(now);
    assert.ok(purged >= 1);
    assert.equal(await db.projectDocument.count({ where: { id: old.id } }), 0);
    assert.equal(await exists(old.id), false);
    for (const d of [edge, recent, live]) {
      assert.equal(await db.projectDocument.count({ where: { id: d.id } }), 1);
      assert.equal(await exists(d.id), true);
    }
    assert.equal(await purgeTrashedDocuments(now), 0); // idempotente
    // Un día más tarde cae también el del límite.
    assert.ok((await purgeTrashedDocuments(new Date(now.getTime() + DAY))) >= 1);
    assert.equal(await exists(edge.id), false);
  });

  test("la tarea documentsTrashPurge está en el mantenimiento diario y queda anotada en JobRun", async () => {
    const job = MAINTENANCE_JOBS.find((j) => j.name === "documentsTrashPurge");
    assert.ok(job);
    assert.ok("everyMs" in job && job.everyMs >= 20 * 60 * 60 * 1000);
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const d = await db.projectDocument.create({ data: { ...row(f.project.id, m.id), deletedAt: new Date(Date.now() - 8 * DAY), deletedById: m.id } });
    await saveDocumentFile(d.id, Buffer.from("x"));
    assert.equal(await runJob(job), "ok");
    const { flushLogs } = await import("../../src/lib/log");
    await flushLogs();
    assert.ok(await db.appLog.count({ where: { action: "documents.trashPurged" } }));
    assert.equal(await db.projectDocument.count({ where: { id: d.id } }), 0);
    assert.equal(await exists(d.id), false);
    const run = await db.jobRun.findUniqueOrThrow({ where: { name: "documentsTrashPurge" } });
    assert.equal(run.lastOk, true);
    assert.equal(await runJob(job), "skipped"); // una vez al día
  });

  test("la limpieza de huérfanos no borra los ficheros de documentos en la papelera", async () => {
    const m = await makeUser();
    const f = await makeProject({ members: [m] });
    const d = await db.projectDocument.create({ data: { ...row(f.project.id, m.id), deletedAt: new Date(), deletedById: m.id } });
    await saveDocumentFile(d.id, Buffer.from("x"));
    const stray = "huerfano0000000000000001";
    await saveDocumentFile(stray, Buffer.from("y"));
    const old = new Date(Date.now() - 3 * DAY);
    await utimes(documentPath(d.id), old, old);
    await utimes(documentPath(stray), old, old);
    const orphans = MAINTENANCE_JOBS.find((j) => j.name === "orphanFiles")!;
    await orphans.run();
    assert.equal(await exists(d.id), true);
    assert.equal(await exists(stray), false);
  });
});
