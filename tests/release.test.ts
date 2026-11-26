import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachmentFileNames,
  buildReleaseMarkdown,
  computeReleaseCodes,
  defaultReleaseTitle,
  evergreenDue,
  attachmentFileMap,
  releaseDownloadText,
  releasesUntilDue,
  nextEvergreenEvery,
  formatReleaseLine,
  isoDate,
  releaseFileName,
  releaseZipName,
  splitReleaseCode,
  swapTemplateBlock,
  titleWithReleaseCode,
  zonedDayRange,
} from "../src/lib/release";
import { MAX_TITLE } from "../src/lib/constants";

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
  assert.equal(defaultReleaseTitle("2026-10-18", "Proyecto"), "Release 18 oct 2026 · Proyecto");
  assert.equal(defaultReleaseTitle("2026-10-18", "Proyecto", 0), "Release 18 oct 2026 · Proyecto");
  assert.equal(defaultReleaseTitle("2026-10-18", "Proyecto", 1), "Release 18 oct 2026 (2) · Proyecto");
  assert.equal(defaultReleaseTitle("2026-10-18", "Proyecto", 2), "Release 18 oct 2026 (3) · Proyecto");
  // En el idioma de la persona, con el mismo formato de fecha que el resto de la app (formatDay).
  assert.equal(defaultReleaseTitle("2026-10-18", "Project", 0, "en-US"), "Release Oct 18, 2026 · Project");
  assert.equal(defaultReleaseTitle("2026-01-05", "Proyecto", 1, "es-ES"), "Release 5 ene 2026 (2) · Proyecto");
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

test("nombre del ZIP de adjuntos: el mismo desde el diálogo y desde el histórico", () => {
  // Antes el diálogo daba «release-2026-11-11-adjuntos.zip» y el histórico «Release_2026-11-11_Proyecto_de_ejemplo-adjuntos.zip».
  assert.equal(releaseZipName({ day: "2026-11-11", number: 12, project: "Proyecto de ejemplo" }), "release-2026-11-11-R12-Proyecto_de_ejemplo-adjuntos.zip");
  assert.equal(releaseZipName({ day: "2026-11-11", number: 12, project: "Proyecto de ejemplo" }, 2, 3), "release-2026-11-11-R12-Proyecto_de_ejemplo-adjuntos-2de3.zip");
  assert.equal(releaseZipName({ day: "2026-11-11", number: 3, project: "Web · Año 2" }, 1, 1), "release-2026-11-11-R3-Web_Año_2-adjuntos.zip");
  // Sin número o sin proyecto (o un nombre sin letras), se omiten.
  assert.equal(releaseZipName({ day: "2026-11-11" }), "release-2026-11-11-adjuntos.zip");
  assert.equal(releaseZipName({ day: "2026-11-11", number: null, project: "///" }, 1, 3), "release-2026-11-11-adjuntos-1de3.zip");
  // Un nombre muy largo se recorta.
  assert.ok(releaseZipName({ day: "2026-11-11", number: 1, project: "x".repeat(300) }).length < 110);
});

test("nombre del ZIP de adjuntos en el idioma de quien lo descarga", () => {
  assert.equal(releaseZipName({ day: "2026-11-11", number: 12, project: "Web" }), "release-2026-11-11-R12-Web-adjuntos.zip");
  assert.equal(releaseZipName({ day: "2026-11-11", number: 12, project: "Web" }, 2, 3, "es"), "release-2026-11-11-R12-Web-adjuntos-2de3.zip");
  assert.equal(releaseZipName({ day: "2026-11-11", number: 12, project: "Web" }, 1, 1, "en"), "release-2026-11-11-R12-Web-attachments.zip");
  assert.equal(releaseZipName({ day: "2026-11-11" }, 2, 3, "en"), "release-2026-11-11-attachments-2of3.zip");
});

