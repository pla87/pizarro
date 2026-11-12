// Exportaciones e importaciones de proyectos en segundo plano: ciclo de vida de los trabajos, cola propia con su
// concurrencia, tope por persona, permisos de estado y descarga, caducidad y recuperación tras un reinicio.
import assert from "node:assert/strict";
import { mkdtemp, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, test } from "node:test";
import { db, loginAs, logout, makeProject, makeTask, makeUser } from "./helpers";
import { POST as ackPost } from "../../src/app/api/transfer-jobs/[id]/ack/route";
import { GET as downloadRoute } from "../../src/app/api/transfer-jobs/[id]/download/route";
import { GET as statusRoute } from "../../src/app/api/transfer-jobs/[id]/route";
import { GET as listRoute } from "../../src/app/api/transfer-jobs/route";
import { assertDiskRoom, diskMarginBytes, isNoSpaceError, releaseDisk, reserveDisk } from "../../src/lib/disk-space";
import { buildProjectExport } from "../../src/lib/project-export/export";
import { strongEtag } from "../../src/lib/http-range";
import { writeProjectExport } from "../../src/lib/project-export/write";
import {
  MAX_JOBS_PER_USER, claimNextJob, listRecentJobs, createExportJob, createImportJob, executeJob, exportsDir, getJobFor, purgeTransferJobs, recoverInterruptedJobs,
  runNextTransferJob, startTransferWorker, stopTransferWorkerForTests, transferConcurrency, dropPreviousExports,
} from "../../src/lib/transfer-jobs";
import { purgeProject } from "../../src/lib/project-delete";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-transfer-"));
const work = await mkdtemp(path.join(tmpdir(), "pz-transfer-zip-"));
let seq = 0;

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (url = "http://localhost/x") => new Request(url, { headers: { "sec-fetch-site": "same-origin" } });
const exists = (file: string) => stat(file).then(() => true, () => false);

// Cada prueba parte de una cola vacía: el trabajador reserva siempre el más antiguo de toda la base.
beforeEach(async () => {
  await db.projectTransferJob.deleteMany({ where: { status: { in: ["QUEUED", "RUNNING"] } } });
});

/** Archivo .pizarro.zip válido de un proyecto con una tarea, escrito fuera de UPLOAD_DIR. */
async function validZip(): Promise<{ file: string; size: number }> {
  const f = await makeProject({ members: [] });
  await makeTask(f);
  const built = await buildProjectExport(f.project.id, { attachments: false, scope: "all" });
  const file = path.join(work, `ok${++seq}.pizarro.zip`);
  const size = await writeProjectExport(built, file);
  return { file, size };
}

async function exportJob(userId: string) {
  const f = await makeProject({ members: [] });
  await makeTask(f);
  return { f, job: await createExportJob(userId, f.project.id, { attachments: false, scope: "all" }) };
}

