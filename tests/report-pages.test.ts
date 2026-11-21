// Paginación de los PDF largos (src/lib/pdf-chunks.ts y pagedPdf en src/lib/report-pdf.tsx). Un documento largo va en
// tramos (varios <Page>) para que el tiempo crezca en línea y no con el cuadrado de su longitud; cada tramo se corta donde
// el documento entero saltaría de página, así que debe salir con las mismas páginas que en un solo <Page>.
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { pdfPageRuns } from "./pdf-runs";
import { assertFastAsync } from "./timing";
import { chunkBlocks, pickCut, textUnits, totalUnits } from "../src/lib/pdf-chunks";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://none:none@localhost:5432/none";
const { renderInWorker, stopPdfWorker } = await import("../src/lib/report-render");
const { buildReport } = await import("../src/lib/report");
type PdfJob = import("../src/lib/report-pdf").PdfJob;

after(() => stopPdfWorker());

const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua";
const words = (i: number, n: number) => lorem.split(" ").slice(0, 2 + ((i * 7) % n)).join(" ");

/** Texto de cada página del PDF. */
const pagesText = async (job: PdfJob) => pdfPageRuns(await renderInWorker(job)).map((runs) => runs.join(""));

/** El pie de cada página dice «N / total», seguidos. */
function assertFooters(pages: string[]) {
  pages.forEach((text, i) => assert.ok(text.includes(`${i + 1} / ${pages.length}`), `página ${i + 1}: falta «${i + 1} / ${pages.length}»`));
}

/**
 * El mismo documento en un solo <Page> (como antes) y en tramos (forzados con `singlePageUnits: 0`, para no necesitar
 * documentos de más de 20 páginas): mismas páginas con el mismo texto.
 */
async function assertSamePages(job: PdfJob, minPages: number) {
  const single = await pagesText({ ...job, singlePageUnits: Infinity });
  const chunked = await pagesText({ ...job, singlePageUnits: 0 });
  assert.ok(single.length >= minPages, `${single.length} páginas: el documento de la prueba debería ser más largo`);
  assert.equal(chunked.length, single.length);
  chunked.forEach((text, i) => assert.equal(text, single[i], `página ${i + 1} distinta`));
  assertFooters(chunked);
}

describe("pdf-chunks", () => {
  test("textUnits: líneas que ocupa un texto (al menos una por párrafo)", () => {
    assert.equal(textUnits("", 10), 1);
    assert.equal(textUnits("a".repeat(10), 10), 1);
    assert.equal(textUnits("a".repeat(25), 10), 3);
    assert.equal(textUnits("uno\n\ndos", 10), 3);
  });

  test("chunkBlocks: tramos de como mucho `max` unidades, un bloque mayor va solo en el suyo", () => {
    const blocks = [5, 5, 5, 20, 1, 1].map((units) => ({ units }));
    assert.deepEqual(chunkBlocks(blocks, 10).map((c) => c.map((b) => b.units)), [[5, 5], [5], [20], [1, 1]]);
    assert.equal(totalUnits(blocks), 37);
  });

  test("pickCut: la última página (sin la última de la ventana) que empieza con un bloque entero", () => {
    assert.equal(pickCut([[0, 1, 2], [3, 4], [5, 6], [7]]), 5);
    // La página 3 empieza con el resto del bloque 4 (partido): vale la 2, que empieza con el 3.
    assert.equal(pickCut([[0, 1, 2], [3, 4], [4, 5], [6]]), 3);
  });

  test("pickCut: si todas empiezan con el resto de un bloque partido, null (que crezca la ventana); con `unclean`, antes de ese bloque", () => {
    assert.equal(pickCut([[0, 1], [1, 2], [2, 3], [3, 4]]), null);
    assert.equal(pickCut([[0, 1], [1, 2], [2, 3], [3, 4]], { unclean: true }), 2);
    // -1: otro elemento del bloque anterior (un título y su tabla); al principio de página, es su continuación.
    assert.equal(pickCut([[0, -1], [-1, 1, -1], [-1, 2], [3]], { unclean: true }), 1);
    // Lo que pide ir con lo siguiente (un título) se va con el bloque partido; nunca se corta antes del primero.
    assert.equal(pickCut([[0, 1, 2, 3, 4], [4, 5], [5, 6], [7]], { unclean: true, keep: (b) => b === 3 || b === 4 }), 3);
    assert.equal(pickCut([[0, 1], [1, 2], [2, 3], [3, 4]], { unclean: true, keep: () => true }), 1);
  });

  test("pickCut: con menos de tres páginas, o un solo bloque, no corta (hace falta una ventana mayor)", () => {
    assert.equal(pickCut([[0, 1, 2]]), null);
    assert.equal(pickCut([[0, 1], [2]]), null);
    assert.equal(pickCut([[0], [0], [0], [0]]), null);
  });
});

