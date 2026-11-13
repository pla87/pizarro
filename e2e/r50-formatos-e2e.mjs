// Formatos del material de un curso (ronda 50): cerrar «Generar release» con el texto cambiado pide confirmación (Escape,
// Cancelar, la X o clic fuera; sin cambios cierra directo), en los dos modos del editor; los párrafos vacíos del editor
// con barra salen como una línea en blanco (sin «&nbsp;») en Copiar todo, .md, .txt, lo guardado, el historial de
// releases y la descripción copiada; Google Slides desde la tarjeta como Docs y Sheets; y adjuntos y documentos en .md,
// .pdf, .html, .docx y .pptx, con el HTML visto en un marco aislado (sus scripts nunca se ejecutan en el origen de la app).
// Misma base y servidor que board-e2e.mjs; la parte «slides» necesita el servidor con Google configurado (valores de
// prueba: GOOGLE_CLIENT_ID=r50 GOOGLE_CLIENT_SECRET=r50; no llama a Google):
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r50-formatos-e2e.mjs   # PART=relclose,nbsp,slides,html
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep, COL } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "relclose,nbsp,slides,html").split(",");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "r50-"));

await L.prepareUsers();
await L.cleanBoard();
const p = await L.project();
const [admin] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
const setEditor = (mode) => L.q(`UPDATE "User" SET "editorMode"=$2 WHERE id=$1`, [admin.id, mode]);

// --- Release: utilidades (como en r49-copy-e2e.mjs) -----------------------------------------------------------------
const HEADER = "# Novedades r50\n\nHola, esto es lo nuevo.";
const FOOTER = "Gracias r50";
const FOOTER2 = "Más info r50";
async function seedRelease() {
  await L.cleanBoard();
  await L.q(`DELETE FROM "ReleaseTemplate" WHERE "userId"=$1`, [admin.id]);
  await L.q(`INSERT INTO "ReleaseTemplate"(id,"userId",kind,name,content,position) VALUES ('r50_h','${admin.id}','HEADER','Cabecera r50',$1,1),('r50_f','${admin.id}','FOOTER','Pie r50',$2,1),('r50_f2','${admin.id}','FOOTER','Pie dos r50',$3,2)`, [HEADER, FOOTER, FOOTER2]);
  const [uno] = await L.seedTasks(COL.next, ["Tarea Uno r50", "Tarea Dos r50"]);
  await L.q(`UPDATE "Task" SET description='Descripción de Uno' WHERE id=$1`, [uno]);
}
async function openRelease(page) {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press("Alt+R");
  const dlg = U.dialog(page);
  await dlg.getByText("Paso 1 de 2").waitFor();
  await sleep(1500); // el número de la release llega del servidor al abrir
  return dlg;
}
async function generate(page) {
  const dlg = await openRelease(page);
  await dlg.getByRole("button", { name: /Generar con 2 tarea/ }).click();
  await dlg.getByText("Paso 2 de 2").waitFor({ timeout: 20000 });
  return dlg;
}
async function download(page, dlg, ext) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), dlg.getByRole("button", { name: `.${ext}`, exact: true }).click()]);
  const file = path.join(TMP, `dl-${Date.now()}.${ext}`);
  await dl.saveAs(file);
  return fs.readFileSync(file, "utf8");
}
async function caretAfter(page, text) {
  const pt = await page.evaluate((text) => {
    const root = document.querySelector("[data-release-editor=rich] .ProseMirror");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.data.indexOf(text);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i + text.length - 1);
      r.setEnd(n, i + text.length);
      const box = r.getBoundingClientRect();
      return { x: box.right - 1, y: box.top + box.height / 2 };
    }
    throw new Error(`no está «${text}»`);
  }, text);
  await page.mouse.click(pt.x, pt.y);
  await sleep(200);
}
const releaseOpen = (page) => page.getByText(/Paso [12] de 2/).count().then((n) => n > 0);
const askClose = (page) => page.locator("[role=dialog]").filter({ hasText: "Has cambiado el texto de la release" });