describe("ciclo de vida", () => {
  test("exportación: en cola → en marcha → lista, con el archivo en exports/ y 24 h de vida", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const { f, job } = await exportJob(admin.id);
    assert.equal(job.status, "QUEUED");
    assert.equal(job.expiresAt, null);
    const claimed = (await claimNextJob())!;
    assert.equal(claimed.id, job.id);
    assert.equal(claimed.status, "RUNNING");
    assert.ok(claimed.startedAt);
    await executeJob(claimed);
    const done = await db.projectTransferJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(done.status, "DONE");
    assert.equal(done.error, null);
    assert.equal(done.projectId, f.project.id);
    const result = done.result as { file: string; size: number; name: string };
    const file = path.join(exportsDir(), result.file);
    assert.equal((await stat(file)).size, result.size);
    assert.match(result.name, /\.pizarro\.zip$/);
    const ttl = done.expiresAt!.getTime() - done.finishedAt!.getTime();
    assert.equal(ttl, 24 * 60 * 60 * 1000);
    // Ni rastro del temporal.
    assert.deepEqual((await readdir(exportsDir())).filter((n) => n.endsWith(".tmp")), []);
  });

  test("importación: sube, se valida y se importa; el temporal se borra y el trabajo guarda el resumen y el proyecto", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const { file, size } = await validZip();
    const temp = path.join(work, `imp${++seq}.tmp`);
    await writeFile(temp, await (await import("node:fs/promises")).readFile(file));
    const job = await createImportJob(admin.id, temp, size, true);
    assert.equal(job.kind, "IMPORT");
    assert.equal(await runNextTransferJob(), job.id);
    const done = await db.projectTransferJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(done.status, "DONE");
    const summary = done.result as { projectId: string; counts: { tasks: number } };
    assert.equal(done.projectId, summary.projectId);
    assert.equal(summary.counts.tasks, 1);
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: summary.projectId } })).isPrivate, true);
    assert.equal(await exists(temp), false);
  });

  test("fallos: proyecto que ya no existe, archivo corrupto y temporal desaparecido; no queda nada a medias", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const { f, job: gone } = await exportJob(admin.id);
    await db.project.delete({ where: { id: f.project.id } });
    assert.equal(await runNextTransferJob(), gone.id);
    const a = await db.projectTransferJob.findUniqueOrThrow({ where: { id: gone.id } });
    assert.equal(a.status, "FAILED");
    assert.match(a.error!, /proyecto ya no existe/);
    assert.ok(a.finishedAt && a.expiresAt);
    assert.deepEqual(await readdir(exportsDir()).then((n) => n.filter((x) => x.startsWith(gone.id))), []);

    // Un ZIP cuyo contenido no coincide con sus sumas: la comprobación barata de la subida lo dejaría pasar y la del trabajo no.
    const { file, size } = await validZip();
    const bytes = await (await import("node:fs/promises")).readFile(file);
    const tampered = Buffer.from(bytes);
    const at = tampered.indexOf(Buffer.from('"title"'));
    assert.ok(at > 0);
    tampered[at + 2] = tampered[at + 2]! ^ 0x01;
    const temp = path.join(work, `bad${++seq}.tmp`);
    await writeFile(temp, tampered);
    const bad = await createImportJob(admin.id, temp, size, false);
    assert.equal(await runNextTransferJob(), bad.id);
    const b = await db.projectTransferJob.findUniqueOrThrow({ where: { id: bad.id } });
    assert.equal(b.status, "FAILED");
    assert.ok(b.error);
    assert.equal(await exists(temp), false);

    const lost = await createImportJob(admin.id, path.join(work, "no-existe.tmp"), 1000, false);
    assert.equal(await runNextTransferJob(), lost.id);
    const c = await db.projectTransferJob.findUniqueOrThrow({ where: { id: lost.id } });
    assert.equal(c.status, "FAILED");
    assert.match(c.error!, /ya no está en el servidor/);
  });

  test("un miembro no puede importar: el trabajo falla sin crear nada", async () => {
    const member = await makeUser();
    const { file, size } = await validZip();
    const temp = path.join(work, `mem${++seq}.tmp`);
    await writeFile(temp, await (await import("node:fs/promises")).readFile(file));
    const before = await db.project.count();
    const job = await createImportJob(member.id, temp, size, false);
    await runNextTransferJob();
    assert.equal((await db.projectTransferJob.findUniqueOrThrow({ where: { id: job.id } })).status, "FAILED");
    assert.equal(await db.project.count(), before);
  });
});

describe("cola propia", () => {
  test("FIFO y dos trabajos en marcha como mucho en todo el servidor por defecto; PROJECT_TRANSFER_CONCURRENCY lo cambia", async () => {
    assert.equal(transferConcurrency(undefined), 2);
    assert.equal(transferConcurrency(""), 2);
    assert.equal(transferConcurrency("abc"), 2);
    assert.equal(transferConcurrency("0"), 2);
    assert.equal(transferConcurrency("1"), 1);
    assert.equal(transferConcurrency("3"), 3);
    assert.equal(transferConcurrency("99"), 8);
    const [a, b, c] = [await makeUser({ role: "ADMIN" }), await makeUser({ role: "ADMIN" }), await makeUser({ role: "ADMIN" })];
    const first = (await exportJob(a.id)).job;
    const second = (await exportJob(b.id)).job;
    const third = (await exportJob(c.id)).job;
    const run1 = (await claimNextJob())!;
    assert.equal(run1.id, first.id);
    const run2 = (await claimNextJob())!; // con 2 a la vez, el segundo entra mientras el primero sigue
    assert.equal(run2.id, second.id);
    assert.equal(await claimNextJob(), null); // ya hay dos en marcha: el tercero espera
    await Promise.all([executeJob(run1), executeJob(run2)]);
    const run3 = (await claimNextJob())!;
    assert.equal(run3.id, third.id);
    await executeJob(run3);
    for (const j of [first, second, third]) assert.equal((await db.projectTransferJob.findUniqueOrThrow({ where: { id: j.id } })).status, "DONE");
    // Con 1, solo uno a la vez.
    process.env.PROJECT_TRANSFER_CONCURRENCY = "1";
    try {
      const d = (await exportJob(a.id)).job;
      const e = (await exportJob(b.id)).job;
      const r1 = (await claimNextJob())!;
      assert.equal(r1.id, d.id);
      assert.equal(await claimNextJob(), null);
      await executeJob(r1);
      const r2 = (await claimNextJob())!;
      assert.equal(r2.id, e.id);
      await executeJob(r2);
    } finally {
      delete process.env.PROJECT_TRANSFER_CONCURRENCY;
    }
  });

  test("tope de dos trabajos en cola o en marcha por persona", async () => {
    const u = await makeUser({ role: "ADMIN" });
    const other = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const opts = { attachments: false, scope: "board" } as const;
    const one = await createExportJob(u.id, f.project.id, opts);
    await createExportJob(u.id, f.project.id, opts);
    assert.equal(MAX_JOBS_PER_USER, 2);
    await assert.rejects(createExportJob(u.id, f.project.id, opts), (e: { status: number; code: string }) => e.status === 429 && e.code === "transfer_limit");
    await assert.rejects(createImportJob(u.id, path.join(work, "x.tmp"), 10, false), /dos exportaciones/);
    // Otra persona no se ve afectada.
    await createExportJob(other.id, f.project.id, opts);
    // Al terminar uno, vuelve a haber hueco.
    await db.projectTransferJob.update({ where: { id: one.id }, data: { status: "DONE" } });
    await createExportJob(u.id, f.project.id, opts);
    await db.projectTransferJob.deleteMany({ where: { userId: { in: [u.id, other.id] } } });
  });

  test("las peticiones simultáneas tampoco superan el tope", async () => {
    const u = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => createExportJob(u.id, f.project.id, { attachments: false, scope: "board" })));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
    await db.projectTransferJob.deleteMany({ where: { userId: u.id } });
  });
});

