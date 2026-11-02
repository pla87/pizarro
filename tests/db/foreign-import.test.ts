// Importar desde otros Kanban (JSON de Trello y CSV) contra PostgreSQL real: creación del proyecto en una transacción,
// emparejado de responsables, comentarios del usuario que importa, permisos, límites y ruta de subida con su trabajo en segundo plano.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { db, loginAs, logout, makeKind, makeUser } from "./helpers";
import { makeT } from "../../src/i18n/core";
import { POST as importRoute } from "../../src/app/api/projects/import/route";
import { importForeignFile } from "../../src/lib/foreign-import/create";
import { runNextTransferJob } from "../../src/lib/transfer-jobs";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-foreign-"));
const work = await mkdtemp(path.join(tmpdir(), "pz-foreign-files-"));
const t = makeT("es");
let seq = 0;

const trello = await readFile(new URL("../fixtures/trello-board.json", import.meta.url), "utf8");
const asImporter = (u: { id: string; name: string; email: string; role: "ADMIN" | "MEMBER" }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
async function file(name: string, text: string): Promise<string> {
  const f = path.join(work, `${++seq}-${name}`);
  await writeFile(f, text);
  return f;
}
const uniq = () => Math.random().toString(36).slice(2, 8);

async function load(projectId: string) {
  return db.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      columns: { orderBy: { position: "asc" } }, labels: true, members: true, adminPicks: true,
      tasks: { orderBy: [{ columnId: "asc" }, { position: "asc" }], include: { labels: { include: { label: true } }, subtasks: { orderBy: { position: "asc" } }, comments: { orderBy: { createdAt: "asc" } }, assignee: true } },
    },
  });
}

