// Ronda 53 (y 54): copiar y pegar una tarea como JSON desde el detalle. Ctrl+C sin texto seleccionado copia la tarea
// entera (formato «pizarro.task», src/lib/task-json.ts; del responsable, su id y su nombre, nunca el email) y con texto
// seleccionado copia ese texto, como siempre; Ctrl+V fuera de un campo de texto escribe en la tarea abierta la tarea del
// portapapeles (en una sola operación que se deshace con Ctrl+Z) SOLO si el portapapeles es exactamente un JSON de tarea
// (con su marcador, sin texto alrededor ni varias): cualquier otra cosa sigue el pegado normal sin avisos; dentro de un
// campo pega texto normal; los botones discretos «Copiar tarea» e «Importar tarea» (desde el portapapeles, tolerante con
// lo que escribe una IA, o desde un fichero; también con el teclado, en el móvil y cuando el navegador no deja leer el
// portapapeles); y en inglés. Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node importar-json-detalle-e2e.mjs      # PART=copiar,pegar,texto,invalido,menu,ingles
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { COL, sleep } = L;
const only = (process.env.PART || "copiar,pegar,texto,invalido,menu,ingles").split(",");

await L.prepareUsers();
const p0 = await L.project();
const [me] = await L.q(`SELECT id, name, email, locale, "editorMode" FROM "User" WHERE email=$1`, [L.ADMIN]);
const [{ taskFields: fields0 }] = await L.q(`SELECT "taskFields" FROM "Project" WHERE id=$1`, [p0.id]);
await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [me.id]);

/** Tablero con una tarea completa («Origen», en «En progreso») y otra vacía con subtareas propias («Destino», en Backlog). */
async function seed() {
  await L.cleanBoard();
  await L.q(`UPDATE "Project" SET "taskFields"=ARRAY['priority','client'] WHERE id=$1`, [p0.id]);
  const [src] = await L.seedTasks(COL.doing, ["Origen"]);
  const [dst, other] = await L.seedTasks(COL.backlog, ["Destino", "Otra"]);
  await L.q(`UPDATE "Task" SET description=$2, "dueDate"='2026-12-01', "assigneeId"=$3, priority='ALTA', client='Acme', "linkUrl"='https://example.com/origen', "blockedById"=$4 WHERE id=$1`,
    [src, "Texto **importante** de la tarea.", me.id, other]);
  for (const [i, name] of ["cliente", "urgente"].entries()) {
    await L.q(`INSERT INTO "Label"(id,"projectId",name,color) VALUES ($1,$2,$3,'#ef4444')`, [`r53l${i}`, p0.id, name]);
    await L.q(`INSERT INTO "TaskLabel"("taskId","labelId") VALUES ($1,$2)`, [src, `r53l${i}`]);
  }
  await L.q(`INSERT INTO "Subtask"(id,"taskId",title,done,position) VALUES ('r53s1',$1,'Guion',true,1024),('r53s2',$1,'Ensayo',false,2048)`, [src]);
  await L.q(`INSERT INTO "Subtask"(id,"taskId",title,done,position) VALUES ('r53s3',$1,'Subtarea vieja',false,1024)`, [dst]);
  return { src, dst, other };
}
const row = async (id) => {
  const [t] = await L.q(`SELECT t.title, t.description, to_char(t."dueDate",'YYYY-MM-DD') AS due, t."assigneeId", t.priority, t.client, t."linkUrl", t."blockedById", c.name AS col FROM "Task" t JOIN "Column" c ON c.id=t."columnId" WHERE t.id=$1`, [id]);
  const labels = (await L.q(`SELECT l.name FROM "TaskLabel" tl JOIN "Label" l ON l.id=tl."labelId" WHERE tl."taskId"=$1 ORDER BY l.name`, [id])).map((r) => r.name);
  const subtasks = (await L.q(`SELECT title, done FROM "Subtask" WHERE "taskId"=$1 ORDER BY position`, [id])).map((r) => `${r.done ? "x" : " "} ${r.title}`);
  return sorted({ ...t, labels, subtasks });
};
/** Mismas claves en el mismo orden (L.eq compara el JSON). */
function sorted(o) { return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))); }
const clip = (page) => page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
const setClip = (page, text) => page.evaluate((v) => navigator.clipboard.writeText(v), text);
const status = (page) => U.dialog(page).locator("[data-save-status]");
/** El indicador de la cabecera («Guardado») muestra `text` y se ve. */
const statusShows = (page, text) => L.waitFor(async () => (await status(page).innerText().catch(() => "")).trim() === text && Number(await status(page).evaluate((el) => getComputedStyle(el).opacity)) > 0.5, { timeout: 6000 });
// Avisos emergentes (sin el anunciador de rutas de Next, que también es un role=alert con el título de la página).
const alerts = async (page) => (await page.locator("[role=alert]").allInnerTexts().catch(() => [])).filter((x) => x.trim() && !x.includes("· Pizarro")).join(" | ");
const blur = (page) => page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
const titleField = (page) => U.dialog(page).locator("textarea, input").first();
const withClipboard = async (opts = {}) => {
  const s = await L.session(opts);
  await s.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
  return s;
};
const FULL = sorted({ title: "Destino pegado", description: "Texto **importante** de la tarea.", due: "2026-12-01", assigneeId: me.id, priority: "ALTA", client: "Acme", linkUrl: "https://example.com/origen", col: COL.doing, labels: ["cliente", "urgente"], subtasks: ["x Guion", "  Ensayo"] });
const EMPTY = sorted({ title: "Destino", description: "", due: null, assigneeId: null, priority: null, client: null, linkUrl: null, blockedById: null, col: COL.backlog, labels: [], subtasks: ["  Subtarea vieja"] });

