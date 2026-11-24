import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { inflateSync } from "node:zlib";
import { pdfSafeData, pdfSafeText, pdfWordParts, PDF_LONG_WORD } from "../src/lib/pdf-text";
import { buildReport, type ReportInput } from "../src/lib/report";
import { pdfRuns } from "./pdf-runs";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://none:none@localhost:5432/none";
const { renderInWorker, stopPdfWorker } = await import("../src/lib/report-render");
type PdfJob = import("../src/lib/report-pdf").PdfJob;

after(() => stopPdfWorker());

const LONG = "A".repeat(210);

describe("texto de los PDF (fuentes estándar, solo WinAnsi)", () => {
  test("quita los emojis sin dejar basura ni espacios dobles", () => {
    assert.equal(pdfSafeText("Fiesta 🎉 hecha"), "Fiesta hecha");
    assert.equal(pdfSafeText("ok😀"), "ok");
    assert.equal(pdfSafeText("👍🏽 bien"), "bien");
    assert.equal(pdfSafeText("Hecho 🎉"), "Hecho");
    assert.equal(pdfSafeText("Equipo 👨\u200d👩\u200d👧 🇪🇸 listo"), "Equipo listo");
    assert.equal(pdfSafeText("❤\ufe0f ✅"), "");
  });

  test("conserva todo lo que WinAnsi tiene y cambia el resto por algo legible", () => {
    const latin = "Año, pingüino, ¿qué? ¡Sí! € “comillas” «españolas» — – … © ® ™ ½ ß ø";
    assert.equal(pdfSafeText(latin), latin);
    assert.equal(pdfSafeText("a → b ≤ c"), "a -> b <= c");
    assert.equal(pdfSafeText("Łódź, Kraków, ā"), "?ódz, Kraków, a");
    assert.equal(pdfSafeText("Москва 東京"), "?????? ??");
    assert.equal(pdfSafeText("Promise<void> & a<b"), "Promise<void> & a<b");
  });

  test("pdfSafeData recorre objetos y listas y deja números y nulos", () => {
    assert.deepEqual(pdfSafeData({ a: "x 🎉", n: 3, z: null, l: [{ t: "😀y" }] }), { a: "x", n: 3, z: null, l: [{ t: "y" }] });
  });

  test("solo las palabras largas se pueden partir, en trozos", () => {
    assert.deepEqual(pdfWordParts("resumen"), ["resumen"]);
    assert.deepEqual(pdfWordParts("a".repeat(PDF_LONG_WORD)), ["a".repeat(PDF_LONG_WORD)]);
    const parts = pdfWordParts(LONG);
    assert.ok(parts.length > 1 && parts.every((p) => p.length <= 10));
    assert.equal(parts.join(""), LONG);
  });
});

