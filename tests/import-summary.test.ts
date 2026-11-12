// Resumen de una importación: cada número en singular o plural y las piezas sin nada, fuera.
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeT } from "../src/i18n/core";
import { importSummaryItems } from "../src/lib/import-summary";

const zero = { columns: 0, tasks: 0, archivedTasks: 0, comments: 0, taskAttachments: 0, releaseAttachments: 0, releases: 0, documents: 0 };

test("exportación de Pizarro: «1 comentario» (antes «1 comentarios») y en plural a partir de 2", () => {
  const es = makeT("es");
  assert.equal(
    importSummaryItems({ ...zero, tasks: 1, columns: 1, comments: 1, taskAttachments: 1, releases: 1, documents: 1 }, false, es, "es-ES"),
    "1 tarjeta, 1 columna, 1 comentario, 1 adjunto, 1 release y 1 documento",
  );
  assert.equal(
    importSummaryItems({ ...zero, tasks: 5, archivedTasks: 2, columns: 4, comments: 3, taskAttachments: 2, releaseAttachments: 1, releases: 2, documents: 2 }, false, es, "es-ES"),
    "5 tarjetas (2 archivadas), 4 columnas, 3 comentarios, 3 adjuntos, 2 releases y 2 documentos",
  );
  // Lo que no hay no se enumera («0 adjuntos, 0 releases»).
  assert.equal(importSummaryItems({ ...zero, tasks: 3, archivedTasks: 1, columns: 2 }, false, es, "es-ES"), "3 tarjetas (1 archivada) y 2 columnas");
});

test("Trello y CSV: columnas, tareas, subtareas, etiquetas y comentarios; en inglés con su propia lista", () => {
  const c = { ...zero, columns: 1, tasks: 1, subtasks: 1, labels: 2, comments: 1 };
  assert.equal(importSummaryItems(c, true, makeT("es"), "es-ES"), "1 columna, 1 tarea, 1 subtarea, 2 etiquetas y 1 comentario");
  assert.equal(importSummaryItems(c, true, makeT("en"), "en-GB"), "1 column, 1 task, 1 subtask, 2 labels and 1 comment");
});
