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
import { DISK_MARGIN_BYTES, assertDiskRoom } from "../../src/lib/disk-space";
import { buildProjectExport } from "../../src/lib/project-export/export";
import { writeProjectExport } from "../../src/lib/project-export/write";
import {
  MAX_JOBS_PER_USER, claimNextJob, createExportJob, createImportJob, executeJob, exportsDir, getJobFor, purgeTransferJobs, recoverInterruptedJobs,
  runNextTransferJob, startTransferWorker, transferConcurrency,
} from "../../src/lib/transfer-jobs";

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
  test("FIFO y un solo trabajo en marcha en todo el servidor; PROJECT_TRANSFER_CONCURRENCY lo amplía", async () => {
    assert.equal(transferConcurrency(undefined), 1);
    assert.equal(transferConcurrency(""), 1);
    assert.equal(transferConcurrency("abc"), 1);
    assert.equal(transferConcurrency("3"), 3);
    const [a, b, c] = [await makeUser({ role: "ADMIN" }), await makeUser({ role: "ADMIN" }), await makeUser({ role: "ADMIN" })];
    const first = (await exportJob(a.id)).job;
    const second = (await exportJob(b.id)).job;
    const third = (await exportJob(c.id)).job;
    const run1 = (await claimNextJob())!;
    assert.equal(run1.id, first.id);
    assert.equal(await claimNextJob(), null); // ya hay uno en marcha
    await executeJob(run1);
    const run2 = (await claimNextJob())!;
    assert.equal(run2.id, second.id);
    process.env.PROJECT_TRANSFER_CONCURRENCY = "2";
    try {
      const run3 = (await claimNextJob())!; // con 2 a la vez, el tercero entra mientras el segundo sigue
      assert.equal(run3.id, third.id);
      await executeJob(run3);
    } finally {
      delete process.env.PROJECT_TRANSFER_CONCURRENCY;
    }
    await executeJob(run2);
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
  test("solo su dueño (o un administrador) ve el estado y descarga; los demás, 404", async () => {
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
    // Otro sitio (Sec-Fetch-Site).
    assert.equal((await downloadRoute(new Request("http://localhost/x", { headers: { "sec-fetch-site": "cross-site" } }), ctx(job.id))).status, 403);

    await loginAs(stranger);
    assert.equal((await downloadRoute(get(), ctx(job.id))).status, 404);
    await loginAs(admin);
    assert.equal((await statusRoute(get(), ctx(job.id))).status, 200);
    assert.equal((await downloadRoute(get(), ctx(job.id))).status, 200);
    await loginAs(otherAdmin);
    assert.equal((await downloadRoute(get(), ctx(job.id))).status, 200);

    // El dueño que deja de gestionar el proyecto ya no se lleva el archivo.
    await db.project.update({ where: { id: f.project.id }, data: { privateOwnerId: admin.id } });
    await db.projectMember.deleteMany({ where: { projectId: f.project.id, userId: owner.id } });
    await loginAs(owner);
    assert.equal((await downloadRoute(get(), ctx(job.id))).status, 404);
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
    // Aún no toca.
    assert.equal(await purgeTransferJobs(new Date()), 0);
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
    await assert.rejects(assertDiskRoom("/x", 1000, free(1000 + DISK_MARGIN_BYTES - 1)), (e: { status: number }) => e.status === 507);
    await assertDiskRoom("/x", 1000, free(1000 + DISK_MARGIN_BYTES));
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
  });
});
