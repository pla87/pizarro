import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { makeT } from "../src/i18n/core";
import { buildProgramSessions, programBlocks, programDateLabel, programDocumentName } from "../src/lib/course-program";
import { markdownToPdfBlocks } from "../src/lib/pdf-markdown";
import { canonicalTemplate } from "../src/lib/builtin-templates";
import { canonicalTemplateEn } from "../src/lib/builtin-templates-en";
import { COLUMN_ROLE_HINT, COLUMN_ROLE_LABEL, COLUMN_ROLES, isUniqueColumnRole } from "../src/lib/constants";
import { columnAtSessionLimit, PROGRAM_MAX_SESSIONS, programColumnsOverLimit } from "../src/lib/program-limit";
import { pdfRuns } from "./pdf-runs";
import { assertFast } from "./timing";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://none:none@localhost:5432/none";
const { renderInWorker, stopPdfWorker } = await import("../src/lib/report-render");

after(() => stopPdfWorker());

const es = makeT("es");
const en = makeT("en");

describe("Markdown de la descripción → bloques del PDF", () => {
  test("párrafos con negrita, cursiva, tachado, subrayado, código y enlaces seguros", () => {
    const [p] = markdownToPdfBlocks("**Objetivo:** ver *esto*, ~~aquello~~, ++subrayado++, `a<b`, [web](https://example.com) y [mal](javascript:alert(1))");
    assert.deepEqual(p, {
      t: "p",
      runs: [
        { text: "Objetivo:", b: true },
        { text: " ver " },
        { text: "esto", i: true },
        { text: ", " },
        { text: "aquello", s: true },
        { text: ", " },
        { text: "subrayado", u: true },
        { text: ", " },
        { text: "a<b", code: true },
        { text: ", " },
        { text: "web", href: "https://example.com" },
        { text: " y mal" },
      ],
    });
  });

  test("títulos, listas (numeradas, de tareas y anidadas), citas, código, tablas y separadores", () => {
    const blocks = markdownToPdfBlocks("## Temario\n\n3. Uno\n4. Dos\n\n- [x] Hecho\n- [ ] Pendiente\n  - Dentro\n\n> Cita\n\n```\nx = 1\n```\n\n| A | B |\n|---|---|\n| 1 | **2** |\n\n---");
    assert.deepEqual(blocks.map((b) => b.t), ["h", "list", "list", "quote", "code", "table", "hr"]);
    assert.deepEqual(blocks[0], { t: "h", level: 2, runs: [{ text: "Temario" }] });
    const ordered = blocks[1] as Extract<(typeof blocks)[number], { t: "list" }>;
    assert.equal(ordered.ordered, true);
    assert.equal(ordered.start, 3);
    const tasks = blocks[2] as Extract<(typeof blocks)[number], { t: "list" }>;
    assert.deepEqual(tasks.items.map((i) => i.checked), [true, false]);
    assert.equal(tasks.items[1]!.blocks[1]!.t, "list");
    assert.deepEqual(blocks[4], { t: "code", text: "x = 1" });
    assert.deepEqual(blocks[5], { t: "table", header: [[{ text: "A" }], [{ text: "B" }]], rows: [[[{ text: "1" }], [{ text: "2", b: true }]]] });
  });

  test("entidades del editor, menciones, imágenes y HTML como texto; vacío sin bloques", () => {
    const [p] = markdownToPdfBlocks("Tú &amp; yo con @[Ana](user:abc123) ![plano](/api/attachments/x) <b>no</b>");
    assert.equal(p!.t, "p");
    const text = (p as { runs: { text: string }[] }).runs.map((r) => r.text).join("");
    assert.equal(text, "Tú & yo con @Ana [plano] <b>no</b>");
    assert.deepEqual(markdownToPdfBlocks("   \n&nbsp;"), []);
  });

  test("anidamiento muy profundo: se aplana a partir de cierto nivel sin perder el texto", () => {
    const md = Array.from({ length: 12 }, (_, i) => `${"  ".repeat(i)}- nivel ${i}`).join("\n");
    const json = JSON.stringify(markdownToPdfBlocks(md));
    for (let i = 0; i < 12; i++) assert.ok(json.includes(`nivel ${i}`), `nivel ${i}`);
  });
});