describe("permisos de estado y descarga", () => {
  test("solo su dueño (tampoco un administrador) ve el estado y descarga; los demás, 404", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const otherAdmin = await makeUser({ role: "ADMIN" });
    const owner = await makeUser();
    const stranger = await makeUser();
    // El dueño es miembro de un proyecto privado, que sí puede exportar.
    const f = await makeProject({ visibility: "PRIVATE", owner });
    await makeTask(f);
    const job = await createExportJob(owner.id, f.project.id, { attachments: false, scope: "all" });

    logout();
    assert.equal((await statusRoute(get(), ctx(job.id))).status, 401);
    await loginAs(stranger);
    assert.equal((await statusRoute(get(), ctx(job.id))).status, 404);
    await assert.rejects(getJobFor({ id: stranger.id, role: "MEMBER" }, job.id), /No encontrado/);
    await loginAs(owner);
    const queued = await (await statusRoute(get(), ctx(job.id))).json();
    assert.equal(queued.status, "QUEUED");
    assert.equal(queued.ahead, 0);
    assert.equal("options" in queued, false);
    // Aún no está lista: no se descarga.
    assert.equal((await downloadRoute(get(), ctx(job.id))).status, 409);

    assert.equal(await runNextTransferJob(), job.id);
    const ready = await (await statusRoute(get(), ctx(job.id))).json();
    assert.equal(ready.status, "DONE");
    assert.equal(JSON.stringify(ready).includes(exportsDir()), false); // ninguna ruta del servidor
    const res = await downloadRoute(get(), ctx(job.id));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");
    assert.match(res.headers.get("content-disposition")!, /\.pizarro\.zip/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.length, Number(res.headers.get("content-length")));
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    const etag = res.headers.get("etag")!;
    assert.equal(etag, strongEtag(job.id, bytes.length, ready.finishedAt ? new Date(ready.finishedAt) : null));
    const rget = (range: string, extra: Record<string, string> = {}) => downloadRoute(new Request("http://localhost/x", { headers: { "sec-fetch-site": "same-origin", range, ...extra } }), ctx(job.id));
    // Rango parcial: 206 con Content-Range y solo esos bytes.
    const part = await rget("bytes=2-9");
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), `bytes 2-9/${bytes.length}`);
    assert.equal(part.headers.get("content-length"), "8");
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(2, 10));
    const tail = await rget("bytes=-5");
    assert.equal(tail.status, 206);
    assert.deepEqual(Buffer.from(await tail.arrayBuffer()), bytes.subarray(bytes.length - 5));
    const open = await rget(`bytes=${bytes.length - 3}-`);
    assert.deepEqual(Buffer.from(await open.arrayBuffer()), bytes.subarray(bytes.length - 3));
    // Fuera del archivo: 416 con el tamaño.
    const bad = await rget(`bytes=${bytes.length}-`);
    assert.equal(bad.status, 416);
    assert.equal(bad.headers.get("content-range"), `bytes */${bytes.length}`);
    assert.equal((await rget("bytes=abc")).status, 416);
    // If-Range: con el ETag vigente se atiende el rango; con otro valor se envía el archivo entero.
    assert.equal((await rget("bytes=0-3", { "if-range": etag })).status, 206);
    const whole = await rget("bytes=0-3", { "if-range": '"otro"' });
    assert.equal(whole.status, 200);
    assert.equal(Buffer.from(await whole.arrayBuffer()).length, bytes.length);
    // Otro sitio (Sec-Fetch-Site).
    assert.equal((await downloadRoute(new Request("http://localhost/x", { headers: { "sec-fetch-site": "cross-site" } }), ctx(job.id))).status, 403);

    await loginAs(stranger);
    assert.equal((await downloadRoute(get(), ctx(job.id))).status, 404);
    await loginAs(admin);
    // Un administrador tampoco ve el estado ni descarga el archivo de otra persona.
    assert.equal((await statusRoute(get(), ctx(job.id))).status, 404);
    await assert.rejects(getJobFor({ id: admin.id, role: "ADMIN" }, job.id), /No encontrado/);
    assert.equal((await downloadRoute(get(), ctx(job.id))).status, 404);
    await loginAs(otherAdmin);
    assert.equal((await downloadRoute(get(), ctx(job.id))).status, 404);

    // El dueño que deja de gestionar el proyecto ya no se lleva el archivo.
    await db.project.update({ where: { id: f.project.id }, data: { privateOwnerId: admin.id } });
    await db.projectMember.deleteMany({ where: { projectId: f.project.id, userId: owner.id } });
    await loginAs(owner);
    assert.equal((await downloadRoute(get(), ctx(job.id))).status, 404);
  });

  test("un administrador sacado de un proyecto privado ya no descarga su propia exportación; si el proyecto se borra, 404", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const other = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ visibility: "PRIVATE", owner: admin });
    await makeTask(f);
    const job = await createExportJob(admin.id, f.project.id, { attachments: false, scope: "all" });
    assert.equal(await runNextTransferJob(), job.id);
    await loginAs(admin);
    assert.equal((await downloadRoute(get(), ctx(job.id))).status, 200);
    await db.project.update({ where: { id: f.project.id }, data: { privateOwnerId: other.id } });
    await db.projectMember.deleteMany({ where: { projectId: f.project.id, userId: admin.id } });
    assert.equal((await downloadRoute(get(), ctx(job.id))).status, 404);

    const g = await makeProject({ members: [] });
    await makeTask(g);
    const job2 = await createExportJob(admin.id, g.project.id, { attachments: false, scope: "all" });
    assert.equal(await runNextTransferJob(), job2.id);
    assert.equal((await downloadRoute(get(), ctx(job2.id))).status, 200);
    await db.project.delete({ where: { id: g.project.id } });
    assert.equal((await downloadRoute(get(), ctx(job2.id))).status, 404);
  });

  test("la lista es solo la propia, con filtro de tipo y de proyecto; el aviso se marca como visto una vez", async () => {
    const a = await makeUser({ role: "ADMIN" });
    const b = await makeUser({ role: "ADMIN" });
    const { f, job } = await exportJob(a.id);
    await exportJob(b.id);
    await loginAs(a);
    const all = (await (await listRoute(get("http://localhost/api/transfer-jobs"))).json()).jobs as { id: string }[];
    assert.deepEqual(all.map((j) => j.id), [job.id]);
    const byProject = (await (await listRoute(get(`http://localhost/api/transfer-jobs?kind=EXPORT&projectId=${f.project.id}`))).json()).jobs;
    assert.equal(byProject.length, 1);
    assert.equal((await (await listRoute(get("http://localhost/api/transfer-jobs?kind=IMPORT"))).json()).jobs.length, 0);

    // Ack: solo el dueño, solo cuando terminó, y con Origin.
    await runNextTransferJob();
    const ack = (u: string, origin = true) => ackPost(new Request("http://localhost/x", { method: "POST", headers: origin ? { origin: "http://localhost", host: "localhost" } : { host: "localhost" } }), ctx(u));
    assert.equal((await ack(job.id, false)).status, 403);
    assert.equal((await ack(job.id)).status, 200);
    assert.ok((await db.projectTransferJob.findUniqueOrThrow({ where: { id: job.id } })).notifiedAt);
    const pending = (await (await listRoute(get("http://localhost/api/transfer-jobs?pending=1"))).json()).jobs as { id: string }[];
    assert.equal(pending.some((j) => j.id === job.id), false);
    await loginAs(await makeUser());
    assert.equal((await ack(job.id)).status, 404);
  });
});

