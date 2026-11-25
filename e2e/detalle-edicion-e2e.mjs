// Editar en el detalle de la tarea (rondas 67 y 68): un cambio de tipo que no se guarda vuelve al de antes (con su título
// y su descripción); tras «Guardar descripción» el foco queda en la descripción guardada, la columna no salta e Intro
// vuelve a editar; la descripción no se abre sola al volver a la pestaña; un conflicto al cambiar de tipo con la
// descripción a medio escribir no pierde lo escrito (dos personas, con el canal en vivo de la primera cortado para que
// no vea el cambio de la otra); el aviso del cambio de tipo dice si la plantilla de la descripción se aplica o se quita
// (o nada) y su «Deshacer» nombra la tarea sin el prefijo del tipo; una imagen pegada o soltada con el editor abierto se
// adjunta y se inserta en el texto (editor con barra y Markdown; fuera del editor solo se adjunta); y el botón del pie
// dice «Deshacer todo» en una ventana ancha. Esperas a una condición, nunca pausas fijas. Misma base y servidor que
// tablero-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node detalle-edicion-e2e.mjs
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { COL } = L;
const only = (process.env.PART || "tipo,foco,pestana,conflicto,aviso,imagen,pie").split(",");

await L.prepareUsers();
await L.cleanBoard();
await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG'`);

const row = async (id) => (await L.q(`SELECT title, description, "kindId" FROM "Task" WHERE id=$1`, [id]))[0];
const attachments = (id) => L.q(`SELECT id, "originalName" AS name FROM "TaskAttachment" WHERE "taskId"=$1 ORDER BY "createdAt", id`, [id]);
/** Dos fotogramas: lo que el detalle hace tras un evento (efectos, foco) ya se ha pintado. */
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const toastWith = (page, text) => page.locator("[data-toasts] > div").filter({ hasText: text });
const editor = (d) => d.locator("[contenteditable=true]").first();
const checkedKind = (d) => d.locator("[role=radiogroup][aria-label=Tipo] [role=radio][aria-checked=true]").innerText();
const titleOf = (page) => U.dialog(page).getAttribute("aria-label");
const saveDesc = (d) => d.getByRole("button", { name: "Guardar descripción" });
/** Abre la descripción en edición (vacía o con texto) y espera al editor. */
async function openDesc(d) {
  const empty = d.getByRole("button", { name: "Añade una descripción…" });
  await (await empty.count() ? empty : d.getByRole("button", { name: "Editar", exact: true })).click();
  await saveDesc(d).waitFor();
}
/** Pega una imagen PNG (hecha con un canvas) con un ClipboardEvent sintético sobre el elemento con el foco. */
const pasteImage = (page, name) =>
  page.evaluate(async (name) => {
    const c = document.createElement("canvas");
    c.width = 40;
    c.height = 30;
    const g = c.getContext("2d");
    g.fillStyle = "#3b82f6";
    g.fillRect(0, 0, 40, 30);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], name, { type: "image/png" }));
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, name);
/** Suelta una imagen sobre `selector` (dragenter, dragover y drop, cerca de su esquina inferior derecha). */
const dropImage = (page, selector, name) =>
  page.evaluate(async ([selector, name]) => {
    const c = document.createElement("canvas");
    c.width = 30;
    c.height = 30;
    c.getContext("2d").fillRect(0, 0, 30, 30);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], name, { type: "image/png" }));
    const el = document.querySelector(selector);
    const r = el.getBoundingClientRect();
    for (const type of ["dragenter", "dragover", "drop"]) {
      el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.right - 4, clientY: r.bottom - 4 }));
    }
  }, [selector, name]);