// --- Copiar --------------------------------------------------------------------------------------------------------------
let copied = "";
if (only.includes("copiar") || only.includes("pegar")) {
  L.scenario("copiar: Ctrl+C sin selección copia la tarea; con texto seleccionado, el texto");
  const ids = await seed();
  const s = await withClipboard();
  const { page } = s;
  await setClip(page, "antes");
  await U.openTask(page, "Origen");
  await blur(page);
  await page.keyboard.press("Control+c");
  L.check("COPIAR: el indicador de la cabecera dice «Tarea copiada»", await statusShows(page, "Tarea copiada"));
  copied = await clip(page);
  let json = {};
  try { json = JSON.parse(copied); } catch { /* se comprueba abajo */ }
  L.eq("COPIAR: el portapapeles tiene la tarea en JSON, con marcador y versión", [json.format, json.version, json.title], ["pizarro.task", 1, "Origen"]);
  L.eq("COPIAR: descripción (Markdown), tipo y columna por nombre", [json.description, json.type, json.column], ["Texto **importante** de la tarea.", "Funcionalidad", COL.doing]);
  L.eq("COPIAR: etiquetas, responsable (id y nombre, sin email) y fecha límite", [json.labels, json.assignee, json.dueDate], [["cliente", "urgente"], { id: me.id, name: me.name }, "2026-12-01"]);
  L.check("COPIAR: ningún email en el texto copiado (tampoco el de quien copia)", !copied.includes(me.email) && !copied.includes("@example.com"));
  L.eq("COPIAR: los campos opcionales activos del proyecto (y solo esos)", [json.priority, json.client, "cost" in json, "startDate" in json], ["high", "Acme", false, false]);
  L.eq("COPIAR: subtareas, dependencia (id y título), enlace y repetición", [json.subtasks, json.dependsOn, json.link, json.recurrence], [[{ text: "Guion", done: true }, { text: "Ensayo", done: false }], { id: ids.other, title: "Otra" }, "https://example.com/origen", { rule: "none" }]);
  L.check("COPIAR: datos de solo lectura (id, proyecto, id del proyecto y URL absoluta de la tarea)", json.info?.id === ids.src && json.info?.project === p0.name && json.info?.projectId === p0.id && /^https?:\/\/[^/]+\/p\/.+\?task=/.test(json.info?.url ?? "") && json.info.url.endsWith(`/p/${p0.id}?task=${ids.src}`), JSON.stringify(json.info));
  L.check("COPIAR: legible (sangrado) y sin ids internos de etiquetas, tipo o columna", copied.startsWith('{\n  "format": "pizarro.task",') && !/r53l0|kind_funcionalidad/.test(copied));
  L.eq("COPIAR: copiar no deja entrada de deshacer ni historial", [await U.undoCount("UNDO"), (await L.events("Origen")).length], [0, 0]);

  if (only.includes("copiar")) {
    // Con el cursor en el título pero sin nada seleccionado, también se copia la tarea.
    await sleep(2700);
    await setClip(page, "antes");
    await titleField(page).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Control+c");
    L.check("COPIAR: con el cursor en un campo y nada seleccionado, también la tarea", await statusShows(page, "Tarea copiada") && (await clip(page)).includes('"pizarro.task"'));
    // Texto seleccionado en un campo: se copia ese texto y no la tarea.
    await sleep(2700);
    await titleField(page).click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+c");
    await sleep(600);
    L.eq("COPIAR: con el título seleccionado, Ctrl+C copia el título", await clip(page), "Origen");
    L.check("COPIAR: … y no sale «Tarea copiada»", (await status(page).innerText()).trim() !== "Tarea copiada" || Number(await status(page).evaluate((el) => getComputedStyle(el).opacity)) < 0.5);
    // Texto seleccionado en la página (fuera de los campos): igual.
    await blur(page);
    await setClip(page, "antes");
    await U.dialog(page).getByRole("heading", { name: /Capturas y adjuntos/ }).evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); });
    await page.keyboard.press("Control+c");
    await sleep(600);
    L.eq("COPIAR: con texto de la página seleccionado, Ctrl+C copia ese texto", (await clip(page)).trim(), "Capturas y adjuntos");
    await page.evaluate(() => getSelection().removeAllRanges());
    // Con otro diálogo encima (la ayuda de atajos no; una confirmación sí): no copia la tarea de debajo.
    await U.closeDialog(page);
    await setClip(page, "antes");
    await page.keyboard.press("Control+c");
    await sleep(500);
    L.eq("COPIAR: sin ninguna tarea abierta, Ctrl+C no copia nada", await clip(page), "antes");
    L.assertNoErrors("copiar", [s]);
  }

  // --- Pegar en otra tarea y deshacer --------------------------------------------------------------------------------------
  if (only.includes("pegar")) {
    L.scenario("pegar: Ctrl+V fuera de un campo escribe la tarea copiada en la abierta; Ctrl+Z lo deshace de una vez");
    if (await U.dialog(page).count()) await U.closeDialog(page);
    await setClip(page, copied.replace('"title": "Origen"', '"title": "Destino pegado"'));
    await U.openTask(page, "Destino");
    await blur(page);
    L.eq("PEGAR: antes, la tarea de destino está como se creó", await row(ids.dst), EMPTY);
    await page.keyboard.press("Control+v");
    L.check("PEGAR: el indicador de la cabecera dice «Tarea pegada»", await statusShows(page, "Tarea pegada"));
    await L.eqEventually("PEGAR: título, descripción, fecha, responsable, campos, enlace, columna, etiquetas, subtareas y dependencia", () => row(ids.dst), sorted({ ...FULL, blockedById: ids.other }));
    L.eq("PEGAR: el detalle muestra el título pegado", await titleField(page).inputValue(), "Destino pegado");
    await L.checkEventually("PEGAR: … y las subtareas pegadas en lugar de las que había", async () => { const t = await U.dialog(page).innerText(); return t.includes("Guion") && t.includes("Ensayo") && !t.includes("Subtarea vieja"); });
    L.check("PEGAR: … y la descripción pegada", (await U.dialog(page).innerText()).includes("importante"));
    L.eq("PEGAR: una sola entrada de deshacer", await U.undoCount("UNDO"), 1);
    L.eq("PEGAR: el origen no cambia (ni su id ni su columna)", [(await row(ids.src)).title, (await row(ids.src)).col], ["Origen", COL.doing]);
    L.check("PEGAR: queda en el historial de la tarea", (await L.events("Destino pegado")).some((e) => e.label.includes("Pegó el contenido de una tarea en JSON")));
    L.eq("PEGAR: sin avisos de error", await alerts(page), "");

    await U.undoKey(page, "Control+z");
    await L.eqEventually("DESHACER: un solo Ctrl+Z devuelve la tarea entera a como estaba", () => row(ids.dst), EMPTY);
    await L.checkEventually("DESHACER: el detalle vuelve a mostrar el título y la subtarea de antes", async () => (await titleField(page).inputValue()) === "Destino" && (await U.dialog(page).innerText()).includes("Subtarea vieja"));
    L.eq("DESHACER: no queda nada más que deshacer", await U.undoCount("UNDO"), 0);
    await U.undoKey(page, "Control+Shift+z", "REDO");
    await L.eqEventually("REHACER: Ctrl+Shift+Z vuelve a pegarla", () => row(ids.dst), sorted({ ...FULL, blockedById: ids.other }));
    await U.undoKey(page, "Control+z");
    await L.eqEventually("DESHACER: y se deshace otra vez", () => row(ids.dst), EMPTY);

    // «Cancelar» del detalle también descarta lo pegado (es un cambio más de la sesión de edición).
    await blur(page);
    await page.keyboard.press("Control+v");
    await L.eqEventually("CANCELAR: se pega de nuevo…", async () => (await row(ids.dst)).title, "Destino pegado");
    await statusShows(page, "Tarea pegada");
    await U.dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();
    await L.eqEventually("CANCELAR: … y «Cancelar» lo descarta entero", () => row(ids.dst), EMPTY);
    L.assertNoErrors("pegar", [s]);
  }
  await s.ctx.close();
}