describe("caducidad y limpieza", () => {
  test("el archivo exportado caduca a las 24 h: se borra, el trabajo pasa a EXPIRED y la descarga da 410", async () => {
    const owner = await makeUser({ role: "ADMIN" });
    const { job } = await exportJob(owner.id);
    await runNextTransferJob();
    const done = await db.projectTransferJob.findUniqueOrThrow({ where: { id: job.id } });
    const file = path.join(exportsDir(), (done.result as { file: string }).file);
    assert.equal(await exists(file), true);
    // Aún no toca (la limpieza sí puede borrar huérfanas de proyectos borrados en otras pruebas).
    await purgeTransferJobs(new Date());
    assert.equal(await exists(file), true);
    // Pasadas 24 h: el trabajo de mantenimiento lo borra.
    assert.ok((await purgeTransferJobs(new Date(Date.now() + 25 * 3600_000))) >= 1);
    assert.equal(await exists(file), false);
    assert.equal((await db.projectTransferJob.findUniqueOrThrow({ where: { id: job.id } })).status, "EXPIRED");
    await loginAs(owner);
    assert.equal((await downloadRoute(get(), ctx(job.id))).status, 410);
    // Y aunque el mantenimiento aún no haya pasado, una exportación vencida no se descarga.
    const { job: second } = await exportJob(owner.id);
    await runNextTransferJob();
    await db.projectTransferJob.update({ where: { id: second.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await downloadRoute(get(), ctx(second.id))).status, 410);
  });

  test("restos de exports/ sin trabajo y con más de 24 h se borran; los recientes se respetan; las filas viejas se eliminan", async () => {
    await (await import("node:fs/promises")).mkdir(exportsDir(), { recursive: true });
    const old = path.join(exportsDir(), "huerfano.pizarro.zip.tmp");
    const recent = path.join(exportsDir(), "reciente.pizarro.zip.tmp");
    await writeFile(old, "x");
    await writeFile(recent, "x");
    const past = new Date(Date.now() - 30 * 3600_000);
    await utimes(old, past, past);
    await purgeTransferJobs();
    assert.equal(await exists(old), false);
    assert.equal(await exists(recent), true);
    const u = await makeUser({ role: "ADMIN" });
    const row = await db.projectTransferJob.create({ data: { kind: "EXPORT", status: "FAILED", userId: u.id, error: "x", finishedAt: new Date(Date.now() - 8 * 86_400_000) } });
    await purgeTransferJobs();
    assert.equal(await db.projectTransferJob.count({ where: { id: row.id } }), 0);
  });
});

describe("al borrar el proyecto", () => {
  test("se borran sus exportaciones (filas y .pizarro.zip) y la importación que lo creó; las de otros proyectos no", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const { f, job } = await exportJob(admin.id);
    assert.equal(await runNextTransferJob(), job.id);
    const file = path.join(exportsDir(), `${job.id}.pizarro.zip`);
    assert.equal(await exists(file), true);
    // Una exportación lista de otro proyecto, que no se toca.
    const { job: other } = await exportJob(admin.id);
    assert.equal(await runNextTransferJob(), other.id);
    // Otra exportación del mismo proyecto aún en cola, y la importación que lo «creó».
    const queued = await db.projectTransferJob.create({ data: { kind: "EXPORT", status: "QUEUED", userId: admin.id, projectId: f.project.id, options: { attachments: false, scope: "all" } } });
    const imported = await db.projectTransferJob.create({ data: { kind: "IMPORT", status: "DONE", userId: admin.id, projectId: f.project.id, finishedAt: new Date(), result: {} } });
    const otherFile = path.join(exportsDir(), `${other.id}.pizarro.zip`);

    await purgeProject(f.project.id);
    // Antes el trabajo seguía DONE y el archivo en uploads/exports.
    assert.equal(await exists(file), false);
    assert.equal(await db.projectTransferJob.count({ where: { id: { in: [job.id, queued.id, imported.id] } } }), 0);
    assert.equal(await exists(otherFile), true);
    assert.equal((await db.projectTransferJob.findUniqueOrThrow({ where: { id: other.id } })).status, "DONE");
  });

  test("una exportación en marcha cuya fila desaparece no deja su archivo en disco", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const { job } = await exportJob(admin.id);
    const claimed = (await claimNextJob())!;
    await db.projectTransferJob.delete({ where: { id: job.id } });
    await executeJob(claimed);
    assert.deepEqual((await readdir(exportsDir())).filter((n) => n.startsWith(job.id)), []);
  });

  test("la limpieza periódica borra las exportaciones listas de proyectos que ya no existen, aunque no hayan caducado", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const { f, job } = await exportJob(admin.id);
    assert.equal(await runNextTransferJob(), job.id);
    const file = path.join(exportsDir(), `${job.id}.pizarro.zip`);
    // Borrado por otra vía (o antes de que el borrado se llevara sus trabajos): huérfana.
    await db.task.deleteMany({ where: { projectId: f.project.id } });
    await db.project.delete({ where: { id: f.project.id } });
    const { job: alive } = await exportJob(admin.id);
    assert.equal(await runNextTransferJob(), alive.id);
    assert.ok((await purgeTransferJobs()) >= 1);
    assert.equal(await exists(file), false);
    assert.equal(await db.projectTransferJob.count({ where: { id: job.id } }), 0);
    // La de un proyecto que sigue existiendo y aún no caduca, intacta.
    assert.equal(await exists(path.join(exportsDir(), `${alive.id}.pizarro.zip`)), true);
    assert.equal((await db.projectTransferJob.findUniqueOrThrow({ where: { id: alive.id } })).status, "DONE");
  });
});

