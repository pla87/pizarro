// Copias de adjuntos de una release que sobreviven a un reinicio, y cadencia de las tareas fijas.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { afterDone, db, expectFail, expectOk, loginAs, makeProject, makeTask, makeUser } from "./helpers";
import { deployRelease } from "../../src/actions/releases";
import { moveTask, updateTask } from "../../src/actions/tasks";
import { undoLast } from "../../src/actions/undo";
import { resumePendingReleaseAttachments, type PendingJob } from "../../src/lib/release-attachments";
import { attachmentPath } from "../../src/lib/uploads";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-resume-"));

/** Adjunto de tarea que no es imagen (se copia tal cual), con su fichero en disco. */
async function fileAttachment(taskId: string, name: string, write = true) {
  const att = await db.taskAttachment.create({ data: { taskId, originalName: name, isImage: false, mimeType: "application/pdf", size: 3 } });
  if (write) {
    await mkdir(process.env.UPLOAD_DIR!, { recursive: true });
    await writeFile(attachmentPath(att.id, "file"), "pdf");
  }
  return att;
}

async function setup() {
  const user = await makeUser();
  const f = await makeProject();
  await loginAs(user);
  const prod = await db.column.create({ data: { projectId: f.project.id, name: "En producción", position: 4000, role: "IN_PRODUCTION" } });
  return { user, f, prod };
}

describe("reanudar copias de adjuntos de una release", () => {
  test("el despliegue guarda el pendiente y lo limpia al terminar", async () => {
    const { f } = await setup();
    const a = await makeTask(f, { title: "A" });
    await fileAttachment(a.id, "uno.pdf");
    const { releaseId } = expectOk(await deployRelease({ projectId: f.project.id, title: "R", content: "x", taskIds: [a.id], destination: "IN_PRODUCTION", attachments: [{ taskId: a.id, code: "F1" }] }));
    await afterDone();
    const rel = await db.release.findUniqueOrThrow({ where: { id: releaseId }, select: { attachmentsPending: true, attachments: { select: { fileName: true } } } });
    assert.equal(rel.attachmentsPending, null);
    assert.deepEqual(rel.attachments.map((x) => x.fileName), ["F1_uno.pdf"]);
  });

  test("tras un «reinicio» a medias retoma lo que falta, sin duplicar, y limpia el pendiente", async () => {
    const { user, f } = await setup();
    const a = await makeTask(f, { title: "A" });
    const b = await makeTask(f, { title: "B" });
    const c = await makeTask(f, { title: "C" });
    const aAtt = await fileAttachment(a.id, "uno.pdf");
    await fileAttachment(b.id, "dos.pdf");
    // C tenía un adjunto que se borró mientras el servidor estaba parado.
    const gone = await fileAttachment(c.id, "tres.pdf", false);
    await db.taskAttachment.delete({ where: { id: gone.id } });
    const release = await db.release.create({ data: { projectId: f.project.id, number: 1, title: "R", content: "x" } });
    // Ya se había copiado el de A antes de caer.
    await db.releaseAttachment.create({ data: { releaseId: release.id, fileName: "F1_uno.pdf", size: 3, isImage: false, position: 0 } });
    const job: PendingJob = {
      items: [{ taskId: a.id, code: "F1" }, { taskId: b.id, code: "F2" }, { taskId: c.id, code: "F3" }],
      allowed: [a.id, b.id, c.id], projectId: f.project.id, userId: user.id, userName: user.name,
    };
    await db.release.update({ where: { id: release.id }, data: { attachmentsPending: job } });

    assert.ok((await resumePendingReleaseAttachments()) >= 1);
    const rel = await db.release.findUniqueOrThrow({ where: { id: release.id }, select: { attachmentsPending: true, attachments: { orderBy: { position: "asc" }, select: { id: true, fileName: true, position: true } } } });
    assert.equal(rel.attachmentsPending, null);
    // F1 no se duplica; F2 se añade a continuación; C no tiene adjuntos.
    assert.deepEqual(rel.attachments.map((x) => [x.fileName, x.position]), [["F1_uno.pdf", 0], ["F2_dos.pdf", 1]]);
    assert.ok((await readdir(path.join(process.env.UPLOAD_DIR!, "releases"))).includes(`${rel.attachments[1]!.id}.bin`));
    assert.ok(aAtt.id);
    // Idempotente: otra pasada no hace nada.
    await resumePendingReleaseAttachments();
    assert.equal(await db.releaseAttachment.count({ where: { releaseId: release.id } }), 2);
  });

  test("adjunto borrado entre medias: se omite y se registra; el resto se copia", async () => {
    const { user, f } = await setup();
    const a = await makeTask(f, { title: "A" });
    await fileAttachment(a.id, "falta.pdf", false); // fila sin fichero
    const ok = await fileAttachment(a.id, "bien.pdf");
    const release = await db.release.create({ data: { projectId: f.project.id, number: 1, title: "R", content: "x" } });
    await db.release.update({
      where: { id: release.id },
      data: { attachmentsPending: { items: [{ taskId: a.id, code: "F1" }], allowed: [a.id], projectId: f.project.id, userId: user.id, userName: user.name } satisfies PendingJob },
    });
    await resumePendingReleaseAttachments();
    const rel = await db.release.findUniqueOrThrow({ where: { id: release.id }, select: { attachmentsPending: true, attachments: { select: { fileName: true } } } });
    assert.equal(rel.attachmentsPending, null);
    assert.deepEqual(rel.attachments.map((x) => x.fileName), ["F1_bien.pdf"]);
    assert.ok(ok.id);
  });

  test("pendiente con tareas no permitidas o ilegible: no copia y se limpia; release borrada: sin error", async () => {
    const { user, f } = await setup();
    const a = await makeTask(f, { title: "A" });
    await fileAttachment(a.id, "uno.pdf");
    const r1 = await db.release.create({ data: { projectId: f.project.id, number: 1, title: "R1", content: "x" } });
    // La tarea no estaba en la release (allowed vacío): no se copia nada.
    await db.release.update({ where: { id: r1.id }, data: { attachmentsPending: { items: [{ taskId: a.id, code: "F1" }], allowed: [], projectId: f.project.id, userId: user.id, userName: user.name } satisfies PendingJob } });
    const r2 = await db.release.create({ data: { projectId: f.project.id, number: 2, title: "R2", content: "x" } });
    await db.release.update({ where: { id: r2.id }, data: { attachmentsPending: { basura: true } } });
    const r3 = await db.release.create({ data: { projectId: f.project.id, number: 3, title: "R3", content: "x" } });
    await db.release.update({ where: { id: r3.id }, data: { attachmentsPending: { items: [{ taskId: a.id, code: "F1" }], allowed: [a.id], projectId: f.project.id, userId: user.id, userName: user.name } satisfies PendingJob } });
    await db.release.delete({ where: { id: r3.id } });
    await resumePendingReleaseAttachments();
    for (const id of [r1.id, r2.id]) {
      const rel = await db.release.findUniqueOrThrow({ where: { id }, select: { attachmentsPending: true, _count: { select: { attachments: true } } } });
      assert.equal(rel.attachmentsPending, null);
      assert.equal(rel._count.attachments, 0);
    }
  });
});

