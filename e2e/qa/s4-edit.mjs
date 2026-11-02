// Escenario 4: editar una tarea en el diálogo (título, descripción, tipo, responsable, fecha, etiquetas, color, enlace, entregable).
import * as L from "./lib.mjs";
import * as U from "./ui.mjs";
const { COL } = L;

const row = async (title) => (await L.q(`SELECT t.title,t.description,t."kindId",t."assigneeId",t."dueDate"::text AS due,t.color,t."linkUrl",t."deliverableId",
  (SELECT string_agg(l.name,',' ORDER BY l.name) FROM "TaskLabel" tl JOIN "Label" l ON l.id=tl."labelId" WHERE tl."taskId"=t.id) AS labels FROM "Task" t WHERE t.title=$1`, [title]))[0];

export async function run() {
  L.scenario("4. Editar una tarea en el diálogo");
  await L.cleanBoard();
  const p0 = await L.project();
  await L.q(`INSERT INTO "Label"(id,"projectId",name,color) VALUES ('qlab1',$1,'Urgente','#ef4444'),('qlab2',$1,'Web','#3b82f6')`, [p0.id]);
  await L.seedTasks(COL.backlog, ["Editable", "Otra"]);
  const [u2] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.USER2]);
  const [deliv] = await L.q(`SELECT id FROM "Deliverable" LIMIT 1`);
  const t0 = await L.dbNow();
  const s = await L.session({ viewport: U.WIDE });
  const p = s.page;
  const before = await row("Editable");
  L.eq("estado inicial: sin descripción ni etiquetas", [before.description, before.labels, before.color, before.linkUrl, before.due], ["", null, null, null, null]);

  await U.openTask(p, "Editable");
  const d = U.dialog(p);
  const saved = async () => { await L.sleep(700); };

  // Título
  const title = d.locator("textarea[aria-label='Título']").first();
  await title.click(); await p.keyboard.press("Control+A"); await p.keyboard.type("Título nuevo"); await p.keyboard.press("Enter");
  await L.eqEventually("título guardado en BD", async () => (await L.q(`SELECT title FROM "Task" WHERE id=(SELECT id FROM "Task" WHERE title='Título nuevo')`)).length, 1);
  const T = "Título nuevo";

  // Descripción (editor enriquecido): negrita con Ctrl+B y guardado con Ctrl+Enter
  await d.getByRole("button", { name: "Añade una descripción…" }).click();
  const ed = d.locator("[role=textbox][contenteditable]").first();
  await ed.click();
  await p.keyboard.type("Hola ");
  await p.keyboard.press("Control+B"); await p.keyboard.type("mundo"); await p.keyboard.press("Control+B");
  await p.keyboard.type(" fin");
  await p.keyboard.press("Control+Enter");
  await L.eqEventually("descripción guardada con negrita (Markdown)", async () => (await row(T)).description.trim(), "Hola **mundo** fin");
  L.check("la descripción se ve en el diálogo con <strong>", (await d.locator("strong", { hasText: "mundo" }).count()) === 1);

  // Tipo
  await d.getByRole("radio", { name: "Corrección" }).click();
  await L.eqEventually("tipo: Corrección", async () => (await row(T)).kindId, "kind_correccion");
  // Responsable
  await d.locator("select").filter({ has: p.locator("option", { hasText: "Sin asignar" }) }).selectOption({ label: "Segunda Persona" });
  await L.eqEventually("responsable guardado", async () => (await row(T)).assigneeId, u2.id);
  // Fecha límite
  const due = d.locator("input[type=date]");
  await due.fill("2026-11-15");
  await L.eqEventually("fecha límite guardada", async () => (await row(T)).due, "2026-11-15");
  // Entregable
  await d.locator("select").filter({ has: p.locator("option", { hasText: "Sin entregable" }) }).selectOption({ label: "Beta cerrada" });
  await L.eqEventually("entregable guardado", async () => (await row(T)).deliverableId, deliv.id);
  // Color
  await d.getByRole("radio", { name: "Color Rojo" }).click();
  await L.eqEventually("color guardado", async () => !!(await row(T)).color, true);
  const color = (await row(T)).color;
  // Etiquetas
  await d.getByRole("button", { name: "Urgente" }).click();
  await L.eqEventually("etiqueta 1", async () => (await row(T)).labels, "Urgente");
  await d.getByRole("button", { name: "Web" }).click();
  await L.eqEventually("etiqueta 2", async () => (await row(T)).labels, "Urgente,Web");
  await d.getByRole("button", { name: "Urgente" }).click();
  await L.eqEventually("quitar una etiqueta", async () => (await row(T)).labels, "Web");
  await d.getByRole("button", { name: "Urgente" }).click();
  await L.eqEventually("volver a poner la etiqueta", async () => (await row(T)).labels, "Urgente,Web");
  // Enlace
  const link = d.locator("input[type=url]");
  await link.fill("https://example.com/pr/1"); await link.blur();
  await L.eqEventually("enlace guardado", async () => (await row(T)).linkUrl, "https://example.com/pr/1");
  // Guardar y cerrar
  await d.getByRole("button", { name: "Guardar" }).last().click();
  await d.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await saved();

  const after = await row(T);
  L.eq("BD final: todos los campos", { ...after, color: !!after.color }, { title: T, description: after.description, kindId: "kind_correccion", assigneeId: u2.id, due: "2026-11-15", color: true, linkUrl: "https://example.com/pr/1", deliverableId: deliv.id, labels: "Urgente,Web" });
  // UI de la tarjeta tras recargar
  await L.reload(p);
  const card = L.cardLoc(p, T);
  L.check("tarjeta: título nuevo", await card.count() === 1);
  L.check("tarjeta: tipo Corrección", (await card.getByText("Corrección").count()) > 0);
  L.check("tarjeta: etiquetas visibles", (await card.getByText("Urgente").count()) > 0 && (await card.getByText("Web").count()) > 0);
  L.check("tarjeta: icono de descripción", (await card.locator("svg[aria-label='Con descripción']").count()) > 0);
  await U.openTask(p, T);
  const d2 = U.dialog(p);
  L.check("diálogo recargado: valores persistidos", (await d2.locator("input[type=date]").inputValue()) === "2026-11-15" && (await d2.locator("input[type=url]").inputValue()) === "https://example.com/pr/1" && (await d2.locator("strong", { hasText: "mundo" }).count()) === 1 && (await d2.getByRole("radio", { name: "Corrección" }).getAttribute("aria-checked")) === "true" && (await d2.getByRole("button", { name: "Urgente" }).getAttribute("aria-pressed")) === "true");
  const hist = await U.historyText(p);
  const evs = await L.events(T);
  L.check("historial: aparece al menos una línea de cambio por campo editado", evs.length >= 5, JSON.stringify(evs.map((e) => e.code)));
  L.check("historial del diálogo muestra «Administrador»", /Administrador/.test(hist));
  L.check("historial del diálogo menciona el título/descr./tipo", /Cambió|Cambi|título|descripción|tipo/i.test(hist), hist.slice(hist.indexOf("Historial"), hist.indexOf("Historial") + 400));
  await U.closeDialog(p);
  await U.logHas("AppLog updateTask «Modificó»", t0, "tasks.updateTask", /^Modificó «/);
  const nUndo = (await L.undoEntries("UNDO")).length;
  L.eq("el deshacer guarda como máximo las últimas 10 ediciones (hubo 12)", nUndo, 10);

  // Deshacer todo: cada Ctrl+Z revierte una edición
  for (let i = 0; i < nUndo; i++) await U.undoKey(p, "Control+z");
  const back = await row(T);
  L.eq("deshacer las 10 últimas: tipo, responsable, fecha, color, enlace, entregable y etiquetas vuelven al valor inicial",
    [back.kindId, back.assigneeId, back.due, back.color, back.linkUrl, back.deliverableId, back.labels],
    [before.kindId, before.assigneeId, before.due, before.color, before.linkUrl, before.deliverableId, before.labels]);
  L.eq("deshacer: título y descripción (fuera de las 10 últimas) se conservan", [back.title, back.description.trim()], [T, "Hola **mundo** fin"]);
  await L.reload(p);
  L.check("deshacer: la tarjeta sigue con el título nuevo", (await L.cardLoc(p, T).count()) === 1);
  // Rehacer todo
  for (let i = 0; i < nUndo; i++) await U.undoKey(p, "Alt+Shift+z", "REDO");
  const redo = await row(T);
  L.eq("rehacer todo: valores finales restaurados", { ...redo, color: !!redo.color }, { ...after, color: true });
  L.eq("el color rehecho es el mismo", redo.color, color);

  // Autoguardado de campos sin pulsar «Guardar»: cerrar con Escape conserva el cambio de fecha
  await U.openTask(p, T);
  await U.dialog(p).locator("input[type=date]").fill("2026-12-01");
  await L.eqEventually("fecha cambiada se guarda sin pulsar Guardar", async () => (await row(T)).due, "2026-12-01");
  await U.dialog(p).getByRole("button", { name: "Quitar fecha límite" }).click();
  await L.eqEventually("quitar fecha límite", async () => (await row(T)).due, null);
  await U.closeDialog(p);

  // Título largo con Alt+S: «Guardar» guarda el título y la descripción en edición
  await U.openTask(p, "Otra");
  const t2 = U.dialog(p).locator("textarea[aria-label='Título']").first();
  await t2.click(); await p.keyboard.press("Control+A"); await p.keyboard.type("Otra renombrada");
  await p.keyboard.press("Alt+s");
  await L.eqEventually("Alt+S guarda el título en edición", async () => (await L.dbTask("Otra renombrada")) !== undefined, true);
  await U.dialog(p).waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  L.check("Alt+S cierra el diálogo", (await p.locator("[role=dialog]").count()) === 0);

  // Deshacer de título y descripción por separado (pila vacía de entradas previas relevantes)
  await U.openTask(p, "Otra renombrada");
  const d3 = U.dialog(p);
  await d3.getByRole("button", { name: "Añade una descripción…" }).click();
  await d3.locator("[role=textbox][contenteditable]").first().click();
  await p.keyboard.type("Texto de prueba");
  await p.keyboard.press("Control+Enter");
  await L.eqEventually("descripción nueva guardada", async () => (await row("Otra renombrada")).description.trim(), "Texto de prueba");
  await U.closeDialog(p);
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer la descripción la deja vacía", async () => (await row("Otra renombrada")).description.trim(), "");
  await U.undoKey(p, "Control+z");
  await L.eqEventually("deshacer el renombrado restaura «Otra»", async () => (await L.dbTask("Otra")) !== undefined, true);
  const evOtra = await L.events("Otra");
  // v1.21: deshacer borra del historial las entradas de la acción deshecha.
  L.check("historial de «Otra»: sin título ni descripción tras deshacer ambos", !evOtra.some((e) => /título|descripción/.test(e.label)), JSON.stringify(evOtra));

  L.assertNoErrors("escenario 4", [s]);
  await s.ctx.close();
}
await U.runStandalone(import.meta.url, run);