describe("reinicios", () => {
  test("RUNNING sin latido: la exportación se vuelve a poner en cola (hasta dos veces) y la importación falla; lo reciente no se toca", async () => {
    const u = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const stale = new Date(Date.now() - 5 * 60_000);
    const running = (data: object) => db.projectTransferJob.create({ data: { userId: u.id, status: "RUNNING", startedAt: stale, updatedAt: stale, ...data } as never });
    const exp = await running({ kind: "EXPORT", projectId: f.project.id, options: { attachments: false, scope: "board" } });
    const temp = path.join(work, `reinicio${++seq}.tmp`);
    await writeFile(temp, "zip");
    const imp = await running({ kind: "IMPORT", options: { isPrivate: false, tempFile: temp, bytes: 3 } });
    const alive = await db.projectTransferJob.create({ data: { userId: u.id, kind: "EXPORT", status: "RUNNING", projectId: f.project.id, startedAt: new Date() } });

    assert.equal(await recoverInterruptedJobs(), 2);
    const e1 = await db.projectTransferJob.findUniqueOrThrow({ where: { id: exp.id } });
    assert.equal(e1.status, "QUEUED");
    assert.equal(e1.attempts, 1);
    assert.equal(e1.startedAt, null);
    const i1 = await db.projectTransferJob.findUniqueOrThrow({ where: { id: imp.id } });
    assert.equal(i1.status, "FAILED");
    assert.equal(i1.error, "Interrumpido por un reinicio");
    assert.ok(i1.finishedAt && i1.expiresAt);
    assert.equal(await exists(temp), false);
    assert.equal((await db.projectTransferJob.findUniqueOrThrow({ where: { id: alive.id } })).status, "RUNNING");

    // Segunda interrupción: otra vez en cola; a la tercera, fallida.
    for (const [attempt, expected] of [[1, "QUEUED"], [2, "FAILED"]] as const) {
      const claimed = await db.projectTransferJob.update({ where: { id: exp.id }, data: { status: "RUNNING", updatedAt: stale } });
      assert.equal(claimed.attempts, attempt);
      assert.equal(await recoverInterruptedJobs(), 1);
      assert.equal((await db.projectTransferJob.findUniqueOrThrow({ where: { id: exp.id } })).status, expected);
    }
    assert.equal((await db.projectTransferJob.findUniqueOrThrow({ where: { id: exp.id } })).error, "Interrumpido por un reinicio");
    await db.projectTransferJob.deleteMany({ where: { userId: u.id } });
  });

  test("una exportación retomada tras un reinicio se completa", async () => {
    const u = await makeUser({ role: "ADMIN" });
    const { job } = await exportJob(u.id);
    const stale = new Date(Date.now() - 5 * 60_000);
    await db.projectTransferJob.update({ where: { id: job.id }, data: { status: "RUNNING", updatedAt: stale } });
    await recoverInterruptedJobs();
    assert.equal(await runNextTransferJob(), job.id);
    assert.equal((await db.projectTransferJob.findUniqueOrThrow({ where: { id: job.id } })).status, "DONE");
  });
});

