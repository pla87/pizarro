// Exportar e importar un proyecto entero (.pizarro.zip) contra PostgreSQL real: ida y vuelta con todas las funciones,
// versión y sumas de control, permisos, emparejado de personas, imágenes y límites.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { db, loginAs, logout, makeKind, makeProject, makeTask, makeUser } from "./helpers";
import { buildProjectExport, estimateProjectExport, exportFileName, projectSlug, type ProjectExport } from "../../src/lib/project-export/export";
import { importProjectFile, type ImportUser } from "../../src/lib/project-export/import";
import { projectDataSchema, type ExportManifest, type ExportOptions, type ProjectExportData } from "../../src/lib/project-export/types";
import { attachmentPath, documentPath, safeDownloadMime, saveAttachmentFiles, saveDocumentFile, saveRawAttachmentFile, saveReleaseAttachmentFile } from "../../src/lib/uploads";
import { streamZip, type StreamZipEntry } from "../../src/lib/zip-stream";
import { GET as exportRoute } from "../../src/app/api/projects/[projectId]/export/route";
import { POST as importRoute } from "../../src/app/api/projects/import/route";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-pexport-"));
const work = await mkdtemp(path.join(tmpdir(), "pz-pexport-zip-"));
let seq = 0;

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const params = (projectId: string) => ({ params: Promise.resolve({ projectId }) });
const asImporter = (u: { id: string; name: string; email: string; role: "ADMIN" | "MEMBER" }): ImportUser => ({ id: u.id, name: u.name, email: u.email, role: u.role });

async function webp(w = 100, h = 80, color = "#c33") {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).webp().toBuffer();
}

async function zipTo(entries: StreamZipEntry[], name = `x${++seq}.zip`): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of streamZip(entries)) parts.push(c);
  const file = path.join(work, name);
  await writeFile(file, Buffer.concat(parts));
  return file;
}
const entry = (name: string, b: Buffer): StreamZipEntry => ({ name, size: b.length, crc: crc32(b), body: b });
const json = (b: StreamZipEntry["body"]) => JSON.parse((b as Buffer).toString("utf8"));

const writeExport = (build: ProjectExport) => zipTo(build.entries, `exp${++seq}.zip`);
const projectJsonOf = (build: ProjectExport): ProjectExportData => json(build.entries[1]!.body);

/** Un archivo válido hecho a mano a partir de datos (para probar entradas manipuladas). */
async function craft(data: unknown, files: Buffer[] = [], manifest: Partial<ExportManifest> & Record<string, unknown> = {}): Promise<string> {
  const pj = Buffer.from(JSON.stringify(data));
  const checksums: Record<string, string> = { "project.json": sha(pj) };
  for (const f of files) checksums[`files/${sha(f)}`] = sha(f);
  const m = { format: "pizarro-project", formatVersion: 1, appVersion: "test", exportedAt: new Date().toISOString(), options: { attachments: files.length > 0, scope: "all" }, counts: {}, checksums, ...manifest };
  return zipTo([entry("manifest.json", Buffer.from(JSON.stringify(m))), entry("project.json", pj), ...files.map((f) => entry(`files/${sha(f)}`, f))]);
}

/** Datos mínimos válidos de un proyecto (una columna, un tipo y las tareas indicadas). */
function minimal(tasks: Partial<ProjectExportData["tasks"][number]>[] = [], extra: Partial<ProjectExportData> = {}): ProjectExportData {
  const at = "2026-01-02T03:04:05.000Z";
  return {
    users: [], project: { name: "Mínimo", description: "", visibility: "TEAM", taskFields: [], releaseZipMaxMb: 80, taskAttachMaxMb: 80, fileMaxMb: 20, googleShareMode: null },
    reportSchedule: null, releaseTemplates: [],
    columns: [{ ref: "c1", name: "Por hacer", position: 1000, role: "NONE", isDone: false, waitingDays: null, routineTargetRef: null }],
    kinds: [{ ref: "k1", name: "Tipo único", color: "#3b82f6", position: 1, titleTemplate: "", descriptionTemplate: "", subtaskTemplate: [], scope: "project" }],
    hiddenGeneralKinds: [], labels: [], deliverables: [], releases: [], documents: [], events: [],
    tasks: tasks.map((t, i) => ({
      ref: `t${i + 1}`, title: `Tarea ${i + 1}`, description: "", columnRef: "c1", kindRef: "k1", color: null, linkUrl: null, position: (i + 1) * 1000, assignee: null, createdBy: null,
      dueDate: null, startDate: null, deliverableRef: null, archivedAt: null, archivedFromColumnRef: null, columnEnteredAt: at, evergreen: false, evergreenEvery: 1, cost: null,
      costPaid: false, estimatedHours: null, actualHours: null, priority: null, client: null, recurrence: "NONE", recurrenceDay: null, recurrenceFromRef: null, contentUpdatedAt: null,
      createdAt: at, updatedAt: at, labelRefs: [], subtasks: [], followers: [], comments: [], attachments: [], links: [], ...t,
    })),
    ...extra,
  };
}

