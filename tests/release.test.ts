import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachmentFileNames,
  buildReleaseMarkdown,
  computeReleaseCodes,
  defaultReleaseTitle,
  formatReleaseLine,
  releaseFileName,
  releaseZipName,
  swapTemplateBlock,
  zonedDayRange,
} from "../src/lib/release";

const kinds = [
  { id: "k1", name: "Funcionalidad" },
  { id: "k2", name: "Corrección" },
  { id: "k3", name: "Infraestructura" },
];

test("una sección por tipo, en el orden de los tipos, con cabecera y pie", () => {
  const md = buildReleaseMarkdown({
    header: "CABECERA",
    footer: "PIE",
    kinds,
    tasks: [
      { id: "t1", title: "Fix 1", kindId: "k2" },
      { id: "t2", title: "Feat 1", kindId: "k1", linkUrl: "https://example.com/pr/1" },
      { id: "t3", title: "Infra 1", kindId: "k3" },
      { id: "t4", title: "Feat 2", kindId: "k1" },
    ],
  });
  const lines = md.trim().split("\n");
  // Orden: cabecera, secciones, pie (sin título).
  assert.equal(lines[0], "CABECERA");
  assert.ok(!/^## /m.test(md));
  assert.equal(lines.at(-1), "PIE");
  const idx = (s: string) => lines.indexOf(s);
  assert.ok(idx("### Funcionalidad") < idx("### Corrección") && idx("### Corrección") < idx("### Infraestructura"));
  assert.ok(idx("- **F1** · Feat 1 ([enlace](<https://example.com/pr/1>))") < idx("- **F2** · Feat 2"));
});

test("omite secciones vacías y plantillas vacías; tipos desconocidos van a «Otros»", () => {
  assert.equal(
    buildReleaseMarkdown({ header: "  ", footer: "", kinds, tasks: [{ id: "a", title: "Solo fix", kindId: "k2" }] }),
    "### Corrección\n- **C1** · Solo fix\n",
  );
  assert.match(buildReleaseMarkdown({ header: "", footer: "", kinds, tasks: [{ id: "a", title: "x", kindId: "borrado" }] }), /### Otros\n- \*\*O1\*\* · x/);
});

test("escapa corchetes y normaliza espacios del título", () => {
  assert.equal(formatReleaseLine({ title: "Arreglo [x]\n  en  modal" }), "- Arreglo \\[x\\] en modal");
});

test("cambiar de cabecera o pie en un texto ya editado", () => {
  const text = "CAB A\n\nnota mía\n\nPIE A\n";
  assert.equal(swapTemplateBlock(text, "CAB A", "CAB B", "start"), "CAB B\n\nnota mía\n\nPIE A\n");
  assert.equal(swapTemplateBlock(text, "PIE A", "PIE B", "end"), "CAB A\n\nnota mía\n\nPIE B\n");
  // Quitar la cabecera no deja líneas en blanco al principio.
  assert.equal(swapTemplateBlock(text, "CAB A", "", "start"), "nota mía\n\nPIE A\n");
  assert.equal(swapTemplateBlock(text, "PIE A", "", "end"), "CAB A\n\nnota mía\n");
  // Si no hay cabecera previa (o el usuario la editó), la nueva va al principio del texto.
  assert.equal(swapTemplateBlock("### Fun\n- x\n", "", "CAB B", "start"), "CAB B\n\n### Fun\n- x\n");
  assert.equal(swapTemplateBlock("\n\n### Fun\n", "CAB A", "CAB B", "start"), "CAB B\n\n### Fun\n");
  assert.equal(swapTemplateBlock("", "", "CAB B", "start"), "CAB B\n");
  assert.equal(swapTemplateBlock("### Fun\n", "", "PIE B", "end"), "### Fun\n\nPIE B\n");
});

test("título por defecto con ordinal si ya hay releases ese día", () => {
  assert.equal(defaultReleaseTitle("2026-10-18", "Proyecto"), "Release 2026-10-18 · Proyecto");
  assert.equal(defaultReleaseTitle("2026-10-18", "Proyecto", 0), "Release 2026-10-18 · Proyecto");
  assert.equal(defaultReleaseTitle("2026-10-18", "Proyecto", 1), "Release 2026-10-18 (2) · Proyecto");
  assert.equal(defaultReleaseTitle("2026-10-18", "Proyecto", 2), "Release 2026-10-18 (3) · Proyecto");
});

test("rango del día local en una zona horaria", () => {
  // Madrid en octubre: CEST (UTC+2).
  const r = zonedDayRange("2026-10-18", "Europe/Madrid");
  assert.equal(r.start.toISOString(), "2026-10-17T22:00:00.000Z");
  assert.equal(r.end.toISOString(), "2026-10-18T22:00:00.000Z");
  // Día del cambio a horario de invierno: dura 25 h.
  const dst = zonedDayRange("2026-10-25", "Europe/Madrid");
  assert.equal(dst.start.toISOString(), "2026-10-24T22:00:00.000Z");
  assert.equal(dst.end.toISOString(), "2026-10-25T23:00:00.000Z");
});

test("nombre del ZIP del histórico", () => {
  assert.equal(releaseZipName("Release 2026-10-18 (2) · Proyecto"), "Release_2026-10-18_2_Proyecto-adjuntos.zip");
  assert.equal(releaseZipName("///"), "release-adjuntos.zip");
});

test("códigos: prefijo por tipo, colisiones y numeración por tipo", () => {
  const ks = [
    { id: "a", name: "Funcionalidad" },
    { id: "b", name: "Corrección" },
    { id: "c", name: "Diseño" },
    { id: "d", name: "Documentación" },
    { id: "e", name: "Docker" },
    { id: "f", name: "Ámbito" },
  ];
  const tasks = [
    { id: "1", kindId: "d" },
    { id: "2", kindId: "a" },
    { id: "3", kindId: "a" },
    { id: "4", kindId: "c" },
    { id: "5", kindId: "e" },
    { id: "6", kindId: "f" },
    { id: "7", kindId: "desconocido" },
    { id: "8", kindId: "b" },
  ];
  const codes = computeReleaseCodes(ks, tasks);
  assert.deepEqual(Object.fromEntries(codes), {
    "1": "DO1", "2": "F1", "3": "F2", "4": "D1", "5": "DOC1", "6": "A1", "7": "O1", "8": "C1",
  });
  // «Otros» también evita colisiones con un tipo que empiece por O.
  const withO = computeReleaseCodes([{ id: "o", name: "Optimización" }], [{ id: "1", kindId: "o" }, { id: "2", kindId: "x" }]);
  assert.deepEqual([...withO.values()], ["O1", "OT1"]);
});

test("descripción sangrada con menciones y adjuntos renombrados", () => {
  const md = buildReleaseMarkdown({
    header: "",
    footer: "",
    kinds,
    tasks: [
      {
        id: "t1",
        title: "Feat",
        kindId: "k1",
        description: "Hola @[Ana](user:abc1)  \r\n\r\n\n\n- punto   \n\n",
        attachments: [{ originalName: "captura.png" }, { originalName: "captura.jpg" }, { originalName: "Vista Árbol (1).PNG" }],
      },
      { id: "t2", title: "Sin nada", kindId: "k1", description: "  \n ", attachments: [] },
    ],
  });
  assert.equal(
    md,
    "### Funcionalidad\n- **F1** · Feat\n  Adjuntos: F1_captura.webp, F1_captura-2.webp, F1_Vista_Árbol__1_.webp\n  Hola @Ana\n\n  - punto\n- **F2** · Sin nada\n",
  );
});

test("nombres de adjuntos: extensión .webp, saneado y duplicados", () => {
  assert.deepEqual(attachmentFileNames("F1", [{ originalName: "a b/c.png" }, { originalName: "a b/c.jpeg" }, { originalName: "a_b_c" }, { originalName: "A_B_C.gif" }]), [
    "F1_a_b_c.webp",
    "F1_a_b_c-2.webp",
    "F1_a_b_c-3.webp",
    "F1_A_B_C-4.webp",
  ]);
  assert.deepEqual(attachmentFileNames("C2", [{ originalName: "informe.final.tar.png" }]), ["C2_informe.final.tar.webp"]);
});

test("nombres de adjuntos: los no imagen conservan su extensión", () => {
  assert.deepEqual(
    attachmentFileNames("F1", [
      { originalName: "informe final.PDF", isImage: false },
      { originalName: "informe final.pdf", isImage: false },
      { originalName: "informe final.png" },
      { originalName: "LEEME", isImage: false },
    ]),
    ["F1_informe_final.PDF", "F1_informe_final-2.pdf", "F1_informe_final.webp", "F1_LEEME"],
  );
});

test("nombre de fichero con fecha local", () => {
  assert.equal(releaseFileName(new Date(2026, 0, 5, 23, 30), "md"), "release-2026-01-05.md");
  assert.equal(releaseFileName(new Date(2026, 11, 31), "txt"), "release-2026-12-31.txt");
});