// --- Cerrar «Generar release» con el texto cambiado -----------------------------------------------------------------
if (only.includes("relclose")) {
  await seedRelease();
  for (const mode of ["MARKDOWN", "WYSIWYG"]) {
    const M = mode === "MARKDOWN" ? "RELCLOSE-MD" : "RELCLOSE-BARRA";
    L.scenario(`relclose: ${mode === "MARKDOWN" ? "editor Markdown" : "editor con barra"}`);
    await setEditor(mode);
    const s = await L.session();
    const { page } = s;
    const edit = async (dlg) => {
      if (mode === "MARKDOWN") {
        const box = dlg.locator("textarea[aria-label='Contenido de la release']");
        await box.click();
        await page.keyboard.press("Control+End");
        await page.keyboard.type("\nLínea añadida r50");
      } else {
        await dlg.locator("[data-release-editor=rich] .ProseMirror").waitFor({ timeout: 10000 });
        await caretAfter(page, "Tarea Dos r50");
        await page.keyboard.type(" cambiada");
      }
    };
    const shown = async (dlg) => (mode === "MARKDOWN" ? dlg.locator("textarea[aria-label='Contenido de la release']").inputValue() : dlg.locator("[data-release-editor=rich] .ProseMirror").innerText());

    // Sin cambios: Escape cierra directamente.
    let dlg = await generate(page);
    if (mode === "WYSIWYG") await dlg.locator("[data-release-editor=rich] .ProseMirror").waitFor({ timeout: 10000 });
    await page.keyboard.press("Escape");
    await L.eqEventually(`${M}: sin cambios, Escape cierra sin preguntar`, () => releaseOpen(page), false, { timeout: 5000 });
    L.eq(`${M}: sin cambios no sale la pregunta`, await askClose(page).count(), 0);

    // Cambiar el pie no cuenta como cambiar el texto: la X cierra directamente.
    dlg = await generate(page);
    await dlg.locator("#rel-footer").selectOption({ label: "Pie dos r50" });
    await sleep(300);
    await dlg.getByRole("button", { name: "Cerrar", exact: true }).click();
    await L.eqEventually(`${M}: tras cambiar solo el pie, la X cierra sin preguntar`, () => releaseOpen(page), false, { timeout: 5000 });

    // Con el texto cambiado: Escape, la X y el clic fuera preguntan; «Seguir editando» conserva lo escrito.
    dlg = await generate(page);
    await edit(dlg);
    const typed = await shown(dlg);
    for (const [how, act] of [
      ["Escape", () => page.keyboard.press("Escape")],
      ["la X", () => dlg.getByRole("button", { name: "Cerrar", exact: true }).click()],
      ["el clic fuera", () => page.mouse.click(4, 4)],
    ]) {
      await act();
      const ask = askClose(page);
      L.check(`${M}: con cambios, ${how} pregunta antes de cerrar`, await ask.waitFor({ timeout: 5000 }).then(() => true, () => false));
      if (how === "Escape") await page.screenshot({ path: `${SHOTS}/r50-release-cerrar-${mode.toLowerCase()}.png` });
      await ask.getByRole("button", { name: "Seguir editando" }).click();
      await sleep(300);
      L.check(`${M}: «Seguir editando» (tras ${how}) deja el diálogo abierto con lo escrito`, (await releaseOpen(page)) && (await shown(dlg)) === typed);
    }
    // Varias pulsaciones de Escape no apilan preguntas.
    await page.keyboard.press("Escape");
    await askClose(page).waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await sleep(300);
    L.eq(`${M}: Escape con la pregunta abierta la cierra sin abrir otra`, await askClose(page).count(), 0);
    L.check(`${M}: …y el diálogo sigue abierto`, await releaseOpen(page));
    // «Descartar cambios» cierra.
    await dlg.getByRole("button", { name: "Cerrar", exact: true }).click();
    await askClose(page).getByRole("button", { name: "Descartar cambios" }).click();
    await L.eqEventually(`${M}: «Descartar cambios» cierra el diálogo`, () => releaseOpen(page), false, { timeout: 5000 });

    // Paso 1: «Cancelar» cierra directamente; tras «Cambiar tareas» (que ya avisa) tampoco vuelve a preguntar.
    dlg = await openRelease(page);
    await dlg.getByRole("button", { name: "Cancelar", exact: true }).click();
    await L.eqEventually(`${M}: «Cancelar» en el paso 1 cierra`, () => releaseOpen(page), false, { timeout: 5000 });
    dlg = await generate(page);
    await edit(dlg);
    await dlg.getByRole("button", { name: "Cambiar tareas" }).click();
    await page.locator("[role=dialog]").filter({ hasText: "Se perderán los cambios" }).getByRole("button", { name: "Continuar" }).click();
    await dlg.getByText("Paso 1 de 2").waitFor();
    await dlg.getByRole("button", { name: "Cancelar", exact: true }).click();
    await L.eqEventually(`${M}: de vuelta en el paso 1, «Cancelar» cierra sin preguntar`, () => releaseOpen(page), false, { timeout: 5000 });
    L.eq(`${M}: …sin la pregunta`, await askClose(page).count(), 0);
    L.assertNoErrors(M, [s]);
    await s.ctx.close();
  }
}