/** Proyecto de equipo con casi todas las funciones; devuelve lo necesario para comprobar la importación. */
async function richProject() {
  const admin = await makeUser({ role: "ADMIN", name: "Ada Admin" });
  const member = await makeUser({ name: "Beto Miembro" });
  const f = await makeProject({ members: [member] });
  const projectId = f.project.id;
  await db.project.update({
    where: { id: projectId },
    data: { description: "Descripción del proyecto", taskFields: ["cost", "hours", "priority", "client", "startDate"], fileMaxMb: 10, taskAttachMaxMb: 40, releaseZipMaxMb: 60, googleShareMode: "MEMBERS" },
  });
  // Roles de columna: espera con días, siguiente salto, producción, rutinas con destino.
  await db.column.update({ where: { id: f.columns.doing }, data: { role: "WAITING", waitingDays: 5 } });
  const next = await db.column.create({ data: { projectId, name: "Siguiente", position: 4000, role: "NEXT_RELEASE" } });
  await db.column.create({ data: { projectId, name: "Producción", position: 5000, role: "IN_PRODUCTION", isDone: true } });
  const routines = await db.column.create({ data: { projectId, name: "Rutinas", position: 6000, role: "ROUTINES", routineTargetColumnId: f.columns.todo } });
  const general = await makeKind(null);
  const hidden = await makeKind(null);
  await db.projectHiddenKind.create({ data: { projectId, kindId: hidden.id } });
  await db.taskKind.update({ where: { id: f.kindId }, data: { titleTemplate: "[Bug] ", descriptionTemplate: "Pasos:", subtaskTemplate: ["Reproducir", "Arreglar"] } });
  const l1 = await db.label.create({ data: { projectId, name: "urgente", color: "#ef4444" } });
  const l2 = await db.label.create({ data: { projectId, name: "web", color: "#0ea5e9" } });
  const deliverable = await db.deliverable.create({ data: { projectId, name: "Hito 1", description: "Primera entrega", dueDate: new Date("2026-12-01T00:00:00Z"), position: 1000 } });
  await db.projectReleaseTemplate.create({ data: { projectId, kind: "HEADER", name: "Cabecera", content: "Contexto para la IA", position: 1000 } });
  await db.reportSchedule.create({ data: { projectId, recipient: admin.email, enabled: true, weekday: 3, hour: 9 } });

  const t1 = await db.task.create({
    data: {
      projectId, columnId: f.columns.todo, kindId: f.kindId, title: "Tarea completa", position: 1000, color: "#22c55e", linkUrl: "https://example.com/x",
      description: `Revisar con @[${member.name}](user:${member.id}) y @[Fantasma](user:zzzz)`, assigneeId: member.id, createdById: admin.id, dueDate: new Date("2026-11-30T00:00:00Z"),
      startDate: new Date("2026-11-01T00:00:00Z"), deliverableId: deliverable.id, cost: "123.45", costPaid: true, estimatedHours: "8.50", actualHours: "3.25", priority: "ALTA", client: "ACME",
      recurrence: "WEEKLY", recurrenceDay: 3, contentUpdatedAt: new Date("2026-10-10T10:00:00Z"), createdAt: new Date("2026-10-01T09:00:00Z"),
      labels: { create: [{ labelId: l1.id }, { labelId: l2.id }] },
      subtasks: { create: [{ title: "Sub A", done: true, position: 1000 }, { title: "Sub B", done: false, position: 2000 }] },
      followers: { create: [{ userId: member.id, muted: false }, { userId: admin.id, muted: true }] },
      links: { create: [{ kind: "GOOGLE_DOC", title: "Doc", url: "https://docs.google.com/document/d/abc", createdById: admin.id }] },
    },
  });
  const c1 = await db.taskComment.create({ data: { taskId: t1.id, authorId: admin.id, body: `Hola @[${member.name}](user:${member.id})`, createdAt: new Date("2026-10-02T09:00:00Z") } });
  await db.taskComment.create({ data: { taskId: t1.id, authorId: member.id, body: "Respuesta", parentId: c1.id, createdAt: new Date("2026-10-03T09:00:00Z"), editedAt: new Date("2026-10-04T09:00:00Z") } });
  await db.taskComment.create({ data: { taskId: t1.id, authorId: null, body: "", deletedAt: new Date("2026-10-05T09:00:00Z"), createdAt: new Date("2026-10-05T08:00:00Z") } });
  // Adjuntos: una imagen y un fichero tal cual.
  const img = await db.taskAttachment.create({ data: { taskId: t1.id, originalName: "captura.png", mimeType: "image/webp", isImage: true, width: 100, height: 80, size: 1, createdById: admin.id } });
  const imgBuf = await webp();
  await saveAttachmentFiles(img.id, { full: imgBuf, thumb: await webp(48, 38), width: 100, height: 80 });
  const raw = await db.taskAttachment.create({ data: { taskId: t1.id, originalName: "notas.txt", mimeType: "text/plain", isImage: false, size: 11, createdById: member.id } });
  await saveRawAttachmentFile(raw.id, Buffer.from("hola mundo!!"));

  await db.task.create({ data: { projectId, columnId: next.id, kindId: general.id, title: "Evergreen", position: 1000, evergreen: true, evergreenEvery: 2, recurrenceFromId: t1.id } });
  const t3 = await db.task.create({ data: { projectId, columnId: routines.id, kindId: f.kindId, title: "Archivada", position: 1000, archivedAt: new Date("2026-10-20T00:00:00Z"), archivedFromColumnId: f.columns.doing } });
  await db.taskComment.create({ data: { taskId: t3.id, authorId: member.id, body: "Comentario en archivada" } });
  await db.taskEvent.createMany({
    data: [
      { taskId: t1.id, projectId, userId: admin.id, userName: admin.name, code: "create", label: "Creó la tarea", createdAt: new Date("2026-10-01T09:00:00Z") },
      { taskId: t3.id, projectId, userId: null, userName: "Alguien", code: "archive", label: "Archivó la tarea", createdAt: new Date("2026-10-20T09:00:00Z") },
    ],
  });
  // Release con tarea, snapshot y adjuntos de histórico.
  const rel = await db.release.create({ data: { projectId, number: 1, title: "Release 1", content: "# Notas\n- cosa", createdById: admin.id, deployedAt: new Date("2026-10-15T12:00:00Z") } });
  await db.releaseTask.createMany({ data: [{ releaseId: rel.id, taskId: t1.id, title: "Tarea completa", kindName: "Tipo" }, { releaseId: rel.id, taskId: null, title: "Borrada", kindName: "Tipo" }] });
  const ra = await db.releaseAttachment.create({ data: { releaseId: rel.id, fileName: "F1_captura.webp", size: 1, isImage: true, position: 0, createdAt: new Date("2026-10-15T12:00:00Z") } });
  await saveReleaseAttachmentFile(ra.id, await webp(60, 40, "#36c"), "webp");
  const rb = await db.releaseAttachment.create({ data: { releaseId: rel.id, fileName: "F1_notas.txt", size: 1, isImage: false, position: 1 } });
  await saveReleaseAttachmentFile(rb.id, Buffer.from("copia de notas"), "bin");
  // Documentación: uno vivo y uno en la papelera (no se exporta).
  const doc = await db.projectDocument.create({ data: { projectId, name: "guia.md", mimeType: "text/markdown", size: 9, kind: "MARKDOWN", createdById: admin.id } });
  await saveDocumentFile(doc.id, Buffer.from("# Guía\nok"));
  const trashed = await db.projectDocument.create({ data: { projectId, name: "viejo.txt", mimeType: "text/plain", size: 3, kind: "TEXT", deletedAt: new Date() } });
  await saveDocumentFile(trashed.id, Buffer.from("old"));
  return { admin, member, f, projectId, t1, doc };
}