// --- (Ronda 67) Un cambio de tipo que no se guarda vuelve al tipo de antes, con su título y su descripción -----------
if (only.includes("tipo")) {
  L.scenario("tipo: sin conexión, el cambio de tipo no se guarda y todo vuelve a como estaba");
  const [id] = await L.seedTasks(COL.backlog, ["Tipo sin red"]);
  const s = await L.session();
  await U.openTask(s.page, "Tipo sin red");
  const d = U.dialog(s.page);
  L.eq("TIPO: empieza en «Funcionalidad»", await checkedKind(d), "Funcionalidad");
  await s.ctx.setOffline(true);
  // «Respuesta» pone su prefijo en el título y su plantilla en la descripción; sin red no se puede guardar.
  await d.getByRole("radio", { name: "Respuesta" }).click();
  await L.eqEventually("TIPO: sin red, el selector vuelve a «Funcionalidad»", () => checkedKind(d), "Funcionalidad", { timeout: 15000 });
  await L.eqEventually("TIPO: el título vuelve al de antes (sin «Respuesta»)", () => titleOf(s.page), "Tipo sin red");
  await L.eqEventually("TIPO: la descripción sigue vacía (sin la plantilla de «Respuesta»)", () => d.getByRole("button", { name: "Añade una descripción…" }).count(), 1);
  await s.ctx.setOffline(false);
  L.eq("TIPO: en la base no ha cambiado nada", await row(id), { title: "Tipo sin red", description: "", kindId: "kind_funcionalidad" });
  // Con la red de vuelta, el mismo cambio sí se guarda.
  await L.waitFor(() => s.page.evaluate(() => navigator.onLine));
  await d.getByRole("radio", { name: "Respuesta" }).click();
  await L.eqEventually("TIPO: con red, el cambio se guarda (tipo y título)", async () => { const r = await row(id); return [r.kindId, r.title]; }, ["kind_respuesta", "Respuesta Tipo sin red"], { timeout: 10000 });
  await U.closeDialog(s.page);
  await s.ctx.close();
}

// --- (Ronda 67) «Guardar descripción»: el foco en la descripción guardada, la columna quieta e Intro vuelve a editar --
if (only.includes("foco")) {
  L.scenario("foco: tras «Guardar descripción» el foco y la columna se quedan donde estaban");
  const long = Array.from({ length: 40 }, (_, i) => `Párrafo ${i + 1} de una descripción larga.`).join("\n\n");
  const [id] = await L.seedTasks(COL.backlog, ["Foco al guardar"]);
  await L.q(`UPDATE "Task" SET description=$1 WHERE id=$2`, [long, id]);
  const s = await L.session({ viewport: { width: 1500, height: 700 } });
  await U.openTask(s.page, "Foco al guardar");
  const d = U.dialog(s.page);
  // Doble clic en un párrafo de en medio (la columna se desplaza hasta él) y se escribe al final de su línea.
  await d.getByRole("group", { name: "Descripción" }).getByText("Párrafo 20 de una descripción larga.", { exact: true }).dblclick();
  await saveDesc(d).waitFor();
  await L.waitFor(() => s.page.evaluate(() => document.activeElement?.closest("[contenteditable=true]") !== null));
  await s.page.keyboard.press("End");
  await s.page.keyboard.type(" Editado.");
  const headingTop = () => d.locator("h3", { hasText: /^Descripción$/ }).evaluate((el) => el.getBoundingClientRect().top);
  // El botón a la vista antes de medir: así el clic no desplaza la columna por su cuenta.
  await saveDesc(d).scrollIntoViewIfNeeded();
  const before = await headingTop();
  await saveDesc(d).click();
  await L.eqEventually("FOCO: la descripción se guarda", async () => (await row(id)).description.includes("Párrafo 20 de una descripción larga. Editado."), true);
  await L.checkEventually("FOCO: el foco queda en la descripción guardada", () => s.page.evaluate(() => {
    const el = document.activeElement;
    return el?.getAttribute("role") === "group" && el.getAttribute("aria-label") === "Descripción";
  }));
  const after = await headingTop();
  L.check("FOCO: la columna no salta (la sección se queda en su sitio)", Math.abs(after - before) < 2, `antes ${before}, después ${after}`);
  await s.page.keyboard.press("Enter");
  L.check("FOCO: Intro vuelve a abrir la descripción en edición", await saveDesc(d).waitFor({ timeout: 5000 }).then(() => true, () => false));
  // Sin cambios, Escape la cierra sin preguntar.
  await s.page.keyboard.press("Escape");
  await saveDesc(d).waitFor({ state: "detached", timeout: 5000 });
  L.assertNoErrors("FOCO", [s]);
  await U.closeDialog(s.page);
  await s.ctx.close();
}

