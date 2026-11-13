// Release editada con el editor con barra (R48C2): lo que la persona no toca conserva su Markdown exacto (y la cabecera y
// el pie se pueden seguir cambiando); lo editado sale como lo escribe el editor. `editorMarkdown` simula el editor (ida y
// vuelta con sus mismas extensiones, como al cargar el texto y guardarlo).
import assert from "node:assert/strict";
import { test } from "node:test";
import { editorMarkdown } from "../src/lib/editor-markdown";
import { keepUntouchedMarkdown } from "../src/lib/markdown-keep";
import { buildReleaseMarkdown, swapTemplateBlock } from "../src/lib/release";
import { bestTime } from "./timing";

const HEADER = "# Novedades\n\nHola **equipo**, esto es <importante> & más.";
const FOOTER = "_Gracias_ — el equipo";
const kinds = [{ id: "k1", name: "Funcionalidad" }, { id: "k2", name: "Bug" }] as never;
const base = buildReleaseMarkdown({
  header: HEADER,
  footer: FOOTER,
  kinds,
  tasks: [
    { id: "a", title: "Login con Google", kindId: "k1", linkUrl: "https://example.com/x?a=1&b=2", description: "Permite entrar.\n\n- punto uno\n- punto dos", attachments: [{ originalName: "captura.png", isImage: true }] },
    { id: "b", title: "Exportar a CSV", kindId: "k1", linkUrl: null, description: "Con **todas** las columnas.", attachments: [] },
    { id: "c", title: "Arreglo *raro* [x]", kindId: "k2", linkUrl: null, description: "", attachments: [] },
    { id: "d", title: "Otra", kindId: "zz", linkUrl: null, description: "texto con `code` y > flecha\nsegunda línea", attachments: [] },
  ] as never,
  releaseNumber: 3,
});
/** Lo que guardaría el editor tras cargar `md` y cambiar `from` por `to` (o nada). */
const editorAfter = (md: string, from?: string, to?: string) => editorMarkdown(from === undefined ? md : md.replace(from, to ?? ""));
const keep = (edited: string, from = base) => keepUntouchedMarkdown(from, edited, editorMarkdown);

