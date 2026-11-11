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
import { createProjectFromBoard, importForeignFile } from "../../src/lib/foreign-import/create";
import type { ForeignBoard } from "../../src/lib/foreign-import/types";
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

describe("Trello: comentarios por encima del tope", () => {
  test("una tarjeta con 230 comentarios guarda los 200 más recientes con su fecha original, y el aviso lo dice", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const at = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString();
    const actions = Array.from({ length: 230 }, (_, i) => ({ type: "commentCard", date: at(i), data: { text: `nota ${i}`, card: { id: "c1" } }, memberCreator: { fullName: "Ana" } })).reverse();
    const board = JSON.stringify({ name: `Muchos comentarios ${uniq()}`, lists: [{ id: "l1", name: "A", pos: 1 }], cards: [{ id: "c1", name: "Con charla", idList: "l1" }], actions });
    const s = await importForeignFile(await file("t.json", board), "trello", asImporter(admin), { isPrivate: true, t });
    assert.equal(s.counts.comments, 200);
    assert.ok(s.warnings.includes("30 comentarios antiguos no se han importado: de cada tarjeta con más de 200 se guardan los 200 más recientes."), s.warnings.join(" | "));
    const comments = (await load(s.projectId)).tasks[0]!.comments;
    assert.equal(comments.length, 200);
    assert.match(comments[0]!.body, /\n\nnota 30$/);
    assert.match(comments[199]!.body, /\n\nnota 229$/);
    assert.equal(comments[0]!.createdAt.toISOString(), at(30));
    assert.equal(comments[199]!.createdAt.toISOString(), at(229));
  });
});