/** project.json comparable: sin el nombre (el importado lleva el sufijo). */
const comparable = (d: ProjectExportData) => ({ ...d, project: { ...d.project, name: "" } });

describe("exportar e importar un proyecto", () => {
  for (const options of [
    { attachments: true, scope: "all" },
    { attachments: false, scope: "board" },
    { attachments: true, scope: "board" },
    { attachments: false, scope: "all" },
  ] as ExportOptions[]) {
    test(`ida y vuelta idéntica (adjuntos: ${options.attachments}, alcance: ${options.scope})`, async () => {
      const { admin, projectId, member } = await richProject();
      const built = await buildProjectExport(projectId, options, new Date("2026-11-11T10:00:00Z"));
      const data = projectJsonOf(built);
      projectDataSchema.parse(data);
      // Contenido según las opciones.
      assert.equal(data.tasks.some((t) => t.archivedAt), options.scope === "all");
      assert.equal(data.releases.length, options.scope === "all" ? 1 : 0);
      assert.equal(data.events.length, options.scope === "all" ? 2 : 0);
      assert.equal(data.tasks.flatMap((t) => t.attachments).length, options.attachments ? 2 : 0);
      assert.equal(data.documents.length, options.attachments ? 1 : 0); // la de la papelera no sale
      assert.equal(Object.keys(built.manifest.checksums).filter((k) => k.startsWith("files/")).length, built.manifest.counts.files);
      assert.equal(data.users.find((u) => u.email === admin.email)?.name, admin.name);
      // Las menciones salen con la ref de persona, no con el id de la base de datos.
      assert.ok(!JSON.stringify(data).includes(member.id));
      assert.match(data.tasks[0]!.description, /@\[Beto Miembro\]\(user:u\d+\)/);

      const file = await writeExport(built);
      const summary = await importProjectFile(file, asImporter(admin), { isPrivate: false });
      assert.match(summary.name, /\(importado\)$/);
      assert.equal(summary.unmappedUsers.length, 0);
      assert.equal(summary.counts.tasks, data.tasks.length);

      // Reexportar lo importado da exactamente lo mismo (salvo el nombre y la fecha de exportación).
      const again = await buildProjectExport(summary.projectId, options, new Date("2026-11-11T10:00:00Z"));
      assert.deepEqual(comparable(projectJsonOf(again)), comparable(data));
      // Mismas sumas de todos los ficheros (el de project.json difiere solo por el nombre).
      const sums = (m: ExportManifest) => ({ ...m, checksums: { ...m.checksums, "project.json": "" } });
      assert.deepEqual(sums(again.manifest), sums(built.manifest));

      // El proyecto nuevo es de equipo, lo trabaja quien importa y mantiene a los miembros asignados.
      const created = await db.project.findUniqueOrThrow({ where: { id: summary.projectId }, include: { members: true, adminPicks: true } });
      assert.equal(created.isPrivate, false);
      assert.deepEqual(created.adminPicks.map((p) => p.userId), [admin.id]);
      assert.deepEqual(created.members.map((m) => m.userId), [member.id]);
      assert.equal(summary.addedMembers, 1);
      // El original sigue intacto.
      assert.equal(await db.task.count({ where: { projectId } }), 3);
      // Los ficheros existen en disco para cada adjunto importado.
      for (const a of await db.taskAttachment.findMany({ where: { task: { projectId: summary.projectId } } })) {
        assert.ok((await stat(attachmentPath(a.id, a.isImage ? "full" : "file"))).size > 0);
        if (a.isImage) assert.ok((await stat(attachmentPath(a.id, "thumb"))).size > 0);
      }
      for (const d of await db.projectDocument.findMany({ where: { projectId: summary.projectId } })) assert.equal((await readFile(documentPath(d.id))).toString(), "# Guía\nok");
    });
  }

  test("el contenido y el estado del proyecto importado son los del original", async () => {
    const { admin, projectId, member } = await richProject();
    const file = await writeExport(await buildProjectExport(projectId, { attachments: true, scope: "all" }));
    const s = await importProjectFile(file, asImporter(admin), { isPrivate: false });
    const p = await db.project.findUniqueOrThrow({
      where: { id: s.projectId },
      include: { columns: { orderBy: { position: "asc" } }, kinds: true, hiddenKinds: true, labels: true, reportSchedule: true, releaseTemplates: true },
    });
    assert.deepEqual([p.fileMaxMb, p.taskAttachMaxMb, p.releaseZipMaxMb, p.googleShareMode, p.description], [10, 40, 60, "MEMBERS", "Descripción del proyecto"]);
    assert.deepEqual(p.taskFields.slice().sort(), ["client", "cost", "hours", "priority", "startDate"]);
    assert.deepEqual(p.columns.map((c) => [c.name, c.role, c.waitingDays]), [["Por hacer", "NONE", null], ["En curso", "WAITING", 5], ["Hecho", "NONE", null], ["Siguiente", "NEXT_RELEASE", null], ["Producción", "IN_PRODUCTION", null], ["Rutinas", "ROUTINES", null]]);
    const routines = p.columns.find((c) => c.role === "ROUTINES")!;
    assert.equal(routines.routineTargetColumnId, p.columns[0]!.id);
    assert.equal(p.hiddenKinds.length, 1);
    assert.equal(p.reportSchedule?.recipient, admin.email);
    assert.equal(p.releaseTemplates.length, 1);
    // El tipo general usado se empareja por nombre (no se duplica); el propio se recrea con sus automatizaciones.
    assert.equal(p.kinds.length, 1);
    assert.deepEqual([p.kinds[0]!.titleTemplate, p.kinds[0]!.subtaskTemplate], ["[Bug] ", ["Reproducir", "Arreglar"]]);
    const t1 = await db.task.findFirstOrThrow({
      where: { projectId: s.projectId, title: "Tarea completa" },
      include: { labels: true, subtasks: true, followers: true, comments: { orderBy: { createdAt: "asc" } }, links: true, attachments: true },
    });
    assert.equal(t1.assigneeId, member.id);
    assert.equal(t1.createdById, admin.id);
    assert.equal(t1.cost?.toFixed(2), "123.45");
    assert.equal(t1.createdAt.toISOString(), "2026-10-01T09:00:00.000Z");
    assert.match(t1.description, new RegExp(`@\\[Beto Miembro\\]\\(user:${member.id}\\) y @Fantasma`)); // la mención sin persona queda como texto
    assert.equal(t1.labels.length, 2);
    assert.equal(t1.followers.length, 2);
    assert.equal(t1.links.length, 1);
    assert.equal(t1.attachments.length, 2);
    assert.equal(t1.comments.length, 3);
    assert.equal(t1.comments[1]!.parentId, t1.comments[0]!.id);
    assert.equal(t1.comments[2]!.deletedAt?.toISOString(), "2026-10-05T09:00:00.000Z");
    const evergreen = await db.task.findFirstOrThrow({ where: { projectId: s.projectId, title: "Evergreen" }, include: { column: true } });
    assert.deepEqual([evergreen.evergreen, evergreen.evergreenEvery, evergreen.recurrenceFromId, evergreen.column.role], [true, 2, t1.id, "NEXT_RELEASE"]);
    const archived = await db.task.findFirstOrThrow({ where: { projectId: s.projectId, title: "Archivada" } });
    assert.ok(archived.archivedAt && archived.archivedFromColumnId === p.columns[1]!.id);
    assert.equal(archived.routineColumnId, routines.id); // lo fija el disparador al insertar en una columna de rutinas
    const rel = await db.release.findFirstOrThrow({ where: { projectId: s.projectId }, include: { tasks: true, attachments: true } });
    assert.equal(rel.tasks.length, 2);
    assert.equal(rel.tasks.filter((x) => x.taskId === t1.id).length, 1);
    assert.equal(rel.attachments.length, 2);
    assert.ok(await db.taskEvent.count({ where: { projectId: s.projectId } }));
  });

  test("el nombre se repite con «(importado)» y el nuevo proyecto privado solo lo ve quien importa", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const other = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    await makeTask(f, { title: "Una" });
    const file = await writeExport(await buildProjectExport(f.project.id, { attachments: false, scope: "board" }));
    const a = await importProjectFile(file, asImporter(admin), { isPrivate: true });
    const b = await importProjectFile(file, asImporter(admin), { isPrivate: true });
    assert.equal(a.name, `${f.project.name} (importado)`);
    assert.equal(b.name, `${f.project.name} (importado) 2`); // el primero importado ya es visible para su dueño: el nombre se numera
    const p = await db.project.findUniqueOrThrow({ where: { id: a.projectId }, include: { members: true } });
    assert.equal(p.isPrivate, true);
    assert.equal(p.privateOwnerId, admin.id);
    assert.deepEqual(p.members.map((m) => m.userId), [admin.id]);
    void other;
  });
});

