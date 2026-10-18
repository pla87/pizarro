import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReleaseMarkdown, formatReleaseLine, releaseFileName, swapTemplateBlock } from "../src/lib/release";

const kinds = [
  { id: "k1", name: "Funcionalidad" },
  { id: "k2", name: "Corrección" },
  { id: "k3", name: "Infraestructura" },
];

test("una sección por tipo, en el orden de los tipos, con cabecera y pie", () => {
  const md = buildReleaseMarkdown({
    header: "CABECERA",
    footer: "PIE",
    title: "Release X",
    kinds,
    tasks: [
      { title: "Fix 1", kindId: "k2" },
      { title: "Feat 1", kindId: "k1", linkUrl: "https://example.com/pr/1" },
      { title: "Infra 1", kindId: "k3" },
      { title: "Feat 2", kindId: "k1" },
    ],
  });
  const lines = md.trim().split("\n");
  assert.equal(lines[0], "CABECERA");
  assert.equal(lines.at(-1), "PIE");
  const idx = (s: string) => lines.indexOf(s);
  assert.ok(idx("### Funcionalidad") < idx("### Corrección") && idx("### Corrección") < idx("### Infraestructura"));
  assert.ok(idx("- Feat 1 ([enlace](<https://example.com/pr/1>))") < idx("- Feat 2"));
});

test("omite secciones vacías y plantillas vacías; tipos desconocidos van a «Otros»", () => {
  assert.equal(
    buildReleaseMarkdown({ header: "  ", footer: "", title: "R", kinds, tasks: [{ title: "Solo fix", kindId: "k2" }] }),
    "## R\n\n### Corrección\n- Solo fix\n",
  );
  assert.match(buildReleaseMarkdown({ header: "", footer: "", title: "R", kinds, tasks: [{ title: "x", kindId: "borrado" }] }), /### Otros\n- x/);
});

test("escapa corchetes y normaliza espacios del título", () => {
  assert.equal(formatReleaseLine({ title: "Arreglo [x]\n  en  modal" }), "- Arreglo \\[x\\] en modal");
});

test("cambiar de cabecera o pie en un texto ya editado", () => {
  const text = "CAB A\n\n## R\n\nnota mía\n\nPIE A\n";
  assert.equal(swapTemplateBlock(text, "CAB A", "CAB B", "start"), "CAB B\n\n## R\n\nnota mía\n\nPIE A\n");
  assert.equal(swapTemplateBlock(text, "PIE A", "PIE B", "end"), "CAB A\n\n## R\n\nnota mía\n\nPIE B\n");
  // Quitar la cabecera elimina también su línea en blanco.
  assert.equal(swapTemplateBlock(text, "CAB A", "", "start"), "## R\n\nnota mía\n\nPIE A\n");
  assert.equal(swapTemplateBlock(text, "PIE A", "", "end"), "CAB A\n\n## R\n\nnota mía\n");
  // Si el bloque anterior ya no está (lo editó el usuario), el nuevo se añade.
  assert.equal(swapTemplateBlock("## R\n", "CAB A", "CAB B", "start"), "CAB B\n\n## R\n");
  assert.equal(swapTemplateBlock("## R\n", "", "PIE B", "end"), "## R\n\nPIE B\n");
});

test("nombre de fichero con fecha local", () => {
  assert.equal(releaseFileName(new Date(2026, 0, 5, 23, 30), "md"), "release-2026-01-05.md");
  assert.equal(releaseFileName(new Date(2026, 11, 31), "txt"), "release-2026-12-31.txt");
});