describe("PDF generado", () => {
  test("plan de una persona: emojis fuera y el título largo partido en líneas que caben", async () => {
    const task = (title: string) => ({ title, kind: "Funcionalidad", priority: null, dueDate: null, summary: [], labels: [], pendingSubtasks: [], pendingCount: 0 });
    const job: PdfJob = {
      kind: "assignPlan",
      locale: "en",
      input: { project: "Proyecto", column: "De Ana", person: "Ana", today: "2026-11-02", groups: [{ bucket: "none", tasks: [task(LONG), task("Fiesta 🎉 hecha 😀 ok")] }], others: 0 },
    };
    const runs = pdfRuns(await renderInWorker(job));
    const text = runs.join("|");
    assert.match(text, /Fiesta hecha ok/);
    assert.doesNotMatch(text, /<‰|=\u0000/);
    const longLines = runs.filter((r) => r.startsWith("AAAA"));
    assert.ok(longLines.length >= 3, `el título largo debe ocupar varias líneas: ${JSON.stringify(longLines)}`);
    // Una línea de la página (523 pt a 10,5 pt en negrita) admite unas 69 «A».
    assert.ok(longLines.every((l) => l.replace(/-$/, "").length <= 69));
    assert.equal(longLines.map((l) => l.replace(/-$/, "")).join(""), LONG);
  });

  test("informe: cabeceras de «Carga por persona» traducidas y títulos largos dentro de la columna", async () => {
    const input: ReportInput = {
      project: { name: "P", description: "" },
      generatedBy: "Test",
      today: "2026-10-18",
      columns: [{ id: "todo", name: "Backlog", isDone: false }],
      kinds: ["Funcionalidad"],
      tasks: [
        { id: "a", title: LONG, kind: "Funcionalidad", columnId: "todo", assigneeName: "Ana", dueDate: "2026-10-15", deliverableId: null, subtaskTotal: 0, subtaskDone: 0 },
      ],
      deliverables: [],
      releases: [],
      archivedCount: 0,
    };
    const runs = pdfRuns(await renderInWorker({ kind: "report", locale: "en", input: buildReport(input) }));
    assert.ok(runs.includes("Assignee") && runs.includes("Pending") && runs.includes("Overdue"));
    assert.ok(!runs.includes("Pendientes") && !runs.includes("Vencidas"));
    // La columna «Tarea» de la tabla de pendientes (40 % de 523 pt, a 9 pt) admite unas 30 «A».
    const pieces = runs.filter((r) => r.startsWith("AAAA")).map((l) => l.replace(/-$/, ""));
    assert.ok(pieces.length > 0 && pieces.every((l) => l.length <= 30), JSON.stringify(pieces));
  });
});

describe("informe con más tareas de las que se listan", () => {
  // Los recuentos llegan de la BD sobre todas las tareas; el PDF dice cuántas salen en los listados.
  test("el resumen avisa de que se muestran las primeras y el avance es el de todas", async () => {
    const input: ReportInput = {
      project: { name: "P", description: "" },
      generatedBy: "Test",
      today: "2026-10-18",
      columns: [{ id: "todo", name: "Backlog", isDone: false }, { id: "done", name: "Hecho", isDone: true }],
      kinds: ["Funcionalidad"],
      tasks: [{ id: "a", title: "Una", kind: "Funcionalidad", columnId: "todo", assigneeName: "Ana", dueDate: null, deliverableId: null, subtaskTotal: 0, subtaskDone: 0 }],
      deliverables: [],
      releases: [],
      archivedCount: 0,
      counts: {
        rows: [
          { columnId: "todo", assigneeName: "Ana", kind: "Funcionalidad", count: 3000, overdue: 0, dueSoon: 0, withoutDue: 3000 },
          { columnId: "done", assigneeName: "Ana", kind: "Funcionalidad", count: 1000, overdue: 0, dueSoon: 0, withoutDue: 1000 },
        ],
        fixed: 0,
      },
    };
    const text = pdfRuns(await renderInWorker({ kind: "report", locale: "en", input: buildReport(input) })).join(" ").replace(/\s+/g, " ");
    assert.match(text, /The lists show the first 1 of 4,000 tasks; progress and counts include all of them\./, text);
    assert.match(text, /Progress: 25%/);
  });
});

describe("informe: números con el separador de miles del idioma", () => {
  // Como «… y 12.330 más» y el aviso de las primeras N: los indicadores, el avance y las cabeceras de columna también.
  const input: ReportInput = {
    project: { name: "P", description: "" },
    generatedBy: "Test",
    today: "2026-10-18",
    columns: [{ id: "todo", name: "Backlog", isDone: false }, { id: "done", name: "Hecho", isDone: true }],
    kinds: ["Funcionalidad"],
    tasks: [{ id: "a", title: "Una", kind: "Funcionalidad", columnId: "todo", assigneeName: "Ana", dueDate: null, deliverableId: null, subtaskTotal: 0, subtaskDone: 0 }],
    deliverables: [],
    releases: [],
    archivedCount: 0,
    counts: {
      rows: [
        { columnId: "todo", assigneeName: "Ana", kind: "Funcionalidad", count: 12345, overdue: 0, dueSoon: 0, withoutDue: 12345 },
        { columnId: "done", assigneeName: "Ana", kind: "Funcionalidad", count: 23456, overdue: 0, dueSoon: 0, withoutDue: 23456 },
      ],
      fixed: 0,
    },
  };
  const text = async (locale: "es" | "en") => pdfRuns(await renderInWorker({ kind: "report", locale, input: buildReport(input) })).join(" ").replace(/\s+/g, " ");

  test("en español, con punto", async () => {
    const es = await text("es");
    assert.match(es, /23\.456 de 35\.801 tarjetas terminadas/, es);
    assert.match(es, /Backlog · 12\.345/, es);
    assert.doesNotMatch(es, /12345|23456|35801/, es);
  });

  test("en inglés, con coma", async () => {
    const en = await text("en");
    assert.match(en, /23,456 of 35,801/, en);
    assert.match(en, /Backlog · 12,345/, en);
    assert.doesNotMatch(en, /12345|23456|35801/, en);
  });
});