test("release notes en el idioma de quien la genera: «Otros», «Adjuntos», «enlace» y sin tareas", () => {
  const en = (s: string) => ({ Otros: "Others", Adjuntos: "Attachments", enlace: "link", "Sin tareas seleccionadas.": "No tasks selected." })[s] ?? s;
  const md = buildReleaseMarkdown({
    header: "",
    footer: "",
    kinds: [{ id: "k1", name: "Feature", codeName: "Funcionalidad" }],
    tasks: [
      { id: "a", title: "Uno", kindId: "k1", linkUrl: "https://example.com/1", attachments: [{ originalName: "foto.png" }] },
      { id: "b", title: "Dos", kindId: "borrado" },
    ],
  }, en);
  assert.match(md, /### Feature\n- \*\*F1\*\* · Uno \(\[link\]\(<https:\/\/example\.com\/1>\)\)\n\n {2}Attachments: F1_foto\.webp/);
  // La sección se traduce, pero el código sigue saliendo del nombre de serie («Otros» → O1).
  assert.match(md, /### Others\n- \*\*O1\*\* · Dos/);
  assert.doesNotMatch(md, /Adjuntos|enlace|Otros/);
  assert.equal(buildReleaseMarkdown({ header: "", footer: "", kinds, tasks: [] }, en), "_No tasks selected._\n");
  // Sin traductor, en español (como hasta ahora).
  assert.equal(buildReleaseMarkdown({ header: "", footer: "", kinds, tasks: [] }), "_Sin tareas seleccionadas._\n");
});

test("códigos con el nombre guardado del tipo, no con el traducido (iguales para todo el equipo)", () => {
  // Tipos de serie vistos en inglés (localizeGeneralKind deja el nombre guardado en codeName) y en español.
  const asEn = [{ id: "kind_funcionalidad", name: "Feature", codeName: "Funcionalidad" }, { id: "kind_correccion", name: "Bug fix", codeName: "Corrección" }, { id: "kd", name: "Diseño" }];
  const asEs = [{ id: "kind_funcionalidad", name: "Funcionalidad" }, { id: "kind_correccion", name: "Corrección" }, { id: "kd", name: "Diseño" }];
  const tasks = [{ id: "a", kindId: "kind_correccion" }, { id: "b", kindId: "kind_funcionalidad" }, { id: "c", kindId: "kd" }];
  const es = computeReleaseCodes(asEs, tasks, 4);
  assert.deepEqual([...es.values()], ["R4C1", "R4F1", "R4D1"]);
  assert.deepEqual([...computeReleaseCodes(asEn, tasks, 4).values()], [...es.values()]);
});

test("cabecera y pie de release con entidades guardadas por el editor (&lt; …) salen con los caracteres reales", () => {
  const md = buildReleaseMarkdown({ header: "Versión &lt;2.0&gt; &amp; notas", footer: "  Equipo &quot;QA&quot; -&gt; listo ", kinds, tasks: [{ id: "a", title: "x", kindId: "k1" }] });
  assert.ok(md.startsWith('Versión <2.0> & notas\n\n'), md);
  assert.ok(md.endsWith('Equipo "QA" -> listo\n'), md);
  // Cambiar de cabecera en el texto ya generado encuentra la anterior aunque la plantilla lleve entidades.
  assert.equal(swapTemplateBlock(md, "Versión &lt;2.0&gt; &amp; notas", "Otra &lt;cabecera&gt;", "start").split("\n")[0], "Otra <cabecera>");
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

test("códigos: muchos tipos con el mismo nombre nunca comparten prefijo", () => {
  const ks = Array.from({ length: 40 }, (_, i) => ({ id: `k${i}`, name: "Tarea" }));
  const codes = computeReleaseCodes(ks, ks.map((k) => ({ id: k.id, kindId: k.id })));
  const prefixes = [...codes.values()].map((c) => c.replace(/\d+$/, ""));
  assert.equal(new Set(prefixes).size, 40);
  assert.ok(prefixes.every((p) => /^[A-Z]{1,4}$/.test(p)));
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
    "### Funcionalidad\n- **F1** · Feat\n\n  Adjuntos: F1_captura.webp, F1_captura-2.webp, F1_Vista_Árbol__1_.webp\n\n  Hola @Ana\n\n  - punto\n- **F2** · Sin nada\n",
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

test("nombre del .md y el .txt: fecha, número de la release y proyecto, como el ZIP de sus adjuntos", () => {
  // Antes era siempre «release-AAAA-MM-DD.md»: la segunda y la tercera release del día se llamaban igual.
  assert.equal(releaseFileName({ day: isoDate(new Date(2026, 0, 5, 23, 30)), number: 2, project: "Web" }, "md"), "release-2026-01-05-R2-Web.md");
  assert.equal(releaseFileName({ day: "2026-12-31", number: 3, project: "Proyecto de ejemplo" }, "txt"), "release-2026-12-31-R3-Proyecto_de_ejemplo.txt");
  // Mismas piezas que el ZIP (sin el sufijo de adjuntos).
  const opts = { day: "2026-11-11", number: 12, project: "Web · Año 2" };
  assert.equal(releaseFileName(opts, "md").replace(/\.md$/, ""), releaseZipName(opts).replace(/-adjuntos\.zip$/, ""));
  // Sin número (aún no generada) o sin proyecto, se omiten.
  assert.equal(releaseFileName({ day: "2026-11-11" }, "md"), "release-2026-11-11.md");
  assert.equal(releaseFileName({ day: "2026-11-11", number: null, project: "///" }, "txt"), "release-2026-11-11.txt");
});

test("evergreenDue: cadencia de las tareas fijas", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => evergreenDue(n, 1)), [true, true, true, true, true, true]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => evergreenDue(n, 2)), [false, true, false, true, false, true]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => evergreenDue(n, 3)), [false, false, true, false, false, true]);
});

test("nextEvergreenEvery cicla 1 > 2 > 3 > 1", () => {
  assert.deepEqual([1, 2, 3].map(nextEvergreenEvery), [2, 3, 1]);
});

test("titleWithReleaseCode antepone el código (también si ya había otro) y respeta el máximo", () => {
  assert.equal(titleWithReleaseCode("Respuesta", "R3R1"), "R3R1: Respuesta");
  // Desplegada otra vez en una release posterior: el código nuevo se antepone, no sustituye al viejo.
  assert.equal(titleWithReleaseCode("R3R1: Respuesta", "R5F2"), "R5F2: R3R1: Respuesta");
  // Algo parecido pero sin «: » no es un código.
  assert.equal(titleWithReleaseCode("R3R1 Respuesta", "R5F2"), "R5F2: R3R1 Respuesta");
  // Se recorta el final del título original, no el código.
  const out = titleWithReleaseCode("x".repeat(300), "R12DI3", 210);
  assert.equal(out.length, 210);
  assert.ok(out.startsWith("R12DI3: xxx"));
  // Con un código previo, se recorta el final del original y el código anterior se conserva.
  const twice = titleWithReleaseCode(`R3F2: ${"x".repeat(300)}`, "R5F1");
  assert.equal(twice.length, MAX_TITLE);
  assert.ok(twice.startsWith("R5F1: R3F2: xxx"));
  // Una mención partida por el recorte se descarta entera.
  assert.equal(titleWithReleaseCode("ab @[Ana](user:abc123)", "R1F1", 12), "R1F1: ab");
});

test("releasesUntilDue: releases que faltan para que toque una tarea fija", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => releasesUntilDue(n, 1)), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => releasesUntilDue(n, 2)), [1, 0, 1, 0, 1, 0]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => releasesUntilDue(n, 3)), [2, 1, 0, 2, 1, 0]);
  // Coherente con evergreenDue.
  for (const every of [1, 2, 3]) for (let n = 1; n <= 9; n++) assert.equal(releasesUntilDue(n, every) === 0, evergreenDue(n, every));
});

