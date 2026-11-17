// Ronda 54: importar y exportar tareas en JSON (src/lib/task-json.ts, actions/task-json.ts). En la cabecera del tablero,
// junto a «Varias tareas», «Importar» abre un diálogo (pegar, portapapeles, fichero, arrastrar un fichero encima) con vista
// previa y «Columna de destino»; con tarjetas marcadas el botón pasa a «Exportar (N)» (descargar el .json o copiarlo), y lo
// exportado se vuelve a importar (dependencias del lote hacia las nuevas). Ctrl+V en el tablero con un JSON de tareas
// exacto abre el diálogo con el texto. «Nueva tarea» copia lo escrito como JSON e importa una tarea en el formulario
// (portapapeles, fichero y Ctrl+V fuera de un campo). Móvil (390 px: «Varias tareas» lleva a «Importar» y la barra de
// selección tiene «Exportar»), inglés y modo oscuro. Misma base y servidor que board-e2e.mjs:
// «pegar» (R54C1): Ctrl+V de una tarea copiada en «Nueva tarea» con el foco en el título vacío y en cualquier otro sitio, y
// desde el «+» de una columna. «extras»: etiquetas existentes, color y enlace en «Nueva tarea» (también a 390 px y en oscuro).
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r54-import-e2e.mjs      # PART=importar,exportar,nueva,pegar,extras,movil,ingles,oscuro
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { COL, sleep } = L;
const only = (process.env.PART || "importar,exportar,nueva,pegar,extras,movil,ingles,oscuro").split(",");

await L.prepareUsers();
const p0 = await L.project();
const [me] = await L.q(`SELECT id, name, email, locale, theme FROM "User" WHERE email=$1`, [L.ADMIN]);
await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [me.id]);

const clip = (page) => page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
const setClip = (page, text) => page.evaluate((v) => navigator.clipboard.writeText(v), text);
/** Avisos emergentes que se ven (de éxito y de error): los de la región «polite» de los avisos. */
const alerts = async (page) => (await page.locator("div.fixed[aria-live=polite] > div").allInnerTexts().catch(() => [])).filter((x) => x.trim()).join(" | ");
const withClipboard = async (opts = {}) => {
  const s = await L.session(opts);
  await s.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
  return s;
};
const boardTitles = async () => (await L.q(`SELECT t.title FROM "Task" t WHERE t."projectId"=$1 AND t."archivedAt" IS NULL ORDER BY t.title`, [p0.id])).map((r) => r.title);
const taskOf = async (title) => (await L.q(`SELECT t.id, t."blockedById", t."createdById", t."assigneeId", c.name AS col, to_char(t."dueDate",'YYYY-MM-DD') AS due FROM "Task" t JOIN "Column" c ON c.id=t."columnId" WHERE t.title=$1 ORDER BY t."createdAt" DESC LIMIT 1`, [title]))[0];
const labelNames = async () => (await L.q(`SELECT name FROM "Label" WHERE "projectId"=$1 ORDER BY name`, [p0.id])).map((r) => r.name);
const importDialog = (page) => page.getByRole("dialog", { name: /Importar tareas|Import tasks/ });

async function cleanLabels() {
  await L.q(`DELETE FROM "Label" WHERE "projectId"=$1`, [p0.id]);
}