// --- (Ronda 67) Volver a la pestaña con el foco en la descripción guardada no la abre en edición -----------------------
if (only.includes("pestana")) {
  L.scenario("pestaña: la descripción no se abre sola al volver a la pestaña");
  const [id] = await L.seedTasks(COL.backlog, ["Volver a la pestaña"]);
  await L.q(`UPDATE "Task" SET description='Texto corto.' WHERE id=$1`, [id]);
  const s = await L.session();
  await U.openTask(s.page, "Volver a la pestaña");
  const d = U.dialog(s.page);
  const read = d.getByRole("group", { name: "Descripción" });
  // Con el teclado: el foco en la descripción, Intro la edita y Ctrl+Intro la guarda.
  await read.focus();
  await s.page.keyboard.press("Enter");
  await saveDesc(d).waitFor();
  await L.waitFor(() => s.page.evaluate(() => document.activeElement?.closest("[contenteditable=true]") !== null));
  await s.page.keyboard.press("Control+End");
  await s.page.keyboard.type(" Y algo más.");
  await s.page.keyboard.press("Control+Enter");
  await L.eqEventually("PESTAÑA: guardada con Ctrl+Intro", async () => (await row(id)).description, "Texto corto. Y algo más.");
  await L.checkEventually("PESTAÑA: el foco queda en la descripción guardada", () => read.evaluate((el) => el === document.activeElement));
  // Otra pestaña delante y vuelta a esta; y lo que hace el navegador al volver: devolver el foco al mismo elemento, sin
  // elemento de origen.
  const other = await s.ctx.newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  await s.page.bringToFront();
  await other.close();
  await s.page.evaluate(() => {
    const el = document.activeElement;
    window.dispatchEvent(new Event("blur"));
    if (el instanceof HTMLElement) {
      el.blur();
      window.dispatchEvent(new Event("focus"));
      el.focus();
    }
  });
  await frames(s.page);
  L.eq("PESTAÑA: la descripción sigue en lectura (no se ha abierto el editor)", await saveDesc(d).count(), 0);
  L.check("PESTAÑA: y con el foco en ella", await read.evaluate((el) => el === document.activeElement));
  L.assertNoErrors("PESTAÑA", [s]);
  await U.closeDialog(s.page);
  await s.ctx.close();
}

// --- (Ronda 68) Conflicto al cambiar de tipo con la descripción a medio escribir: lo escrito no se pierde ----------------
if (only.includes("conflicto")) {
  L.scenario("conflicto: otra persona cambia el título mientras se escribe la descripción y se cambia de tipo");
  const [id] = await L.seedTasks(COL.backlog, ["Conflicto de tipo"]);
  const a = await L.session();
  await a.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
  const b = await L.session({ email: L.USER2 });
  // La primera persona, sin canal en vivo: no ve el cambio de la segunda y su cambio de tipo choca con él.
  await a.page.route(/\/api\/projects\/[^/]+\/events/, (r) => r.abort());
  await L.reload(a.page);
  await U.openTask(a.page, "Conflicto de tipo");
  const da = U.dialog(a.page);
  await openDesc(da);
  await editor(da).click();
  await a.page.keyboard.type("Texto sin guardar de A");
  // La segunda persona cambia el título.
  await U.openTask(b.page, "Conflicto de tipo");
  const db = U.dialog(b.page);
  // El título del detalle es un área de texto (un botón solo con menciones o en una ventana estrecha).
  await db.locator("textarea[aria-label='Título']").first().click();
  await b.page.keyboard.press("Control+a");
  await b.page.keyboard.type("Conflicto de tipo (cambiado por B)");
  await b.page.keyboard.press("Enter");
  await L.eqEventually("CONFLICTO: la segunda persona guarda su título", async () => (await row(id)).title, "Conflicto de tipo (cambiado por B)");
  // La primera cambia de tipo: «Respuesta» pone su prefijo en el título que ella ve (el viejo) → conflicto.
  await da.getByRole("radio", { name: "Respuesta" }).click();
  await L.checkEventually("CONFLICTO: se avisa del conflicto", async () => (await toastWith(a.page, "ha cambiado el texto de esta tarea").count()) > 0, { timeout: 10000 });
  await L.eqEventually("CONFLICTO: el detalle recarga el título de la otra persona", () => titleOf(a.page), "Conflicto de tipo (cambiado por B)");
  await frames(a.page);
  L.eq("CONFLICTO: la descripción sigue abierta en edición", await saveDesc(da).count(), 1);
  L.eq("CONFLICTO: con lo escrito (no se ha recargado el editor)", (await editor(da).innerText()).trim(), "Texto sin guardar de A");
  L.eq("CONFLICTO: el tipo vuelve al de antes", await checkedKind(da), "Funcionalidad");
  await saveDesc(da).click();
  await L.eqEventually("CONFLICTO: al guardarla, se guarda lo escrito (sin pisar el título de la otra persona)", async () => { const r = await row(id); return [r.title, r.description, r.kindId]; }, ["Conflicto de tipo (cambiado por B)", "Texto sin guardar de A", "kind_funcionalidad"]);

  // Y si además la otra persona cambió la descripción: lo escrito sigue ahí y se avisa junto a los botones.
  L.scenario("conflicto: otra persona cambia título y descripción");
  await openDesc(da);
  await editor(da).click();
  await a.page.keyboard.press("Control+End");
  await a.page.keyboard.type(" y más");
  await L.q(`UPDATE "Task" SET title='Conflicto de tipo (otra vez B)', description='Descripción de B', "contentUpdatedAt"=NOW(), "updatedAt"=NOW() WHERE id=$1`, [id]);
  await da.getByRole("radio", { name: "Respuesta" }).click();
  await L.eqEventually("CONFLICTO 2: el detalle recarga el título de la otra persona", () => titleOf(a.page), "Conflicto de tipo (otra vez B)", { timeout: 10000 });
  await L.checkEventually("CONFLICTO 2: aviso de que la descripción guardada ha cambiado", async () => (await da.locator("[data-desc-remote]").count()) === 1);
  L.eq("CONFLICTO 2: lo escrito sigue en el editor", (await editor(da).innerText()).trim(), "Texto sin guardar de A y más");
  // Guardar ahora choca con la descripción de la otra persona: se avisa y se puede copiar lo escrito (no se pisa la suya).
  await saveDesc(da).click();
  await L.eqEventually("CONFLICTO 2: al guardar choca y no pisa la descripción de la otra persona", async () => [(await row(id)).description, await saveDesc(da).count()], ["Descripción de B", 0], { timeout: 10000 });
  // El aviso más reciente lleva «Copiar tu texto» con lo escrito (el del primer conflicto copiaba el título). La
  // descripción de B se cambió por SQL sin cambiar quién la tocó por última vez, así que este aviso dice «Has cambiado…».
  const copy = toastWith(a.page, /[Hh]as? cambiado el texto de esta tarea/).getByRole("button", { name: "Copiar tu texto" });
  await L.waitFor(async () => (await copy.count()) > 0, { timeout: 10000 });
  await copy.last().click();
  await L.eqEventually("CONFLICTO 2: «Copiar tu texto» copia lo escrito", () => a.page.evaluate(() => navigator.clipboard.readText()), "Texto sin guardar de A y más");
  L.assertNoErrors("CONFLICTO", [b]);
  await a.ctx.close();
  await b.ctx.close();
}