describe("Trello JSON", () => {
  test("crea el proyecto con el nombre del tablero, las listas como columnas y las tarjetas como tareas", async () => {
    await makeKind(null);
    const admin = await makeUser({ role: "ADMIN" });
    const ana = await makeUser({ name: "Ana Ejemplo" });
    const s = await importForeignFile(await file("t.json", trello), "trello", asImporter(admin), { isPrivate: false, t, fileName: "otro" });
    assert.equal(s.source, "trello");
    assert.deepEqual([s.counts.columns, s.counts.tasks, s.counts.archivedTasks, s.counts.subtasks, s.counts.comments, s.counts.labels], [3, 5, 2, 4, 2, 4]);
    const p = await load(s.projectId);
    assert.ok(p.name.startsWith("Lanzamiento web"));
    assert.match(p.description, /^Tablero del \*\*lanzamiento\*\*/);
    assert.deepEqual(p.columns.map((c) => [c.name, c.isDone]), [["Por hacer", false], ["En curso", false], ["Hecho", true]]);
    assert.equal(p.isPrivate, false);
    assert.deepEqual(p.adminPicks.map((a) => a.userId), [admin.id]);

    const byTitle = new Map(p.tasks.map((x) => [x.title, x]));
    const textos = byTitle.get("Redactar los textos")!;
    assert.equal(textos.columnId, p.columns[0]!.id);
    assert.equal(textos.createdById, admin.id);
    assert.ok(textos.position > byTitle.get("Elegir el dominio")!.position);
    assert.equal(textos.dueDate?.toISOString().slice(0, 10) === "2026-12-15" || textos.dueDate?.toISOString().slice(0, 10) === "2026-12-16", true);
    assert.deepEqual(textos.labels.map((l) => [l.label.name, l.label.color]).sort(), [["Diseño", "#a855f7"], ["Rojo", "#ef4444"]]);
    assert.deepEqual(textos.subtasks.map((x) => [x.title, x.done]), [["Primer borrador", true], ["Revisar con Ana", false]]);
    assert.doesNotMatch(textos.description, /<img|javascript:|onerror/);
    assert.match(textos.description, /\[Guía de estilo\]\(https:\/\/example\.com\//);

    // Comentarios: del usuario que importa, con el autor original en el texto y la fecha original.
    assert.deepEqual(textos.comments.map((c) => c.authorId), [admin.id, admin.id]);
    assert.match(textos.comments[0]!.body, /^\*\*Ana Ejemplo comentó en Trello el 2026-10-30:\*\*\n\nEmpiezo hoy\.$/);
    assert.equal(textos.comments[0]!.createdAt.toISOString(), "2026-10-30T18:00:00.000Z");

    // Archivadas: la tarjeta cerrada y la de una lista archivada.
    assert.deepEqual(p.tasks.filter((x) => x.archivedAt).map((x) => x.title).sort(), ["Chat en vivo", "Contratar el hosting"]);
    assert.ok(p.tasks.every((x) => !x.archivedAt || x.archivedFromColumnId === x.columnId));

    // Responsables: Ana existe (por nombre) y se asigna y se hace miembro; Luis no existe: a la descripción y a «sin emparejar».
    assert.equal(textos.assigneeId, ana.id);
    assert.deepEqual(p.members.map((m) => m.userId), [ana.id]);
    assert.match(textos.description, /Responsable en el archivo original: Luis Muestra\./);
    assert.deepEqual(s.unmappedUsers, [{ name: "Luis Muestra", email: "" }]);
    assert.equal(s.addedMembers, 1);
    assert.ok(s.warnings.some((w) => /archivos adjuntos subidos a Trello/.test(w)));
  });

  test("proyecto privado: solo se asigna quien importa; el nombre ya existente recibe «(importado)»", async () => {
    const admin = await makeUser({ role: "ADMIN", name: "Ana Ejemplo" });
    const other = await makeUser({ name: "Ana Ejemplo" }); // mismo nombre que otra persona: ambiguo, nunca se asigna
    const first = await importForeignFile(await file("t.json", trello), "trello", asImporter(admin), { isPrivate: true, t });
    const second = await importForeignFile(await file("t.json", trello), "trello", asImporter(admin), { isPrivate: true, t });
    assert.notEqual(first.name, second.name);
    assert.match(second.name, /\(importado\)/);
    const p = await load(first.projectId);
    assert.equal(p.isPrivate, true);
    assert.equal(p.privateOwnerId, admin.id);
    assert.deepEqual(p.members.map((m) => m.userId), [admin.id]);
    assert.ok(p.tasks.every((x) => x.assigneeId !== other.id));
    assert.equal(first.addedMembers, 0);
  });
});

describe("CSV", () => {
  test("columnas por estado en orden de aparición, etiquetas con color, responsable por email, prioridad activa el campo", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const dev = await makeUser({ name: "Dev Uno" });
    const text =
      "﻿Summary;Issue key;Status;Priority;Assignee;Due Date;Labels;Description\n" +
      `Arreglar login;PRJ-1;En curso;Highest;${dev.email.toUpperCase()};2026-12-01;auth, urgente;"Falla con ""SSO""\ny reinicios"\n` +
      "Escribir docs;PRJ-2;Por hacer;Low;nadie@example.com;;docs;\n" +
      "Otra más;PRJ-3;En curso;;;;auth;\n";
    const s = await importForeignFile(await file("plan q4.csv", text), "csv", asImporter(admin), { isPrivate: false, t, fileName: "plan q4" });
    assert.equal(s.source, "csv");
    const p = await load(s.projectId);
    assert.equal(p.name.startsWith("plan q4"), true);
    assert.deepEqual(p.columns.map((c) => c.name), ["En curso", "Por hacer"]);
    assert.deepEqual(p.taskFields, ["priority"]);
    assert.deepEqual([s.counts.tasks, s.counts.columns, s.counts.labels], [3, 2, 3]);
    assert.ok(p.labels.every((l) => /^#[0-9a-f]{6}$/.test(l.color)));
    const login = p.tasks.find((x) => x.title === "Arreglar login")!;
    assert.equal(login.priority, "URGENTE");
    assert.equal(login.assigneeId, dev.id);
    assert.equal(login.dueDate?.toISOString().slice(0, 10), "2026-12-01");
    assert.equal(login.description, 'Falla con "SSO"\ny reinicios\n\n_Referencia original: PRJ-1_');
    assert.deepEqual(login.labels.map((l) => l.label.name).sort(), ["auth", "urgente"]);
    const docs = p.tasks.find((x) => x.title === "Escribir docs")!;
    assert.equal(docs.assigneeId, null);
    assert.match(docs.description, /Responsable en el archivo original: nadie@example\.com\./);
    assert.deepEqual(s.unmappedUsers, [{ name: "nadie@example.com", email: "nadie@example.com" }]);
    assert.deepEqual(p.members.map((m) => m.userId), [dev.id]);
  });

  test("sin columna de estado: todo a la primera de las columnas por defecto", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const s = await importForeignFile(await file("t.csv", "title,notes\nA,uno\nB,dos\n"), "csv", asImporter(admin), { isPrivate: false, t, fileName: "simple" });
    const p = await load(s.projectId);
    assert.equal(p.columns.length, 5);
    assert.ok(p.tasks.every((x) => x.columnId === p.columns[0]!.id));
    assert.deepEqual(p.tasks.map((x) => x.title), ["A", "B"]);
    assert.deepEqual(p.taskFields, []);
  });

  test("más de 30 estados: error y no se crea nada (ni proyecto ni columnas)", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const before = await db.project.count();
    const csv = `title,status\n${Array.from({ length: 31 }, (_, i) => `T${i},E${i}`).join("\n")}`;
    await assert.rejects(importForeignFile(await file("t.csv", csv), "csv", asImporter(admin), { isPrivate: false, t }), /más de 30 columnas/);
    assert.equal(await db.project.count(), before);
  });

  test("el CSV con etiquetas por encima del tope de 50 las recorta con aviso y el resto se importa", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const csv = `title,labels\nA,"${Array.from({ length: 55 }, (_, i) => `L${i}`).join(",")}"\n`;
    const s = await importForeignFile(await file("t.csv", csv), "csv", asImporter(admin), { isPrivate: false, t });
    assert.equal(s.counts.labels, 50);
    assert.ok(s.warnings.some((w) => /5 etiquetas sobraban/.test(w)));
  });
});

