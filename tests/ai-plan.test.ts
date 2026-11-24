// Plan de trabajo para IA (columna AI_PLAN): texto generado, nombres de fichero, versiones y el rol de la columna.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { makeT } from "../src/i18n/core";
import { EN } from "../src/i18n/en";
import { AI_PLAN_DEFAULTS, AI_PLAN_SAVE_MAX, AI_PLAN_ZIP_FOLDER, aiPlanDownloadName, aiPlanTooLong, aiPlanZipRoot, aiPlanFileName, buildAiPlanMarkdown, highestPlanVersion, planAttachmentPaths, planDescription, type AiPlanInput } from "../src/lib/ai-plan";
import {
  COLUMN_ROLE_HINT, COLUMN_ROLE_LABEL, COLUMN_ROLES, EVERGREEN_COLUMN_ROLES, hasEvergreenTasks, isUniqueColumnRole, releaseTemplateRows, TEMPLATE_KINDS,
} from "../src/lib/constants";
import { aiPlanZipName, evergreenDue, swapTemplateBlock } from "../src/lib/release";

const base = (over: Partial<AiPlanInput> = {}): AiPlanInput => ({
  header: AI_PLAN_DEFAULTS.es.header,
  footer: AI_PLAN_DEFAULTS.es.footer,
  project: { name: "Web", description: "Tienda en línea.\n\n## Stack\n\nNext.js. Tablero: [aquí](https://pz.example.com/p/p1)." },
  column: "Plan de trabajo para IA",
  date: "2026-11-23",
  origin: "https://pz.example.com",
  tasks: [
    {
      id: "t1", title: "Arreglar @[Ana](user:u1) el login", kind: "Corrección",
      description: "Falla al entrar.\n\n# Pasos\n\n```\n# no es un título\n```\n\n![captura](/api/attachments/a9) -&gt; ver",
      subtasks: [{ title: "Reproducir", done: true }, { title: "Corregir y probar", done: false }],
      labels: ["Urgente", "Backend"], dueDate: "2026-11-30", startDate: "2026-11-24", priority: "Alta",
      linkUrl: "https://github.com/example/web/issues/1", links: [{ title: "Diseño [v2]", url: "https://docs.google.com/document/d/x" }],
      attachments: [{ name: "log.txt" }, { name: "mi_registro*.txt" }],
    },
    { id: "t2", title: "Añadir pruebas", kind: "Funcionalidad", blockedBy: { title: "Arreglar el login", index: 1 } },
    { id: "t3", title: "Revisar estilo", blockedBy: { title: "Otra cosa" } },
  ],
  ...over,
});