// --- Párrafos vacíos con el editor con barra: una línea en blanco, sin «&nbsp;» --------------------------------------
if (only.includes("nbsp")) {
  L.scenario("nbsp: párrafos vacíos en la release con barra, en el historial y en la descripción copiada");
  await seedRelease();
  await setEditor("WYSIWYG");
  const s = await L.session();
  const { page } = s;
  await s.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
  const dlg = await generate(page);
  await dlg.locator("[data-release-editor=rich] .ProseMirror").waitFor({ timeout: 10000 });
  const orig = await download(page, dlg, "md");
  L.check("NBSP: el texto generado no lleva «&nbsp;»", !orig.includes("&nbsp;"), orig);
  // Intro tres veces detrás de la cabecera: párrafos vacíos entre bloques sin tocar → el texto de partida, exacto.
  await caretAfter(page, "esto es lo nuevo.");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Enter");
  L.eq("NBSP: tres párrafos vacíos entre bloques sin tocar: .md idéntico al generado", await download(page, dlg, "md"), orig);
  // Texto nuevo entre párrafos vacíos: una sola línea en blanco a cada lado (la descarga se llevó el foco: se vuelve).
  await caretAfter(page, "esto es lo nuevo.");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Nota r50");
  for (let i = 0; i < 2; i++) await page.keyboard.press("Enter");
  await caretAfter(page, "Tarea Dos r50");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Detalle r50");
  await page.screenshot({ path: `${SHOTS}/r50-release-parrafos-vacios.png` });
  const md = await download(page, dlg, "md");
  const txt = await download(page, dlg, "txt");
  await dlg.getByRole("button", { name: "Copiar todo" }).click();
  await page.getByText("Copiado al portapapeles").first().waitFor();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  for (const [name, text] of [[".md", md], [".txt", txt], ["Copiar todo", clip]]) {
    L.check(`NBSP: ${name} sin «&nbsp;»`, !text.includes("&nbsp;"), text);
    L.check(`NBSP: ${name} sin líneas en blanco repetidas`, !/\n[ \t]*\n[ \t]*\n/.test(text), JSON.stringify(text));
  }
  L.eq("NBSP: .txt y Copiar todo = .md", [txt, clip], [md, md]);
  L.check("NBSP: la nota va en su párrafo, con una línea en blanco a cada lado", md.includes("Hola, esto es lo nuevo.\n\nNota r50\n\n### "), JSON.stringify(md.slice(0, 120)));
  L.check("NBSP: el texto tras la tarea, en su párrafo", /\n\nDetalle r50\n\n/.test(md), JSON.stringify(md));
  L.check("NBSP: lo no tocado sale igual (cabecera con «#», pie)", md.startsWith("# Novedades r50\n") && md.endsWith(`${FOOTER}\n`));
  // Desplegar guarda el mismo texto.
  await dlg.getByRole("button", { name: "Marcar como desplegado" }).click();
  await page.locator("[role=dialog]").filter({ hasText: "Desplegar la release" }).getByRole("button", { name: "Continuar" }).click();
  await L.waitFor(async () => (await L.q(`SELECT count(*)::int n FROM "Release"`))[0].n === 1, { timeout: 15000 });
  const [saved] = await L.q(`SELECT content FROM "Release"`);
  L.eq("NBSP: lo guardado al desplegar = .md", saved.content, md);

  // Historial: una release guardada antes con «&nbsp;» se copia y se descarga sin él.
  const old = "Hola\n\n&nbsp;\n\n&nbsp;\n\n### Funcionalidad\n- **R1F1** · Antigua\n";
  await L.q(`INSERT INTO "Release"(id,"projectId",number,title,content,"deployedAt") VALUES ('r50_old',$1,99,'Release antigua r50',$2,NOW() - interval '1 day')`, [p.id, old]);
  await page.goto(`${L.BASE}/p/${p.id}/releases`);
  const entry = page.locator("article").filter({ hasText: "Release antigua r50" });
  await entry.getByRole("button").first().click();
  const [dl] = await Promise.all([page.waitForEvent("download"), entry.getByRole("button", { name: ".md", exact: true }).click()]);
  const file = path.join(TMP, "antigua.md");
  await dl.saveAs(file);
  L.eq("NBSP: historial: el .md de una release antigua sale sin «&nbsp;»", fs.readFileSync(file, "utf8"), "Hola\n\n### Funcionalidad\n- **R1F1** · Antigua\n");
  await entry.getByRole("button", { name: "Copiar", exact: true }).click();
  await sleep(300);
  L.eq("NBSP: historial: Copiar, igual", await page.evaluate(() => navigator.clipboard.readText()), "Hola\n\n### Funcionalidad\n- **R1F1** · Antigua\n");

  // Descripción guardada con párrafos vacíos: «Copiar descripción» deja el texto plano sin «&nbsp;».
  const [tid] = await L.seedTasks(COL.backlog, ["Descripción con huecos r50"]);
  await L.q(`UPDATE "Task" SET description=$2 WHERE id=$1`, [tid, "Uno r50\n\n&nbsp;\n\n&nbsp;\n\nDos r50"]);
  await page.goto(`${L.BASE}/p/${p.id}`);
  await L.board(page);
  await U.openTask(page, "Descripción con huecos r50");
  await U.dialog(page).getByTestId("desc-copy").click();
  await sleep(400);
  L.eq("NBSP: «Copiar descripción» sin «&nbsp;»", await page.evaluate(() => navigator.clipboard.readText()), "Uno r50\n\nDos r50");
  L.assertNoErrors("NBSP", [s]);
  await s.ctx.close();
}