describe("importar: validación del archivo", () => {
  test("una versión del formato posterior se rechaza, y otro formato también", async () => {
    const { admin, projectId } = await richProject();
    const built = await buildProjectExport(projectId, { attachments: false, scope: "board" });
    const withManifest = (patch: Record<string, unknown>) => [entry("manifest.json", Buffer.from(JSON.stringify({ ...json(built.entries[0]!.body), ...patch }))), ...built.entries.slice(1)];
    await assert.rejects(importProjectFile(await zipTo(withManifest({ formatVersion: 2 })), asImporter(admin), { isPrivate: false }), /más reciente/);
    await assert.rejects(importProjectFile(await zipTo(withManifest({ formatVersion: 0 })), asImporter(admin), { isPrivate: false }), /no es válida/);
    await assert.rejects(importProjectFile(await zipTo(withManifest({ format: "otra-cosa" })), asImporter(admin), { isPrivate: false }), /No es un archivo de proyecto de Pizarro/);
    // Una versión futura se rechaza aunque su manifiesto tenga otra forma.
    await assert.rejects(importProjectFile(await zipTo([entry("manifest.json", Buffer.from(JSON.stringify({ format: "pizarro-project", formatVersion: 9, nuevo: true }))), built.entries[1]!]), asImporter(admin), { isPrivate: false }), /más reciente/);
    assert.equal(await db.project.count({ where: { name: { contains: "(importado)" }, privateOwnerId: null, id: { not: projectId } } }) >= 0, true);
  });

  test("una suma de control distinta (project.json o un fichero) o una entrada ajena se rechaza", async () => {
    const { admin, projectId } = await richProject();
    const built = await buildProjectExport(projectId, { attachments: true, scope: "all" });
    const before = await db.project.count();
    const reject = async (entries: StreamZipEntry[], re: RegExp) =>
      assert.rejects(importProjectFile(await zipTo(entries), asImporter(admin), { isPrivate: false }), re);

    // project.json cambiado a mano.
    const pj = (built.entries[1]!.body as Buffer).toString().replace("Tarea completa", "Tarea cambiada");
    await reject([built.entries[0]!, entry("project.json", Buffer.from(pj)), ...built.entries.slice(2)], /SHA-256/);
    // Un fichero con el contenido cambiado (mismo nombre).
    const fileEntry = built.entries[2]!;
    await reject([...built.entries.slice(0, 2), entry(fileEntry.name, Buffer.from("contenido distinto")), ...built.entries.slice(3)], /SHA-256|suma/);
    // Falta un fichero declarado, o sobra uno sin declarar.
    await reject(built.entries.slice(0, 2), /sumas de control/);
    await reject([...built.entries, entry("files/" + "0".repeat(64), Buffer.from("x"))], /sumas de control/);
    // Entradas con nombre peligroso o desconocido.
    await reject([...built.entries, entry("../evil.txt", Buffer.from("x"))], /Nombre de entrada no válido|ZIP válido/);
    await reject([...built.entries, entry("otro.txt", Buffer.from("x"))], /entrada inesperada/);
    // Falta el manifiesto.
    await reject(built.entries.slice(1), /falta manifest/);
    assert.equal(await db.project.count(), before); // nada creado
  });

  test("un project.json con forma incorrecta o referencias rotas se rechaza sin crear nada", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const before = await db.project.count();
    const bad = async (data: unknown, re: RegExp) => assert.rejects(importProjectFile(await craft(data), asImporter(admin), { isPrivate: false }), re);
    await bad({ ...minimal(), tasks: [{ title: 1 }] }, /project.json no es válido/);
    await bad(minimal([{ columnRef: "c9" }]), /no existe/);
    await bad(minimal([{ kindRef: "k9" }]), /no existe/);
    await bad(minimal([{}, { ref: "t1" }]), /repite una tarea/);
    await bad(minimal([{ comments: [{ ref: "m1", author: null, authorName: null, body: "x", createdAt: "2026-01-01T00:00:00.000Z", editedAt: null, parentRef: "m7", deletedAt: null }] }]), /no existe/);
    await bad({ ...minimal(), columns: [{ ...minimal().columns[0]!, role: "NEXT_RELEASE" }, { ...minimal().columns[0]!, ref: "c2", role: "NEXT_RELEASE" }] }, /rol único/);
    await bad(minimal([{ attachments: [{ originalName: "a", mimeType: "x/y", isImage: false, width: null, height: null, size: 1, createdBy: null, createdAt: "2026-01-01T00:00:00.000Z", file: "a".repeat(64) }] }]), /no existe/);
    await bad({ ...minimal(), tasks: minimal([{ color: "rojo" }]).tasks }, /project.json no es válido/);
    assert.equal(await db.project.count(), before);
    // Y una cosa que no es un ZIP.
    const junk = path.join(work, "junk.zip");
    await writeFile(junk, "no soy un zip");
    await assert.rejects(importProjectFile(junk, asImporter(admin), { isPrivate: false }), /no es un ZIP/);
  });

  test("imágenes: una PNG grande se recodifica a WebP; una imagen inválida se omite con aviso; una WebP válida se conserva", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#09f" } }).png().toBuffer();
    const good = await webp(300, 200, "#0a0");
    const att = (file: Buffer, name: string, isImage = true) => ({ originalName: name, mimeType: isImage ? "image/webp" : "application/pdf", isImage, width: null, height: null, size: file.length, createdBy: null, createdAt: "2026-01-01T00:00:00.000Z", file: sha(file) });
    const fake = Buffer.from("no es una imagen");
    const data = minimal([{ attachments: [att(png, "grande.png"), att(good, "bien.webp"), att(fake, "rota.png")] }]);
    const s = await importProjectFile(await craft(data, [png, good, fake]), asImporter(admin), { isPrivate: false });
    assert.equal(s.counts.taskAttachments, 2);
    assert.equal(s.warnings.length, 1);
    assert.match(s.warnings[0]!, /rota\.png/);
    const rows = await db.taskAttachment.findMany({ where: { task: { projectId: s.projectId } }, orderBy: { originalName: "asc" } });
    const big = rows.find((r) => r.originalName === "grande.png")!;
    assert.equal(big.width, 1280);
    assert.equal((await sharp(await readFile(attachmentPath(big.id, "full"))).metadata()).format, "webp");
    const kept = rows.find((r) => r.originalName === "bien.webp")!;
    assert.ok((await readFile(attachmentPath(kept.id, "full"))).equals(good)); // sin recomprimir
    // Un adjunto «no imagen» con MIME raro se guarda con un MIME saneado.
    const weird = Buffer.from("%PDF-1.4 x");
    const s2 = await importProjectFile(await craft(minimal([{ attachments: [{ ...att(weird, "doc.pdf", false), mimeType: "text/html; charset=x<script>" }] }]), [weird]), asImporter(admin), { isPrivate: false });
    const a = await db.taskAttachment.findFirstOrThrow({ where: { task: { projectId: s2.projectId } } });
    assert.equal(a.mimeType, "text/html"); // sin parámetros; igualmente se sirve siempre como descarga genérica
    assert.equal(safeDownloadMime(a.mimeType), "application/octet-stream");
  });

  test("la cuota del proyecto y el tamaño máximo por archivo se respetan, y un fallo no deja ficheros ni filas", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const big = Buffer.alloc(2 * 1024 * 1024, 7);
    const att = (file: Buffer, name: string) => ({ originalName: name, mimeType: "application/octet-stream", isImage: false, width: null, height: null, size: file.length, createdBy: null, createdAt: "2026-01-01T00:00:00.000Z", file: sha(file) });
    const prev = process.env.UPLOAD_QUOTA_MB_PER_PROJECT;
    process.env.UPLOAD_QUOTA_MB_PER_PROJECT = "1";
    try {
      const before = await db.project.count();
      const filesBefore = (await readdir(process.env.UPLOAD_DIR!)).length;
      await assert.rejects(importProjectFile(await craft(minimal([{ attachments: [att(big, "grande.bin")] }]), [big]), asImporter(admin), { isPrivate: false }), /Cuota/);
      assert.equal(await db.project.count(), before);
      assert.equal((await readdir(process.env.UPLOAD_DIR!)).length, filesBefore);
    } finally {
      if (prev === undefined) delete process.env.UPLOAD_QUOTA_MB_PER_PROJECT;
      else process.env.UPLOAD_QUOTA_MB_PER_PROJECT = prev;
    }
    // Más que el máximo por archivo del proyecto (1 MB): se omite con aviso, el resto se importa.
    const data = minimal([{ attachments: [att(big, "grande.bin")] }]);
    data.project.fileMaxMb = 1;
    data.project.taskAttachMaxMb = 1;
    const s = await importProjectFile(await craft(data, [big]), asImporter(admin), { isPrivate: false });
    assert.equal(s.counts.taskAttachments, 0);
    assert.match(s.warnings[0]!, /grande\.bin/);
    assert.equal(s.counts.tasks, 1);
  });
});