describe("PDF largos en tramos: mismas páginas que en un solo <Page>", () => {
  test("lista consolidada (por tarjeta y por tipo)", async () => {
    const groups = Array.from({ length: 12 }, (_, g) => ({
      key: "g" + g, label: `Tarjeta ${g} ${words(g, 6)}`,
      items: Array.from({ length: 40 + (g % 30) }, (_, k) => ({ id: `s${g}-${k}`, title: `Subtarea ${k} ${words(g + k, 18)}`, done: (g + k) % 3 === 0, taskId: "t" + g, taskTitle: "Tarea " + g, kindId: "k", kindName: "K" })),
    }));
    await assertSamePages({ kind: "checklist", locale: "es", input: { project: "Proyecto", column: "Lista", today: "2026-11-20", by: "card", groups } }, 10);
    await assertSamePages({ kind: "checklist", locale: "es", input: { project: "Proyecto", column: "Lista", today: "2026-11-20", by: "kind", groups } }, 10);
  });

  test("informe del proyecto (tablas largas)", async () => {
    const columns = [{ id: "a", name: "Pendiente", isDone: false }, { id: "b", name: "En curso", isDone: false }, { id: "d", name: "Hecho", isDone: true }];
    const tasks = Array.from({ length: 300 }, (_, i) => ({
      id: "t" + i, title: `Tarea ${i} ${words(i, 18)}`, kind: ["Funcionalidad", "Error"][i % 2]!, columnId: columns[i % 3]!.id,
      assigneeName: i % 5 ? `Persona ${i % 6}` : null, dueDate: i % 4 ? `2026-${i % 2 ? "11" : "12"}-${String(1 + (i % 28)).padStart(2, "0")}` : null,
      deliverableId: null, subtaskTotal: i % 3, subtaskDone: i % 2, updatedAt: "2026-11-15T10:00:00.000Z", doneAt: null,
    }));
    const report = buildReport({ project: { name: "Proyecto", description: "" }, generatedBy: "Ana", today: "2026-11-20", columns, kinds: ["Funcionalidad", "Error"], tasks, deliverables: [], releases: [], archivedCount: 0 });
    await assertSamePages({ kind: "report", locale: "es", input: report }, 10);
  });

  test("resumen para el cliente (tarjetas)", async () => {
    const tasks = Array.from({ length: 160 }, (_, i) => ({
      title: `Entrega ${i} ${words(i, 15)}`, kind: "Funcionalidad", dueDate: i % 3 ? "2026-12-01" : null, subtaskTotal: i % 6,
      doneSubtasks: Array.from({ length: Math.floor((i % 6) / 2) }, (_, k) => `Subtarea ${k} ${words(i + k, 16)}`),
    }));
    await assertSamePages({ kind: "delivery", locale: "es", input: { project: "Proyecto", column: "Entrega", today: "2026-11-20", tasks } }, 10);
  });
});

