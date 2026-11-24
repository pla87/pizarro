// Paginación de los PDF largos: la lista consolidada, el informe del proyecto y el plan de una persona en tramos salen
// con las mismas páginas que en un solo <Page>. Separadas de report-pages.test.ts para que corran en paralelo.
import { describe, test } from "node:test";
import { assertSamePages, words } from "./report-pages-helpers";

// Después de la ayuda, que fija las variables de entorno.
const { buildReport } = await import("../src/lib/report");

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

  test("plan de una persona (tarjetas)", async () => {
    const tasks = Array.from({ length: 160 }, (_, i) => ({
      title: `Tarea ${i} ${words(i, 15)}`, kind: "Funcionalidad", priority: null, dueDate: i % 3 ? "2026-12-01" : null, labels: [],
      summary: i % 4 ? [words(i, 18)] : [],
      pendingSubtasks: Array.from({ length: Math.floor((i % 6) / 2) }, (_, k) => `Subtarea ${k} ${words(i + k, 16)}`), pendingCount: Math.floor((i % 6) / 2),
    }));
    await assertSamePages({ kind: "assignPlan", locale: "es", input: { project: "Proyecto", column: "De Ana", person: "Ana", today: "2026-11-20", groups: [{ bucket: "later", tasks }], others: 0 } }, 10);
  });
});
