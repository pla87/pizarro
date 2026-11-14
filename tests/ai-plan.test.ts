// Plan de trabajo para IA (columna AI_PLAN): texto generado, nombres de fichero, versiones y el rol de la columna.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { makeT } from "../src/i18n/core";
import { EN } from "../src/i18n/en";
import { AI_PLAN_DEFAULTS, aiPlanDownloadName, aiPlanFileName, buildAiPlanMarkdown, highestPlanVersion, planDescription, type AiPlanInput } from "../src/lib/ai-plan";
import {
  COLUMN_ROLE_HINT, COLUMN_ROLE_LABEL, COLUMN_ROLES, EVERGREEN_COLUMN_ROLES, hasEvergreenTasks, isUniqueColumnRole, releaseTemplateRows, TEMPLATE_KINDS,
} from "../src/lib/constants";
import { evergreenDue, swapTemplateBlock } from "../src/lib/release";

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