// --- Pegar con un campo de texto enfocado: texto normal -------------------------------------------------------------------
if (only.includes("texto")) {
  L.scenario("texto: con un campo de texto enfocado, Ctrl+V pega el texto y no toca la tarea");
  const ids = await seed();
  await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG' WHERE id=$1`, [me.id]);
  const s = await withClipboard();
  const { page } = s;
  const oneLine = '{"format":"pizarro.task","title":"No debe aplicarse","dueDate":"2030-01-01"}';
  await U.openTask(page, "Destino");
  await setClip(page, oneLine);
  await titleField(page).click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+v");
  await sleep(800);
  L.eq("TEXTO: en el título, el JSON se pega como texto", await titleField(page).inputValue(), oneLine);
  L.eq("TEXTO: la tarea no cambia (ni fecha ni título guardado)", [(await row(ids.dst)).due, (await row(ids.dst)).title], [null, "Destino"]);
  L.check("TEXTO: no sale «Tarea pegada»", (await status(page).innerText()).trim() !== "Tarea pegada");
  await titleField(page).fill("Destino");
  // En la descripción (editor): también texto.
  await page.keyboard.press("Tab");
  await U.dialog(page).getByRole("button", { name: "Añade una descripción…" }).click();
  const editor = U.dialog(page).locator("[role=textbox][contenteditable]").first();
  {
    await editor.click();
    await page.keyboard.press("Control+v");
    await sleep(800);
    L.check("TEXTO: en la descripción, el JSON se pega como texto", (await editor.innerText()).includes("No debe aplicarse"));
    L.eq("TEXTO: … y la fecha sigue sin tocar", (await row(ids.dst)).due, null);
    // Con la descripción a medio escribir, pegar una tarea fuera del campo pregunta antes de descartarla.
    await blur(page);
    await setClip(page, '{"format":"pizarro.task","description":"La pegada","dueDate":"2030-01-01"}');
    await page.keyboard.press("Control+v");
    const ask = page.getByRole("button", { name: "Seguir editando" });
    L.check("TEXTO: con la descripción sin guardar, pegar la tarea pregunta antes", await ask.waitFor({ timeout: 4000 }).then(() => true, () => false));
    await ask.click().catch(() => {});
    await sleep(500);
    L.eq("TEXTO: «Seguir editando» no pega nada", [(await row(ids.dst)).due, (await editor.innerText()).includes("No debe aplicarse")], [null, true]);
  }
  s.errors.length = 0;
  await s.ctx.close();
  await L.q(`UPDATE "User" SET "editorMode"=$2 WHERE id=$1`, [me.id, me.editorMode]);
}

