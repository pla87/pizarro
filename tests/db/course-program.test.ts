// Plantilla «Curso o máster» y columna «Programa» contra PostgreSQL real: crear el proyecto desde la plantilla (español e
// inglés), rol PROGRAM, PDF del programa por la ruta (orden, fechas, responsable, acceso) y copia en la Documentación
// con sus límites (cuota y tamaño máximo).
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { db, expectOk, loginAs, logout, makeProject, makeUser } from "./helpers";
import { pdfRuns } from "../pdf-runs";
import { createProject } from "../../src/actions/projects";
import { setColumnRole } from "../../src/actions/columns";
import { listTemplates } from "../../src/actions/templates";
import { createDocumentWithinLimit } from "../../src/lib/documents";
import { todayIso } from "../../src/lib/dates";
import { appTimeZone } from "../../src/lib/format";
import { resetRateLimit } from "../../src/lib/rate-limit";
import { stopPdfWorker } from "../../src/lib/report-render";
import { documentPath } from "../../src/lib/uploads";
import { seedBuiltinTemplates } from "../../src/lib/template-store";
import { GET as programGet, POST as programPost } from "../../src/app/api/projects/[projectId]/columns/[columnId]/program/route";

process.env.UPLOAD_DIR = await mkdtemp(path.join(tmpdir(), "pz-program-"));
const MB = 1024 * 1024;

after(() => stopPdfWorker());

const params = (projectId: string, columnId: string) => ({ params: Promise.resolve({ projectId, columnId }) });
const url = (projectId: string, columnId: string, query: string) => `http://localhost/api/projects/${projectId}/columns/${columnId}/program?${query}`;
const getReq = (p: string, c: string, q = "") => new Request(url(p, c, q));
const postReq = (p: string, c: string, q = "save=1", origin = true) =>
  new Request(url(p, c, q), { method: "POST", headers: origin ? { origin: "http://localhost", host: "localhost" } : { host: "localhost" } });
const text = async (res: Response) => pdfRuns(new Uint8Array(await res.arrayBuffer())).join("");

/** Proyecto creado desde la plantilla de serie «Curso o máster», con tres sesiones en «Programa». */
async function courseProject(user: { id: string }) {
  await db.projectTemplate.deleteMany({ where: { builtinKey: "curso-master" } });
  await db.builtinTemplateSeeded.deleteMany({ where: { key: "curso-master" } });
  await seedBuiltinTemplates(db);
  const tpl = expectOk(await listTemplates()).find((t) => t.builtinKey === "curso-master")!;
  const created = expectOk(await createProject(`Máster ${Date.now()}`, { templateId: tpl.id }));
  const program = await db.column.findFirstOrThrow({ where: { projectId: created.id, role: "PROGRAM" } });
  const session = await db.taskKind.findFirstOrThrow({ where: { projectId: created.id, name: "Sesión" } });
  const mk = (title: string, position: number, data: Record<string, unknown> = {}) =>
    db.task.create({ data: { projectId: created.id, columnId: program.id, kindId: session.id, title, position, ...data } });
  // Posiciones desordenadas respecto a la creación: el PDF sigue el orden de la columna.
  await mk("Sesión: Cierre", 3000);
  await mk("Sesión: Presentación", 1000, { dueDate: new Date("2027-01-12"), description: "**Objetivos:** conocer el curso.\n\n- Calendario\n- Evaluación", assigneeId: user.id });
  await mk("Sesión: Taller", 2000, { startDate: new Date("2027-01-18"), dueDate: new Date("2027-01-22") });
  await mk("Sesión archivada", 1500, { archivedAt: new Date() });
  return { projectId: created.id, programId: program.id };
}

