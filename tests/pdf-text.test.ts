import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { inflateSync } from "node:zlib";
import { pdfSafeData, pdfSafeText, pdfWordParts, PDF_LONG_WORD } from "../src/lib/pdf-text";
import { buildReport, type ReportInput } from "../src/lib/report";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://none:none@localhost:5432/none";
const { renderInWorker, stopPdfWorker } = await import("../src/lib/report-render");
type PdfJob = import("../src/lib/report-pdf").PdfJob;

after(() => stopPdfWorker());

/** Textos que pinta un PDF de @react-pdf: cada operador TJ (cadenas hexadecimales en WinAnsi) de los flujos comprimidos. */
function pdfRuns(pdf: Uint8Array): string[] {
  const buf = Buffer.from(pdf);
  const raw = buf.toString("latin1");
  const dec = new TextDecoder("windows-1252");
  const runs: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    let content: string;
    try {
      content = inflateSync(buf.subarray(start, raw.indexOf("endstream", start))).toString("latin1");
    } catch {
      continue;
    }
    for (const tj of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const hex = [...tj[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join("");
      runs.push(dec.decode(Buffer.from(hex, "hex")));
    }
  }
  return runs;
}

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
  test("entrega al cliente: emojis fuera y el título largo partido en líneas que caben", async () => {
    const job: PdfJob = {
      kind: "delivery",
      locale: "en",
      input: {
        project: "Proyecto",
        column: "Entrega",
        today: "2026-11-02",
        tasks: [
          { title: LONG, kind: "Funcionalidad", dueDate: null, subtaskTotal: 0, doneSubtasks: [] },
          { title: "Fiesta 🎉 hecha 😀 ok", kind: "Funcionalidad", dueDate: null, subtaskTotal: 0, doneSubtasks: [] },
        ],
      },
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
    assert.ok(runs.includes("Person") && runs.includes("Pending") && runs.includes("Overdue"));
    assert.ok(!runs.includes("Pendientes") && !runs.includes("Vencidas"));
    // La columna «Tarea» de la tabla de pendientes (40 % de 523 pt, a 9 pt) admite unas 30 «A».
    const pieces = runs.filter((r) => r.startsWith("AAAA")).map((l) => l.replace(/-$/, ""));
    assert.ok(pieces.length > 0 && pieces.every((l) => l.length <= 30), JSON.stringify(pieces));
  });
});