// --- JSON inválido, otro texto y avisos de lo que no se pudo aplicar -------------------------------------------------------
if (only.includes("invalido")) {
  L.scenario("invalido: un JSON de tarea roto avisa; otro texto no hace nada; lo que no se puede aplicar se avisa en breve");
  const ids = await seed();
  const s = await withClipboard();
  const { page } = s;
  await U.openTask(page, "Destino");
  await blur(page);
  // Ctrl+V es estricto: solo una tarea en JSON exacta. Un JSON roto, varias tareas, una lista, un bloque ```json o texto
  // alrededor siguen el pegado normal, sin avisos ni cambios.
  const one = '{"format":"pizarro.task","title":"No debe aplicarse","dueDate":"2030-01-01"}';
  for (const [name, text] of [
    ["un JSON de tarea roto", '{"format":"pizarro.task","title":"sin cerrar"'], ["un texto cualquiera", "hola, esto no es JSON"], ["otro JSON", '{"a":1,"b":[2,3]}'],
    ["un JSON de otro formato", '{"format":"otra.cosa","title":"x"}'], ["una tarea sin marcador", '{"title":"Sin marcador","dueDate":"2030-01-01"}'],
    ["una tarea dentro de un bloque ```json", "```json\n" + one + "\n```"], ["una tarea con texto alrededor", `Aquí la tienes: ${one} ¿Te sirve?`],
    ["una lista con una tarea", `[${one}]`], ["dos tareas seguidas", `${one}\n${one}`],
  ]) {
    await setClip(page, text);
    await page.keyboard.press("Control+v");
    await sleep(700);
    L.eq(`ESTRICTO: ${name} con Ctrl+V fuera de un campo no hace nada (ni aviso ni cambio)`, [await alerts(page), (await row(ids.dst)).title, (await status(page).innerText()).trim() === "Tarea pegada"], ["", "Destino", false]);
  }
  L.eq("ESTRICTO: … y no deja entrada de deshacer", await U.undoCount("UNDO"), 0);
  // Espacios y saltos de línea alrededor sí valen (es la misma tarea exacta).
  await setClip(page, `\n   ${'{"format":"pizarro.task","dueDate":"2030-01-02"}'}  \n`);
  await page.keyboard.press("Control+v");
  L.check("ESTRICTO: con espacios alrededor, sí se pega", await statusShows(page, "Tarea pegada"));
  await L.eqEventually("ESTRICTO: … la fecha queda escrita", async () => (await row(ids.dst)).due, "2030-01-02");
  await U.undoKey(page, "Control+z");
  await L.eqEventually("ESTRICTO: Ctrl+Z la quita", async () => (await row(ids.dst)).due, null);
  const importBtn = U.dialog(page).getByRole("button", { name: "Importar tarea" });
  const fromClipboard = async () => {
    await importBtn.click();
    await page.getByRole("menuitem", { name: /Desde el portapapeles/ }).click();
  };
  // «Importar tarea → Desde el portapapeles» sí es tolerante, y sí avisa de lo que no puede leer.
  await setClip(page, '{"format":"pizarro.task","title":"sin cerrar"');
  await fromClipboard();
  await L.checkEventually("IMPORTAR: un JSON de tarea roto avisa «El JSON de la tarea no es válido.»", async () => (await alerts(page)).includes("El JSON de la tarea no es válido."));
  await sleep(6200); // el aviso de error se va solo
  await setClip(page, `${one}\n${one}`);
  await fromClipboard();
  await L.checkEventually("IMPORTAR: con dos tareas avisa que se importan desde el tablero", async () => (await alerts(page)).includes("Hay 2 tareas. Para importar varias, usa «Importar» en el tablero."));
  L.eq("IMPORTAR: … y no cambia nada", [await row(ids.dst), await U.undoCount("UNDO")], [EMPTY, 0]);
  await sleep(6200);
  // JSON de una IA con variaciones: se aplica lo que se puede y se avisa de lo demás.
  await setClip(page, "Claro, aquí tienes la tarea:\n\n```json\n" + JSON.stringify({ Título: "Escrita por una IA", Tipo: "No existe", Estado: "en PROGRESO", Etiquetas: ["URGENTE", "nueva"], fecha_limite: "2027-03-04T09:00:00Z", Prioridad: "urgente", coste: 10, Subtareas: ["[x] Hecha", "Pendiente"] }, null, 2) + "\n```\n¿Algo más?");
  await fromClipboard();
  L.check("IA: «Importar tarea» la pega con el texto alrededor («Tarea pegada»)", await statusShows(page, "Tarea pegada"));
  await L.checkEventually("IA: avisa en breve de lo que no se pudo aplicar (tipo inexistente, campo no activado)", async () => { const a = await alerts(page); return [a.includes("Tarea pegada, salvo:") && a.includes("tipo «No existe» (no existe)") && a.includes("coste (campo no activado)"), a]; });
  await L.eqEventually("IA: claves en español, fecha ISO, columna y etiqueta sin mirar mayúsculas, etiqueta nueva creada", async () => { const r = await row(ids.dst); return [r.title, r.due, r.col, r.priority, r.labels, r.subtasks]; }, ["Escrita por una IA", "2027-03-04", COL.doing, "URGENTE", ["nueva", "urgente"], ["x Hecha", "  Pendiente"]]);
  await L.checkEventually("IA: la etiqueta nueva ya sale en el detalle", async () => (await U.dialog(page).innerText()).includes("nueva"));
  await U.undoKey(page, "Control+z");
  await L.eqEventually("IA: Ctrl+Z lo deshace entero", () => row(ids.dst), EMPTY);
  L.eq("IA: … y borra la etiqueta que creó el pegado («nueva»)", (await L.q(`SELECT name FROM "Label" WHERE "projectId"=$1 ORDER BY name`, [p0.id])).map((r) => r.name), ["cliente", "urgente"]);
  s.errors.length = 0;
  await s.ctx.close();
}

