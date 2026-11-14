// Plan de trabajo para IA (columna AI_PLAN): texto generado, nombres de fichero, versiones y el rol de la columna.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { makeT } from "../src/i18n/core";
import { EN } from "../src/i18n/en";
import { AI_PLAN_DEFAULTS, AI_PLAN_ZIP_FOLDER, aiPlanDownloadName, aiPlanFileName, buildAiPlanMarkdown, highestPlanVersion, planAttachmentPaths, planDescription, type AiPlanInput } from "../src/lib/ai-plan";
import {
  COLUMN_ROLE_HINT, COLUMN_ROLE_LABEL, COLUMN_ROLES, EVERGREEN_COLUMN_ROLES, hasEvergreenTasks, isUniqueColumnRole, releaseTemplateRows, TEMPLATE_KINDS,
} from "../src/lib/constants";
import { aiPlanZipName, evergreenDue, swapTemplateBlock } from "../src/lib/release";

const base = (over: Partial<AiPlanInput> = {}): AiPlanInput => ({
  header: AI_PLAN_DEFAULTS.es.header,
  footer: AI_PLAN_DEFAULTS.es.footer,
  project: { name: "Web", description: "Tienda en línea.\n\n## Stack\n\nNext.js", url: "https://pz.example.com/p/p1" },
  column: "Plan de trabajo para IA",
  date: "2026-11-23",
  origin: "https://pz.example.com",
  tasks: [
    {
      id: "t1", title: "Arreglar @[Ana](user:u1) el login", kind: "Corrección", url: "https://pz.example.com/p/p1?task=t1",
      description: "Falla al entrar.\n\n# Pasos\n\n```\n# no es un título\n```\n\n![captura](/api/attachments/a9) -&gt; ver",
      subtasks: [{ title: "Reproducir", done: true }, { title: "Corregir y probar", done: false }],
      labels: ["Urgente", "Backend"], dueDate: "2026-11-30", startDate: "2026-11-24", priority: "Alta",
      linkUrl: "https://github.com/example/web/issues/1", links: [{ title: "Diseño [v2]", url: "https://docs.google.com/document/d/x" }],
      attachments: [{ name: "log.txt", url: "https://pz.example.com/api/attachments/a1" }],
    },
    { id: "t2", title: "Añadir pruebas", kind: "Funcionalidad", blockedBy: { title: "Arreglar el login", index: 1 } },
    { id: "t3", title: "Revisar estilo", evergreen: true, blockedBy: { title: "Otra cosa" } },
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

  test("contexto del proyecto: nombre con enlace, columna, fecha, número de tareas y descripción (títulos rebajados)", () => {
    const md = buildAiPlanMarkdown(base());
    assert.match(md, /- \*\*Proyecto:\*\* \[Web\]\(<https:\/\/pz\.example\.com\/p\/p1>\)/);
    assert.match(md, /- \*\*Columna:\*\* Plan de trabajo para IA/);
    assert.match(md, /- \*\*Fecha:\*\* 2026-11-23/);
    assert.match(md, /- \*\*Tareas:\*\* 3/);
    assert.match(md, /Tienda en línea\.\n\n##### Stack\n\nNext\.js/);
  });

  test("cada tarea lleva tipo, prioridad, etiquetas, fechas, enlaces, documentos, adjuntos, descripción y checklist", () => {
    const md = buildAiPlanMarkdown(base());
    const t1 = md.slice(md.indexOf("### 1."), md.indexOf("### 2."));
    for (const line of [
      "- **Tipo:** Corrección", "- **Prioridad:** Alta", "- **Etiquetas:** Urgente, Backend", "- **Fecha de inicio:** 2026-11-24", "- **Fecha límite:** 2026-11-30",
      "- **Tarea en Pizarro:** [abrir](<https://pz.example.com/p/p1?task=t1>)",
      "- **Enlace:** [https://github.com/example/web/issues/1](<https://github.com/example/web/issues/1>)",
      "- **Documentos:** [Diseño \\[v2\\]](<https://docs.google.com/document/d/x>)",
      "- **Adjuntos:** [log.txt](<https://pz.example.com/api/attachments/a1>)",
      "**Descripción:**", "**Checklist (criterios de aceptación):**", "- [x] Reproducir", "- [ ] Corregir y probar",
    ]) assert.ok(t1.includes(line), line);
    // Títulos de la descripción rebajados (no compiten con los del plan), pero no dentro del código; entidades y enlaces a adjuntos.
    assert.ok(t1.includes("#### Pasos"));
    assert.ok(t1.includes("```\n# no es un título\n```"));
    assert.ok(t1.includes("![captura](https://pz.example.com/api/attachments/a9) -> ver"));
    // Sin datos que no tiene: ni «Fecha límite» ni checklist en la 2.
    const t2 = md.slice(md.indexOf("### 2."), md.indexOf("### 3."));
    assert.ok(!t2.includes("Fecha límite") && !t2.includes("Checklist"));
    assert.ok(t2.includes("- **Depende de:** la tarea 1 («Arreglar el login»)"));
  });

  test("tarea fija y dependencia de una tarea que no está en el plan", () => {
    const md = buildAiPlanMarkdown(base());
    const t3 = md.slice(md.indexOf("### 3."));
    assert.ok(t3.includes("- _Tarea fija: entra en todos los planes._"));
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
    for (const piece of ["# Work plan – Web", "## Instructions for the AI", "## Project context", "- **Type:** Corrección", "- **Due date:** 2026-11-30", "**Checklist (acceptance criteria):**", "- **Depends on:** task 1", "## Delivery"]) {
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

  test("el texto cita las rutas del ZIP, sustituye las imágenes de la descripción y explica el ZIP; sin ruta, solo enlaces", () => {
    const { byAttachment } = planAttachmentPaths(tasks);
    const withPaths = (path: boolean) => buildAiPlanMarkdown({
      header: AI_PLAN_DEFAULTS.es.header, footer: "", project: { name: "Web" }, date: "2026-11-23", origin: "https://pz.example.com",
      tasks: [{
        id: "t1", title: "Arreglar", description: "Mira ![captura](/api/attachments/a1) y ![otra](/api/attachments/zz) y ![c](/api/attachments/a1?thumb=1)",
        attachments: [{ id: "a1", name: "Plano final.png", url: "https://pz.example.com/api/attachments/a1", path: path ? byAttachment.get("a1") : undefined }],
      }],
    });
    const md = withPaths(true);
    assert.ok(md.includes("- **Adjuntos:** 1 archivo(s) en el ZIP «adjuntos/…»"));
    assert.ok(md.includes("  - `adjuntos/01-arreglar-ana-el-login-nandu/Plano_final.webp` ([Plano final.png en Pizarro](<https://pz.example.com/api/attachments/a1>))"));
    assert.ok(md.includes("![captura](adjuntos/01-arreglar-ana-el-login-nandu/Plano_final.webp)"));
    assert.ok(md.includes("![c](adjuntos/01-arreglar-ana-el-login-nandu/Plano_final.webp)"));
    // Una imagen que no es adjunto de ninguna tarea del plan queda con su enlace absoluto.
    assert.ok(md.includes("![otra](https://pz.example.com/api/attachments/zz)"));
    assert.ok(md.includes("ZIP «adjuntos/…» que acompaña a este plan"));
    const plain = withPaths(false);
    assert.ok(!plain.includes("en el ZIP «adjuntos/…» que va con este plan") && plain.includes("![captura](https://pz.example.com/api/attachments/a1)"));
    assert.ok(plain.includes("- **Adjuntos:** [Plano final.png](<https://pz.example.com/api/attachments/a1>)"));
    // Sin ZIP (más de 200 tareas con adjuntos): el contexto aclara que van solo como enlaces, pese a la cabecera de serie.
    assert.ok(plain.includes("- **Adjuntos:** Este plan no lleva ZIP de adjuntos: van solo como enlaces a Pizarro"));
    assert.ok(!md.includes("no lleva ZIP"));
  });

  test("planDescription sin mapa deja los enlaces absolutos como siempre", () => {
    assert.equal(planDescription("![a](/api/attachments/x1)", "https://pz.example.com"), "![a](https://pz.example.com/api/attachments/x1)");
    assert.equal(planDescription("![a](/api/attachments/x1)", "https://pz.example.com", new Map([["x1", "adjuntos/01-t/a.webp"]])), "![a](adjuntos/01-t/a.webp)");
  });

  test("nombre del ZIP", () => {
    assert.equal(aiPlanZipName({ day: "2026-11-23", version: 3, project: "Mi Web" }), "plan-2026-11-23-v3-Mi_Web-adjuntos.zip");
    assert.equal(aiPlanZipName({ day: "2026-11-23", version: 3, project: "Mi Web" }, 2, 3, "en"), "plan-2026-11-23-v3-Mi_Web-attachments-2of3.zip");
  });

  test("la plantilla de serie explica el ZIP «adjuntos/…» en los dos idiomas", () => {
    assert.ok(AI_PLAN_DEFAULTS.es.header.includes("«adjuntos/…»") && AI_PLAN_DEFAULTS.en.header.includes("adjuntos/…"));
  });
});