test("el editor sí reescribe la release entera (por eso hace falta conservar lo no tocado)", () => {
  const raw = editorMarkdown(base);
  assert.notEqual(raw, base.trimEnd());
  assert.doesNotMatch(raw, /^# Novedades/);
});

test("sin tocar nada se devuelve el texto exacto", () => {
  assert.equal(keep(editorAfter(base)), base);
});

test("al editar el título de una tarea solo cambia ese elemento; el resto (cabecera con #, sangrías, enlaces <…>, pie) queda igual", () => {
  const out = keep(editorAfter(base, "Exportar a CSV", "Exportar a CSV y Excel"));
  const expected = base.replace("- **R3F2** · Exportar a CSV\n  Con **todas** las columnas.", "- **R3F2** · Exportar a CSV y Excel\nCon **todas** las columnas.");
  assert.equal(out, expected);
  assert.match(out, /^# Novedades\n\nHola \*\*equipo\*\*, esto es <importante> & más\.\n/);
  assert.match(out, /\(\[enlace\]\(<https:\/\/example\.com\/x\?a=1&b=2>\)\)\n {2}Adjuntos: R3F1_captura\.webp\n {2}Permite entrar\./);
  assert.ok(out.endsWith("_Gracias_ — el equipo\n"));
});

test("con el texto editado, cambiar la cabecera o el pie sigue sustituyendo el bloque anterior (no lo duplica)", () => {
  const edited = keep(editorAfter(base, "Otra", "Otra cosa"));
  const newHeader = "## Versión nueva";
  const swapped = swapTemplateBlock(edited, HEADER, newHeader, "start");
  assert.ok(swapped.startsWith("## Versión nueva\n\n### Funcionalidad"));
  assert.doesNotMatch(swapped, /Novedades/);
  const noFooter = swapTemplateBlock(swapped, FOOTER, "", "end");
  assert.doesNotMatch(noFooter, /Gracias/);
  assert.match(noFooter, /Otra cosa/);
  // Y vuelve a cargarse en el editor: sin tocar nada después, se exporta tal cual.
  assert.equal(keep(editorAfter(noFooter), noFooter), noFooter);
});

test("borrar una tarea, añadir un párrafo o editar la cabecera: cada cambio sale y lo demás se conserva", () => {
  const removed = keep(editorAfter(base, /- \*\*R3B1\*\* · Arreglo \*raro\* \\\[x\\\]\n/ as never, ""));
  assert.equal(removed, base.replace("### Bug\n- **R3B1** · Arreglo *raro* \\[x\\]\n", "### Bug\n"));

  const added = keep(`${editorAfter(base)}\n\nNota final añadida.`);
  assert.equal(added, `${base}\nNota final añadida.\n`);

  // La cabecera editada sale como la escribe el editor (sin el «#», que no admite); el resto, intacto.
  const header = keep(editorAfter(base, "Hola **equipo**", "Hola **a todos**"));
  assert.ok(header.startsWith("# Novedades\n\nHola **a todos**, esto es &lt;importante> & más.\n\n### Funcionalidad\n- **R3F1**"));
  assert.ok(header.endsWith("_Gracias_ — el equipo\n"));
});

test("la primera tarea de una sección, editada, sigue pegada a su título; un elemento convertido en párrafo no se pega a la lista", () => {
  const out = keep(editorAfter(base, "Login con Google", "Login con Google y Apple"));
  assert.match(out, /### Funcionalidad\n- \*\*R3F1\*\* · Login con Google y Apple/);
  const md = "- uno\n- dos\n- tres\n";
  const para = keepUntouchedMarkdown(md, "- uno\n\ndos cambiado\n\n- tres", editorMarkdown);
  assert.equal(para, "- uno\n\ndos cambiado\n\n- tres\n");
});

test("un elemento intacto con otra viñeta no se mezcla en la lista editada (empezaría otra lista)", () => {
  const md = "* uno\n* dos\n* tres\n";
  const out = keepUntouchedMarkdown(md, editorMarkdown(md.replace("dos", "DOS")), editorMarkdown);
  assert.equal(out, "- uno\n- DOS\n- tres\n");
});

test("texto que el lexer no puede alinear o vacío: se devuelve lo del editor", () => {
  assert.equal(keepUntouchedMarkdown(base, "", editorMarkdown), "");
  assert.equal(keepUntouchedMarkdown("", "hola", editorMarkdown), "hola");
});

test("rendimiento: release de 400 tareas con un cambio, en un tiempo proporcional a leerla una vez", () => {
  const big = buildReleaseMarkdown({
    header: HEADER, footer: FOOTER, kinds,
    tasks: Array.from({ length: 400 }, (_, i) => ({ id: `t${i}`, title: `Tarea número ${i}`, kindId: i % 2 ? "k1" : "k2", linkUrl: null, description: `Descripción ${i}.\n\n- uno **negrita**\n- dos`, attachments: [] })) as never,
    releaseNumber: 9,
  });
  const edited = editorAfter(big, "Tarea número 200", "Tarea número 200 (editada)");
  keepUntouchedMarkdown(big, edited, editorMarkdown); // primera vez: normaliza (y recuerda) cada bloque
  const reference = bestTime(() => editorMarkdown(`${big}\n\nx${Math.random()}`));
  const ms = bestTime(() => keepUntouchedMarkdown(big, edited, editorMarkdown));
  assert.ok(ms < Math.max(reference * 3, 50), `${Math.round(ms)} ms frente a ${Math.round(reference)} ms de leer la release entera`);
  const out = keepUntouchedMarkdown(big, edited, editorMarkdown);
  assert.equal(out.replace("Tarea número 200 (editada)\nDescripción 200.\n", "Tarea número 200\n  Descripción 200.\n\n"), big, "solo cambia la tarea editada");
});