// --- (Ronda 68) El aviso del cambio de tipo dice lo que de verdad ha cambiado, y su «Deshacer» nombra bien la tarea ------
if (only.includes("aviso")) {
  L.scenario("aviso: plantilla de la descripción aplicada, quitada o nada");
  const [id] = await L.seedTasks(COL.backlog, ["Varias dos"]);
  const s = await L.session();
  await U.openTask(s.page, "Varias dos");
  const d = U.dialog(s.page);
  const kindTo = async (name, kindId) => {
    await d.getByRole("radio", { name }).click();
    await L.eqEventually(`AVISO: tipo «${name}» guardado`, async () => (await row(id)).kindId, kindId, { timeout: 10000 });
  };
  // Vacía, a un tipo con plantilla: aplicada.
  await kindTo("Respuesta", "kind_respuesta");
  await L.checkEventually("AVISO: a «Respuesta», «plantilla de la descripción aplicada»", async () => (await toastWith(s.page, "Tipo cambiado: plantilla de la descripción aplicada").count()) === 1);
  // «Deshacer» del aviso: nombra la tarea sin el prefijo que puso el tipo («Respuesta Varias dos»).
  await toastWith(s.page, "Tipo cambiado: plantilla de la descripción aplicada").getByRole("button", { name: "Deshacer", exact: true }).click();
  await L.checkEventually("AVISO: «Deshecho el cambio de tipo de «Varias dos»» (sin el prefijo del tipo)", async () => (await toastWith(s.page, "Deshecho el cambio de tipo de «Varias dos»").count()) === 1);
  await L.eqEventually("AVISO: deshecho (tipo, título y descripción de antes)", () => row(id), { title: "Varias dos", description: "", kindId: "kind_funcionalidad" });
  // Otra vez a «Respuesta» y de ahí a «Corrección» (sin plantilla): quitada, no «aplicada».
  await kindTo("Respuesta", "kind_respuesta");
  await kindTo("Corrección", "kind_correccion");
  await L.checkEventually("AVISO: de «Respuesta» a «Corrección» con la plantilla sin tocar, «plantilla de la descripción quitada»", async () => (await toastWith(s.page, "Tipo cambiado: plantilla de la descripción quitada").count()) === 1);
  L.eq("AVISO: la descripción vuelve a estar vacía y el título sin prefijo", await row(id), { title: "Varias dos", description: "", kindId: "kind_correccion" });
  // Descripción escrita por la persona (sin la plantilla) en «Respuesta» → «Corrección»: no cambia nada más que el tipo.
  await L.q(`UPDATE "Task" SET "kindId"='kind_respuesta', description='Lo escribí yo.', "contentUpdatedAt"=NOW(), "updatedAt"=NOW() WHERE id=$1`, [id]);
  await U.closeDialog(s.page);
  await L.reload(s.page);
  await U.openTask(s.page, "Varias dos");
  await L.eqEventually("AVISO: abierta en «Respuesta» con lo escrito", () => checkedKind(d), "Respuesta");
  const toastsBefore = await toastWith(s.page, "Tipo cambiado").count();
  await kindTo("Corrección", "kind_correccion");
  await d.locator("[data-save-status]").filter({ hasText: "Guardado" }).waitFor({ timeout: 10000 });
  await frames(s.page);
  L.eq("AVISO: con la descripción escrita por la persona, ningún «Tipo cambiado…»", (await toastWith(s.page, "Tipo cambiado").count()) - toastsBefore, 0);
  L.eq("AVISO: la descripción escrita se queda tal cual", (await row(id)).description, "Lo escribí yo.");
  L.assertNoErrors("AVISO", [s]);
  await U.closeDialog(s.page);
  await s.ctx.close();
}