describe("importar: personas", () => {
  test("se emparejan por email con usuarios activos; los demás conservan su nombre", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const member = await makeUser({ name: "María Real" });
    const gone = await makeUser({ name: "Persona Inactiva", active: false });
    const at = "2026-01-01T00:00:00.000Z";
    const comment = (ref: string, author: string | null, body: string, authorName: string | null = null) => ({ ref, author, authorName, body, createdAt: at, editedAt: null, parentRef: null, deletedAt: null });
    const data = minimal(
      [{
        assignee: "u2", createdBy: "u3",
        description: "Hola @[María](user:u1) y @[Inactiva](user:u2) y @[Nadie](user:u9)",
        followers: [{ user: "u1", muted: false }, { user: "u3", muted: false }],
        comments: [comment("m1", "u1", "de María"), comment("m2", "u3", "de la inactiva"), comment("m3", null, "de alguien borrado", "Antiguo Compañero")],
      }],
      {
        users: [
          { ref: "u1", name: "Otro nombre", email: member.email.toUpperCase() },
          { ref: "u2", name: "Desconocido Uno", email: "no-existe@example.com" },
          { ref: "u3", name: "Persona Inactiva", email: gone.email },
        ],
      },
    );
    const s = await importProjectFile(await craft(data), asImporter(admin), { isPrivate: false });
    assert.deepEqual(s.unmappedUsers.map((u) => u.email).sort(), [gone.email, "no-existe@example.com"].sort());
    assert.equal(s.mappedUsers, 1);
    const t = await db.task.findFirstOrThrow({ where: { projectId: s.projectId }, include: { followers: true, comments: { orderBy: { createdAt: "asc" }, include: { author: true } } } });
    assert.equal(t.assigneeId, null);
    assert.equal(t.createdById, null);
    assert.equal(t.description, `Hola @[María](user:${member.id}) y @Inactiva y @Nadie`);
    assert.deepEqual(t.followers.map((f) => f.userId), [member.id]);
    const byBody = new Map(t.comments.map((c) => [c.body, c]));
    assert.equal(byBody.get("de María")!.authorId, member.id);
    assert.equal(byBody.get("de María")!.authorName, null);
    assert.equal(byBody.get("de la inactiva")!.authorId, null);
    assert.equal(byBody.get("de la inactiva")!.authorName, "Persona Inactiva");
    assert.equal(byBody.get("de alguien borrado")!.authorName, "Antiguo Compañero");
    // Nota con quien estaba asignado y quien la creó.
    const note = t.comments.find((c) => c.authorId === admin.id)!;
    assert.match(note.body, /Desconocido Uno/);
    assert.match(note.body, /Persona Inactiva/);
    // Usuario de equipo (no administrador) emparejado: pasa a ser miembro.
    assert.equal(await db.projectMember.count({ where: { projectId: s.projectId, userId: member.id } }), 1);
  });

  test("en un proyecto privado solo se empareja quien importa", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    const data = minimal([{ assignee: "u1", createdBy: "u2" }], {
      users: [{ ref: "u1", name: "Miembro", email: member.email }, { ref: "u2", name: "Admin", email: admin.email }],
    });
    const s = await importProjectFile(await craft(data), asImporter(admin), { isPrivate: true });
    assert.deepEqual(s.unmappedUsers.map((u) => u.email), [member.email]);
    const t = await db.task.findFirstOrThrow({ where: { projectId: s.projectId } });
    assert.equal(t.assigneeId, null);
    assert.equal(t.createdById, admin.id);
    assert.equal(await db.projectMember.count({ where: { projectId: s.projectId } }), 1);
  });

  test("los tipos generales se emparejan por nombre y, si no existen aquí, se crean como del proyecto", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const existing = await makeKind(null);
    const kind = (ref: string, name: string, scope: "project" | "general") => ({ ref, name, color: "#3b82f6", position: 1, titleTemplate: "", descriptionTemplate: "", subtaskTemplate: [], scope });
    const data = minimal([{ kindRef: "k1" }, { kindRef: "k2" }, { kindRef: "k3" }], {
      kinds: [kind("k1", existing.name.toUpperCase(), "general"), kind("k2", "Tipo inventado", "general"), kind("k3", "Propio", "project")],
      hiddenGeneralKinds: [existing.name, "No existe"],
    });
    const s = await importProjectFile(await craft(data), asImporter(admin), { isPrivate: false });
    const tasks = await db.task.findMany({ where: { projectId: s.projectId }, orderBy: { position: "asc" }, include: { kind: true } });
    assert.equal(tasks[0]!.kindId, existing.id);
    assert.equal(tasks[1]!.kind.projectId, s.projectId);
    assert.equal(tasks[2]!.kind.projectId, s.projectId);
    assert.equal(await db.taskKind.count({ where: { projectId: s.projectId } }), 2);
    assert.equal(await db.projectHiddenKind.count({ where: { projectId: s.projectId, kindId: existing.id } }), 1);
  });
});