describe("texto del plan de trabajo para IA", () => {
  test("título, cabecera, contexto, una sección por tarea en orden y pie", () => {
    const md = buildAiPlanMarkdown(base());
    const order = ["# Plan de trabajo – Web", "## Instrucciones para la IA", "## Contexto del proyecto", "## Tareas", "### 1. Arreglar @Ana el login", "### 2. Añadir pruebas", "### 3. Revisar estilo", "## Entrega"];
    let at = -1;
    for (const piece of order) {
      const i = md.indexOf(piece);
      assert.ok(i > at, `${piece} en su sitio`);
      at = i;
    }
    assert.ok(md.endsWith("\n") && !md.endsWith("\n\n"));
  });

  test("contexto del proyecto: nombre (sin enlace a Pizarro), columna, fecha, número de tareas y descripción (títulos rebajados)", () => {
    const md = buildAiPlanMarkdown(base());
    assert.match(md, /- \*\*Proyecto:\*\* Web\n/);
    assert.match(md, /- \*\*Columna:\*\* Plan de trabajo para IA/);
    // La fecha del plan, como en el resto de la app y en el título de las releases (no AAAA-MM-DD).
    assert.match(md, /- \*\*Fecha:\*\* 23 nov 2026\n/);
    assert.match(buildAiPlanMarkdown({ ...base(), intlLocale: "en-US" }), /- \*\*Fecha:\*\* Nov 23, 2026\n/);
    assert.match(md, /- \*\*Tareas:\*\* 3/);
    assert.match(md, /Tienda en línea\.\n\n##### Stack\n\nNext\.js\. Tablero: aquí\./);
  });

  test("cada tarea lleva tipo, prioridad, etiquetas, fechas, enlaces, documentos, adjuntos, descripción y checklist", () => {
    const md = buildAiPlanMarkdown(base());
    const t1 = md.slice(md.indexOf("### 1."), md.indexOf("### 2."));
    for (const line of [
      "- **Tipo:** Corrección", "- **Prioridad:** Alta", "- **Etiquetas:** Urgente, Backend", "- **Fecha de inicio:** 2026-11-24", "- **Fecha límite:** 2026-11-30",
      "- **Enlace:** [https://github.com/example/web/issues/1](<https://github.com/example/web/issues/1>)",
      "- **Documentos:** [Diseño \\[v2\\]](<https://docs.google.com/document/d/x>)",
      "- **Adjuntos:** `log.txt`, `mi_registro*.txt`",
      "**Checklist:**", "- [x] Reproducir", "- [ ] Corregir y probar",
    ]) assert.ok(t1.includes(line), line);
    // La descripción va sin rótulo, justo después de los datos (la cabecera ya dice que las subtareas son los criterios).
    assert.ok(t1.includes("- **Adjuntos:** `log.txt`, `mi_registro*.txt`\n\nFalla al entrar."), t1);
    assert.ok(!md.includes("**Descripción:**") && !md.includes("criterios de aceptación):"), md);
    // Salvo si empieza con una lista: la línea en blanco no la separa de la de los datos (en Markdown, serían más datos).
    const listed = buildAiPlanMarkdown(base({ project: { name: "Web", description: "1. Uno" }, tasks: [{ id: "t1", title: "A", kind: "Bug", description: "- Reproducir\n- Corregir" }, { id: "t2", title: "B", description: "- Sin datos" }] }));
    assert.ok(listed.includes("- **Tipo:** Bug\n\n**Descripción:**\n\n- Reproducir\n- Corregir"), listed);
    assert.ok(listed.includes("- **Tareas:** 2\n\n**Descripción:**\n\n1. Uno"), listed);
    assert.ok(listed.includes("### 2. B\n\n- Sin datos"), listed);
    // Títulos de la descripción rebajados (no compiten con los del plan), pero no dentro del código; entidades y enlaces a adjuntos.
    assert.ok(t1.includes("#### Pasos"));
    assert.ok(t1.includes("```\n# no es un título\n```"));
    // La imagen de un adjunto que no va en el ZIP se queda en su texto alternativo: la IA no puede abrir Pizarro.
    assert.ok(t1.includes("captura -> ver"), t1);
    assert.ok(!md.includes("pz.example.com"), md);
    assert.ok(!md.includes("Pizarro"), md);
    // Sin datos que no tiene: ni «Fecha límite» ni checklist en la 2.
    const t2 = md.slice(md.indexOf("### 2."), md.indexOf("### 3."));
    assert.ok(!t2.includes("Fecha límite") && !t2.includes("Checklist"));
    assert.ok(t2.includes("- **Depende de:** la tarea 1 («Arreglar el login»)"));
  });

  test("dependencia de una tarea que no está en el plan; las fijas no llevan nota (es cosa de Pizarro, no de la IA)", () => {
    const md = buildAiPlanMarkdown(base());
    const t3 = md.slice(md.indexOf("### 3."));
    assert.ok(!md.includes("Tarea fija"));
    assert.ok(t3.includes("- **Depende de:** «Otra cosa» (no está en este plan)"));
  });

  test("sin cabecera, pie ni tareas", () => {
    const md = buildAiPlanMarkdown(base({ header: "", footer: "", tasks: [], project: { name: "Web" } }));
    assert.ok(!md.includes("Instrucciones para la IA") && !md.includes("## Entrega"));
    assert.match(md, /_Sin tareas seleccionadas\._/);
    assert.match(md, /- \*\*Proyecto:\*\* Web\n/);
  });

  test("en inglés, con las plantillas de serie en inglés", () => {
    const md = buildAiPlanMarkdown(base({ header: AI_PLAN_DEFAULTS.en.header, footer: AI_PLAN_DEFAULTS.en.footer }), makeT("en"));
    for (const piece of ["# Work plan – Web", "## Instructions for the AI", "## Project context", "- **Type:** Corrección", "- **Due date:** 2026-11-30", "**Checklist:**", "- **Depends on:** task 1", "## Delivery"]) {
      assert.ok(md.includes(piece), piece);
    }
  });

  test("las plantillas guardadas con el editor con barra (&lt;, &nbsp;) entran con los caracteres reales", () => {
    const md = buildAiPlanMarkdown(base({ header: "Usa &lt;main&gt;\n\n&nbsp;\n\nfin", footer: "" }));
    assert.match(md, /Usa <main>\n\n\nfin|Usa <main>\n\nfin/);
  });

  test("cambiar la cabecera en el texto ya editado sustituye solo ese bloque", () => {
    const md = buildAiPlanMarkdown(base());
    const edited = md.replace("Añadir pruebas", "Añadir pruebas de extremo a extremo");
    const swapped = swapTemplateBlock(edited, AI_PLAN_DEFAULTS.es.header, "## Otra cabecera", "start");
    assert.ok(swapped.includes("## Otra cabecera") && !swapped.includes("## Instrucciones para la IA"));
    assert.ok(swapped.includes("Añadir pruebas de extremo a extremo") && swapped.startsWith("# Plan de trabajo – Web"));
  });

  test("planDescription: menciones, líneas en blanco repetidas y título dentro de ~~~", () => {
    assert.equal(planDescription("\n\n@[Ana](user:u1) dice\n\n\n\nhola\n\n"), "@Ana dice\n\nhola");
    assert.equal(planDescription("~~~\n## x\n~~~\n## y"), "~~~\n## x\n~~~\n##### y");
    assert.equal(planDescription("###### seis"), "###### seis");
    assert.equal(planDescription(null), "");
  });

  test("planDescription: sin los apartados del formulario del tipo que siguen vacíos; los respondidos se quedan", () => {
    assert.equal(planDescription("**Qué mejora:** el buscador\n\n**Por qué:**\n\n**Cómo sabré que está bien:**\n"), "**Qué mejora:** el buscador");
    assert.equal(
      planDescription("**Qué mejora:**\n\nEl buscador.\n\n**Por qué:**\n\n- \n* [ ]\n1.\n\n**Riesgo:** sin cambios visibles.\n\n**Notas**:\n"),
      "**Qué mejora:**\n\nEl buscador.\n\n**Riesgo:** sin cambios visibles.",
    );
    // Con algo debajo (texto, una lista, código) es una respuesta; una negrita sin «:» no es una etiqueta del formulario.
    assert.equal(planDescription("**Esquema:**\n\n- uno\n\n**Pregunta:**\n```\nnpm test\n```"), "**Esquema:**\n\n- uno\n\n**Pregunta:**\n```\nnpm test\n```");
    assert.equal(planDescription("Hecho a medias.\n\n**¡Urgente!**"), "Hecho a medias.\n\n**¡Urgente!**");
    // Una respuesta que empieza en negrita sin «:» no es la etiqueta siguiente: el apartado se queda con su título.
    assert.equal(planDescription("**Pasos:**\n\n**1.** Abrir ajustes\n**2.** Guardar"), "**Pasos:**\n\n**1.** Abrir ajustes\n**2.** Guardar");
    assert.equal(planDescription("**Por qué:**\n\n**Riesgo:** ninguno"), "**Riesgo:** ninguno");
    // Dentro de un bloque de código no se toca nada.
    assert.equal(planDescription("```\n**Por qué:**\n```"), "```\n**Por qué:**\n```");
    // Solo etiquetas vacías: no queda nada (y la tarea sale sin descripción).
    assert.equal(planDescription("**Qué hay que hacer:**\n\n**Plazo:**\n"), "");
    const md = buildAiPlanMarkdown(base({ tasks: [{ id: "t1", title: "A", description: "**Por qué:**\n\n- \n" }] }));
    assert.ok(md.includes("### 1. A\n\n## Entrega"), md);
  });

  test("planDescription: un bloque de código sin cerrar se cierra al final (no se traga las tareas siguientes ni el pie)", () => {
    assert.equal(planDescription("Ejemplo:\n```ts\nconst a = 1;"), "Ejemplo:\n```ts\nconst a = 1;\n```");
    assert.equal(planDescription("````\n```\n## dentro\n"), "````\n```\n## dentro\n````");
    // Una valla más corta o con texto detrás no cierra la que está abierta; una igual o más larga, sí.
    assert.equal(planDescription("````\n```js\n````\n## fuera"), "````\n```js\n````\n##### fuera");
    assert.equal(planDescription("~~~\n```\n~~~~\n# fuera"), "~~~\n```\n~~~~\n#### fuera");
    const md = buildAiPlanMarkdown({ ...base(), tasks: [{ id: "a", title: "Uno", description: "```\nsin cerrar" }, { id: "b", title: "Dos" }] });
    const fences = md.split("\n").filter((l) => l.startsWith("```")).length;
    assert.equal(fences % 2, 0, "las vallas del plan quedan emparejadas");
    assert.match(md, /sin cerrar\n```\n\n### 2\. Dos/);
  });

  test("planDescription: una línea que abriría un bloque HTML sin fin empieza con «\\<» (no se traga el resto del plan)", () => {
    // Comentario, instrucción de proceso, declaración, CDATA y pre/script/style/textarea (sin distinguir mayúsculas).
    for (const line of ["<!-- nota", "<?php echo 1;", "<!DOCTYPE html>", "<![CDATA[ x", "<pre>", "<pre", "<script src=x>", "<STYLE>", "<textarea rows=3>"]) {
      assert.equal(planDescription(`Antes\n\n${line}\nsigue`), `Antes\n\n\\${line}\nsigue`, line);
      assert.equal(planDescription(`   ${line}`), `   \\${line}`, line);
    }
    // Lo demás no se toca: HTML que acaba en la línea en blanco, etiquetas que solo empiezan igual, sangría de código,
    // texto en medio de la línea y lo que va dentro de un bloque de código.
    for (const same of ["<div>hola</div>", "<prefijo>", "<scripts>", "<b>negrita</b>", "    <!-- código", "a <!-- b", "```\n<!-- en código\n```"]) {
      assert.equal(planDescription(same), same, same);
    }
    // Con el plan entero: la tarea siguiente y el pie siguen fuera del comentario.
    const md = buildAiPlanMarkdown(base({ tasks: [{ id: "a", title: "Una", description: "texto\n\n<!-- nota sin cerrar" }, { id: "b", title: "Otra" }] }));
    assert.match(md, /\n\\<!-- nota sin cerrar\n\n### 2\. Otra/);
  });

  test("planDescription: un bloque de código sin cerrar se cierra (no se traga el resto del plan)", () => {
    assert.equal(planDescription("```\nsin cerrar\n# hola"), "```\nsin cerrar\n# hola\n```");
    assert.equal(planDescription("~~~~\nx\n~~~"), "~~~~\nx\n~~~\n~~~~");
    // Con el plan entero: la tarea siguiente y el pie siguen siendo títulos.
    const md = buildAiPlanMarkdown(base({ tasks: [{ id: "a", title: "Una", description: "```js\nconst a = 1;" }, { id: "b", title: "Otra" }] }));
    assert.match(md, /const a = 1;\n```\n\n### 2\. Otra/);
    assert.ok(md.trimEnd().endsWith("por qué."));
  });

  test("planDescription: ``` dentro de un bloque de ```` es código (ni lo cierra ni se rebajan sus #)", () => {
    const d = "````md\n```js\n# dentro\n```\n````\n\n# Fuera";
    assert.equal(planDescription(d), "````md\n```js\n# dentro\n```\n````\n\n#### Fuera");
    // Un ``` con información que lleva ` no abre bloque (es código en línea).
    assert.equal(planDescription("```a `b`\n# c"), "```a `b`\n#### c");
  });

  test("planDescription: títulos setext, «#» vacío y con sangría también se rebajan", () => {
    assert.equal(planDescription("Párrafo\ndos\n---\nmás"), "##### Párrafo dos\nmás");
    assert.equal(planDescription("Título\n==="), "#### Título");
    assert.equal(planDescription("#\n\n  # sangrado"), "####\n\n#### sangrado");
    // «---» tras una lista, una tabla o una línea en blanco es una raya, no un título.
    assert.equal(planDescription("- a\n---"), "- a\n---");
    assert.equal(planDescription("| a |\n|---|\n| 1 |\n---"), "| a |\n|---|\n| 1 |\n---");
    assert.equal(planDescription("a\n\n---"), "a\n\n---");
  });

  test("planDescription: conserva los saltos de línea forzados (dos espacios al final, como los guarda el editor con barra)", () => {
    assert.equal(planDescription("Calle Mayor 1  \nMadrid"), "Calle Mayor 1  \nMadrid");
    assert.equal(planDescription("a\n   \n\nb"), "a\n\nb");
  });
});

describe("nombres y versiones", () => {
  test("«Plan de trabajo – AAAA-MM-DD_vN.md», y el prefijo inglés que cuenta las versiones es su traducción", () => {
    assert.equal(aiPlanFileName("Plan de trabajo", "2026-11-23", 3), "Plan de trabajo – 2026-11-23_v3.md");
    assert.equal(aiPlanFileName("Work plan", "2026-11-23", 12, "txt"), "Work plan – 2026-11-23_v12.txt");
    // src/actions/ai-plan.ts cuenta las versiones de los documentos en los dos idiomas con «Work plan».
    assert.equal(EN["Plan de trabajo"], "Work plan");
  });

  test("al descargar, el mismo nombre solo con ASCII (raya y tildes fuera)", () => {
    assert.equal(aiPlanDownloadName("Plan de trabajo – 2026-11-23_v3.md"), "Plan de trabajo - 2026-11-23_v3.md");
    assert.equal(aiPlanDownloadName("Planificación — año_v1.txt"), "Planificacion - ano_v1.txt");
    assert.equal(aiPlanDownloadName("Plan 📋_v1.md"), "Plan ___v1.md");
  });

  test("highestPlanVersion: el mayor _vN, sin contar otros nombres", () => {
    assert.equal(highestPlanVersion([]), 0);
    assert.equal(highestPlanVersion(["Plan de trabajo – 2026-11-01_v2.md", "Work plan – 2026-11-02_v10.md", "Plan de trabajo – 2026-11-03_v9.md", "Plan de trabajo – notas.md", "x_v99.pdf"]), 10);
  });

  test("tareas fijas con cadencia: la misma regla que en las releases, con la versión del plan", () => {
    assert.deepEqual([1, 2, 3, 4].map((n) => evergreenDue(n, 2)), [false, true, false, true]);
  });
});

describe("rol «Plan de trabajo para IA»", () => {
  test("repetible, con nombre y explicación, y con tareas fijas como la release", () => {
    assert.ok(COLUMN_ROLES.includes("AI_PLAN"));
    assert.equal(isUniqueColumnRole("AI_PLAN"), false);
    assert.equal(COLUMN_ROLE_LABEL.AI_PLAN, "Plan de trabajo para IA");
    assert.match(COLUMN_ROLE_HINT.AI_PLAN, /Generar plan de trabajo/);
    assert.deepEqual([...EVERGREEN_COLUMN_ROLES], ["NEXT_RELEASE", "AI_PLAN"]);
    assert.equal(hasEvergreenTasks("AI_PLAN"), true);
    assert.equal(hasEvergreenTasks("PROGRAM"), false);
    assert.equal(hasEvergreenTasks(undefined), false);
  });

  test("las plantillas del plan son otro tipo y no se cuelan entre las de release", () => {
    assert.deepEqual([...TEMPLATE_KINDS], ["HEADER", "FOOTER", "PLAN_HEADER", "PLAN_FOOTER"]);
    const rows = [{ kind: "HEADER", name: "a" }, { kind: "PLAN_HEADER", name: "b" }, { kind: "FOOTER", name: "c" }, { kind: "PLAN_FOOTER", name: "d" }];
    assert.deepEqual(releaseTemplateRows(rows).map((r) => r.name), ["a", "c"]);
  });

  test("las plantillas de serie hablan de Claude Code y piden la entrega tarea por tarea", () => {
    for (const d of Object.values(AI_PLAN_DEFAULTS)) {
      assert.match(d.header, /Claude Code/);
      assert.match(d.footer, /1\. /);
    }
  });
});

describe("adjuntos del plan: rutas dentro del ZIP «adjuntos/…»", () => {
  const tasks = [
    { id: "t1", title: "Arreglar @[Ana](user:u1) el login: ¡Ñandú!", attachments: [{ id: "a1", originalName: "Plano final.png", isImage: true }, { id: "a2", originalName: "plano final.webp", isImage: true }, { id: "a3", originalName: "log.txt", isImage: false }] },
    { id: "t2", title: "Sin adjuntos", attachments: [] },
    { id: "t3", title: "???", attachments: [{ id: "a4", originalName: "x.pdf", isImage: false }] },
  ];

  test("una carpeta por tarea con su número en el plan, sin tildes; imágenes en WebP y nombres repetidos con -2", () => {
    const { byTask, byAttachment } = planAttachmentPaths(tasks);
    assert.deepEqual([...byTask.keys()], ["t1", "t3"]);
    assert.equal(byTask.get("t1")!.folder, "adjuntos/01-arreglar-ana-el-login-nandu");
    assert.equal(byTask.get("t3")!.folder, "adjuntos/03-tarea");
    assert.equal(byAttachment.get("a1"), "adjuntos/01-arreglar-ana-el-login-nandu/Plano_final.webp");
    assert.equal(byAttachment.get("a2"), "adjuntos/01-arreglar-ana-el-login-nandu/plano_final-2.webp");
    assert.equal(byAttachment.get("a3"), "adjuntos/01-arreglar-ana-el-login-nandu/log.txt");
    assert.equal(byAttachment.get("a4"), "adjuntos/03-tarea/x.pdf");
    for (const { folder } of byTask.values()) assert.ok(AI_PLAN_ZIP_FOLDER.test(folder), folder);
  });

  test("el texto cita las rutas del ZIP, sustituye las imágenes de la descripción y explica el ZIP; sin ruta, solo los nombres", () => {
    const { byAttachment } = planAttachmentPaths(tasks);
    const withPaths = (path: boolean) => buildAiPlanMarkdown({
      header: AI_PLAN_DEFAULTS.es.header, footer: "", project: { name: "Web" }, date: "2026-11-23", origin: "https://pz.example.com",
      tasks: [{
        id: "t1", title: "Arreglar", description: "Mira ![captura](/api/attachments/a1) y ![otra](/api/attachments/zz) y ![c](/api/attachments/a1?thumb=1)",
        attachments: [{ id: "a1", name: "Plano final.png", path: path ? byAttachment.get("a1") : undefined }],
      }],
    });
    const md = withPaths(true);
    assert.ok(md.includes("- **Adjuntos:** 1 archivo(s) en el ZIP «adjuntos/…»"));
    assert.ok(md.includes("- **Adjuntos:**\n  - `adjuntos/01-arreglar-ana-el-login-nandu/Plano_final.webp`\n"), md);
    assert.ok(md.includes("![captura](adjuntos/01-arreglar-ana-el-login-nandu/Plano_final.webp)"));
    assert.ok(md.includes("![c](adjuntos/01-arreglar-ana-el-login-nandu/Plano_final.webp)"));
    // Una imagen que no es adjunto de ninguna tarea del plan se queda en su texto alternativo (sin enlace a Pizarro).
    assert.ok(md.includes("Mira ![captura](adjuntos/01-arreglar-ana-el-login-nandu/Plano_final.webp) y otra y "), md);
    assert.ok(md.includes("(descomprímelo junto a este fichero)") && md.includes("Las imágenes van en WebP."), md);
    const plain = withPaths(false);
    assert.ok(!plain.includes("en el ZIP «adjuntos/…» que va con este plan") && plain.includes("Mira captura y otra y c"), plain);
    assert.ok(plain.includes("- **Adjuntos:** `Plano final.png`"));
    // Sin ZIP (más de 200 tareas con adjuntos): el contexto aclara que solo van sus nombres (por si la cabecera habla de un ZIP).
    assert.ok(plain.includes("- **Adjuntos:** Este plan no lleva ZIP de adjuntos: cada tarea cita solo el nombre de los suyos"));
    for (const text of [md, plain]) assert.ok(!text.includes("pz.example.com") && !text.includes("Pizarro"), text);
    assert.ok(!md.includes("no lleva ZIP"));
  });

  test("planDescription: sin enlaces a Pizarro (relativos o con su origen); los adjuntos del ZIP, por su ruta; los demás enlaces, igual", () => {
    const origin = "https://pz.example.com";
    const zip = new Map([["x1", "adjuntos/01-t/a.webp"]]);
    assert.equal(planDescription("![a](/api/attachments/x1)", origin), "a");
    assert.equal(planDescription("![a](/api/attachments/x1)", origin, zip), "![a](adjuntos/01-t/a.webp)");
    assert.equal(planDescription("[plano](</api/attachments/x1?download=1> \"t\")", origin, zip), "[plano](<adjuntos/01-t/a.webp> \"t\")");
    // A la tarea, al tablero, con el origen en mayúsculas o con «/» al final: el texto, sin el enlace.
    assert.equal(planDescription("Ver [la tarea](https://pz.example.com/p/p1?task=t2) y [el **tablero**](HTTPS://PZ.example.com/p/p1).", `${origin}/`), "Ver la tarea y el **tablero**.");
    assert.equal(planDescription("[inicio](https://pz.example.com) y [panel](https://pz.example.com#x)", origin), "inicio y panel");
    // Otro sitio (también uno que empieza igual), un enlace sin origen conocido o uno «//otro» no cambian.
    for (const keep of ["[web](https://example.com/p/1)", "[casi](https://pz.example.com.evil.example/p/1)", "[proto](//pz.example.com/p/1)", "![x](https://cdn.example.com/x.png)"]) assert.equal(planDescription(keep, origin), keep);
    assert.equal(planDescription("[rel](/p/p1)", null), "rel");
    // Dentro de un bloque de código no se toca nada; en un título, sí.
    assert.equal(planDescription("```\n[a](/p/1)\n```\n# [Título](/p/1)", origin), "```\n[a](/p/1)\n```\n#### Título");
  });

  test("el enlace externo de una tarea que lleva a Pizarro no entra; los de otros sitios, sí", () => {
    const md = (linkUrl: string) => buildAiPlanMarkdown({ header: "", footer: "", project: { name: "Web" }, date: "2026-11-23", origin: "https://pz.example.com", tasks: [{ id: "t1", title: "A", linkUrl }] });
    assert.ok(!md("https://pz.example.com/p/p2?task=x").includes("Enlace"));
    assert.ok(md("https://example.com/issue/1").includes("- **Enlace:** [https://example.com/issue/1](<https://example.com/issue/1>)"));
  });

  test("la cabecera de serie ya no habla de enlaces a Pizarro (el plan no lleva ninguno)", () => {
    for (const l of ["es", "en"] as const) assert.ok(!AI_PLAN_DEFAULTS[l].header.includes("Pizarro"), l);
  });

  test("nombre del ZIP", () => {
    assert.equal(aiPlanZipName({ day: "2026-11-23", version: 3, project: "Mi Web" }), "plan-2026-11-23-v3-Mi_Web-adjuntos.zip");
    assert.equal(aiPlanZipName({ day: "2026-11-23", version: 3, project: "Mi Web" }, 2, 3, "en"), "plan-2026-11-23-v3-Mi_Web-attachments-2of3.zip");
  });

  test("la plantilla de serie no habla del ZIP (va en todos los planes): lo explica el contexto, solo cuando hay adjuntos", () => {
    for (const l of ["es", "en"] as const) assert.ok(!/ZIP|adjuntos|attachments/.test(AI_PLAN_DEFAULTS[l].header), l);
    const withZip = buildAiPlanMarkdown(base({ tasks: [{ id: "t1", title: "A", attachments: [{ id: "a1", name: "p.png", path: "adjuntos/01-a/p.webp" }] }] }));
    assert.ok(withZip.includes("- **Adjuntos:** 1 archivo(s) en el ZIP «adjuntos/…» que va con este plan (descomprímelo junto a este fichero): cada tarea cita la ruta de los suyos y las imágenes de las descripciones apuntan a ella. Las imágenes van en WebP.\n"), withZip);
    const without = buildAiPlanMarkdown(base({ tasks: [{ id: "t1", title: "A" }] }));
    assert.ok(!without.includes("ZIP"), without);
  });

  test("plan en inglés: la carpeta raíz es «attachments/» y una tarea sin letras, «NN-task»", () => {
    const { byTask, byAttachment } = planAttachmentPaths(tasks, "en");
    assert.equal(byTask.get("t1")!.folder, "attachments/01-arreglar-ana-el-login-nandu");
    assert.equal(byTask.get("t3")!.folder, "attachments/03-task");
    assert.equal(byAttachment.get("a2"), "attachments/01-arreglar-ana-el-login-nandu/plano_final-2.webp");
    assert.equal(byAttachment.get("a4"), "attachments/03-task/x.pdf");
    for (const { folder } of byTask.values()) {
      assert.ok(AI_PLAN_ZIP_FOLDER.test(folder), folder);
      assert.equal(aiPlanZipRoot(folder), "attachments");
    }
    assert.equal(aiPlanZipRoot("adjuntos/01-x"), "adjuntos");
    // En español (y sin idioma) sigue como siempre.
    assert.deepEqual(planAttachmentPaths(tasks, "es"), planAttachmentPaths(tasks));
    // El texto del plan en inglés cita esas rutas y explica el ZIP con el mismo nombre de carpeta; ni rastro de «adjuntos/».
    const md = buildAiPlanMarkdown({
      header: AI_PLAN_DEFAULTS.en.header, footer: "", project: { name: "Web" }, date: "2026-11-23", origin: "https://pz.example.com",
      tasks: [{
        id: "t1", title: "Fix", description: "See ![shot](/api/attachments/a1)",
        attachments: [{ id: "a1", name: "Plano final.png", path: byAttachment.get("a1") }],
      }],
    }, makeT("en"));
    assert.ok(md.includes("- **Attachments:** 1 file(s) in the “attachments/…” ZIP that goes with this plan"), md);
    assert.ok(md.includes("  - `attachments/01-arreglar-ana-el-login-nandu/Plano_final.webp`\n"), md);
    assert.ok(!md.includes("Pizarro"), md);
    assert.ok(md.includes("![shot](attachments/01-arreglar-ana-el-login-nandu/Plano_final.webp)"));
    assert.ok(!md.includes("adjuntos/"), md);
  });

  test("el servidor admite las dos raíces con la misma forma estricta", () => {
    for (const ok of ["adjuntos/01-x", "attachments/01-x", "attachments/0001-", "attachments/03-task", "adjuntos/03-tarea", `attachments/12-${"a".repeat(40)}`]) assert.ok(AI_PLAN_ZIP_FOLDER.test(ok), ok);
    for (const bad of [
      "attachments/x", "attachments/1-x", "attachments/00001-x", "attachments/../x", "attachments/01-x/y", "attachments/01-X", "attachments/01-x.", "attachments/01-ñ",
      `attachments/01-${"a".repeat(41)}`, "Attachments/01-x", "attachment/01-x", "anexos/01-x", "/attachments/01-x", "attachments//01-x", "attachments/01-x\n", " attachments/01-x", "adjuntos/attachments/01-x", "attachments",
    ]) assert.ok(!AI_PLAN_ZIP_FOLDER.test(bad), bad);
  });
});

describe("plan de trabajo: tipo común", () => {
  const tasks = (n: number, kind: (i: number) => string | undefined = () => "Corrección") => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, title: `Tarea ${i}`, kind: kind(i) }));

  test("si todas las tareas son del mismo tipo, va una vez en el contexto y no en cada tarea", () => {
    const same = buildAiPlanMarkdown(base({ tasks: tasks(3) }));
    assert.ok(same.includes("- **Tareas:** 3\n- **Tipo de todas las tareas:** Corrección\n"), same);
    assert.ok(!same.includes("- **Tipo:**"), same);
    // Varios tipos (o alguna sin tipo): como siempre, en cada tarea y nada en el contexto.
    for (const mixed of [buildAiPlanMarkdown(base({ tasks: tasks(3, (i) => (i ? "Corrección" : "Mejora")) })), buildAiPlanMarkdown(base({ tasks: tasks(3, (i) => (i ? "Corrección" : undefined)) }))]) {
      assert.ok(!mixed.includes("Tipo de todas las tareas") && mixed.includes("- **Tipo:** Corrección"), mixed);
    }
    // Una sola tarea: en la tarea, como antes.
    assert.ok(buildAiPlanMarkdown(base({ tasks: tasks(1) })).includes("### 1. Tarea 0\n\n- **Tipo:** Corrección"));
    // En inglés también.
    assert.ok(buildAiPlanMarkdown(base({ tasks: tasks(2) }), makeT("en")).includes("- **Type of all tasks:** Corrección"));
  });

  test("ahorro en un plan de 500 tareas del mismo tipo", () => {
    const now = buildAiPlanMarkdown(base({ tasks: tasks(500) }));
    // Lo que salía antes: sin la línea del contexto y con «- **Tipo:** …» bajo el título de cada tarea.
    const before = now.replace("- **Tipo de todas las tareas:** Corrección\n", "").replace(/^(### \d+\. Tarea \d+)$/gm, "$1\n\n- **Tipo:** Corrección");
    const saved = before.length - now.length;
    // 24 caracteres por tarea («\n\n- **Tipo:** Corrección») menos los 43 de la línea del contexto: 11 957 de unos 25 000.
    assert.equal(saved, 500 * "\n\n- **Tipo:** Corrección".length - "- **Tipo de todas las tareas:** Corrección\n".length);
    assert.equal(saved, 11_957);
    assert.ok(saved / before.length > 0.4, `${saved} de ${before.length}`);
  });
});

test("plan demasiado largo para Documentación: el aviso dice cuánto tiene, el tope y qué hacer, en los dos idiomas", () => {
  assert.equal(AI_PLAN_SAVE_MAX, 200_000);
  assert.match(aiPlanTooLong(makeT("es"), 230_500, "es-ES"), /^El plan tiene 230\.500 caracteres y en Documentación caben como mucho 200\.000: cópialo con «Copiar todo» o descárgalo en \.md/);
  assert.match(aiPlanTooLong(makeT("en"), 230_500, "en-US"), /^The plan has 230,500 characters and Documentation holds at most 200,000: copy it with “Copy all” or download it as \.md/);
});