describe("espacio en disco", () => {
  test("se rechaza lo que no cabe (507) y no se bloquea si el sistema no informa del espacio", async () => {
    const free = (n: number | null) => async () => n;
    await assert.rejects(assertDiskRoom("/x", 1000, free(500)), (e: { status: number }) => e.status === 507);
    const margin = diskMarginBytes(null, undefined);
    assert.equal(margin, 1024 * 1024 * 1024); // 1 GB por defecto
    await assert.rejects(assertDiskRoom("/x", 1000, free(1000 + margin - 1)), (e: { status: number; message: string }) => e.status === 507 && /No hay espacio/.test(e.message));
    await assertDiskRoom("/x", 1000, free(1000 + margin));
    // Por defecto min(1 GB, 20 % del volumen) con suelo de 100 MB; DISK_MIN_FREE_MB lo fija tal cual.
    const GB = 1024 ** 3, MB = 1024 ** 2;
    assert.equal(diskMarginBytes(100 * GB, undefined), GB);
    assert.equal(diskMarginBytes(2 * GB, undefined), Math.floor(0.2 * 2 * GB));
    assert.equal(diskMarginBytes(200 * MB, undefined), 100 * MB);
    assert.equal(diskMarginBytes(10 * GB, "2048"), 2 * GB);
    assert.equal(diskMarginBytes(10 * GB, "50"), 50 * MB);
    assert.equal(diskMarginBytes(10 * GB, "x"), GB);
    await assert.rejects(assertDiskRoom("/x", 0, free(GB - 1), async () => 100 * GB), (e: { status: number }) => e.status === 507);
    await assertDiskRoom("/x", 0, free(GB), async () => 100 * GB);
    // Lo reservado por otros trabajos en marcha se descuenta; el propio no.
    reserveDisk("job-a", "/y", 500);
    await assert.rejects(assertDiskRoom("/y", 1000, free(1000 + margin + 499)), (e: { status: number }) => e.status === 507);
    await assertDiskRoom("/y", 1000, free(1000 + margin + 500));
    await assertDiskRoom("/y", 1000, free(1000 + margin), undefined, "job-a");
    await assertDiskRoom("/z", 1000, free(1000 + margin)); // otro directorio: sin efecto
    releaseDisk("job-a");
    await assertDiskRoom("/y", 1000, free(1000 + margin));
    assert.equal(isNoSpaceError(Object.assign(new Error("x"), { code: "ENOSPC" })), true);
    assert.equal(isNoSpaceError(new Error("x")), false);
    await assertDiskRoom("/x", 10 ** 15, free(null));
    // Con el disco real hay de sobra para una exportación pequeña.
    const u = await makeUser({ role: "ADMIN" });
    const { job } = await exportJob(u.id);
    assert.equal(job.status, "QUEUED");
    await db.projectTransferJob.delete({ where: { id: job.id } });
  });
});