describe("ruta de subida y trabajo en segundo plano", () => {
  const upload = (body: BodyInit, name: string, extra = "") =>
    new Request(`http://localhost/api/projects/import?private=0&name=${encodeURIComponent(name)}${extra}`, { method: "POST", body, headers: { origin: "http://localhost", host: "localhost" } });

  test("Trello JSON y CSV: el formato se reconoce por el contenido, se encola y el trabajo crea el proyecto", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    for (const [body, name, source] of [[trello, "board.json", "trello"], ["título,estado\nUna,Abierta\nDos,Cerrada\n", "tareas.csv", "csv"], ["title;status\nA;X\n", "sin-extension", "csv"]] as const) {
      const res = await importRoute(upload(body, name));
      assert.equal(res.status, 202);
      const { jobId } = await res.json();
      const job = await db.projectTransferJob.findUniqueOrThrow({ where: { id: jobId } });
      assert.equal((job.options as { format: string }).format, source);
      assert.equal(await runNextTransferJob(), jobId);
      const done = await db.projectTransferJob.findUniqueOrThrow({ where: { id: jobId } });
      assert.equal(done.status, "DONE", done.error ?? "");
      const summary = done.result as { source: string; projectId: string; name: string };
      assert.equal(summary.source, source);
      assert.equal(done.projectId, summary.projectId);
      if (source === "csv" && name === "tareas.csv") assert.ok(summary.name.startsWith("tareas"));
    }
    // El temporal se borra siempre.
    assert.deepEqual(await readdir(path.join(process.env.UPLOAD_DIR!, "imports")), []);
  });

  test("permisos y origen como la importación de Pizarro: sin sesión 401, miembro 403, sin Origin 403; el trabajo comprueba el rol", async () => {
    const member = await makeUser();
    logout();
    assert.equal((await importRoute(upload(trello, "b.json"))).status, 401);
    await loginAs(member);
    assert.equal((await importRoute(upload(trello, "b.json"))).status, 403);
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    assert.equal((await importRoute(new Request("http://localhost/api/projects/import?name=b.json", { method: "POST", body: trello, headers: { host: "localhost" } }))).status, 403);
    await assert.rejects(importForeignFile(await file("t.json", trello), "trello", asImporter(member), { isPrivate: true, t }), /No tienes permiso/);
  });

  test("archivos que no valen: binario, .json que no es JSON, CSV sin título, JSON/CSV por encima del tope; nada encolado", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const queued = () => db.projectTransferJob.count({ where: { userId: admin.id } });
    assert.equal(await queued(), 0);
    const reject = async (body: BodyInit, name: string, status: number, message: RegExp) => {
      const res = await importRoute(upload(body, name));
      assert.equal(res.status, status);
      assert.match((await res.json()).error, message);
    };
    await reject(new Uint8Array([0, 1, 2, 3, 255]), "a.csv", 400, /Formato de archivo no reconocido/);
    await reject("esto no es json", "a.json", 400, /Formato de archivo no reconocido/);
    await reject("a,b\n1,2\n", "a.csv", 400, /columna de título/);
    process.env.PROJECT_IMPORT_MAX_MB = "0.0001";
    try {
      await reject(trello, "a.json", 413, /tamaño máximo/);
    } finally {
      delete process.env.PROJECT_IMPORT_MAX_MB;
    }
    assert.equal(await queued(), 0);
    assert.deepEqual(await readdir(path.join(process.env.UPLOAD_DIR!, "imports")), []);
  });

  test("un JSON de Trello roto falla en el trabajo con un mensaje claro y sin crear proyecto", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const name = `Roto ${uniq()}`;
    const res = await importRoute(upload(JSON.stringify({ name, lists: "no", cards: [] }), "roto.json"));
    assert.equal(res.status, 202);
    const { jobId } = await res.json();
    assert.equal(await runNextTransferJob(), jobId);
    const done = await db.projectTransferJob.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(done.status, "FAILED");
    assert.match(done.error!, /no parece una exportación de un tablero de Trello/);
    assert.equal(await db.project.count({ where: { name } }), 0);
  });
});