describe("sesiones del programa", () => {
  test("fecha: un día con el día de la semana, rango inicio–fin, solo inicio, sin fecha e inicio incoherente", () => {
    assert.equal(programDateLabel(null, "2027-01-12", "es-ES", es), "martes, 12 de enero de 2027");
    assert.equal(programDateLabel("2027-01-18", "2027-01-22", "es-ES", es), "18 de enero de 2027 – 22 de enero de 2027");
    assert.equal(programDateLabel("2027-01-18", null, "es-ES", es), "Desde el lunes, 18 de enero de 2027");
    assert.equal(programDateLabel(null, null, "es-ES", es), null);
    assert.equal(programDateLabel("2027-01-30", "2027-01-22", "es-ES", es), "viernes, 22 de enero de 2027");
    assert.equal(programDateLabel("2027-01-22", "2027-01-22", "es-ES", es), "viernes, 22 de enero de 2027");
    assert.equal(programDateLabel(null, "2027-01-12", "en-GB", en), "Tuesday, 12 January 2027");
    assert.equal(programDateLabel("2027-01-18", null, "en-GB", en), "From Monday, 18 January 2027");
  });

  test("numeradas en el orden recibido; responsable solo si se pide; fecha de inicio solo si el proyecto la usa", () => {
    const tasks = [
      { title: "Uno con @[Ana](user:abc)", description: "**Hola**", startDate: "2027-01-10", dueDate: "2027-01-12", assignee: "Ana" },
      { title: "Dos", description: "", startDate: null, dueDate: null, assignee: null },
    ];
    const a = buildProgramSessions(tasks, { locale: "es-ES", t: es, withAssignee: true, useStartDate: true });
    assert.deepEqual(a.map((s) => [s.n, s.title, s.assignee]), [[1, "Uno con Ana", "Ana"], [2, "Dos", null]]);
    assert.equal(a[0]!.date, "10 de enero de 2027 – 12 de enero de 2027");
    // El Markdown va tal cual; los bloques los hace el worker de PDF (programBlocks).
    assert.deepEqual(a.map((s) => s.description), ["**Hola**", ""]);
    const doc = programBlocks({ project: "P", today: "2026-11-13", withAssignee: true, sessions: a });
    assert.deepEqual(doc.sessions[0]!.blocks, [{ t: "p", runs: [{ text: "Hola", b: true }] }]);
    assert.deepEqual(doc.sessions[1]!.blocks, []);
    assert.equal(doc.sessions[0]!.title, "Uno con Ana");
    const b = buildProgramSessions(tasks, { locale: "es-ES", t: es, withAssignee: false, useStartDate: false });
    assert.equal(b[0]!.assignee, null);
    assert.equal(b[0]!.date, "martes, 12 de enero de 2027");
  });

  test("preparar el programa en el proceso web no analiza el Markdown (2000 sesiones de 20.000 caracteres, al momento)", () => {
    // Antes se convertía aquí cada descripción en bloques: unos 13 s de CPU en el hilo del servidor (y ~190 MB de bloques
    // que copiar al worker) con una columna de 2000 tarjetas largas, cualquiera con acceso al proyecto.
    const para = "Texto **negrita** con [enlace](https://example.com).\n\n- uno\n- dos\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n";
    const description = para.repeat(Math.ceil(20_000 / para.length)).slice(0, 20_000);
    const tasks = Array.from({ length: 2000 }, (_, i) => ({ title: `Sesión ${i}`, description, startDate: null, dueDate: "2027-01-12", assignee: null }));
    const out = assertFast(500, () => buildProgramSessions(tasks, { locale: "es-ES", t: es, withAssignee: false, useStartDate: false }), "preparar el programa");
    assert.equal(out.length, 2000);
  });

  test("nombre del documento guardado en Documentación, con la versión, en cada idioma", () => {
    assert.equal(programDocumentName(es, "2026-11-13", 1), "Programa – 2026-11-13_v1.pdf");
    assert.equal(programDocumentName(en, "2026-11-13", 12), "Programme – 2026-11-13_v12.pdf");
  });

  test("tope de sesiones de una columna «Programa»: solo PROGRAM, contando las no archivadas", () => {
    assert.equal(PROGRAM_MAX_SESSIONS, 100);
    assert.equal(columnAtSessionLimit("PROGRAM", 99), false);
    assert.equal(columnAtSessionLimit("PROGRAM", 100), true);
    assert.equal(columnAtSessionLimit("PROGRAM", 130), true);
    assert.equal(columnAtSessionLimit("NONE", 500), false);
    const columns = [{ ref: "a", role: "PROGRAM", name: "A" }, { ref: "b", role: "NONE", name: "B" }, { ref: "c", role: "PROGRAM", name: "C" }];
    const tasks = (ref: string, n: number, archived = false) => Array.from({ length: n }, () => ({ columnRef: ref, archivedAt: archived ? "2026-01-01T00:00:00.000Z" : null }));
    // 100 activas y 40 archivadas: cabe. 101 activas: no. Otro rol: sin tope.
    assert.deepEqual(programColumnsOverLimit(columns, [...tasks("a", 100), ...tasks("a", 40, true), ...tasks("b", 300)]), []);
    assert.deepEqual(programColumnsOverLimit(columns, [...tasks("a", 101), ...tasks("c", 150)]).map((x) => [x.column.ref, x.sessions]), [["a", 101], ["c", 150]]);
  });

  test("rol PROGRAM: repetible, con nombre y explicación", () => {
    assert.ok(COLUMN_ROLES.includes("PROGRAM"));
    assert.equal(isUniqueColumnRole("PROGRAM"), false);
    for (const r of COLUMN_ROLES) assert.ok(COLUMN_ROLE_LABEL[r] && COLUMN_ROLE_HINT[r], r);
  });
});