describe("trabajador en segundo plano", () => {
  test("al arrancar atiende lo encolado sin que nadie lo ejecute a mano", async () => {
    await db.projectTransferJob.deleteMany();
    const u = await makeUser({ role: "ADMIN" });
    const { job } = await exportJob(u.id);
    startTransferWorker();
    const deadline = Date.now() + 15_000;
    let status = "QUEUED";
    while (Date.now() < deadline && status !== "DONE" && status !== "FAILED") {
      await new Promise((r) => setTimeout(r, 100));
      status = (await db.projectTransferJob.findUniqueOrThrow({ where: { id: job.id } })).status;
    }
    assert.equal(status, "DONE");
    // Un trabajo nuevo también se atiende.
    const second = (await exportJob(u.id)).job;
    const end = Date.now() + 15_000;
    while (Date.now() < end && (await db.projectTransferJob.findUniqueOrThrow({ where: { id: second.id } })).status !== "DONE") await new Promise((r) => setTimeout(r, 100));
    assert.equal((await db.projectTransferJob.findUniqueOrThrow({ where: { id: second.id } })).status, "DONE");
    // Las pruebas siguientes reservan los trabajos a mano: el trabajador de fondo no debe adelantarse (pruebas intermitentes).
    stopTransferWorkerForTests();
  });
});