describe("permisos", () => {
  test("importar es solo para administradores (función y ruta)", async () => {
    const member = await makeUser();
    const admin = await makeUser({ role: "ADMIN" });
    const file = await craft(minimal([{}]));
    await assert.rejects(importProjectFile(file, asImporter(member), { isPrivate: true }), /No tienes permiso/);

    const body = await readFile(file);
    const req = () => new Request("http://localhost/api/projects/import?private=1", { method: "POST", body, headers: { origin: "http://localhost", host: "localhost", "content-length": String(body.length) } });
    logout();
    assert.equal((await importRoute(req())).status, 401);
    await loginAs(member);
    assert.equal((await importRoute(req())).status, 403);
    // Sin Origin (CSRF) tampoco.
    await loginAs(admin);
    assert.equal((await importRoute(new Request("http://localhost/api/projects/import", { method: "POST", body, headers: { host: "localhost" } }))).status, 403);
    const ok = await importRoute(req());
    assert.equal(ok.status, 201);
    const { summary } = await ok.json();
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: summary.projectId } })).isPrivate, true);
    // Cuerpo vacío o archivo que no es un ZIP: error claro, nada creado.
    const junk = await importRoute(new Request("http://localhost/api/projects/import", { method: "POST", body: "basura", headers: { origin: "http://localhost", host: "localhost" } }));
    assert.equal(junk.status, 400);
    assert.match((await junk.json()).error, /ZIP/);
    // Tamaño máximo configurable.
    process.env.PROJECT_IMPORT_MAX_MB = "0.0001";
    try {
      assert.equal((await importRoute(req())).status, 413);
    } finally {
      delete process.env.PROJECT_IMPORT_MAX_MB;
    }
    // El temporal se borra siempre.
    const tmp = await readdir(path.join(process.env.UPLOAD_DIR!, "imports"));
    assert.deepEqual(tmp, []);
  });

  test("exportar: administradores en proyectos de equipo y miembros de los privados; los ajenos no", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const otherAdmin = await makeUser({ role: "ADMIN" });
    const member = await makeUser();
    const outsider = await makeUser();
    const team = await makeProject({ members: [member] });
    const priv = await makeProject({ visibility: "PRIVATE", owner: member });
    const url = (id: string, q = "attachments=without&scope=board") => new Request(`http://localhost/api/projects/${id}/export?${q}`, { headers: { "sec-fetch-site": "same-origin" } });
    const status = async (id: string, q?: string) => (await exportRoute(url(id, q), params(id))).status;

    logout();
    assert.equal(await status(team.project.id), 401);
    await loginAs(admin);
    const res = await exportRoute(url(team.project.id), params(team.project.id));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");
    assert.match(res.headers.get("content-disposition")!, /pizarro-proyecto-\d{8}\.pizarro\.zip|pizarro-.*\.pizarro\.zip/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.length, Number(res.headers.get("content-length")));
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
    assert.equal(await status(priv.project.id), 404); // un administrador ajeno no ve el privado
    await loginAs(otherAdmin);
    assert.equal(await status(priv.project.id), 404);
    await loginAs(member);
    assert.equal(await status(team.project.id), 403); // miembro de un proyecto de equipo: no gestiona
    assert.equal(await status(priv.project.id), 200); // miembro de uno privado: sí
    await loginAs(outsider);
    assert.equal(await status(team.project.id), 404);
    assert.equal(await status(priv.project.id), 404);
    // Opciones inválidas.
    await loginAs(admin);
    assert.equal(await status(team.project.id, "attachments=quizas&scope=board"), 400);
    assert.equal(await status(team.project.id, "attachments=with&scope=nada"), 400);
    // Otro sitio (Sec-Fetch-Site).
    assert.equal((await exportRoute(new Request(`http://localhost/api/projects/${team.project.id}/export?attachments=with&scope=all`, { headers: { "sec-fetch-site": "cross-site" } }), params(team.project.id))).status, 403);
    // Recuentos previos.
    const est = await exportRoute(url(team.project.id, "attachments=with&scope=all&estimate=1"), params(team.project.id));
    assert.equal(est.status, 200);
    assert.equal((await est.json()).tasks, 0);
  });

  test("exportar queda en el registro de actividad y respeta el hueco de ZIP por persona", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    await makeTask(f);
    await loginAs(admin);
    const q = "attachments=without&scope=all";
    const first = await exportRoute(new Request(`http://localhost/api/projects/${f.project.id}/export?${q}`), params(f.project.id));
    assert.equal(first.status, 200);
    // El primero aún no se ha leído: el hueco sigue ocupado.
    const second = await exportRoute(new Request(`http://localhost/api/projects/${f.project.id}/export?${q}`), params(f.project.id));
    assert.equal(second.status, 429);
    await first.arrayBuffer();
    await new Promise((r) => setTimeout(r, 50));
    const third = await exportRoute(new Request(`http://localhost/api/projects/${f.project.id}/export?${q}`), params(f.project.id));
    assert.equal(third.status, 200);
    await third.arrayBuffer();
    await new Promise((r) => setTimeout(r, 3500)); // el registro se escribe por lotes
    assert.ok(await db.appLog.count({ where: { action: "projects.export", projectId: f.project.id } }));
  });
});