describe("plantilla «Curso o máster»", () => {
  test("columnas con «Plan de trabajo para IA» (AI_PLAN) y «Programa» (PROGRAM), sin «Hecho», tipos con encargo para el agente, sin releases y con fecha de inicio", () => {
    for (const t of [canonicalTemplate("curso-master")!, canonicalTemplateEn("curso-master")!]) {
      assert.equal(t.columns.length, 6);
      assert.deepEqual(t.columns.filter((c) => c.role !== "NONE").map((c) => c.role), ["AI_PLAN", "PROGRAM"]);
      assert.equal(t.columns.filter((c) => c.isDone).length, 0);
      assert.equal(t.kinds.length, 7);
      assert.deepEqual(t.taskFields, ["startDate"]);
      assert.deepEqual(t.releaseTemplates, []);
      assert.equal(t.hideAllGeneralKinds, true);
    }
    const es = canonicalTemplate("curso-master")!;
    assert.deepEqual(es.columns.map((c) => c.name), ["Ideas", "Materiales", "Ejercicios y exámenes", "Plan de trabajo para IA", "Programa", "Seguimiento de alumnos"]);
    assert.deepEqual(canonicalTemplateEn("curso-master")!.columns.map((c) => c.name), ["Ideas", "Materials", "Exercises and exams", "AI work plan", "Programme", "Student follow-up"]);
    assert.deepEqual(es.kinds.map((k) => k.name), ["Sesión", "Preparar material", "Preparar ejercicio", "Preparar examen", "Revisar perfil de alumno", "Corregir", "Tutoría"]);
    // Los encargos de preparación llevan formato de entrega y notas para el agente; la sesión (sale en el PDF), no.
    for (const name of ["Preparar material", "Preparar ejercicio", "Preparar examen"]) {
      const k = es.kinds.find((x) => x.name === name)!;
      assert.match(k.descriptionTemplate, /\*\*Objetivo/);
      assert.match(k.descriptionTemplate, /\*\*(Formato de entrega|Tipo y formato):\*\*/);
      assert.match(k.descriptionTemplate, /\*\*Notas para el agente:\*\*/);
      assert.ok(k.titleTemplate.length > 0);
    }
    assert.doesNotMatch(es.kinds[0]!.descriptionTemplate, /agente/);
    // Sin datos personales de alumnos: solo marcadores.
    assert.ok(es.kinds.filter((k) => /Alumno/.test(k.descriptionTemplate)).every((k) => /\[nombre o referencia\]/.test(k.descriptionTemplate)));
  });
});