test("nombres de adjuntos en el ZIP: «.» y «..» no quedan como rutas especiales", async () => {
  const { plainAttachmentFileNames } = await import("../src/lib/release");
  const names = plainAttachmentFileNames([
    { originalName: "..", isImage: false },
    { originalName: ".", isImage: false },
    { originalName: "...", isImage: false },
  ] as never);
  for (const n of names) assert.ok(!/^\.+$/.test(n) && !n.includes("/"), n);
  assert.equal(names[0], "adjunto");
});

test("nombres de adjuntos: como mucho ~200 bytes en UTF-8 (se descomprimen en cualquier sistema) y con el -2 de los repetidos", async () => {
  const { plainAttachmentFileNames } = await import("../src/lib/release");
  const { cleanFileName } = await import("../src/lib/file-name");
  // Un nombre de 120 caracteres chinos (lo máximo que guarda una subida) ocupaba 360 bytes: «File name too long».
  const long = cleanFileName("报".repeat(200) + ".png", "x");
  const emoji = cleanFileName("😀".repeat(200) + ".pdf", "x");
  const coded = attachmentFileNames("R12F3", [{ originalName: long, isImage: true }, { originalName: long, isImage: true }, { originalName: emoji, isImage: false }]);
  const plain = plainAttachmentFileNames([{ originalName: long, isImage: true }, { originalName: long, isImage: true }]);
  for (const n of [...coded, ...plain]) assert.ok(Buffer.byteLength(n) <= 200, `${n.length} caracteres, ${Buffer.byteLength(n)} bytes`);
  assert.ok(coded[0]!.startsWith("R12F3_报") && coded[0]!.endsWith(".webp"));
  assert.ok(coded[1]!.endsWith("-2.webp") && coded[1]!.slice(0, -7) === coded[0]!.slice(0, -5), coded[1]);
  // Sin partir ningún carácter (un emoji a medias no sobrevive a pasar por UTF-8).
  assert.ok(coded[2]!.endsWith(".pdf") && Buffer.from(coded[2]!).toString() === coded[2], coded[2]);
  assert.ok(plain[1]!.endsWith("-2.webp"));
  // Los nombres cortos, como siempre.
  assert.deepEqual(plainAttachmentFileNames([{ originalName: "captura.png", isImage: true }]), ["captura.webp"]);
});