describe("plantilla «Curso o máster»", () => {
  test("crea el proyecto con la columna Programa (rol PROGRAM), sus tipos, etiquetas y la fecha de inicio; en inglés, en inglés", async () => {
    await db.projectTemplate.deleteMany();
    await db.builtinTemplateSeeded.deleteMany();
    await seedBuiltinTemplates(db);
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    const tpl = expectOk(await listTemplates()).find((t) => t.builtinKey === "curso-master")!;
    assert.equal(tpl.name, "Curso o máster");
    assert.equal(tpl.builtinModified, false);
    const p = expectOk(await createProject("Máster de prueba", { templateId: tpl.id }));
    const cols = await db.column.findMany({ where: { projectId: p.id }, orderBy: { position: "asc" } });
    assert.deepEqual(cols.map((c) => [c.name, c.role, c.isDone]), [
      ["Ideas", "NONE", false], ["Materiales", "NONE", false], ["Ejercicios y exámenes", "NONE", false],
      ["Plan de trabajo para IA", "AI_PLAN", false], ["Programa", "PROGRAM", false], ["Seguimiento de alumnos", "NONE", false],
    ]);
    const kinds = await db.taskKind.findMany({ where: { projectId: p.id }, orderBy: { position: "asc" } });
    assert.deepEqual(kinds.map((k) => k.name), ["Sesión", "Preparar material", "Preparar ejercicio", "Preparar examen", "Revisar perfil de alumno", "Corregir", "Tutoría"]);
    assert.equal(kinds[1]!.titleTemplate, "Material:");
    assert.match(kinds[1]!.descriptionTemplate, /\*\*Notas para el agente:\*\*/);
    assert.deepEqual((await db.project.findUniqueOrThrow({ where: { id: p.id } })).taskFields, ["startDate"]);
    assert.ok((await db.label.findMany({ where: { projectId: p.id } })).some((l) => l.name === "Para el agente"));

    await db.user.update({ where: { id: admin.id }, data: { locale: "EN" } });
    await loginAs(admin);
    const en = expectOk(await listTemplates()).find((t) => t.builtinKey === "curso-master")!;
    assert.equal(en.name, "Course or master's");
    const pe = expectOk(await createProject("Test master", { templateId: en.id }));
    const colsEn = await db.column.findMany({ where: { projectId: pe.id }, orderBy: { position: "asc" } });
    assert.equal(colsEn.find((c) => c.role === "PROGRAM")!.name, "Programme");
    assert.equal(colsEn.find((c) => c.role === "AI_PLAN")!.name, "AI work plan");
    assert.deepEqual((await db.project.findUniqueOrThrow({ where: { id: pe.id } })).taskFields, ["startDate"]);
  });

  test("los campos de tarea cuentan en la huella: cambiarlos la marca como modificada", async () => {
    await db.projectTemplate.deleteMany();
    await db.builtinTemplateSeeded.deleteMany();
    await seedBuiltinTemplates(db);
    await loginAs(await makeUser({ role: "ADMIN" }));
    await db.projectTemplate.update({ where: { builtinKey: "curso-master" }, data: { taskFields: [] } });
    assert.equal(expectOk(await listTemplates()).find((t) => t.builtinKey === "curso-master")!.builtinModified, true);
    // Las que no tienen campos siguen sin modificar (su huella no cambia).
    assert.equal(expectOk(await listTemplates()).find((t) => t.builtinKey === "negocio")!.builtinModified, false);
  });
});