describe("PDF del programa", () => {
  const sessions = (t: typeof es, locale: string) =>
    buildProgramSessions(
      [
        { title: "Presentación 🎓", description: "**Objetivos:** conocer el curso.\n\n- Calendario\n- Evaluación", startDate: null, dueDate: "2027-01-12", assignee: "Profesora Uno" },
        { title: "Taller", description: "| Bloque | Min |\n|---|---|\n| Teoría | 30 |", startDate: "2027-01-18", dueDate: "2027-01-22", assignee: null },
        { title: "Cierre", description: "", startDate: null, dueDate: null, assignee: null },
      ],
      { locale, t, withAssignee: true, useStartDate: true },
    );

  test("en español: título, número, fecha, título de la sesión, descripción y responsable", async () => {
    const pdf = await renderInWorker({ kind: "program", locale: "es", input: { project: "Máster de prueba", today: "2026-11-13", withAssignee: true, sessions: sessions(es, "es-ES") } });
    const text = pdfRuns(pdf).join("");
    for (const s of ["PROGRAMA DEL CURSO", "Máster de prueba", "3 sesiones", "Sesión 1: Presentación", "martes, 12 de enero de 2027", "Profesora Uno", "Objetivos:", "Calendario", "Sesión 2: Taller", "18 de enero de 2027 – 22 de enero de 2027", "Teoría", "Sesión 3: Cierre", "Fecha por determinar"]) {
      assert.ok(text.includes(s), `falta «${s}» en ${text.slice(0, 400)}`);
    }
    // El orden del PDF es el de la columna.
    assert.ok(text.indexOf("Sesión 1:") < text.indexOf("Sesión 2:") && text.indexOf("Sesión 2:") < text.indexOf("Sesión 3:"));
    assert.ok(!text.includes("🎓"));
  });

  test("en inglés", async () => {
    const pdf = await renderInWorker({ kind: "program", locale: "en", input: { project: "Test master", today: "2026-11-13", withAssignee: false, sessions: sessions(en, "en-GB").map((s) => ({ ...s, assignee: null })) } });
    const text = pdfRuns(pdf).join("");
    for (const s of ["COURSE PROGRAMME", "3 sessions", "Session 1: Presentación", "Tuesday, 12 January 2027", "Date to be confirmed"]) assert.ok(text.includes(s), `falta «${s}»`);
    assert.ok(!text.includes("Profesora Uno"));
  });

  test("sin sesiones: el PDF lo dice", async () => {
    const pdf = await renderInWorker({ kind: "program", locale: "es", input: { project: "Vacío", today: "2026-11-13", withAssignee: false, sessions: [] } });
    assert.ok(pdfRuns(pdf).join("").includes("Aún no hay sesiones en esta columna."));
  });
});

test("título de la sesión: quita el comienzo automático de su tipo, salvo que lo deje vacío", async () => {
  const { sessionTitle } = await import("../src/lib/course-program");
  assert.equal(sessionTitle("Sesión: Fundamentos", "Sesión: "), "Fundamentos");
  assert.equal(sessionTitle("Sesión: ", "Sesión: "), "Sesión: ");
  assert.equal(sessionTitle("Repaso", "Sesión: "), "Repaso");
  assert.equal(sessionTitle("Session: Intro", ""), "Session: Intro");
});