describe("CSV", () => {
  test("columnas por estado en orden de aparición, etiquetas con color, responsable por email, prioridad activa el campo", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const dev = await makeUser({ name: "Dev Uno" });
    const text =
      "﻿Title;Task ID;Status;Priority;Assignee;Due Date;Tags;Notes\n" +
      `Arreglar login;T-1;En curso;Urgent;${dev.email.toUpperCase()};2026-12-01;auth, urgente;"Falla con ""SSO""\ny reinicios"\n` +
      "Escribir docs;T-2;Por hacer;Low;nadie@example.com;;docs;\n" +
      "Otra más;T-3;En curso;;;;auth;\n";
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
    assert.equal(login.description, 'Falla con "SSO"\ny reinicios\n\n_Referencia original: T-1_');
    assert.deepEqual(login.labels.map((l) => l.label.name).sort(), ["auth", "urgente"]);
    const docs = p.tasks.find((x) => x.title === "Escribir docs")!;
    assert.equal(docs.assigneeId, null);
    assert.match(docs.description, /Responsable en el archivo original: nadie@example\.com\./);
    // Solo con el email: sin nombre (el resumen no lo repite, «nadie@example.com · nadie@example.com»).
    assert.deepEqual(s.unmappedUsers, [{ name: "", email: "nadie@example.com" }]);
    assert.deepEqual(p.members.map((m) => m.userId), [dev.id]);
  });

  test("una columna terminada que aparece primero («Hecho») queda al final, marcada como terminada, con sus tareas", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const text = "título,estado\nPublicar,Hecho\nRedactar,Por hacer\nRevisar,En curso\nMaquetar,Por hacer\nCerrar contrato,Cerrado\n";
    const s = await importForeignFile(await file("t.csv", text), "csv", asImporter(admin), { isPrivate: false, t, fileName: "hecho primero" });
    const p = await load(s.projectId);
    assert.deepEqual(p.columns.map((c) => [c.name, c.isDone]), [["Por hacer", false], ["En curso", false], ["Hecho", true], ["Cerrado", true]]);
    const colName = new Map(p.columns.map((c) => [c.id, c.name]));
    assert.deepEqual(Object.fromEntries(p.tasks.map((x) => [x.title, colName.get(x.columnId)])), {
      Publicar: "Hecho", Redactar: "Por hacer", Revisar: "En curso", Maquetar: "Por hacer", "Cerrar contrato": "Cerrado",
    });
    const todo = p.tasks.filter((x) => colName.get(x.columnId) === "Por hacer").sort((a, b) => a.position - b.position);
    assert.deepEqual(todo.map((x) => x.title), ["Redactar", "Maquetar"]);
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
    const rows = Array.from({ length: 6 }, (_, r) => `T${r},"${Array.from({ length: 10 }, (_, i) => `L${r * 10 + i}`).join(",")}"`);
    const csv = `title,labels\n${rows.join("\n")}\n`;
    const s = await importForeignFile(await file("t.csv", csv), "csv", asImporter(admin), { isPrivate: false, t });
    assert.equal(s.counts.labels, 50);
    assert.ok(s.warnings.some((w) => /10 etiquetas sobraban/.test(w)));
  });

  test("más de 20 etiquetas en una tarea: se recortan a 20 con aviso y la tarea se puede editar (updateTask admite 20)", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const csv = `title,labels\nA,"${Array.from({ length: 30 }, (_, i) => `L${i}`).join(",")}"\nB,"L1,L2"\n`;
    const s = await importForeignFile(await file("t.csv", csv), "csv", asImporter(admin), { isPrivate: false, t });
    const p = await load(s.projectId);
    assert.deepEqual(p.tasks.map((x) => [x.title, x.labels.length]), [["A", 20], ["B", 2]]);
    assert.equal(p.labels.length, 20); // las 10 de más no llegan a crearse en el proyecto
    assert.ok(s.warnings.some((w) => /^10 etiquetas de tareas sobraban \(máximo 20 por tarea\)/.test(w)));
  });

  test("create.ts también recorta a 20 y limpia los nombres de responsables (un NUL no rompe la consulta)", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const board: ForeignBoard = {
      name: "Tablero a mano", description: "", columns: [], warnings: [],
      tasks: [{
        title: "A", description: "", column: null, archived: false, due: null, comments: [], subtasks: [], priority: null,
        labels: Array.from({ length: 25 }, (_, i) => ({ name: `E${i}`, color: null })),
        assignees: [{ email: null, name: `Nombre\u0000Raro ${"x".repeat(200)}` }, { email: "ana\u0000@example.com", name: null }],
      }],
    };
    const s = await createProjectFromBoard(board, "csv", asImporter(admin), { isPrivate: false, t });
    const p = await load(s.projectId);
    assert.equal(p.tasks[0]!.labels.length, 20);
    assert.ok(s.warnings.some((w) => /^5 etiquetas de tareas sobraban/.test(w)));
    assert.doesNotMatch(p.tasks[0]!.description, /\u0000/);
    assert.match(p.tasks[0]!.description, /Responsable en el archivo original: NombreRaro x+…\./);
    assert.ok(s.unmappedUsers.every((u) => u.name.length <= 80 && !/\u0000/.test(u.name + u.email)));
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

  test("JSON y CSV: tope de 25 MB (o PROJECT_IMPORT_MAX_MB si es menor) en la subida y en el trabajo; el ZIP de Pizarro no lo tiene", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const reject = async (body: BodyInit, name: string, status: number, message: RegExp) => {
      const res = await importRoute(upload(body, name));
      assert.equal(res.status, status);
      assert.match((await res.json()).error, message);
    };
    // Por la extensión (se corta al recibirlo) o, sin ella, al reconocer el contenido.
    const big = `title\n${"x".repeat(25 * 1024 * 1024)}\n`;
    await reject(big, "grande.csv", 413, /tamaño máximo para JSON y CSV \(25 MB\)/);
    await reject(big, "grande", 413, /tamaño máximo para JSON y CSV \(25 MB\)/);
    process.env.PROJECT_IMPORT_MAX_MB = "1";
    try {
      await reject(`title\n${"x".repeat(1024 * 1024)}\n`, "mediano.csv", 413, /tamaño máximo para JSON y CSV \(1 MB\)/);
    } finally {
      delete process.env.PROJECT_IMPORT_MAX_MB;
    }
    // 26 MB que no son un ZIP: pasa del tope de JSON y CSV pero no del de importación, así que se rechaza por no ser un ZIP, no por tamaño.
    await reject(new Uint8Array(26 * 1024 * 1024).fill(0x41), "grande.zip", 400, /no es un ZIP válido/);
    assert.equal(await db.projectTransferJob.count({ where: { userId: admin.id } }), 0);
    // El trabajo lo vuelve a comprobar (el archivo ya está en disco).
    await assert.rejects(importForeignFile(await file("grande.csv", big), "csv", asImporter(admin), { isPrivate: true, t }), /tamaño máximo para JSON y CSV \(25 MB\)/);
    process.env.PROJECT_IMPORT_MAX_MB = "1";
    try {
      await assert.rejects(importForeignFile(await file("m.csv", `title\n${"x".repeat(1024 * 1024)}\n`), "csv", asImporter(admin), { isPrivate: true, t }), /\(1 MB\)/);
    } finally {
      delete process.env.PROJECT_IMPORT_MAX_MB;
    }
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