describe("piezas del exportador", () => {
  test("nombre del fichero y recuentos previos", async () => {
    assert.equal(projectSlug("Mi Proyecto Ñandú: v2!"), "mi-proyecto-nandu-v2");
    assert.equal(projectSlug("¡¡¡"), "proyecto");
    assert.equal(exportFileName("Mi Proyecto", new Date("2026-03-04T12:00:00Z"), "UTC"), "pizarro-mi-proyecto-20260304.pizarro.zip");
    const { projectId } = await richProject();
    const all = await estimateProjectExport(projectId, { attachments: true, scope: "all" });
    assert.deepEqual([all.tasks, all.archivedTasks, all.releases, all.documents, all.attachments], [3, 1, 1, 1, 5]);
    const board = await estimateProjectExport(projectId, { attachments: false, scope: "board" });
    assert.deepEqual([board.tasks, board.archivedTasks, board.releases, board.attachments, board.bytes], [2, 0, 0, 0, 0]);
  });

  test("las mismas bytes de dos adjuntos se guardan una sola vez en el archivo", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const f = await makeProject({ members: [] });
    const t = await makeTask(f);
    for (const name of ["a.txt", "b.txt"]) {
      const a = await db.taskAttachment.create({ data: { taskId: t.id, originalName: name, mimeType: "text/plain", isImage: false, size: 4 } });
      await saveRawAttachmentFile(a.id, Buffer.from("igual"));
    }
    const built = await buildProjectExport(f.project.id, { attachments: true, scope: "board" });
    assert.equal(built.manifest.counts.files, 1);
    assert.equal(built.manifest.counts.taskAttachments, 2);
    const s = await importProjectFile(await writeExport(built), asImporter(admin), { isPrivate: false });
    assert.equal(s.counts.taskAttachments, 2);
    // Un adjunto cuyo fichero ya no está se omite del archivo y se cuenta.
    const gone = await db.taskAttachment.create({ data: { taskId: t.id, originalName: "perdido.txt", mimeType: "text/plain", isImage: false, size: 4 } });
    assert.ok(gone.id);
    const again = await buildProjectExport(f.project.id, { attachments: true, scope: "board" });
    assert.equal(again.missingFiles, 1);
    assert.equal(again.manifest.counts.taskAttachments, 2);
  });
});