describe("cadencia de las tareas fijas", () => {
  async function fixedSetup() {
    const { user, f, prod } = await setup();
    const next = await db.column.create({ data: { projectId: f.project.id, name: "Siguiente", position: 500, role: "NEXT_RELEASE" } });
    const e = await makeTask(f, { title: "Fija", columnId: next.id });
    await db.task.update({ where: { id: e.id }, data: { evergreen: true } });
    return { user, f, prod, next, e };
  }

  test("cambiar la cadencia guarda, anota el historial y se deshace", async () => {
    const { f, e } = await fixedSetup();
    expectOk(await updateTask(e.id, { evergreenEvery: 3 }));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: e.id } })).evergreenEvery, 3);
    const ev = await db.taskEvent.findMany({ where: { taskId: e.id }, select: { label: true } });
    assert.ok(ev.some((x) => /cadencia/i.test(x.label)), "debe haber una entrada de historial");
    expectOk(await undoLast(f.project.id));
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: e.id } })).evergreenEvery, 1);
  });

  test("valores fuera de 1-3 se rechazan", async () => {
    const { e } = await fixedSetup();
    expectFail(await updateTask(e.id, { evergreenEvery: 4 }));
    expectFail(await updateTask(e.id, { evergreenEvery: 0 }));
  });

  test("dejar de ser fija, moverla o archivarla vuelve la cadencia a 1; mover se deshace con su cadencia", async () => {
    const { f, e, next } = await fixedSetup();
    expectOk(await updateTask(e.id, { evergreenEvery: 2 }));
    expectOk(await updateTask(e.id, { evergreen: false }));
    assert.deepEqual(await db.task.findUniqueOrThrow({ where: { id: e.id }, select: { evergreen: true, evergreenEvery: true } }), { evergreen: false, evergreenEvery: 1 });

    await db.task.update({ where: { id: e.id }, data: { evergreen: true, evergreenEvery: 3 } });
    expectOk(await moveTask(e.id, f.columns.todo, null, null));
    assert.deepEqual(await db.task.findUniqueOrThrow({ where: { id: e.id }, select: { evergreen: true, evergreenEvery: true, columnId: true } }), { evergreen: false, evergreenEvery: 1, columnId: f.columns.todo });
    expectOk(await undoLast(f.project.id));
    assert.deepEqual(await db.task.findUniqueOrThrow({ where: { id: e.id }, select: { evergreen: true, evergreenEvery: true, columnId: true } }), { evergreen: true, evergreenEvery: 3, columnId: next.id });
  });

  test("desplegar no cambia la cadencia ni saca la tarea de su columna", async () => {
    const { f, e, next } = await fixedSetup();
    await db.task.update({ where: { id: e.id }, data: { evergreenEvery: 2 } });
    expectOk(await deployRelease({ projectId: f.project.id, title: "R", content: "x", taskIds: [e.id], destination: "IN_PRODUCTION" }));
    assert.deepEqual(await db.task.findUniqueOrThrow({ where: { id: e.id }, select: { evergreen: true, evergreenEvery: true, columnId: true } }), { evergreen: true, evergreenEvery: 2, columnId: next.id });
  });
});