// --- Google Slides desde la tarjeta ----------------------------------------------------------------------------------
if (only.includes("slides")) {
  L.scenario("slides: Google Slides como Docs y Sheets");
  await L.cleanBoard();
  const [tid] = await L.seedTasks(COL.backlog, ["Curso r50"]);
  await L.q(`DELETE FROM "GoogleAccount" WHERE "userId"=$1`, [admin.id]);
  await L.q(`INSERT INTO "TaskLink"(id,"taskId",kind,title,url,"externalId","shareStatus") VALUES ('r50_slides',$1,'GOOGLE_SLIDES','Clase 1 r50','https://docs.google.com/presentation/d/r50pres/edit','r50pres','SHARED')`, [tid]);
  for (const mode of ["WYSIWYG", "MARKDOWN"]) {
    await setEditor(mode);
    const s = await L.session();
    const { page } = s;
    await U.openTask(page, "Curso r50");
    const dlg = U.dialog(page);
    const section = dlg.locator("section").filter({ has: page.getByRole("heading", { name: "Documentos de Google" }) });
    if (!(await section.waitFor({ timeout: 8000 }).then(() => true, () => false))) {
      L.check("SLIDES: el servidor tiene Google configurado (arráncalo con GOOGLE_CLIENT_ID=r50 GOOGLE_CLIENT_SECRET=r50)", false);
      await s.ctx.close();
      break;
    }
    if (mode === "WYSIWYG") {
      const link = section.getByRole("link", { name: "Clase 1 r50" });
      L.eq("SLIDES: el enlace de la presentación se ve en la tarjeta", await link.getAttribute("href"), "https://docs.google.com/presentation/d/r50pres/edit");
      const icon = (await section.locator("li", { has: page.getByRole("link", { name: "Clase 1 r50" }) }).locator("svg").first().getAttribute("class")) ?? "";
      L.check("SLIDES: con el icono de presentación", /presentation/.test(icon), icon);
      for (const name of ["Nuevo Doc", "Nuevo Sheet", "Nuevo Slides"]) L.check(`SLIDES: botón «${name}»`, await section.getByRole("button", { name }).isVisible());
      const fits = await section.evaluate((el) => [...el.querySelectorAll("button")].every((b) => b.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1));
      L.check("SLIDES: los tres botones caben en la sección", fits);
      await page.screenshot({ path: `${SHOTS}/r50-slides-detalle.png` });
      // Sin la cuenta conectada, el mismo aviso que con Docs y Sheets.
      await section.getByRole("button", { name: "Nuevo Slides" }).click();
      L.check("SLIDES: sin cuenta conectada, pide conectarla en «Mi perfil»", await page.getByText("Conecta tu cuenta de Google en «Mi perfil» para crear documentos.").first().waitFor({ timeout: 5000 }).then(() => true, () => false));
      L.eq("SLIDES: no se abre ninguna pestaña", s.ctx.pages().length, 1);
      L.check("SLIDES: el comentario sugiere @slides", (await dlg.getByPlaceholder("Comenta… (@persona, @docs, @sheets, @slides)").count()) === 1);
    }
    // @slides en la descripción (con barra y Markdown).
    await dlg.getByRole("button", { name: "Editar", exact: true }).first().click();
    await sleep(300);
    await (mode === "WYSIWYG" ? dlg.locator(".ProseMirror").first() : dlg.getByPlaceholder("Markdown · @persona · @docs / @sheets / @slides")).click();
    await page.keyboard.type(" @slid");
    const option = page.getByRole("option", { name: /Crear Google Slides/ }).or(page.locator("button", { hasText: "Crear Google Slides" }));
    L.check(`SLIDES: ${mode === "WYSIWYG" ? "con barra" : "Markdown"}: «@slid» ofrece «Crear Google Slides»`, await option.first().waitFor({ timeout: 5000 }).then(() => true, () => false));
    await page.keyboard.type("x");
    await page.keyboard.press("Backspace");
    for (let i = 0; i < 4; i++) await page.keyboard.press("Backspace"); // queda «@»
    await page.keyboard.type("google");
    await sleep(300);
    const commands = await page.locator("button").filter({ hasText: /^Crear Google (Doc|Sheet|Slides)/ }).allInnerTexts();
    L.eq(`SLIDES: ${mode}: «@google» ofrece Doc, Sheet y Slides`, commands.map((c) => c.split("\n")[0]).sort(), ["Crear Google Doc", "Crear Google Sheet", "Crear Google Slides"]);
    await page.keyboard.press("Escape"); // cierra solo la lista de sugerencias
    await sleep(200);
    L.eq(`SLIDES: ${mode}: Escape cierra la lista sin cerrar el detalle`, await U.dialog(page).getByRole("heading", { name: "Documentos de Google" }).count(), 1);
    await dlg.locator("section").filter({ has: page.getByRole("heading", { name: "Descripción", exact: true }) }).getByRole("button", { name: "Cancelar", exact: true }).click();
    L.assertNoErrors(`SLIDES-${mode}`, [s]);
    await s.ctx.close();
  }
  // Móvil: la sección cabe sin desplazamiento horizontal.
  const m = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  await U.openTask(m.page, "Curso r50");
  await U.dialog(m.page).getByRole("button", { name: "Nuevo Slides" }).scrollIntoViewIfNeeded().catch(() => {});
  await m.page.screenshot({ path: `${SHOTS}/r50-slides-movil.png` });
  L.check("SLIDES: móvil: sin desplazamiento horizontal", await m.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const h3 = await U.dialog(m.page).getByRole("heading", { name: "Documentos de Google" }).boundingBox();
  L.check("SLIDES: móvil: el título «Documentos de Google» en una línea (los botones pasan debajo)", h3.height < 26, JSON.stringify(h3));
  // Mi perfil nombra Slides.
  await m.page.goto(`${L.BASE}/settings?tab=cuenta`);
  L.check("SLIDES: «Mi perfil» → «Google Docs, Sheets y Slides»", await m.page.getByRole("heading", { name: "Google Docs, Sheets y Slides" }).waitFor({ timeout: 10000 }).then(() => true, () => false));
  L.assertNoErrors("SLIDES-MOVIL", [m]);
  await m.ctx.close();
}

// --- Adjuntos y Documentación en .md, .pdf, .html, .docx y .pptx; el HTML nunca se ejecuta en el origen de la app ----
if (only.includes("html")) {
  L.scenario("html: material de un curso en Documentación y como adjuntos");
  await L.cleanBoard();
  await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1`, [p.id]);
  await setEditor("WYSIWYG");
  const HTML = `<!doctype html><html><head><title>Tema 1</title><meta http-equiv="refresh" content="0;url=https://example.com/fuera">
<script>localStorage.setItem("pz-r50-xss","1"); try { top.document.title = "XSS"; top.__pzXss = 1; } catch (e) {} parent.postMessage("xss","*");</script>
<style>h1 { color: rgb(200, 30, 30); }</style></head>
<body><h1>Tema 1 del curso</h1><p style="font-weight:bold">Texto con estilo.</p>
<img src="x" onerror="localStorage.setItem('pz-r50-xss','img')"><img src="https://example.com/pixel.png" alt="externa">
<a id="fuera" href="https://example.com/r50">Enlace externo</a> <a id="js" href="javascript:localStorage.setItem('pz-r50-xss','a')">js</a>
<iframe src="/settings"></iframe><svg><script>localStorage.setItem("pz-r50-xss","svg")</script></svg></body></html>`;
  const files = {
    "tema.html": HTML,
    "guia.md": "# Guía r50\n\nTexto **importante**.\n",
    "tema.pdf": "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
    "tema.docx": "PK\u0003\u0004 documento de Word de prueba",
    "clase.pptx": "PK\u0003\u0004 presentación de PowerPoint de prueba",
  };
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(TMP, name), body);
  const s = await L.session();
  const { page } = s;
  // Errores de consola esperados: la CSP del marco bloquea la imagen externa (lo buscado).
  const relevant = () => ({ errors: s.errors.filter((e) => !/Content Security Policy|Refused to (load|frame)|Blocked script execution|net::ERR_ABORTED/i.test(e)) });
  page.on("dialog", (d) => { s.errors.push(`dialog: ${d.message()}`); void d.dismiss(); });
  const xss = () => page.evaluate(() => ({ ls: localStorage.getItem("pz-r50-xss"), flag: window.__pzXss ?? null, title: document.title }));
  await page.goto(`${L.BASE}/p/${p.id}/docs`);
  await page.getByRole("heading", { name: /Documentación/ }).first().waitFor({ timeout: 15000 });
  const title0 = await page.evaluate(() => document.title);
  for (const name of Object.keys(files)) {
    await page.locator("input[type=file][aria-label='Subir archivos']").setInputFiles(path.join(TMP, name));
    await L.waitFor(async () => (await L.q(`SELECT 1 FROM "ProjectDocument" WHERE "projectId"=$1 AND name=$2`, [p.id, name])).length === 1, { timeout: 15000 });
  }
  const docs = Object.fromEntries((await L.q(`SELECT id,name,kind FROM "ProjectDocument" WHERE "projectId"=$1`, [p.id])).map((d) => [d.name, d]));
  L.eq("HTML: tipos de los documentos subidos", Object.fromEntries(Object.entries(docs).map(([n, d]) => [n, d.kind])), { "tema.html": "HTML", "guia.md": "MARKDOWN", "tema.pdf": "PDF", "tema.docx": "OTHER", "clase.pptx": "OTHER" });
  await page.reload();
  const open = async (name) => {
    await page.locator(`[data-doc-open="${docs[name].id}"]`).first().click();
    const viewer = U.dialog(page);
    await viewer.getByText(name).first().waitFor();
    return viewer;
  };
  const close = async () => { await page.keyboard.press("Escape"); await sleep(300); };

  // HTML: vista previa en un marco aislado.
  let viewer = await open("tema.html");
  const frameEl = viewer.locator("iframe[data-testid=doc-html]");
  await frameEl.waitFor({ timeout: 10000 });
  const frame = page.frameLocator("iframe[data-testid=doc-html]");
  L.check("HTML: se ve el contenido (título y texto con estilo)", await frame.getByRole("heading", { name: "Tema 1 del curso" }).waitFor({ timeout: 10000 }).then(() => true, () => false) && await frame.getByText("Texto con estilo.").isVisible());
  L.eq("HTML: los estilos del propio documento se aplican", await frame.getByRole("heading", { name: "Tema 1 del curso" }).evaluate((h) => getComputedStyle(h).color), "rgb(200, 30, 30)");
  L.eq("HTML: marco sin scripts ni mismo origen (sandbox)", await frameEl.getAttribute("sandbox"), "allow-popups allow-popups-to-escape-sandbox");
  const srcdoc = await frameEl.getAttribute("srcdoc");
  L.check("HTML: sin <script>, manejadores on…, javascript:, <iframe> ni meta refresh en lo que se pinta", !/<script|onerror=|javascript:|<iframe|http-equiv="refresh"/i.test(srcdoc), srcdoc);
  L.check("HTML: lleva su propia CSP sin red", srcdoc.includes(`http-equiv="Content-Security-Policy" content="default-src 'none'`));
  L.eq("HTML: los enlaces se abren aparte y sin acceso a la app", await frame.locator("#fuera").getAttribute("rel"), "noopener noreferrer");
  await sleep(1000);
  L.eq("HTML: nada se ha ejecutado en la app (almacenamiento, variables, título)", await xss(), { ls: null, flag: null, title: title0 });
  const child = await (await frameEl.elementHandle()).contentFrame();
  L.check("HTML: el marco tiene su propio origen (opaco)", !!child && (await child.evaluate(() => origin)) === "null");
  L.eq("HTML: desde el marco no se alcanza la página ni el almacenamiento de la app", child ? await child.evaluate(() => {
    const tryIt = (fn) => { try { fn(); return "accesible"; } catch { return "bloqueado"; } };
    return [tryIt(() => parent.document.title), tryIt(() => localStorage.length), tryIt(() => document.cookie)];
  }) : null, ["bloqueado", "bloqueado", "bloqueado"]);
  L.eq("HTML: la imagen externa no se carga (CSP del marco)", await frame.locator("img[alt=externa]").evaluate((img) => img.naturalWidth), 0);
  await page.screenshot({ path: `${SHOTS}/r50-html-vista.png` });
  const [dl] = await Promise.all([page.waitForEvent("download"), viewer.getByRole("link", { name: "Descargar" }).click()]);
  L.eq("HTML: «Descargar» baja el fichero tal cual", [dl.suggestedFilename(), fs.readFileSync(await dl.path(), "utf8")], ["tema.html", HTML]);
  await close();
  // Abierto directamente: texto plano, aislado, nunca como página.
  const direct = await s.ctx.newPage();
  const res = await direct.goto(`${L.BASE}/api/documents/${docs["tema.html"].id}`);
  const h = res.headers();
  L.eq("HTML: la dirección del documento lo sirve como texto plano", h["content-type"], "text/plain; charset=utf-8");
  L.check("HTML: con nosniff y CSP aislada", h["x-content-type-options"] === "nosniff" && /sandbox/.test(h["content-security-policy"] ?? "") && /default-src 'none'/.test(h["content-security-policy"] ?? ""));
  L.check("HTML: se ve el código, no la página", (await direct.locator("body").innerText()).includes("<script>localStorage.setItem"));
  const dlRes = await direct.request.get(`${L.BASE}/api/documents/${docs["tema.html"].id}?download=1`);
  L.eq("HTML: descargado, octet-stream y adjunto", [dlRes.headers()["content-type"], /^attachment/.test(dlRes.headers()["content-disposition"])], ["application/octet-stream", true]);
  await direct.close();
  L.eq("HTML: tras abrir la dirección, la app sigue intacta", await xss(), { ls: null, flag: null, title: title0 });

  // Markdown, PDF, Word y PowerPoint.
  viewer = await open("guia.md");
  L.check("DOCS: el .md se ve con formato", await viewer.getByTestId("doc-markdown").getByRole("heading", { name: "Guía r50" }).waitFor({ timeout: 8000 }).then(() => true, () => false));
  await close();
  viewer = await open("tema.pdf");
  L.eq("DOCS: el .pdf, en el visor del navegador", await viewer.locator(`iframe[src="/api/documents/${docs["tema.pdf"].id}"]`).count(), 1);
  await close();
  for (const name of ["tema.docx", "clase.pptx"]) {
    viewer = await open(name);
    L.check(`DOCS: ${name}: sin vista previa, se ofrece descargarlo`, await viewer.getByText("Este tipo de archivo no tiene vista previa").isVisible());
    const [d] = await Promise.all([page.waitForEvent("download"), viewer.getByRole("link", { name: "Descargar" }).click()]);
    L.eq(`DOCS: ${name}: se descarga entero`, [d.suggestedFilename(), fs.readFileSync(await d.path(), "utf8")], [name, files[name]]);
    await close();
  }

  // Adjuntos de una tarea con los mismos ficheros.
  await L.seedTasks(COL.backlog, ["Material r50"]);
  await page.goto(`${L.BASE}/p/${p.id}`);
  await L.board(page);
  await U.openTask(page, "Material r50");
  const dlg = U.dialog(page);
  const attached = () => L.q(`SELECT a.id,a."originalName",a."isImage" FROM "TaskAttachment" a JOIN "Task" t ON t.id=a."taskId" WHERE t.title='Material r50'`);
  for (const name of Object.keys(files)) {
    await dlg.locator("input[type=file]:not([capture])").first().setInputFiles(path.join(TMP, name));
    await L.waitFor(async () => (await attached()).some((a) => a.originalName === name), { timeout: 15000 });
  }
  const atts = Object.fromEntries((await attached()).map((a) => [a.originalName, a]));
  L.eq("ADJ: los cinco se suben como archivos (no imágenes)", Object.keys(atts).sort().map((n) => [n, atts[n].isImage]), ["clase.pptx", "guia.md", "tema.docx", "tema.html", "tema.pdf"].map((n) => [n, false]));
  await sleep(500);
  const row = (name) => dlg.locator("li").filter({ hasText: name });
  const iconOf = async (name) => (await row(name).locator("svg").first().getAttribute("class")) ?? "";
  L.check("ADJ: icono de presentación para el .pptx", /presentation/.test(await iconOf("clase.pptx")), await iconOf("clase.pptx"));
  L.check("ADJ: icono de código para el .html", /file-code/.test(await iconOf("tema.html")), await iconOf("tema.html"));
  await page.screenshot({ path: `${SHOTS}/r50-adjuntos.png` });
  const url0 = page.url();
  const [ad] = await Promise.all([page.waitForEvent("download"), dlg.getByRole("link", { name: "Descargar tema.html" }).click()]);
  L.eq("ADJ: el .html se descarga (tal cual)", [ad.suggestedFilename(), fs.readFileSync(await ad.path(), "utf8")], ["tema.html", HTML]);
  L.eq("ADJ: …sin salir de la app", page.url(), url0);
  for (const [name, type] of [["tema.html", "application/octet-stream"], ["guia.md", "application/octet-stream"], ["tema.pdf", "application/pdf"], ["tema.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["clase.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]]) {
    const r = await page.request.get(`${L.BASE}/api/attachments/${atts[name].id}`);
    L.eq(`ADJ: ${name}: siempre como adjunto, con su tipo seguro`, [r.status(), r.headers()["content-type"], /^attachment/.test(r.headers()["content-disposition"]), r.headers()["x-content-type-options"]], [200, type, true, "nosniff"]);
  }
  // Abrir la dirección del adjunto HTML descarga el fichero; no lo pinta en el origen de la app.
  const direct2 = await s.ctx.newPage();
  const [d2] = await Promise.all([direct2.waitForEvent("download", { timeout: 10000 }), direct2.goto(`${L.BASE}/api/attachments/${atts["tema.html"].id}`).catch(() => null)]);
  L.eq("ADJ: abrir la dirección del .html lo descarga", d2.suggestedFilename(), "tema.html");
  await direct2.close();
  L.eq("ADJ: la app sigue intacta", await xss(), { ls: null, flag: null, title: await page.evaluate(() => document.title) });
  L.eq("ADJ: el título de la app no cambió", (await xss()).title === "XSS", false);
  L.assertNoErrors("HTML", [relevant()]);
  await s.ctx.close();
}

fs.rmSync(TMP, { recursive: true, force: true });
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