// --- Importar varias desde el tablero ----------------------------------------------------------------------------------------
if (only.includes("importar")) {
  L.scenario("importar: el botón de la cabecera, pegar, vista previa, columna de destino, fichero, arrastrar y Ctrl+V en el tablero");
  await L.cleanBoard();
  await cleanLabels();
  await L.seedTasks(COL.backlog, ["Ya existía"]);
  const s = await withClipboard();
  const { page } = s;
  const btn = page.getByRole("button", { name: "Importar", exact: true });
  L.check("BOTÓN: «Importar» en la cabecera, junto a «Varias tareas»", await btn.isVisible() && (await btn.getAttribute("title")) === "Importar tareas desde JSON");
  const order = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => ["Importar", "Varias tareas"].includes(b.getAttribute("aria-label"))).map((b) => b.getAttribute("aria-label")));
  L.eq("BOTÓN: va justo antes de «Varias tareas»", order, ["Importar", "Varias tareas"]);
  await btn.click();
  const dlg = importDialog(page);
  await dlg.waitFor();
  const text = [
    "Aquí tienes las tareas:",
    "```json",
    JSON.stringify([{ title: "Diseño", column: COL.doing, labels: ["importada"] }, { título: "Maquetar", "depende de": "diseño", fecha_limite: "2027-01-15" }]),
    "```",
    JSON.stringify({ format: "pizarro.task", title: "Revisar", column: "No existe", dependsOn: "Ya existía", assignee: { id: me.id, name: "otro nombre" } }),
    '{"title": "rota", }',
    JSON.stringify({ format: "pizarro.task", description: "sin título" }),
  ].join("\n");
  await dlg.locator("textarea").fill(text);
  await L.checkEventually("VISTA PREVIA: 3 tareas detectadas y 2 que no se pueden leer", async () => { const t = await dlg.innerText(); return [t.includes("3 tareas detectadas") && t.includes("2 no se pueden leer"), t]; });
  const preview = await dlg.locator("[data-import-preview] li").allInnerTexts();
  L.check("VISTA PREVIA: cada tarea con la columna a la que irá", preview[0]?.includes("Diseño") && preview[0].includes(`→ ${COL.doing}`) && preview[1]?.includes(`→ ${COL.backlog}`), preview.join(" / "));
  L.check("VISTA PREVIA: la columna que no existe se avisa (irá a la primera)", preview[2]?.includes("columna «No existe» (no existe)") && preview[2].includes(`→ ${COL.backlog}`), preview[2]);
  L.check("VISTA PREVIA: la que no tiene título y la rota salen como no importables", preview.some((x) => x.includes("sin título")) && preview.some((x) => x.includes("no es un JSON válido")), preview.join(" / "));
  // Columna de destino forzada y vuelta a «la de cada tarea».
  const select = dlg.getByLabel("Columna de destino");
  await select.selectOption({ label: COL.prod });
  await L.checkEventually("COLUMNA: forzada, todas van a la elegida", async () => (await dlg.locator("[data-import-preview] li").allInnerTexts()).slice(0, 3).every((x) => x.includes(`→ ${COL.prod}`)));
  await select.selectOption({ index: 0 });
  L.eq("BOTÓN: «Importar 3 tareas»", (await dlg.locator("[data-import-submit]").innerText()).trim(), "Importar 3 tareas");
  await dlg.locator("[data-import-submit]").click();
  await L.checkEventually("IMPORTAR: se cierra, avisa «3 tareas importadas» y de lo que no se pudo (la columna) y las que no se leyeron", async () => { const a = await alerts(page); return [(await importDialog(page).count()) === 0 && a.includes("3 tareas importadas") && a.includes("Importadas, salvo:") && a.includes("«Revisar»: columna «No existe» (no existe)") && a.includes("tarea 4: no es un JSON válido"), a]; });
  await L.eqEventually("IMPORTAR: las tareas están en el tablero", boardTitles, ["Diseño", "Maquetar", "Revisar", "Ya existía"]);
  await L.checkEventually("IMPORTAR: … y se ven sin recargar", async () => (await L.cardLoc(page, "Maquetar").count()) === 1 && (await L.cardLoc(page, "Revisar").count()) === 1);
  const [dis, maq, rev, old] = [await taskOf("Diseño"), await taskOf("Maquetar"), await taskOf("Revisar"), await taskOf("Ya existía")];
  L.eq("IMPORTAR: columnas (la suya o la primera)", [dis.col, maq.col, rev.col], [COL.doing, COL.backlog, COL.backlog]);
  L.eq("IMPORTAR: dependencias por título dentro del lote y en el proyecto", [maq.blockedById, rev.blockedById], [dis.id, old.id]);
  L.eq("IMPORTAR: las crea quien importa; responsable por id", [dis.createdById, rev.assigneeId, maq.due], [me.id, me.id, "2027-01-15"]);
  L.eq("IMPORTAR: la etiqueta nueva se crea", await labelNames(), ["importada"]);
  L.check("HISTORIAL: cada tarea dice que se importó", (await L.events("Revisar")).some((e) => e.label.includes("Importó la tarea desde JSON")));
  L.eq("DESHACER: una sola entrada", await U.undoCount("UNDO"), 1);
  await sleep(6500);
  await U.undoKey(page, "Control+z");
  await L.eqEventually("DESHACER: Ctrl+Z quita las tres", boardTitles, ["Ya existía"]);
  L.eq("DESHACER: … y la etiqueta que creó la importación", await labelNames(), []);
  await L.checkEventually("DESHACER: el tablero ya no las muestra", async () => (await L.cardLoc(page, "Maquetar").count()) === 0);

  // Desde un fichero (.json).
  await btn.click();
  await importDialog(page).waitFor();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), importDialog(page).getByRole("button", { name: "Desde un fichero" }).click()]);
  await chooser.setFiles({ name: "tareas.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "pizarro.tasks", version: 1, tasks: [{ format: "pizarro.task", title: "Del fichero 1" }, { format: "pizarro.task", title: "Del fichero 2" }] })) });
  await L.checkEventually("FICHERO: el .json se carga en el cuadro y se detectan 2", async () => (await importDialog(page).innerText()).includes("2 tareas detectadas"));
  await importDialog(page).locator("[data-import-submit]").click();
  await L.eqEventually("FICHERO: importadas", boardTitles, ["Del fichero 1", "Del fichero 2", "Ya existía"]);

  // Arrastrar un fichero .txt encima del diálogo.
  await btn.click();
  await importDialog(page).waitFor();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['{"title":"Arrastrada A"}\n\n{"title":"Arrastrada B"}'], "tareas.txt", { type: "text/plain" }));
    for (const type of ["dragenter", "dragover", "drop"]) document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await L.checkEventually("ARRASTRAR: el .txt soltado encima se carga (2 tareas)", async () => (await importDialog(page).innerText()).includes("2 tareas detectadas"));
  await importDialog(page).getByRole("button", { name: "Cancelar" }).click();

  // «Desde el portapapeles» y Ctrl+V en el tablero.
  const exported = JSON.stringify({ format: "pizarro.tasks", version: 1, project: "Otro", projectId: "otro", tasks: [{ format: "pizarro.task", title: "Del portapapeles" }] });
  await setClip(page, exported);
  await btn.click();
  await importDialog(page).waitFor();
  await importDialog(page).getByRole("button", { name: "Desde el portapapeles" }).click();
  await L.checkEventually("PORTAPAPELES: el botón carga lo que hay en el portapapeles", async () => (await importDialog(page).locator("textarea").inputValue()) === exported);
  await importDialog(page).getByRole("button", { name: "Cancelar" }).click();
  await importDialog(page).waitFor({ state: "detached" });
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press("Control+v");
  await L.checkEventually("CTRL+V: en el tablero, un JSON de tareas exacto abre «Importar tareas» con el texto", async () => (await importDialog(page).count()) === 1 && (await importDialog(page).locator("textarea").inputValue()) === exported);
  await importDialog(page).getByRole("button", { name: "Cancelar" }).click();
  await importDialog(page).waitFor({ state: "detached" });
  for (const [name, t] of [["texto con la tarea dentro", `Mira: ${exported}`], ["un texto cualquiera", "hola"], ["una tarea sin marcador", '{"title":"x"}']]) {
    await setClip(page, t);
    await page.keyboard.press("Control+v");
    await sleep(600);
    L.eq(`CTRL+V: con ${name} no abre nada`, [await importDialog(page).count(), await page.locator("[role=dialog]").count()], [0, 0]);
  }

  // Más de 1 MB (el tope de las acciones de servidor): va por la ruta /api/projects/[id]/import-tasks, hasta 5 MB.
  const bigTasks = Array.from({ length: 300 }, (_, i) => ({ format: "pizarro.task", title: `Grande ${String(i).padStart(3, "0")}`, description: `Con eñes, € y 🙂: ${"ñ€🙂 texto ".repeat(450)}` }));
  const bigText = JSON.stringify({ format: "pizarro.tasks", version: 1, tasks: bigTasks }, null, 2);
  L.check("GRANDE: el fichero pasa de 2 MB (tope de las acciones: 1 MB; del proxy: 2 MB)", Buffer.byteLength(bigText) > 2 * 1024 * 1024, String(Buffer.byteLength(bigText)));
  await btn.click();
  await importDialog(page).waitFor();
  const loadBig = async () => {
    const [ch] = await Promise.all([page.waitForEvent("filechooser"), importDialog(page).getByRole("button", { name: "Desde un fichero" }).click()]);
    await ch.setFiles({ name: "grande.json", mimeType: "application/json", buffer: Buffer.from(bigText) });
    await L.checkEventually("GRANDE: se detectan las 300", async () => (await importDialog(page).innerText()).includes("300 tareas detectadas"), { timeout: 20000 });
  };
  await loadBig();
  // Sin red: el aviso de siempre y el diálogo sigue abierto con el texto.
  await page.route("**/import-tasks**", (r) => r.abort("internetdisconnected"));
  await importDialog(page).locator("[data-import-submit]").click();
  await L.checkEventually("GRANDE: sin red, «Sin conexión: no se ha guardado» y el diálogo sigue abierto", async () => { const a = await alerts(page); return [a.includes("Sin conexión: no se ha guardado") && (await importDialog(page).count()) === 1, a]; });
  await page.unroute("**/import-tasks**");
  // Sesión caducada: el aviso con su botón para entrar.
  await page.route("**/import-tasks**", (r) => r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Sesión caducada. Vuelve a iniciar sesión." }) }));
  await importDialog(page).locator("[data-import-submit]").click();
  await L.checkEventually("GRANDE: sin sesión, el aviso de sesión caducada con «Iniciar sesión»", async () => (await page.getByRole("button", { name: "Iniciar sesión" }).count()) > 0);
  await page.unroute("**/import-tasks**");
  // Un proxy por delante que corta lo grande (413 sin JSON): el tope, no «Error inesperado».
  await page.route("**/import-tasks**", (r) => r.fulfill({ status: 413, contentType: "text/html", body: "<h1>413</h1>" }));
  await importDialog(page).locator("[data-import-submit]").click();
  await L.checkEventually("GRANDE: un 413 de fuera dice el tope", async () => { const a = await alerts(page); return [a.includes("demasiado largo para importarlo (máximo 5 MB)"), a]; });
  await page.unroute("**/import-tasks**");
  // De verdad: se importan las 300.
  await sleep(500);
  await importDialog(page).locator("[data-import-submit]").click();
  await L.checkEventually("GRANDE: «300 tareas importadas» y se cierra", async () => { const a = await alerts(page); return [(await importDialog(page).count()) === 0 && a.includes("300 tareas importadas"), a]; }, { timeout: 30000 });
  const bigBack = await L.q(`SELECT title, description FROM "Task" WHERE "projectId"=$1 AND title LIKE 'Grande %' ORDER BY title`, [p0.id]);
  L.eq("GRANDE: las 300 en la base, con el texto intacto", [bigBack.length, bigBack[7]?.description === bigTasks[7].description], [300, true]);
  L.eq("GRANDE: un solo deshacer para todas", await U.undoCount("UNDO"), 2);
  // Los fallos de red y de sesión simulados dejan su rastro en la consola: son los esperados.
  s.errors.length = 0;
  L.assertNoErrors("importar", [s]);
  await s.ctx.close();
}