describe("informe: etiquetas de estado de los entregables legibles (blanco sobre su color, 4,5:1 o más)", () => {
  /** Colores de relleno que fija el PDF (operador `scn` de @react-pdf), en hexadecimal. */
  const fills = (pdf: Uint8Array) => {
    const buf = Buffer.from(pdf);
    const raw = buf.toString("latin1");
    const out = new Set<string>();
    for (const m of raw.matchAll(/stream\r?\n/g)) {
      const start = m.index + m[0].length;
      let content: string;
      try {
        content = inflateSync(buf.subarray(start, raw.indexOf("endstream", start))).toString("latin1");
      } catch {
        continue;
      }
      for (const c of content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) scn\b/g)) out.add("#" + [c[1], c[2], c[3]].map((v) => Math.round(Number(v) * 255).toString(16).padStart(2, "0")).join(""));
    }
    return out;
  };

  test("«En riesgo» en ámbar 700 y «Sin tareas» en gris medio (antes 3,2:1 y 2,6:1)", async () => {
    const report = buildReport({
      project: { name: "P", description: "" },
      generatedBy: "Test",
      today: "2026-10-18",
      columns: [{ id: "todo", name: "Backlog", isDone: false }],
      kinds: ["Funcionalidad"],
      tasks: [{ id: "a", title: "Una", kind: "Funcionalidad", columnId: "todo", assigneeName: "Ana", dueDate: null, deliverableId: "d1", subtaskTotal: 0, subtaskDone: 0 }],
      deliverables: [{ id: "d1", name: "Beta", description: "", dueDate: "2026-10-20" }, { id: "d2", name: "Gamma", description: "", dueDate: "2026-10-30" }],
      releases: [],
      archivedCount: 0,
    });
    assert.deepEqual(report.deliverables.map((d) => d.status), ["En riesgo", "Sin tareas"]);
    const used = fills(await renderInWorker({ kind: "report", locale: "es", input: report }));
    assert.ok(used.has("#b45309") && used.has("#64748b"), `colores: ${[...used].join(" ")}`);
    assert.ok(!used.has("#d97706") && !used.has("#059669"), [...used].join(" "));
  });

  test("el pie (proyecto, fecha y página) en gris medio, no en #94a3b8 (2,6:1); los días que faltan, con separador de miles", async () => {
    const report = buildReport({
      project: { name: "P", description: "" },
      generatedBy: "Test",
      today: "2026-10-18",
      columns: [{ id: "todo", name: "Backlog", isDone: false }],
      kinds: ["Funcionalidad"],
      tasks: [],
      deliverables: [{ id: "d1", name: "Lejano", description: "", dueDate: "2030-03-05" }],
      releases: [],
      archivedCount: 0,
    });
    const pdf = await renderInWorker({ kind: "report", locale: "en", input: report });
    const used = fills(pdf);
    assert.ok(!used.has("#94a3b8"), [...used].join(" "));
    // En español, con cuatro cifras no se agrupa («1234»), como en el resto de la app; en inglés sí.
    const text = pdfRuns(pdf).join(" ").replace(/\s+/g, " ");
    assert.match(text, /\(in 1,234 d\)/, text);
  });
});