// --- Botones del detalle: teclado, fichero, navegador que no deja leer el portapapeles y móvil ------------------------------
if (only.includes("menu")) {
  L.scenario("menu: «Copiar tarea» e «Importar tarea» sin atajos, con el teclado, desde un fichero, sin permiso y en el móvil");
  const ids = await seed();
  const s = await withClipboard();
  const { page } = s;
  await setClip(page, "antes");
  await U.openTask(page, "Origen");
  const copyBtn = (pg) => U.dialog(pg).getByRole("button", { name: "Copiar tarea", exact: true });
  const importBtn = (pg) => U.dialog(pg).getByRole("button", { name: "Importar tarea", exact: true });
  L.eq("BOTONES: en escritorio, los dos iconos y no el menú «Más opciones de la tarea» (solo en pantallas estrechas)", await U.dialog(page).getByRole("button", { name: "Más opciones de la tarea" }).count(), 0);
  L.check("BOTONES: «Copiar tarea» e «Importar tarea» con tooltip y su atajo", (await copyBtn(page).getAttribute("title")).includes("Ctrl+C") && !!(await importBtn(page).getAttribute("title")));
  await copyBtn(page).click();
  L.check("BOTONES: «Copiar tarea» copia y lo dice el indicador", await statusShows(page, "Tarea copiada") && (await clip(page)).includes('"title": "Origen"'));
  const json = await clip(page);
  await U.closeDialog(page);
  await setClip(page, json.replace('"title": "Origen"', '"title": "Destino pegado"'));
  await U.openTask(page, "Destino");
  // Con el teclado: el botón se alcanza con el foco, Enter abre el menú y las flechas eligen.
  await importBtn(page).focus();
  await page.keyboard.press("Enter");
  const items = page.getByRole("menuitem");
  await items.first().waitFor({ timeout: 4000 });
  L.eq("IMPORTAR: opciones «Desde el portapapeles» (con su atajo) y «Desde un fichero»", (await items.allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim()), ["Desde el portapapeles Ctrl+V", "Desde un fichero"]);
  L.eq("IMPORTAR: al abrirlo con el teclado, el foco va a la primera opción", await page.evaluate(() => document.activeElement?.textContent?.includes("Desde el portapapeles")), true);
  await page.keyboard.press("Enter");
  L.check("IMPORTAR: «Desde el portapapeles» pega lo del portapapeles", await statusShows(page, "Tarea pegada"));
  await L.eqEventually("IMPORTAR: … con todos sus campos", async () => { const r = await row(ids.dst); return [r.title, r.due, r.col, r.subtasks]; }, ["Destino pegado", "2026-12-01", COL.doing, ["x Guion", "  Ensayo"]]);
  // Desde el portapapeles, un texto sin tarea sí avisa (con Ctrl+V no, para no estorbar al pegado normal).
  await setClip(page, "nada que ver");
  await importBtn(page).click();
  await page.getByRole("menuitem", { name: /Desde el portapapeles/ }).click();
  await L.checkEventually("IMPORTAR: sin una tarea en el portapapeles lo dice", async () => (await alerts(page)).includes("No hay ninguna tarea en JSON."));
  // Desde un fichero (.json o .txt).
  await importBtn(page).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("menuitem", { name: /Desde un fichero/ }).click()]);
  await chooser.setFiles({ name: "tarea.txt", mimeType: "text/plain", buffer: Buffer.from('Tarea:\n{"title":"Desde un fichero","dueDate":"2027-07-08"}\n') });
  await L.eqEventually("FICHERO: la tarea del fichero .txt se pega", async () => { const r = await row(ids.dst); return [r.title, r.due]; }, ["Desde un fichero", "2027-07-08"]);
  // La ayuda de atajos recoge las dos combinaciones.
  await U.closeDialog(page);
  await blur(page);
  await page.keyboard.press("?");
  await L.checkEventually("AYUDA: los atajos de copiar y pegar la tarea salen en la ayuda", async () => { const t = await page.locator("[role=dialog]").last().innerText().catch(() => ""); return t.includes("Copiar la tarea como JSON (sin texto seleccionado)") && t.includes("Pegar una tarea en JSON sobre esta (fuera de un campo de texto)"); });
  await page.keyboard.press("Escape");
  L.assertNoErrors("menu", [s]);
  await s.ctx.close();

  // El navegador no deja leer el portapapeles (permiso rechazado): se ofrece pegar el JSON a mano.
  await seed();
  const ids2 = await L.q(`SELECT id FROM "Task" WHERE title='Destino'`);
  const denied = await L.session({ init: () => { try { Object.defineProperty(navigator.clipboard, "readText", { configurable: true, value: () => Promise.reject(new DOMException("denied", "NotAllowedError")) }); } catch { /* sin API */ } } });
  await U.openTask(denied.page, "Destino");
  await importBtn(denied.page).click();
  await denied.page.getByRole("menuitem", { name: /Desde el portapapeles/ }).click();
  const manual = denied.page.locator("[role=dialog]").last();
  L.check("PERMISO: sin permiso para leer el portapapeles, se abre un cuadro para pegar el JSON a mano", await manual.getByText("El navegador no deja leer el portapapeles").waitFor({ timeout: 4000 }).then(() => true, () => false));
  await manual.locator("textarea").fill("esto no es una tarea");
  await manual.getByRole("button", { name: "Importar", exact: true }).click();
  await L.checkEventually("PERMISO: un texto que no es una tarea avisa y el cuadro sigue abierto", async () => (await alerts(denied.page)).includes("No hay ninguna tarea en JSON.") && (await manual.locator("textarea").count()) === 1);
  await manual.locator("textarea").fill('{"format":"pizarro.task","title":"Pegada a mano","dueDate":"2027-05-06"}');
  await manual.getByRole("button", { name: "Importar", exact: true }).click();
  await L.eqEventually("PERMISO: el JSON pegado a mano se aplica", async () => { const r = await row(ids2[0].id); return [r.title, r.due]; }, ["Pegada a mano", "2027-05-06"]);
  await L.checkEventually("PERMISO: … y el cuadro se cierra", async () => (await denied.page.locator("[role=dialog] textarea.font-mono").count()) === 0);
  denied.errors.length = 0;
  await denied.ctx.close();

  // Móvil: sin teclado, con los botones.
  const ids3 = await seed();
  // En el móvil se ve una columna cada vez: las dos tareas, en la primera.
  await L.q(`UPDATE "Task" SET "columnId"=(SELECT "columnId" FROM "Task" WHERE id=$2), position=9000 WHERE id=$1`, [ids3.src, ids3.dst]);
  const m = await withClipboard({ viewport: { width: 390, height: 800 }, mobile: true });
  await L.cardLoc(m.page, "Origen").first().tap();
  await U.dialog(m.page).waitFor();
  await sleep(500);
  // A 390 px «Copiar tarea» e «Importar tarea» van juntos en «⋯» (Más opciones de la tarea): el título tiene sitio.
  const moreBtn = (pg) => U.dialog(pg).getByRole("button", { name: "Más opciones de la tarea", exact: true });
  L.eq("MÓVIL: los dos iconos sueltos no se ven", [await copyBtn(m.page).count(), await importBtn(m.page).count()], [0, 0]);
  const box = await moreBtn(m.page).boundingBox();
  L.check("MÓVIL: «Más opciones de la tarea» cabe en la cabecera del detalle", !!box && box.x >= 0 && box.x + box.width <= 390 && box.width >= 28, JSON.stringify(box));
  const titleWidth = await moreBtn(m.page).evaluate((el) => Math.round(el.closest("div.relative.flex")?.firstElementChild?.getBoundingClientRect().width ?? 0));
  // Con los dos iconos sueltos se quedaba en unos 150 px a 390 (y 120 a 360: dos palabras); con «⋯», unos 190.
  L.check("MÓVIL: el título tiene sitio (un botón menos en la cabecera)", titleWidth >= 180, String(titleWidth));
  await moreBtn(m.page).tap();
  L.eq("MÓVIL: «⋯» tiene copiar e importar (portapapeles y fichero), sin atajos de teclado", (await m.page.getByRole("menuitem").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim()), ["Copiar tarea", "Importar desde el portapapeles", "Importar desde un fichero"]);
  await m.page.getByRole("menuitem", { name: "Copiar tarea" }).tap();
  L.check("MÓVIL: «Copiar tarea» copia", await statusShows(m.page, "Tarea copiada") && (await clip(m.page)).includes('"pizarro.task"'));
  const mjson = await clip(m.page);
  await setClip(m.page, mjson.replace('"title": "Origen"', '"title": "Pegada en el móvil"'));
  await U.dialog(m.page).getByRole("button", { name: "Cerrar" }).first().tap();
  await U.dialog(m.page).waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await L.cardLoc(m.page, "Destino").first().tap();
  await U.dialog(m.page).waitFor();
  await sleep(500);
  await moreBtn(m.page).tap();
  await m.page.getByRole("menuitem", { name: "Importar desde el portapapeles" }).tap();
  L.check("MÓVIL: «Importar desde el portapapeles» pega", await statusShows(m.page, "Tarea pegada"));
  await L.eqEventually("MÓVIL: … la tarea queda escrita", async () => { const r = await row(ids3.dst); return [r.title, r.due, r.subtasks]; }, ["Pegada en el móvil", "2026-12-01", ["x Guion", "  Ensayo"]]);
  // Con el teclado (un teclado conectado a la tableta): Enter abre «⋯», las flechas recorren y Escape lo cierra.
  await moreBtn(m.page).focus();
  await m.page.keyboard.press("Enter");
  await m.page.getByRole("menuitem").first().waitFor({ timeout: 4000 });
  await m.page.keyboard.press("ArrowDown");
  L.eq("MÓVIL: con el teclado, las flechas recorren las opciones de «⋯»", await m.page.evaluate(() => document.activeElement?.textContent?.trim()), "Importar desde el portapapeles");
  await m.page.keyboard.press("Escape");
  await L.checkEventually("MÓVIL: Escape cierra «⋯» y el foco vuelve al botón", async () => (await m.page.getByRole("menuitem").count()) === 0 && (await m.page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Más opciones de la tarea");
  m.errors.length = 0;
  await m.ctx.close();
}

// --- Inglés ----------------------------------------------------------------------------------------------------------------
if (only.includes("ingles")) {
  L.scenario("ingles: los avisos, el menú y los nombres de serie en inglés");
  const ids = await seed();
  await L.q(`UPDATE "User" SET locale='EN' WHERE id=$1`, [me.id]);
  const b = await L.getBrowser();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, locale: "en-US" });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(L.BASE + "/login");
  await page.fill("#email", L.ADMIN); await page.fill("#password", L.PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/p\//, { timeout: 20000 });
  await L.cardLoc(page, "Origen").first().waitFor({ timeout: 20000 });
  await sleep(800);
  await L.cardLoc(page, "Origen").click();
  await U.dialog(page).waitFor();
  await sleep(500);
  await blur(page);
  await page.keyboard.press("Control+c");
  L.check("EN: el indicador dice «Task copied»", await statusShows(page, "Task copied"));
  const json = JSON.parse((await clip(page)) || "{}");
  L.eq("EN: el tipo de serie va con el nombre que se ve en inglés; las claves no cambian", [json.format, json.type, json.priority], ["pizarro.task", "Feature", "high"]);
  L.eq("EN: los botones en inglés", [await U.dialog(page).getByRole("button", { name: "Copy task", exact: true }).count(), await U.dialog(page).getByRole("button", { name: "Import task", exact: true }).count()], [1, 1]);
  await U.dialog(page).getByRole("button", { name: "Import task", exact: true }).click();
  L.eq("EN: el menú en inglés", (await page.getByRole("menuitem").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim()), ["From the clipboard Ctrl+V", "From a file"]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await U.dialog(page).waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await setClip(page, JSON.stringify({ ...json, title: "Pasted in English", type: "feature", labels: ["URGENTE"], cost: 5 }));
  await L.cardLoc(page, "Destino").click();
  await U.dialog(page).waitFor();
  await sleep(500);
  await blur(page);
  await page.keyboard.press("Control+v");
  L.check("EN: el indicador dice «Task pasted»", await statusShows(page, "Task pasted"));
  await L.eqEventually("EN: se pega (el tipo se reconoce por su nombre en inglés)", async () => { const r = await row(ids.dst); const [k] = await L.q(`SELECT "kindId" FROM "Task" WHERE id=$1`, [ids.dst]); return [r.title, r.due, r.labels, k.kindId]; }, ["Pasted in English", "2026-12-01", ["urgente"], "kind_funcionalidad"]);
  await L.checkEventually("EN: lo que no se aplica se avisa en inglés", async () => { const a = await alerts(page); return [a.includes("Task pasted, except:") && a.includes("cost (field not enabled)"), a]; });
  await sleep(6200);
  await setClip(page, '{"format":"pizarro.task","title":"broken"');
  await U.dialog(page).getByRole("button", { name: "Import task", exact: true }).click();
  await page.getByRole("menuitem", { name: /From the clipboard/ }).click();
  await L.checkEventually("EN: el JSON inválido se avisa en inglés", async () => (await alerts(page)).includes("The task JSON is not valid."));
  await sleep(6200);
  await setClip(page, '{"format":"pizarro.task","title":"a"}\n{"format":"pizarro.task","title":"b"}');
  await U.dialog(page).getByRole("button", { name: "Import task", exact: true }).click();
  await page.getByRole("menuitem", { name: /From the clipboard/ }).click();
  await L.checkEventually("EN: varias tareas se avisan en inglés", async () => (await alerts(page)).includes("There are 2 tasks. To import several, use “Import” on the board."));
  L.check("EN: sin errores de página", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
  await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [me.id]);
}

await L.q(`UPDATE "User" SET locale=$2 WHERE id=$1`, [me.id, me.locale]);
await L.q(`UPDATE "Project" SET "taskFields"=$2 WHERE id=$1`, [p0.id, fields0]);
await L.cleanBoard();
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