describe("PDF largos en tramos", () => {
  test("programa de muchas sesiones: todas, en orden, y el pie numera sobre el total", async () => {
    const description = (i: number) => [`## Objetivos ${i}`, `${lorem}. **Negrita** y *cursiva*.`, "- uno\n- dos\n- tres", (lorem + ". ").repeat(1 + (i % 4))].join("\n\n");
    const sessions = Array.from({ length: 50 }, (_, i) => ({ n: i + 1, title: `Sesión de ${words(i, 6)}`, date: null, assignee: null, description: description(i) }));
    const job: PdfJob = { kind: "program", locale: "es", input: { project: "Curso", today: "2026-11-20", withAssignee: false, sessions } };
    await assertSamePages(job, 10);
    const pages = await pagesText({ ...job, singlePageUnits: 0 });
    const all = pages.join("\n");
    let from = 0;
    for (let n = 1; n <= sessions.length; n++) {
      const at = all.indexOf(`Sesión ${n}: `, from);
      assert.ok(at >= from, `falta la sesión ${n} (o no va en orden)`);
      from = at;
    }
  });

  test("programa: el número y el título de una sesión nunca se separan (antes el número se quedaba solo al pie)", async () => {
    const description = (i: number) => [`## Objetivos ${i}`, `${lorem}. **Negrita** y *cursiva*.`, "- uno\n- dos\n- tres", (lorem + ". ").repeat(1 + (i % 4))].join("\n\n");
    const sessions = Array.from({ length: 150 }, (_, i) => ({ n: i + 1, title: `Sesión de ${words(i, 6)}`, date: null, assignee: null, description: description(i) }));
    const job: PdfJob = { kind: "program", locale: "es", input: { project: "Curso", today: "2026-11-20", withAssignee: false, sessions } };
    for (const singlePageUnits of [undefined, Infinity]) {
      const pages = pdfPageRuns(await renderInWorker({ ...job, singlePageUnits }));
      let seen = 0;
      for (const runs of pages) {
        runs.forEach((run, k) => {
          const m = /^Sesión (\d+)$/.exec(run);
          if (!m) return;
          seen++;
          assert.equal(runs[k - 1], m[1], `«${run}» sin su número delante en la misma página`);
        });
      }
      assert.equal(seen, sessions.length);
    }
  });

  test("programa: una lista o un código enormes en una sesión no disparan el tiempo (se parten por elementos y por líneas)", async () => {
    // Antes, la ventana que se maqueta para cortar se doblaba una y otra vez sobre la misma lista (5.000 elementos: 372 s
    // y error 504); con esta, de 2.500, más de 100 s. Ahora, unos 12 s.
    const sessions = [
      { n: 1, title: "Lista", date: null, assignee: null, description: "- a\n".repeat(2499) + "- z" },
      { n: 2, title: "Código", date: null, assignee: null, description: "```\n" + Array.from({ length: 800 }, (_, k) => `linea ${k}`).join("\n") + "\n```" },
      ...Array.from({ length: 40 }, (_, i) => ({ n: i + 3, title: `Sesión ${words(i, 6)}`, date: null, assignee: null, description: (lorem + ". ").repeat(2) })),
    ];
    const pdf = await assertFastAsync(60_000, () => renderInWorker({ kind: "program", locale: "es", input: { project: "Curso", today: "2026-11-20", withAssignee: false, sessions } }), "programa con una lista de 2.500 elementos");
    const runs = pdfPageRuns(pdf);
    const pages = runs.map((r) => r.join(""));
    assertFooters(pages);
    const all = pages.join("\n");
    assert.ok(all.includes("linea 0") && all.includes("linea 799") && all.includes("Sesión 42: "));
    // Ninguna página casi vacía (el corte antes de un bloque enorme dejaba la cabecera de la sesión sola en una página).
    runs.slice(0, -1).forEach((r, i) => assert.ok(r.length > 30, `página ${i + 1} casi vacía: ${JSON.stringify(r)}`));
  });

  test("resumen para el cliente: una tarjeta con 100 subtareas se parte entre páginas (antes se aplastaba sobre la primera)", async () => {
    const subs = Array.from({ length: 100 }, (_, j) => `Subtarea hecha número ${j} con un texto razonablemente largo para ocupar casi una línea`);
    const pages = await pagesText({ kind: "delivery", locale: "es", input: { project: "P", column: "Entrega", today: "2026-11-20", tasks: [
      { title: "Corta", kind: "F", dueDate: null, subtaskTotal: 1, doneSubtasks: ["x"] },
      { title: "Larga", kind: "F", dueDate: null, subtaskTotal: 100, doneSubtasks: subs },
      { title: "Después", kind: "F", dueDate: null, subtaskTotal: 1, doneSubtasks: ["y"] },
    ] } });
    assert.equal(pages.length, 2);
    assertFooters(pages);
    assert.ok(pages[0]!.includes("Larga") && pages[0]!.includes("número 0 con"));
    assert.ok(!pages[0]!.includes("número 99 con") && pages[1]!.includes("número 99 con") && pages[1]!.includes("Después"));
    // Cada subtarea una sola vez y en orden.
    const all = pages.join("");
    let from = 0;
    for (let j = 0; j < 100; j++) {
      const at = all.indexOf(`número ${j} con`, from);
      assert.ok(at >= from, `subtarea ${j}`);
      from = at;
    }
  });

  test("una tarjeta corta que no cabe al pie pasa entera a la página siguiente (como siempre)", async () => {
    const tasks = Array.from({ length: 40 }, (_, i) => ({ title: `Tarjeta ${i}`, kind: "F", dueDate: null, subtaskTotal: 4, doneSubtasks: ["a", "b", "c", "d"].map((s) => `Sub ${s} de ${i}`) }));
    const pages = await pagesText({ kind: "delivery", locale: "es", input: { project: "P", column: "Entrega", today: "2026-11-20", tasks } });
    assert.ok(pages.length >= 2);
    for (let i = 0; i < tasks.length; i++) {
      const page = pages.findIndex((p) => p.includes(`Tarjeta ${i}F`));
      assert.ok(page >= 0, `tarjeta ${i}`);
      for (const s of ["a", "b", "c", "d"]) assert.ok(pages[page]!.includes(`Sub ${s} de ${i}`), `la tarjeta ${i} está partida`);
    }
  });
});