// --- Exportar la selección y volver a importarla -----------------------------------------------------------------------------
if (only.includes("exportar")) {
  L.scenario("exportar: con tarjetas marcadas el botón pasa a «Exportar (N)»: descargar y copiar; lo exportado se vuelve a importar");
  await L.cleanBoard();
  await cleanLabels();
  const [a, b] = await L.seedTasks(COL.doing, ["Exp A", "Exp B"]);
  await L.seedTasks(COL.backlog, ["Sin marcar"]);
  await L.q(`UPDATE "Task" SET "blockedById"=$1, "assigneeId"=$3, description='Texto **B**' WHERE id=$2`, [a, b, me.id]);
  await L.q(`INSERT INTO "Subtask"(id,"taskId",title,done,position) VALUES ('r54s1',$1,'Paso',true,1024)`, [b]);
  const s = await withClipboard();
  const { page } = s;
  for (const title of ["Exp A", "Exp B"]) await L.cardLoc(page, title).locator('button[aria-label="Seleccionar"]').click();
  const exportBtn = page.getByRole("button", { name: "Exportar (2)" });
  L.check("BOTÓN: con dos marcadas, «Importar» pasa a «Exportar (2)»", await exportBtn.isVisible().catch(() => false) && (await page.getByRole("button", { name: "Importar", exact: true }).count()) === 0);
  await exportBtn.click();
  L.eq("EXPORTAR: opciones «Descargar .json» y «Copiar»", (await page.getByRole("menuitem").allInnerTexts()).map((x) => x.trim()), ["Descargar .json", "Copiar"]);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "Descargar .json" }).click()]);
  const name = download.suggestedFilename();
  L.check("DESCARGAR: nombre seguro con el proyecto y la fecha", /^tareas-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.json$/.test(name), name);
  const path = await download.path();
  const fs = await import("node:fs");
  const fileText = fs.readFileSync(path, "utf8");
  const json = JSON.parse(fileText);
  L.eq("DESCARGAR: envoltorio «pizarro.tasks» con las dos marcadas, en el orden del tablero", [json.format, json.projectId, json.tasks.map((t) => t.title)], ["pizarro.tasks", p0.id, ["Exp A", "Exp B"]]);
  L.eq("DESCARGAR: dependencia con id y título; responsable sin email", [json.tasks[1].dependsOn, json.tasks[1].assignee], [{ id: a, title: "Exp A" }, { id: me.id, name: me.name }]);
  L.check("DESCARGAR: ningún email en el fichero", !fileText.includes("@example.com"));
  await L.checkEventually("DESCARGAR: avisa «2 tareas exportadas»", async () => (await alerts(page)).includes("2 tareas exportadas"));
  await setClip(page, "antes");
  await exportBtn.click();
  await page.getByRole("menuitem", { name: "Copiar" }).click();
  await L.checkEventually("COPIAR: el portapapeles tiene el mismo JSON", async () => { const c = await clip(page); try { return JSON.parse(c).tasks.length === 2; } catch { return false; } });
  L.eq("EXPORTAR: no cambia nada ni deja deshacer", await U.undoCount("UNDO"), 0);
  // Vuelta: se importa lo descargado (en el mismo proyecto: copias nuevas, la dependencia apunta a la copia nueva).
  await page.getByRole("button", { name: "Limpiar selección" }).click();
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await importDialog(page).waitFor();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), importDialog(page).getByRole("button", { name: "Desde un fichero" }).click()]);
  await chooser.setFiles(path);
  await L.checkEventually("REIMPORTAR: el fichero exportado se lee entero", async () => (await importDialog(page).innerText()).includes("2 tareas detectadas"));
  await importDialog(page).locator("[data-import-submit]").click();
  await L.eqEventually("REIMPORTAR: copias nuevas de las dos", async () => (await L.q(`SELECT count(*)::int AS n FROM "Task" WHERE title IN ('Exp A','Exp B')`))[0].n, 4);
  const copies = await L.q(`SELECT id, title, "blockedById" FROM "Task" WHERE title IN ('Exp A','Exp B') AND id NOT IN ($1,$2) ORDER BY title`, [a, b]);
  L.eq("REIMPORTAR: la dependencia apunta a la copia nueva, no a la original", copies[1].blockedById, copies[0].id);
  L.eq("REIMPORTAR: con su descripción y subtareas", (await L.q(`SELECT t.description, s.title, s.done FROM "Task" t JOIN "Subtask" s ON s."taskId"=t.id WHERE t.id=$1`, [copies[1].id]))[0], { description: "Texto **B**", title: "Paso", done: true });
  L.assertNoErrors("exportar", [s]);
  await s.ctx.close();
}