describe("Publicar programa (PDF)", () => {
  test("el PDF trae las sesiones no archivadas en el orden de la columna, con fecha, descripción y, si se pide, responsable", async () => {
    const admin = await makeUser({ role: "ADMIN", name: "Profesora Uno" });
    await loginAs(admin);
    resetRateLimit(`report:${admin.id}`);
    const { projectId, programId } = await courseProject(admin);
    const res = await programGet(getReq(projectId, programId), params(projectId, programId));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "application/pdf");
    assert.match(res.headers.get("Content-Disposition") ?? "", /^inline; filename="programa-master-/);
    const pdf = await text(res);
    const order = ["Sesión 1: Presentación", "Sesión 2: Taller", "Sesión 3: Cierre"].map((s) => pdf.indexOf(s));
    assert.ok(order.every((i) => i >= 0) && order[0]! < order[1]! && order[1]! < order[2]!, pdf.slice(0, 500));
    assert.ok(pdf.includes("martes, 12 de enero de 2027"));
    assert.ok(pdf.includes("18 de enero de 2027 – 22 de enero de 2027"));
    assert.ok(pdf.includes("Objetivos:") && pdf.includes("Calendario"));
    assert.ok(pdf.includes("Fecha por determinar"));
    assert.ok(!pdf.includes("archivada"));
    assert.ok(!pdf.includes("Profesora Uno"), "sin ?assignee=1 no sale el responsable");
    const withAssignee = await text(await programGet(getReq(projectId, programId, "assignee=1"), params(projectId, programId)));
    assert.ok(withAssignee.includes("Responsable: Profesora Uno"));
    // GET nunca guarda en la Documentación.
    assert.equal(await db.projectDocument.count({ where: { projectId } }), 0);
  });

  test("POST con save=1 lo devuelve para descargar y guarda «Programa – fecha.pdf» en la Documentación", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    resetRateLimit(`report:${admin.id}`);
    const { projectId, programId } = await courseProject(admin);
    const res = await programPost(postReq(projectId, programId), params(projectId, programId));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("Content-Disposition") ?? "", /^attachment;/);
    const name = `Programa – ${todayIso(appTimeZone())}.pdf`;
    assert.equal(decodeURIComponent(res.headers.get("X-Pizarro-Document-Name") ?? ""), name);
    assert.equal(res.headers.get("X-Pizarro-Document-Error"), null);
    const body = new Uint8Array(await res.arrayBuffer());
    const doc = await db.projectDocument.findUniqueOrThrow({ where: { id: res.headers.get("X-Pizarro-Document-Id")! } });
    assert.deepEqual([doc.projectId, doc.name, doc.kind, doc.mimeType, doc.size, doc.createdById], [projectId, name, "PDF", "application/pdf", body.length, admin.id]);
    assert.equal((await stat(documentPath(doc.id))).size, body.length);
    // Sin save=1, solo la descarga.
    const plain = await programPost(postReq(projectId, programId, "save=0"), params(projectId, programId));
    assert.equal(plain.status, 200);
    assert.equal(plain.headers.get("X-Pizarro-Document-Id"), null);
    assert.equal(await db.projectDocument.count({ where: { projectId } }), 1);
  });

  test("si no cabe en la cuota o pasa del tamaño máximo, se descarga igual y dice por qué no se guardó", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    resetRateLimit(`report:${admin.id}`);
    const { projectId, programId } = await courseProject(admin);
    const prev = process.env.UPLOAD_QUOTA_MB_PER_PROJECT;
    process.env.UPLOAD_QUOTA_MB_PER_PROJECT = "1";
    try {
      assert.equal((await createDocumentWithinLimit({ projectId, name: "lleno.bin", mimeType: "application/octet-stream", size: MB - 10, kind: "OTHER", createdById: admin.id })).ok, true);
      const res = await programPost(postReq(projectId, programId), params(projectId, programId));
      assert.equal(res.status, 200);
      assert.ok(pdfRuns(new Uint8Array(await res.arrayBuffer())).join("").includes("Sesión 1:"));
      assert.equal(res.headers.get("X-Pizarro-Document-Id"), null);
      assert.match(decodeURIComponent(res.headers.get("X-Pizarro-Document-Error") ?? ""), /Cuota de almacenamiento|cuota/i);
      assert.equal(await db.projectDocument.count({ where: { projectId } }), 1);
    } finally {
      if (prev === undefined) delete process.env.UPLOAD_QUOTA_MB_PER_PROJECT;
      else process.env.UPLOAD_QUOTA_MB_PER_PROJECT = prev;
    }
    const prevMax = process.env.MAX_UPLOAD_MB;
    process.env.MAX_UPLOAD_MB = "0.001";
    try {
      const res = await programPost(postReq(projectId, programId), params(projectId, programId));
      assert.equal(res.status, 200);
      assert.match(decodeURIComponent(res.headers.get("X-Pizarro-Document-Error") ?? ""), /tamaño máximo/);
    } finally {
      if (prevMax === undefined) delete process.env.MAX_UPLOAD_MB;
      else process.env.MAX_UPLOAD_MB = prevMax;
    }
  });

  test("acceso: sin sesión 401, ajeno 404, columna sin el rol 404 y POST de otro origen 403; el rol se asigna desde el menú", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    await loginAs(admin);
    resetRateLimit(`report:${admin.id}`);
    const { projectId, programId } = await courseProject(admin);
    const outsider = await makeUser();
    await loginAs(outsider);
    assert.equal((await programGet(getReq(projectId, programId), params(projectId, programId))).status, 404);
    assert.equal((await programPost(postReq(projectId, programId), params(projectId, programId))).status, 404);
    logout();
    assert.equal((await programGet(getReq(projectId, programId), params(projectId, programId))).status, 401);
    await loginAs(admin);
    assert.equal((await programPost(postReq(projectId, programId, "save=1", false), params(projectId, programId))).status, 403);
    const other = await db.column.findFirstOrThrow({ where: { projectId, name: "Ideas" } });
    assert.equal((await programGet(getReq(projectId, other.id), params(projectId, other.id))).status, 404);
    assert.equal(await db.projectDocument.count({ where: { projectId } }), 0);

    // Cualquier columna puede tener el rol (se repite) y entonces publica su programa.
    const f = await makeProject({ members: [admin] });
    expectOk(await setColumnRole(f.columns.todo, "PROGRAM"));
    expectOk(await setColumnRole(f.columns.doing, "PROGRAM"));
    assert.equal(await db.column.count({ where: { projectId: f.project.id, role: "PROGRAM" } }), 2);
    resetRateLimit(`report:${admin.id}`);
    const empty = await programGet(getReq(f.project.id, f.columns.todo), params(f.project.id, f.columns.todo));
    assert.equal(empty.status, 200);
    assert.ok((await text(empty)).includes("Aún no hay sesiones en esta columna."));
  });
});