describe("lista reciente y trabajadores duplicados", () => {
  test("una exportación lista sigue en la lista hasta que caduca; las caducadas, 24 h más", async () => {
    const u = await makeUser({ role: "ADMIN" });
    const now = new Date();
    const h = (n: number) => new Date(now.getTime() + n * 3_600_000);
    const mk = (status: "DONE" | "EXPIRED" | "FAILED", createdAt: Date, finishedAt: Date, expiresAt: Date) =>
      db.projectTransferJob.create({ data: { userId: u.id, kind: "EXPORT", status, createdAt, finishedAt, expiresAt, progress: {} } });
    const vivaLarga = await mk("DONE", h(-23), h(-1), h(23)); // terminó hace 1 h
    const hecha = await mk("DONE", h(-30), h(-5), h(19)); // encolada hace 30 h, pero sigue válida
    const caducadaPoco = await mk("EXPIRED", h(-50), h(-26), h(-2));
    const caducadaMucho = await mk("EXPIRED", h(-80), h(-56), h(-32));
    const fallidaVieja = await mk("FAILED", h(-30), h(-29), h(-5));
    const ids = (await listRecentJobs(u.id, {}, now)).map((j) => j.id);
    assert.ok(ids.includes(vivaLarga.id));
    assert.ok(ids.includes(hecha.id));
    assert.ok(ids.includes(caducadaPoco.id));
    assert.equal(ids.includes(caducadaMucho.id), false);
    assert.equal(ids.includes(fallidaVieja.id), false);
  });

  test("un trabajador rezagado (otro ya retomó el trabajo) no pisa el estado del vigente", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const { job } = await exportJob(admin.id);
    const claimed = (await claimNextJob())!;
    // El trabajo se retomó: otra reserva con otro startedAt.
    await db.projectTransferJob.update({ where: { id: job.id }, data: { startedAt: new Date(claimed.startedAt!.getTime() + 5000) } });
    await executeJob(claimed);
    const row = await db.projectTransferJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(row.status, "RUNNING");
    assert.equal(row.result, null);
    assert.deepEqual((await readdir(exportsDir())).filter((n) => n.startsWith(job.id) && n.endsWith(".tmp")), []);
  });
});

describe("exportaciones anteriores", () => {
  test("al terminar una exportación se retiran las listas anteriores de la misma persona y proyecto", async () => {
    const u = await makeUser({ role: "ADMIN" });
    const other = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    await makeTask(f);
    const opts = { attachments: false, scope: "all" } as const;
    const run = async (userId: string, projectId: string) => {
      const j = await createExportJob(userId, projectId, opts);
      await runNextTransferJob(); // si el trabajador de fondo (ya arrancado por otra prueba) lo reservó antes, se espera a que lo termine
      for (let i = 0; i < 200; i++) {
        const row = await db.projectTransferJob.findUniqueOrThrow({ where: { id: j.id } });
        if (row.status === "DONE" || row.status === "FAILED") return row;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("la exportación no terminó");
    };
    const first = await run(u.id, f.project.id);
    const theirs = await run(other.id, f.project.id);
    const f2 = await makeProject({ members: [] });
    await makeTask(f2);
    const elsewhere = await run(u.id, f2.project.id);
    const fileOf = (j: { result: unknown }) => path.join(exportsDir(), (j.result as { file: string }).file);
    const second = await run(u.id, f.project.id);
    assert.equal((await db.projectTransferJob.findUniqueOrThrow({ where: { id: first.id } })).status, "EXPIRED");
    assert.equal(await exists(fileOf(first)), false);
    assert.equal(await exists(fileOf(second)), true);
    for (const j of [theirs, elsewhere]) {
      assert.equal((await db.projectTransferJob.findUniqueOrThrow({ where: { id: j.id } })).status, "DONE");
      assert.equal(await exists(fileOf(j)), true);
    }
    assert.equal(await dropPreviousExports({ id: second.id, userId: u.id, projectId: f.project.id }), 0);
    // La más antigua no retira a la más reciente: al ejecutarse con el primero, `second` (posterior) sigue lista.
    assert.equal(await dropPreviousExports({ id: first.id, userId: u.id, projectId: f.project.id }), 0);
    assert.equal((await db.projectTransferJob.findUniqueOrThrow({ where: { id: second.id } })).status, "DONE");
  });
  test("dos exportaciones con el mismo instante de fin no se borran entre sí (desempata el id)", async () => {
    const u = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const at = new Date();
    const mk = (id: string) => db.projectTransferJob.create({ data: { id, kind: "EXPORT", status: "DONE", userId: u.id, projectId: f.project.id, options: {}, progress: {}, finishedAt: at, expiresAt: new Date(at.getTime() + 3600_000), result: { file: `${id}.pizarro.zip`, size: 1, name: "x.zip" } } });
    const a = await mk("aaaa-job"), b = await mk("bbbb-job");
    assert.equal(await dropPreviousExports({ id: a.id, userId: u.id, projectId: f.project.id }), 0);
    assert.equal(await dropPreviousExports({ id: b.id, userId: u.id, projectId: f.project.id }), 1);
    assert.equal((await db.projectTransferJob.findUniqueOrThrow({ where: { id: a.id } })).status, "EXPIRED");
    assert.equal((await db.projectTransferJob.findUniqueOrThrow({ where: { id: b.id } })).status, "DONE");
  });
});