// --- (Ronda 68) Pegar o soltar una imagen con la descripción en edición: adjunto e imagen en el texto ------------------
if (only.includes("imagen")) {
  L.scenario("imagen: pegar y soltar una imagen en la descripción en edición (editor con barra)");
  const [id] = await L.seedTasks(COL.backlog, ["Imagen en la descripción"]);
  const s = await L.session();
  await U.openTask(s.page, "Imagen en la descripción");
  const d = U.dialog(s.page);
  await openDesc(d);
  await editor(d).click();
  await s.page.keyboard.type("Antes después");
  // El cursor tras «Antes »: ahí va la imagen.
  await s.page.keyboard.press("Home");
  for (let i = 0; i < "Antes ".length; i++) await s.page.keyboard.press("ArrowRight");
  await pasteImage(s.page, "captura.png");
  await L.eqEventually("IMAGEN: se sube como adjunto de la tarea", async () => (await attachments(id)).length, 1, { timeout: 15000 });
  const [first] = await attachments(id);
  await L.eqEventually("IMAGEN: y se inserta en el editor", () => d.locator(`[contenteditable=true] img[src="/api/attachments/${first.id}"]`).count(), 1);
  await L.eqEventually("IMAGEN: sale también en «Capturas y adjuntos»", () => d.locator(`img[src="/api/attachments/${first.id}?thumb=1"]`).count(), 1);
  await saveDesc(d).click();
  await L.eqEventually("IMAGEN: guardada donde estaba el cursor", async () => (await row(id)).description, `Antes ![${first.name}](/api/attachments/${first.id})después`);
  L.eq("IMAGEN: la descripción guardada la muestra", await d.getByRole("group", { name: "Descripción" }).locator(`img[src^="/api/attachments/${first.id}"]`).count(), 1);
  // Soltar un fichero de imagen sobre el editor abierto: adjunto e imagen en el texto; el aviso «Suelta para adjuntar» se va.
  await openDesc(d);
  await editor(d).click();
  await dropImage(s.page, "[role=dialog] [contenteditable=true]", "soltada.png");
  await L.eqEventually("IMAGEN: soltada, un adjunto más", async () => (await attachments(id)).length, 2, { timeout: 15000 });
  const second = (await attachments(id))[1];
  await L.eqEventually("IMAGEN: soltada, también en el editor", () => d.locator(`[contenteditable=true] img[src="/api/attachments/${second.id}"]`).count(), 1);
  L.eq("IMAGEN: sin el aviso de soltar a la vista", await s.page.getByText(/^Suelta para (adjuntar|insertar en la descripción)$/).count(), 0);
  await saveDesc(d).click();
  await L.eqEventually("IMAGEN: guardada con las dos", async () => { const t = (await row(id)).description; return [t.includes(`(/api/attachments/${first.id})`), t.includes(`![${second.name}](/api/attachments/${second.id})`)]; }, [true, true]);
  // Fuera del editor: solo se adjunta (como siempre).
  await s.page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  const saved = (await row(id)).description;
  await pasteImage(s.page, "fuera.png");
  await L.eqEventually("IMAGEN: fuera del editor, se adjunta", async () => (await attachments(id)).length, 3, { timeout: 15000 });
  L.eq("IMAGEN: … y la descripción no cambia", (await row(id)).description, saved);
  L.eq("IMAGEN: … ni se abre el editor", await saveDesc(d).count(), 0);
  // (Ronda 68, revisión) «Guardar descripción» justo después de pegar: espera a la subida y guarda la imagen en el texto
  // (antes se guardaba sin ella y la imagen solo quedaba como adjunto).
  await openDesc(d);
  await editor(d).click();
  await s.page.keyboard.press("Control+End");
  await pasteImage(s.page, "deprisa.png");
  await saveDesc(d).click();
  await L.eqEventually("IMAGEN: guardar mientras sube, un adjunto más", async () => (await attachments(id)).length, 4, { timeout: 15000 });
  const quick = (await attachments(id))[3];
  await L.eqEventually("IMAGEN: guardar mientras sube espera y la guarda en el texto", async () => (await row(id)).description.includes(`(/api/attachments/${quick.id})`), true, { timeout: 15000 });
  await L.eqEventually("IMAGEN: … y el editor se cierra al guardarla", () => saveDesc(d).count(), 0);
  L.assertNoErrors("IMAGEN", [s]);
  await U.closeDialog(s.page);
  await s.ctx.close();

  L.scenario("imagen: pegar una imagen en la descripción en Markdown");
  await L.q(`UPDATE "User" SET "editorMode"='MARKDOWN' WHERE email=$1`, [L.ADMIN]);
  const [mid] = await L.seedTasks(COL.backlog, ["Imagen en Markdown"]);
  const m = await L.session();
  await U.openTask(m.page, "Imagen en Markdown");
  const dm = U.dialog(m.page);
  await openDesc(dm);
  const area = dm.getByPlaceholder("Markdown · @persona · @docs / @sheets / @slides");
  await area.fill("Uno dos");
  await area.evaluate((el) => {
    el.focus();
    el.setSelectionRange(3, 3);
  });
  await pasteImage(m.page, "captura.png");
  await L.eqEventually("MARKDOWN: se sube como adjunto", async () => (await attachments(mid)).length, 1, { timeout: 15000 });
  const [att] = await attachments(mid);
  const md = `Uno ![${att.name}](/api/attachments/${att.id}) dos`;
  await L.eqEventually("MARKDOWN: y se inserta en el cursor", () => area.inputValue(), md);
  await saveDesc(dm).click();
  await L.eqEventually("MARKDOWN: guardada", async () => (await row(mid)).description, md);
  L.assertNoErrors("MARKDOWN", [m]);
  await U.closeDialog(m.page);
  await m.ctx.close();
  await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG'`);
}