test("nombres de adjuntos: los reservados de Windows (CON, NUL, LPT1…) llevan «_» delante", async () => {
  const { plainAttachmentFileNames } = await import("../src/lib/release");
  assert.deepEqual(
    plainAttachmentFileNames(["CON.txt", "nul", "Aux.tar.gz", "com1.pdf", "LPT9", "prn.png"].map((originalName) => ({ originalName, isImage: originalName.endsWith(".png") }))),
    ["_CON.txt", "_nul", "_Aux.tar.gz", "_com1.pdf", "_LPT9", "_prn.webp"],
  );
  // Solo el nombre exacto: «console», «com10» o «nul_1» no están reservados; con código delante, tampoco.
  assert.deepEqual(plainAttachmentFileNames(["console.txt", "com10.txt", "nul_1.txt"].map((originalName) => ({ originalName, isImage: false }))), ["console.txt", "com10.txt", "nul_1.txt"]);
  assert.deepEqual(attachmentFileNames("F1", [{ originalName: "CON.txt", isImage: false }]), ["F1_CON.txt"]);
  // También COM y LPT con los superíndices ¹ ² ³, que Windows trata como dígitos.
  assert.deepEqual(
    plainAttachmentFileNames(["COM¹.txt", "lpt²", "Com³.pdf", "LPT³.log"].map((originalName) => ({ originalName, isImage: false }))),
    ["_COM¹.txt", "_lpt²", "_Com³.pdf", "_LPT³.log"],
  );
});

test("nombres de adjuntos: sin puntos ni espacios al final (Windows los quita: «informe.» chocaba con «informe»)", async () => {
  const { plainAttachmentFileNames } = await import("../src/lib/release");
  const names = plainAttachmentFileNames(["informe.", "informe", "notas..", "notas", "..."].map((originalName) => ({ originalName, isImage: false })));
  assert.deepEqual(names, ["informe", "informe-2", "notas", "notas-2", "adjunto"]);
  for (const n of names) assert.ok(!/[. ]$/.test(n), n);
});

test("splitReleaseCode: el código del principio del título, para explicarlo en la tarjeta", () => {
  const code = titleWithReleaseCode("Respuesta", "R32FU12");
  assert.deepEqual(splitReleaseCode(code), { code: "R32FU12", release: 32, letters: "FU", order: 12, rest: ": Respuesta" });
  // Con dos códigos, el primero (el de la última release).
  assert.equal(splitReleaseCode("R5F1: R3F2: Respuesta")?.code, "R5F1");
  // Sin «: » detrás, o sin el formato R + número + letras + número, no es un código.
  for (const title of ["R3F1 sin dos puntos", "Revisar F1: algo", "R3: algo", "r3f1: algo", "F1: algo", ""]) assert.equal(splitReleaseCode(title), null, title);
});

test("descarga: las imágenes de la descripción, en su línea y con la ruta del ZIP (o en texto sin ZIP)", () => {
  const attachments = [{ id: "a1", originalName: "pegada.png" }, { id: "a2", originalName: "log.txt", isImage: false }];
  const files = attachmentFileMap("R3F1", attachments);
  assert.equal(files.get("a1"), "R3F1_pegada.webp");
  const md = [
    "- **R3F1** · Tarea",
    "",
    "  Mira la tabla.![pegada.png](/api/attachments/a1) y sigue",
    "  ![otra](https://pz.example.com/api/attachments/zz?x=1)",
    "  ![web](https://example.com/a.png)",
    "  ```",
    "  ![c](/api/attachments/a1)",
    "  ```",
  ].join("\n");
  assert.equal(releaseDownloadText(md, files), [
    "- **R3F1** · Tarea",
    "",
    "  Mira la tabla.",
    "",
    "  ![pegada.png](R3F1_pegada.webp)",
    "",
    "  y sigue",
    "  [imagen: otra]",
    "  ![web](https://example.com/a.png)",
    "  ```",
    "  ![c](/api/attachments/a1)",
    "  ```",
  ].join("\n"));
  // Sin ZIP: texto, nunca un enlace roto. En inglés, «image».
  assert.ok(releaseDownloadText("  ![pegada.png](/api/attachments/a1)", new Map()).startsWith("  [imagen: pegada.png]"));
  assert.equal(releaseDownloadText("![](/api/attachments/a1)", new Map(), (x) => (x === "imagen" ? "image" : x)), "[image]");
});
