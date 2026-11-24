// Paginación de los PDF largos (src/lib/pdf-chunks.ts y pagedPdf en src/lib/report-pdf.tsx). Un documento largo va en
// tramos (varios <Page>) para que el tiempo crezca en línea y no con el cuadrado de su longitud; cada tramo se corta donde
// el documento entero saltaría de página, así que debe salir con las mismas páginas que en un solo <Page>.
// Las pruebas de «mismas páginas» de la lista, el informe y el resumen están en report-pages-iguales.test.ts (en paralelo).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pdfPageRuns } from "./pdf-runs";
import { assertFooters, assertSamePages, lorem, pagesText, renderInWorker, words, type PdfJob } from "./report-pages-helpers";
import { assertFastAsync } from "./timing";
import { chunkBlocks, pickCut, textUnits, totalUnits } from "../src/lib/pdf-chunks";

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

describe("PDF largos en tramos", () => {
  test("programa de muchas sesiones: todas, en orden, y el pie numera sobre el total", async () => {
    const description = (i: number) => [`## Objetivos ${i}`, `${lorem}. **Negrita** y *cursiva*.`, "- uno\n- dos\n- tres", (lorem + ". ").repeat(1 + (i % 4))].join("\n\n");
    const sessions = Array.from({ length: 50 }, (_, i) => ({ n: i + 1, title: `Sesión de ${words(i, 6)}`, date: null, assignee: null, description: description(i) }));
    const job: PdfJob = { kind: "program", locale: "es", input: { project: "Curso", today: "2026-11-20", withAssignee: false, sessions } };
    const pages = await assertSamePages(job, 10);
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