// --- «Nueva tarea»: copiar lo escrito e importar una tarea en el formulario ---------------------------------------------------
if (only.includes("nueva")) {
  L.scenario("nueva: «Copiar tarea» copia el formulario como JSON; «Importar tarea» (portapapeles, fichero, Ctrl+V) lo rellena");
  await L.cleanBoard();
  await cleanLabels();
  const s = await withClipboard();
  const { page } = s;
  await page.getByRole("button", { name: "Nueva tarea" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Nueva tarea" });
  await dlg.waitFor();
  await dlg.getByRole("textbox", { name: "Título", exact: true }).fill("Escrita en el formulario");
  await dlg.getByPlaceholder("Añadir subtarea…").fill("Primer paso");
  await dlg.getByPlaceholder("Añadir subtarea…").press("Enter");
  await dlg.getByLabel("Fecha límite (opcional)").fill("2027-02-03");
  await setClip(page, "antes");
  await dlg.getByRole("button", { name: "Copiar tarea", exact: true }).click();
  await L.checkEventually("COPIAR: «Tarea copiada»", async () => (await alerts(page)).includes("Tarea copiada"));
  const copied = JSON.parse((await clip(page)) || "{}");
  L.eq("COPIAR: el JSON lleva lo escrito (sin info: aún no es una tarea)", [copied.format, copied.title, copied.dueDate, copied.subtasks, copied.column, "info" in copied], ["pizarro.task", "Escrita en el formulario", "2027-02-03", [{ text: "Primer paso", done: false }], COL.backlog, false]);
  // Importar con contenido escrito: pregunta antes de sustituirlo.
  await setClip(page, JSON.stringify({ format: "pizarro.task", title: "Importada", description: "Desde el portapapeles", column: COL.doing, assignee: { id: me.id, name: me.name }, subtasks: [{ text: "Hecha", done: true }, "Otra"], labels: ["x"], color: "#ef4444" }));
  await dlg.getByRole("button", { name: "Importar tarea", exact: true }).click();
  await page.getByRole("menuitem", { name: /Desde el portapapeles/ }).click();
  const confirm = page.getByRole("button", { name: "Sustituir" });
  L.check("IMPORTAR: con algo escrito, pregunta antes de sustituirlo", await confirm.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await confirm.click();
  await L.eqEventually("IMPORTAR: rellena título, columna y responsable", async () => [await dlg.getByRole("textbox", { name: "Título", exact: true }).inputValue(), await dlg.getByLabel("Columna").locator("option:checked").innerText(), await dlg.getByLabel("Asignada a (opcional)").locator("option:checked").innerText()], ["Importada", COL.doing, `${me.name} (yo)`]);
  L.check("IMPORTAR: y las subtareas", (await dlg.innerText()).includes("Hecha") && (await dlg.innerText()).includes("Otra") && !(await dlg.innerText()).includes("Primer paso"));
  await L.checkEventually("IMPORTAR: avisa de lo que no se ha podido poner (la etiqueta que no existe, las subtareas hechas)", async () => { const a = await alerts(page); return [a.includes("Tarea importada, salvo:") && a.includes("etiqueta «x» (no existe en el proyecto)") && a.includes("subtareas hechas") && !a.includes("color"), a]; });
  // Desde un fichero.
  await dlg.getByRole("button", { name: "Importar tarea", exact: true }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("menuitem", { name: /Desde un fichero/ }).click()]);
  await chooser.setFiles({ name: "t.json", mimeType: "application/json", buffer: Buffer.from('{"format":"pizarro.task","title":"Del fichero"}') });
  await page.getByRole("button", { name: "Sustituir" }).click();
  await L.eqEventually("FICHERO: el título del fichero", () => dlg.getByRole("textbox", { name: "Título", exact: true }).inputValue(), "Del fichero");
  // Varias tareas: no.
  await setClip(page, '{"title":"a"}\n{"title":"b"}');
  await dlg.getByRole("button", { name: "Importar tarea", exact: true }).click();
  await page.getByRole("menuitem", { name: /Desde el portapapeles/ }).click();
  await L.checkEventually("VARIAS: avisa que se importan desde el tablero", async () => (await alerts(page)).includes("Hay 2 tareas. Para importar varias, usa «Importar» en el tablero."));
  // Ctrl+V fuera de un campo, estricto.
  await dlg.getByRole("textbox", { name: "Título", exact: true }).fill("");
  await dlg.getByText("Capturas y adjuntos").click();
  await setClip(page, "```json\n{\"format\":\"pizarro.task\",\"title\":\"No\"}\n```");
  await page.keyboard.press("Control+v");
  await sleep(600);
  L.eq("CTRL+V: un bloque ``` no rellena nada", await dlg.getByRole("textbox", { name: "Título", exact: true }).inputValue(), "");
  await setClip(page, '{"format":"pizarro.task","title":"Por Ctrl+V","dueDate":"2027-09-10"}');
  await page.keyboard.press("Control+v");
  // El color importado antes cuenta como algo escrito: pregunta antes de sustituirlo.
  const again = page.getByRole("button", { name: "Sustituir" });
  L.check("CTRL+V: con un color ya elegido, pregunta antes de sustituir", await again.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await again.click();
  await L.eqEventually("CTRL+V: una tarea exacta rellena el formulario", async () => [await dlg.getByRole("textbox", { name: "Título", exact: true }).inputValue(), await dlg.getByLabel("Fecha límite (opcional)").inputValue()], ["Por Ctrl+V", "2027-09-10"]);
  await dlg.getByRole("button", { name: "Crear tarea" }).click();
  await L.eqEventually("CREAR: la tarea importada se crea", async () => (await taskOf("Por Ctrl+V"))?.due, "2027-09-10");
  L.assertNoErrors("nueva", [s]);
  await s.ctx.close();
}

// --- «Nueva tarea»: Ctrl+V de una tarea copiada, con el foco donde sea (R54C1) --------------------------------------------------
if (only.includes("pegar")) {
  L.scenario("pegar: Ctrl+V de una tarea en JSON en «Nueva tarea» la importa con el foco en el título vacío, en un selector, en un botón, en la fecha, en una zona vacía o en la descripción sin tocar");
  await L.cleanBoard();
  await cleanLabels();
  // Una tarea copiada de otra instalación, inventada: Markdown largo con «-->», listas y barras escapadas, tipo «Respuesta».
  const DESCRIPTION = [
    "Respondo a las preguntas y lo que necesitas de mi:", "", "**1. ¿Qué versión hay en producción?**", "",
    "- La v2 --> la que salió el lunes", "- La rama `main_estable` (con guion bajo: main\\_estable)", "  - sublista con *cursiva*", "",
    "1. Primero", "2. Segundo --> y tercero", "", "Ruta en Windows: C:\\\\datos\\\\informes y un \\_escape\\_ de Markdown.", "",
    ...Array.from({ length: 30 }, (_, i) => `Párrafo ${i + 1}: **negrita** y texto de relleno para que la descripción sea larga.`),
  ].join("\n\n").replace(/\n\n\n\n/g, "\n\n");
  const copied = (title, extra = {}) => JSON.stringify({
    format: "pizarro.task", version: 1, title, description: DESCRIPTION, type: "Respuesta", column: COL.next, labels: [], assignee: null, dueDate: null,
    recurrence: { rule: "none" }, color: null, deliverable: null, link: null, subtasks: [], dependsOn: null,
    attachments: [{ name: "captura.png", url: "https://otra.example.com/api/attachments/adjunto_inventado" }],
    info: { id: "tarea_inventada", project: "Otro", projectId: "proyecto_inventado", url: "https://otra.example.com/p/proyecto_inventado?task=tarea_inventada", createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-02T10:00:00.000Z", createdBy: "Persona Inventada" },
    ...extra,
  }, null, 2);
  // El editor de la descripción de partida (otras suites lo cambian); más abajo, también con el editor de Markdown.
  const [{ editorMode }] = await L.q(`SELECT "editorMode" FROM "User" WHERE id=$1`, [me.id]);
  await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG' WHERE id=$1`, [me.id]);
  const s = await withClipboard();
  const { page } = s;
  const titleBox = (dlg) => dlg.getByRole("textbox", { name: "Título", exact: true });
  const state = async (dlg) => [await titleBox(dlg).inputValue(), await dlg.getByLabel("Columna").locator("option:checked").innerText(), await dlg.locator("[role=radiogroup][aria-label=Tipo] [aria-checked=true]").innerText()];
  const openNew = async (button = page.getByRole("button", { name: "Nueva tarea" }).first()) => {
    await button.click();
    const dlg = page.getByRole("dialog", { name: "Nueva tarea" });
    await dlg.waitFor();
    return dlg;
  };
  const discard = async (dlg) => {
    await dlg.getByRole("button", { name: "Cancelar" }).click();
    const d = page.getByRole("button", { name: "Descartar" });
    if (await d.waitFor({ timeout: 1500 }).then(() => true, () => false)) await d.click();
    await dlg.waitFor({ state: "detached" });
  };
  // Al abrir, el cursor sigue en el título (sin cambios); Ctrl+V ahí rellena el formulario en vez de meter el JSON en el título.
  let dlg = await openNew();
  L.check("ABRIR: el cursor está en el título", await titleBox(dlg).evaluate((el) => el === document.activeElement));
  await setClip(page, copied("Copiada de otra instalación"));
  await page.keyboard.press("Control+v");
  await L.eqEventually("TÍTULO VACÍO: Ctrl+V importa título, columna y tipo (no mete el JSON en el título)", () => state(dlg), ["Copiada de otra instalación", COL.next, "Respuesta"]);
  await L.checkEventually("TÍTULO VACÍO: «Tarea importada», sin avisos (adjuntos e info de otra instalación no cuentan)", async () => { const a = await alerts(page); return [a.includes("Tarea importada") && !a.includes("salvo"), a]; });
  await dlg.getByRole("button", { name: "Crear tarea" }).click();
  await L.eqEventually("CREAR: descripción idéntica, tipo «Respuesta» y columna del JSON", async () => { const t = await L.dbTask("Copiada de otra instalación"); return t && [t.description === DESCRIPTION, t.kindId, t.columnName]; }, [true, "kind_respuesta", COL.next]);
  // Con el foco en cualquier otro sitio del formulario.
  const places = {
    "un selector (columna)": (d) => d.getByLabel("Columna").focus(),
    "un selector (responsable)": (d) => d.getByLabel("Asignada a (opcional)").focus(),
    "un selector (entregable)": (d) => d.getByLabel("Entregable (opcional)").focus(),
    "un selector (repetir)": (d) => d.getByLabel("Repetir", { exact: true }).focus(),
    "un tipo": (d) => d.locator("[role=radiogroup][aria-label=Tipo] [role=radio]").first().focus(),
    "un botón": (d) => d.getByRole("button", { name: "Copiar tarea", exact: true }).focus(),
    "la fecha límite": (d) => d.getByLabel("Fecha límite (opcional)").focus(),
    "una zona vacía (tras hacer clic en ella)": async (d) => { await d.getByText("Capturas y adjuntos").click(); },
    "la columna, tras cambiarla con el teclado": async (d) => { await d.getByLabel("Columna").focus(); await page.keyboard.press("ArrowDown"); },
    "la descripción (formulario sin tocar)": (d) => d.locator("[contenteditable=true], textarea[id$='-desc']").first().click(),
    "las subtareas (formulario sin tocar)": (d) => d.getByPlaceholder("Añadir subtarea…").focus(),
  };
  for (const [where, focus] of Object.entries(places)) {
    dlg = await openNew();
    await setClip(page, copied(`Foco en ${where}`));
    await focus(dlg);
    await page.keyboard.press("Control+v");
    await L.eqEventually(`FOCO EN ${where.toUpperCase()}: Ctrl+V importa la tarea`, async () => (await state(dlg))[0], `Foco en ${where}`);
    await discard(dlg);
  }
  // Con el editor de Markdown (una caja de texto): en la descripción sin tocar también, y la descripción llega idéntica.
  await L.q(`UPDATE "User" SET "editorMode"='MARKDOWN' WHERE id=$1`, [me.id]);
  await L.reload(page);
  dlg = await openNew();
  await setClip(page, copied("Con el editor de Markdown"));
  await dlg.locator("textarea[id$='-desc']").click();
  await page.keyboard.press("Control+v");
  await L.eqEventually("MARKDOWN: Ctrl+V en la descripción sin tocar importa la tarea", async () => [...(await state(dlg)), await dlg.locator("textarea[id$='-desc']").inputValue() === DESCRIPTION], ["Con el editor de Markdown", COL.next, "Respuesta", true]);
  await dlg.getByRole("button", { name: "Crear tarea" }).click();
  await L.eqEventually("MARKDOWN: se crea con la descripción idéntica", async () => (await L.dbTask("Con el editor de Markdown"))?.description === DESCRIPTION, true);
  await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG' WHERE id=$1`, [me.id]);
  await L.reload(page);
  // Con algo ya escrito: en el título vacío pregunta antes de sustituir; en otra caja se pega como texto.
  dlg = await openNew();
  await dlg.getByPlaceholder("Añadir subtarea…").fill("Paso escrito");
  await setClip(page, copied("Sustituye lo escrito"));
  await titleBox(dlg).focus();
  await page.keyboard.press("Control+v");
  const replace = page.getByRole("button", { name: "Sustituir" });
  L.check("ESCRITO: en el título vacío, pregunta antes de sustituir", await replace.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await replace.click();
  await L.eqEventually("ESCRITO: al confirmar, se importa", async () => [(await state(dlg))[0], await dlg.getByPlaceholder("Añadir subtarea…").inputValue()], ["Sustituye lo escrito", ""]);
  await setClip(page, '{"format":"pizarro.task","title":"Como texto"}');
  await dlg.getByPlaceholder("Añadir subtarea…").focus();
  await page.keyboard.press("Control+v");
  await sleep(500);
  L.eq("ESCRITO: en otra caja, con el formulario ya tocado, el JSON se pega como texto", await dlg.getByPlaceholder("Añadir subtarea…").inputValue(), '{"format":"pizarro.task","title":"Como texto"}');
  await discard(dlg);
  // Varias tareas: avisa de que se importan desde el tablero y no mete nada en el título.
  dlg = await openNew();
  await setClip(page, JSON.stringify({ format: "pizarro.tasks", version: 1, tasks: [{ title: "Una" }, { title: "Otra" }] }));
  await page.keyboard.press("Control+v");
  await L.checkEventually("VARIAS: avisa de que se importan con «Importar» del tablero", async () => (await alerts(page)).includes("Hay 2 tareas. Para importar varias, usa «Importar» en el tablero."));
  L.eq("VARIAS: el título sigue vacío", await titleBox(dlg).inputValue(), "");
  await discard(dlg);
  // Desde el «+» de una columna: manda la columna del JSON si existe; si no, la de la columna desde la que se abrió.
  dlg = await openNew(page.getByRole("button", { name: `Añadir tarea en ${COL.doing}` }));
  await setClip(page, copied("Desde el más"));
  await page.keyboard.press("Control+v");
  await L.eqEventually("COLUMNA «+»: la del JSON si existe en el proyecto", async () => (await state(dlg)).slice(0, 2), ["Desde el más", COL.next]);
  await discard(dlg);
  dlg = await openNew(page.getByRole("button", { name: `Añadir tarea en ${COL.doing}` }));
  await setClip(page, copied("Columna ajena", { column: "Columna de otra instalación" }));
  await page.keyboard.press("Control+v");
  await L.eqEventually("COLUMNA «+»: si la del JSON no existe, la de la columna desde la que se abrió", async () => (await state(dlg)).slice(0, 2), ["Columna ajena", COL.doing]);
  await L.checkEventually("COLUMNA «+»: avisa de la columna que no existe", async () => (await alerts(page)).includes("columna «Columna de otra instalación» (no existe)"));
  await discard(dlg);
  L.assertNoErrors("pegar", [s]);
  await s.ctx.close();
  await L.q(`UPDATE "User" SET "editorMode"=$2 WHERE id=$1`, [me.id, editorMode]);
}

// --- «Nueva tarea»: etiquetas, color y enlace -------------------------------------------------------------------------------
if (only.includes("extras")) {
  L.scenario("extras: «Nueva tarea» con etiquetas existentes, color y enlace; importar y copiar los llevan; cambiar de proyecto quita las que no existen");
  await L.cleanBoard();
  await cleanLabels();
  await L.q(`INSERT INTO "Label"(id,"projectId",name,color) VALUES ('lbl_e2e_cli',$1,'Cliente','#22c55e'),('lbl_e2e_urg',$1,'Urgente','#ef4444')`, [p0.id]);
  // Otro proyecto (privado, de quien prueba) con una etiqueta del mismo nombre que «Cliente» y sin «Urgente».
  const OTHER = "r54_extras_otro";
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [OTHER]);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,'Zeta extras',true,$2,999995,NOW())`, [OTHER, me.id]);
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [OTHER, me.id]);
  await L.q(`INSERT INTO "Column"(id,"projectId",name,position) VALUES ($1,$2,'Pendiente',1000)`, [`${OTHER}_col`, OTHER]);
  await L.q(`INSERT INTO "Label"(id,"projectId",name,color) VALUES ('lbl_e2e_otro_cli',$1,'cliente','#6366f1'),('lbl_e2e_otro_x',$1,'Solo allí','#64748b')`, [OTHER]);
  const s = await withClipboard();
  const { page } = s;
  await page.getByRole("button", { name: "Nueva tarea" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Nueva tarea" });
  await dlg.waitFor();
  await dlg.getByRole("textbox", { name: "Título", exact: true }).fill("Con extras");
  const labels = dlg.getByRole("group", { name: "Etiquetas (opcional)" });
  L.eq("ETIQUETAS: las del proyecto, para elegir (sin crear nuevas)", await labels.getByRole("button").allInnerTexts(), ["Cliente", "Urgente"]);
  await labels.getByRole("button", { name: "Urgente" }).click();
  L.eq("ETIQUETAS: marcada", await labels.getByRole("button", { name: "Urgente" }).getAttribute("aria-pressed"), "true");
  await dlg.getByRole("button", { name: /^Color: / }).click();
  await page.getByRole("radio", { name: "Color Verde", exact: true }).click();
  L.check("COLOR: el botón muestra el elegido", (await dlg.getByRole("button", { name: /^Color: / }).getAttribute("aria-label")) === "Color: Verde");
  const link = dlg.getByLabel("Enlace externo (opcional)");
  await link.fill("example.com/ficha");
  await link.blur();
  L.eq("ENLACE: se completa con https:// al salir del campo, como en el detalle", await link.inputValue(), "https://example.com/ficha");
  // Copiar lo escrito lleva etiquetas, color y enlace.
  await dlg.getByRole("button", { name: "Copiar tarea", exact: true }).click();
  await L.checkEventually("COPIAR: «Tarea copiada»", async () => (await alerts(page)).includes("Tarea copiada"));
  const copied = JSON.parse((await clip(page)) || "{}");
  L.eq("COPIAR: etiquetas, color y enlace en el JSON", [copied.labels, copied.color, copied.link], [["Urgente"], "#22c55e", "https://example.com/ficha"]);
  await dlg.getByRole("button", { name: "Crear tarea" }).click();
  await L.eqEventually("CREAR: con la etiqueta, el color y el enlace", async () => {
    const [t] = await L.q(`SELECT t.color, t."linkUrl", array(SELECT l.name FROM "TaskLabel" tl JOIN "Label" l ON l.id=tl."labelId" WHERE tl."taskId"=t.id ORDER BY l.name) AS labels FROM "Task" t WHERE t.title='Con extras'`);
    return t && [t.color, t.linkUrl, t.labels];
  }, ["#22c55e", "https://example.com/ficha", ["Urgente"]]);
  // Un enlace que no es http(s): no se crea y se avisa.
  await page.getByRole("button", { name: "Nueva tarea" }).first().click();
  await dlg.waitFor();
  await dlg.getByRole("textbox", { name: "Título", exact: true }).fill("Enlace malo");
  await dlg.getByLabel("Enlace externo (opcional)").fill("javascript:alert(1)");
  await dlg.getByRole("button", { name: "Crear tarea" }).click();
  await L.checkEventually("ENLACE: uno que no es http(s) se rechaza con aviso", async () => (await alerts(page)).includes("El enlace debe empezar por http:// o https://"));
  L.check("ENLACE: y no se crea la tarea", !(await L.dbTask("Enlace malo")));
  // Importar: etiquetas existentes sí; las que no existen, con aviso; color y enlace también.
  await setClip(page, JSON.stringify({ format: "pizarro.task", title: "Importada con extras", labels: ["cliente", "No existe"], color: "#ef4444", link: "https://example.com/importado", dependsOn: { title: "Otra" } }));
  await dlg.getByRole("button", { name: "Importar tarea", exact: true }).click();
  await page.getByRole("menuitem", { name: /Desde el portapapeles/ }).click();
  await page.getByRole("button", { name: "Sustituir" }).click();
  await L.eqEventually("IMPORTAR: etiqueta existente marcada, color y enlace", async () => [
    await labels.getByRole("button", { name: "Cliente" }).getAttribute("aria-pressed"), await labels.getByRole("button", { name: "Urgente" }).getAttribute("aria-pressed"),
    await dlg.getByRole("button", { name: /^Color: / }).getAttribute("aria-label"), await dlg.getByLabel("Enlace externo (opcional)").inputValue(),
  ], ["true", "false", "Color: Rojo", "https://example.com/importado"]);
  await L.checkEventually("IMPORTAR: avisa de la etiqueta que no existe y de la dependencia (no de color ni enlace)", async () => {
    const a = await alerts(page);
    return [a.includes("etiqueta «No existe» (no existe en el proyecto)") && a.includes("dependencia (no se pueden poner al crear") && !a.includes("color, enlace"), a];
  });
  await dlg.getByRole("button", { name: "Crear tarea" }).click();
  await L.eqEventually("IMPORTAR: se crea con la etiqueta, el color y el enlace", async () => {
    const [t] = await L.q(`SELECT t.color, t."linkUrl", array(SELECT l.name FROM "TaskLabel" tl JOIN "Label" l ON l.id=tl."labelId" WHERE tl."taskId"=t.id) AS labels FROM "Task" t WHERE t.title='Importada con extras'`);
    return t && [t.color, t.linkUrl, t.labels];
  }, ["#ef4444", "https://example.com/importado", ["Cliente"]]);
  L.eq("IMPORTAR: no ha creado etiquetas", await labelNames(), ["Cliente", "Urgente"]);
  // Segundo diálogo, con selector de proyecto: al cambiar de proyecto se quedan las etiquetas que también existen allí.
  await page.getByRole("button", { name: "Nueva tarea" }).first().click();
  await dlg.waitFor();
  await dlg.getByRole("button", { name: "Abrir otra tarea nueva al lado" }).click();
  const second = page.getByRole("dialog", { name: /Nueva tarea/ }).filter({ has: page.getByLabel("Proyecto", { exact: true }) });
  await second.waitFor();
  const secondLabels = second.getByRole("group", { name: "Etiquetas (opcional)" });
  await secondLabels.getByRole("button", { name: "Cliente" }).click();
  await secondLabels.getByRole("button", { name: "Urgente" }).click();
  await second.getByLabel("Proyecto", { exact: true }).selectOption(OTHER);
  await L.eqEventually("PROYECTO: se queda la que existe allí (por nombre) y se quita la que no", async () => {
    const buttons = secondLabels.getByRole("button");
    const names = await buttons.allInnerTexts();
    const pressed = await Promise.all(names.map((_, i) => buttons.nth(i).getAttribute("aria-pressed")));
    return names.map((n, i) => `${n}:${pressed[i]}`).sort();
  }, ["Solo allí:false", "cliente:true"]);
  await second.getByRole("textbox", { name: "Título", exact: true }).fill("En el otro proyecto");
  await second.getByRole("button", { name: "Crear tarea" }).click();
  await L.eqEventually("PROYECTO: se crea allí con su etiqueta", async () => (await L.q(`SELECT array(SELECT tl."labelId" FROM "TaskLabel" tl WHERE tl."taskId"=t.id) AS l FROM "Task" t WHERE t.title='En el otro proyecto' AND t."projectId"=$1`, [OTHER]))[0]?.l, ["lbl_e2e_otro_cli"]);
  L.assertNoErrors("extras", [s]);
  await s.ctx.close();
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [OTHER]);
}

// --- «Nueva tarea» a 390 px y en oscuro con los campos nuevos ---------------------------------------------------------------
if (only.includes("extras")) {
  L.scenario("extras: a 390 px y en modo oscuro, color, enlace y etiquetas caben y se ven");
  await L.cleanBoard();
  await cleanLabels();
  await L.q(`INSERT INTO "Label"(id,"projectId",name,color) VALUES ('lbl_e2e_a',$1,'Etiqueta con un nombre bastante largo','#22c55e'),('lbl_e2e_b',$1,'Otra','#ef4444'),('lbl_e2e_c',$1,'Tercera','#6366f1')`, [p0.id]);
  await L.q(`UPDATE "User" SET theme='DARK' WHERE id=$1`, [me.id]);
  const m = await withClipboard({ viewport: { width: 390, height: 800 }, mobile: true });
  const { page } = m;
  await page.getByRole("button", { name: "Nueva tarea o captura" }).tap();
  const nt = page.getByRole("dialog", { name: "Nueva tarea" });
  await nt.waitFor();
  await nt.getByRole("textbox", { name: "Título", exact: true }).fill("Desde el móvil");
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  L.check("390: sin scroll lateral", wide <= 390, String(wide));
  for (const [name, loc] of [["color", nt.getByRole("button", { name: /^Color: / })], ["enlace", nt.getByLabel("Enlace externo (opcional)")], ["etiqueta larga", nt.getByRole("button", { name: "Etiqueta con un nombre bastante largo" })]]) {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    L.check(`390: «${name}» cabe`, !!b && b.x >= 0 && b.x + b.width <= 390, JSON.stringify(b));
  }
  const bg = await nt.getByLabel("Enlace externo (opcional)").evaluate((el) => getComputedStyle(el).backgroundColor);
  L.check("OSCURO: el enlace no es una caja blanca", bg !== "rgb(255, 255, 255)", bg);
  const off = await nt.getByRole("button", { name: "Otra" }).evaluate((el) => getComputedStyle(el).backgroundColor);
  L.check("OSCURO: una etiqueta sin marcar no es clara", off !== "rgb(241, 245, 249)", off);
  await nt.getByRole("button", { name: "Otra" }).tap();
  await nt.getByRole("button", { name: /^Color: / }).tap();
  await page.getByRole("radio", { name: "Color Celeste" }).tap();
  await nt.getByLabel("Enlace externo (opcional)").fill("https://example.com/movil");
  await nt.getByRole("button", { name: "Crear tarea" }).tap();
  await L.eqEventually("390: se crea con etiqueta, color y enlace", async () => {
    const [t] = await L.q(`SELECT t.color, t."linkUrl", array(SELECT l.name FROM "TaskLabel" tl JOIN "Label" l ON l.id=tl."labelId" WHERE tl."taskId"=t.id) AS labels FROM "Task" t WHERE t.title='Desde el móvil'`);
    return t && [t.color, t.linkUrl, t.labels];
  }, ["#0ea5e9", "https://example.com/movil", ["Otra"]]);
  L.assertNoErrors("extras-movil", [m]);
  await m.ctx.close();
  await L.q(`UPDATE "User" SET theme=$2 WHERE id=$1`, [me.id, me.theme]);
}

// --- Móvil -------------------------------------------------------------------------------------------------------------------
if (only.includes("movil")) {
  L.scenario("movil: a 390 px, «Varias tareas» lleva a «Importar»; la barra de selección exporta; los botones caben");
  await L.cleanBoard();
  await cleanLabels();
  await L.seedTasks(COL.backlog, ["Móvil 1", "Móvil 2"]);
  const m = await withClipboard({ viewport: { width: 390, height: 800 }, mobile: true });
  const { page } = m;
  await page.getByRole("button", { name: "Crear varias tareas" }).tap();
  const bulk = page.getByRole("dialog", { name: /Crear varias tareas/ });
  await bulk.waitFor();
  await bulk.locator("textarea").fill('[{"title":"Del móvil A"},{"title":"Del móvil B"}]');
  const link = bulk.locator("[data-bulk-import]");
  L.eq("VARIAS: con JSON de tareas pegado, ofrece importarlas con todos sus campos", (await link.innerText()).trim(), "Esto parece JSON de tareas: importarlas con todos sus campos");
  await link.tap();
  const dlg = importDialog(page);
  await dlg.waitFor();
  L.eq("IMPORTAR: se abre con el texto ya puesto", await dlg.locator("textarea").inputValue(), '[{"title":"Del móvil A"},{"title":"Del móvil B"}]');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  L.check("IMPORTAR: el diálogo cabe a 390 px (sin scroll lateral)", wide <= 390, String(wide));
  for (const name of ["Desde el portapapeles", "Desde un fichero"]) {
    const box = await dlg.getByRole("button", { name }).boundingBox();
    L.check(`IMPORTAR: «${name}» se ve entero`, !!box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  }
  await dlg.locator("[data-import-submit]").tap();
  await L.eqEventually("IMPORTAR: importadas desde el móvil", boardTitles, ["Del móvil A", "Del móvil B", "Móvil 1", "Móvil 2"]);
  // Selección y exportar desde la barra de selección.
  await L.cardLoc(page, "Móvil 1").locator('button[aria-label="Seleccionar"]').tap();
  const bar = page.locator("[data-selection-bar]");
  await bar.waitFor();
  const exp = bar.locator("[data-selection-export]");
  const box = await exp.boundingBox();
  L.check("SELECCIÓN: la barra tiene «Exportar» y cabe", !!box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
  await exp.tap();
  await setClip(page, "antes");
  await page.getByRole("menuitem", { name: "Copiar" }).tap();
  await L.checkEventually("SELECCIÓN: «Copiar» deja la tarea marcada en el portapapeles", async () => { try { return JSON.parse(await clip(page)).tasks.map((t) => t.title).join() === "Móvil 1"; } catch { return false; } });
  // «Nueva tarea» a 390 px: los botones caben junto al título.
  await page.getByRole("button", { name: "Limpiar selección" }).tap();
  await page.getByRole("button", { name: "Nueva tarea o captura" }).tap();
  const nt = page.getByRole("dialog", { name: "Nueva tarea" });
  await nt.waitFor();
  for (const name of ["Copiar tarea", "Importar tarea"]) {
    const b = await nt.getByRole("button", { name, exact: true }).boundingBox();
    L.check(`NUEVA: «${name}» cabe a 390 px`, !!b && b.x >= 0 && b.x + b.width <= 390, JSON.stringify(b));
  }
  m.errors.length = 0;
  await m.ctx.close();
}

// --- Inglés ------------------------------------------------------------------------------------------------------------------
if (only.includes("ingles")) {
  L.scenario("ingles: botón, diálogo, vista previa y avisos en inglés");
  await L.cleanBoard();
  await cleanLabels();
  await L.q(`UPDATE "User" SET locale='EN' WHERE id=$1`, [me.id]);
  const s = await withClipboard();
  const { page } = s;
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dlg = importDialog(page);
  await dlg.waitFor();
  L.check("EN: título y botones del diálogo en inglés", (await dlg.innerText()).includes("Import tasks") && (await dlg.getByRole("button", { name: "From the clipboard" }).count()) === 1);
  await dlg.locator("textarea").fill('{"title":"In English","column":"Nope"}\n{"title": broken}');
  await L.checkEventually("EN: vista previa en inglés", async () => { const t = await dlg.innerText(); return [t.includes("1 task detected") && t.includes("column “Nope” (does not exist)") && t.includes("Destination column"), t]; });
  await dlg.locator("[data-import-submit]").click();
  await L.checkEventually("EN: «1 task imported»", async () => (await alerts(page)).includes("1 task imported"));
  await L.cardLoc(page, "In English").locator('button[aria-label="Select"]').click();
  await L.checkEventually("EN: «Export (1)»", async () => (await page.getByRole("button", { name: "Export (1)" }).count()) === 1);
  L.assertNoErrors("ingles", [s]);
  await s.ctx.close();
  await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [me.id]);
}

// --- Modo oscuro -------------------------------------------------------------------------------------------------------------
if (only.includes("oscuro")) {
  L.scenario("oscuro: el diálogo de importar y los botones de la tarea se ven en oscuro");
  await L.cleanBoard();
  await L.q(`UPDATE "User" SET theme='DARK' WHERE id=$1`, [me.id]);
  await L.seedTasks(COL.backlog, ["Noche"]);
  const s = await withClipboard();
  const { page } = s;
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  const dlg = importDialog(page);
  await dlg.waitFor();
  await dlg.locator("textarea").fill('{"title":"Oscura","column":"No existe"}');
  await L.checkEventually("OSCURO: la vista previa sale", async () => (await dlg.innerText()).includes("1 tarea detectada"));
  const bg = await dlg.evaluate((el) => getComputedStyle(el.querySelector("textarea")).backgroundColor);
  const listBg = await dlg.locator("[data-import-preview]").evaluate((el) => getComputedStyle(el).borderTopColor);
  L.check("OSCURO: el cuadro de texto no es blanco", bg !== "rgb(255, 255, 255)", bg);
  L.check("OSCURO: la lista de la vista previa con borde oscuro", listBg !== "rgb(226, 232, 240)", listBg);
  await dlg.getByRole("button", { name: "Cancelar" }).click();
  await U.openTask(page, "Noche");
  const color = await U.dialog(page).getByRole("button", { name: "Importar tarea", exact: true }).evaluate((el) => getComputedStyle(el).color);
  L.check("OSCURO: los botones de la tarea no son negros sobre oscuro", color !== "rgb(15, 23, 42)" && color !== "rgb(0, 0, 0)", color);
  L.assertNoErrors("oscuro", [s]);
  await s.ctx.close();
  await L.q(`UPDATE "User" SET theme=$2 WHERE id=$1`, [me.id, me.theme]);
}

await L.q(`UPDATE "User" SET locale=$2, theme=$3 WHERE id=$1`, [me.id, me.locale, me.theme]);
await L.cleanBoard();
await cleanLabels();
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