// --- (Ronda 68) El botón del pie dice «Deshacer todo» si cabe --------------------------------------------------------
if (only.includes("pie")) {
  L.scenario("pie: «Deshacer todo» en una ventana ancha");
  await L.seedTasks(COL.backlog, ["Pie del detalle"]);
  const s = await L.session();
  for (const width of [1500, U.WIDE.width]) {
    await s.page.setViewportSize({ width, height: 900 });
    await U.openTask(s.page, "Pie del detalle");
    const foot = await U.dialog(s.page).locator("[data-discard-all]").evaluateAll((els) => {
      const b = els.find((el) => el.offsetParent);
      const row = b?.parentElement;
      const btns = [...(row?.children ?? [])].filter((el) => el.offsetParent);
      return {
        text: b?.innerText.trim(),
        label: b?.getAttribute("aria-label"),
        fits: !!b && b.scrollWidth <= b.clientWidth + 0.5,
        rows: new Set(btns.map((el) => Math.round(el.getBoundingClientRect().top))).size,
      };
    });
    L.eq(`PIE ${width} px: dice «Deshacer todo», cabe y va en una fila`, foot, { text: "Deshacer todo", label: "Deshacer todo", fits: true, rows: 1 });
    await U.closeDialog(s.page);
  }
  L.assertNoErrors("PIE", [s]);
  await s.ctx.close();
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
