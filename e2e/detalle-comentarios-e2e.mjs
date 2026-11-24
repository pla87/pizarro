// Caza de bugs 48c: comentarios de tres personas a la vez en el detalle abierto (todos se ven, en orden y sin «Ver
// anteriores»), editar el propio comentario en el móvil (mención nueva, en vivo, historial, deshacer; un admin no edita
// los ajenos), el editor de la descripción con red lenta (no se pierden las primeras teclas), dos pestañas de la misma
// persona que guardan la descripción (la segunda, que la escribía a la vez, recibe el aviso y no pisa la primera) y una
// release cuyo texto se generó antes de que otra persona renombrara una tarea. Misma base y servidor que tablero-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node detalle-comentarios-e2e.mjs
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const only = (process.env.PART || "comments,edit,desc,tabs,rel").split(",");

const THIRD = "bh48c@example.com";
await L.prepareUsers();
if (!(await L.q(`SELECT 1 FROM "User" WHERE email=$1`, [THIRD])).length) {
  const [a] = await L.q(`SELECT * FROM "User" WHERE email=$1`, [L.ADMIN]);
  const cols = Object.keys(a).filter((c) => !["id", "email", "name"].includes(c));
  await L.q(`INSERT INTO "User" (id,email,name,${cols.map((c) => `"${c}"`).join(",")}) VALUES ('bh48c_user',$1,'Comentarista Bh48c',${cols.map((_, i) => `$${i + 2}`).join(",")})`, [THIRD, ...cols.map((c) => a[c])]);
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") SELECT id,'bh48c_user' FROM "Project" ON CONFLICT DO NOTHING`);
}
await L.cleanBoard();
await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG'`);

// --- Tres personas comentan a la vez la misma tarea, en varias rondas ------------------------------------------------
if (only.includes("comments")) {
  L.scenario("comments: tres personas comentan a la vez");
  const [taskId] = await L.seedTasks(L.COL.backlog, ["Comentarios a la vez"]);
  const people = [];
  for (const email of [L.ADMIN, L.USER2, THIRD]) {
    const s = await L.session({ email });
    await U.openTask(s.page, "Comentarios a la vez");
    people.push({ email, ...s, box: U.dialog(s.page).getByLabel("Nuevo comentario") });
  }
  const ROUNDS = 4;
  for (let round = 1; round <= ROUNDS; round++) {
    for (const [i, p] of people.entries()) await p.box.fill(`Ronda ${round} de ${i + 1}`);
    // Los tres pulsan «Comentar» a la vez.
    await Promise.all(people.map((p) => U.dialog(p.page).getByRole("button", { name: "Comentar", exact: true }).click()));
    await L.waitFor(async () => Number((await L.q(`SELECT count(*)::int n FROM "TaskComment" WHERE "taskId"=$1`, [taskId]))[0].n) === round * 3, { timeout: 15000 });
    const expected = (await L.q(`SELECT body FROM "TaskComment" WHERE "taskId"=$1 ORDER BY "createdAt", id`, [taskId])).map((r) => r.body);
    for (const [i, p] of people.entries()) {
      const shown = () => p.page.locator("[role=dialog] [data-comment-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-comment-id")));
      await L.waitFor(async () => (await shown()).length === expected.length, { timeout: 10000 });
      const ids = await shown();
      const bodies = await Promise.all(ids.map(async (id) => (await L.q(`SELECT body FROM "TaskComment" WHERE id=$1`, [id]))[0]?.body));
      L.eq(`COMMENTS: ronda ${round}, persona ${i + 1} ve los ${expected.length} comentarios en orden`, bodies, expected);
      L.eq(`COMMENTS: ronda ${round}, persona ${i + 1} sin «Ver anteriores»`, await U.dialog(p.page).getByRole("button", { name: /Ver anteriores/ }).count(), 0);
    }
  }
  L.assertNoErrors("COMMENTS", people);
  for (const p of people) await p.ctx.close();
}

// --- Editar el propio comentario en el móvil: botón con texto, mención nueva, en vivo, historial y deshacer -----------
if (only.includes("edit")) {
  L.scenario("edit: editar el propio comentario (móvil) con otra persona mirando");
  const [taskId] = await L.seedTasks(L.COL.backlog, ["Editar comentario r57"]);
  // Persona a la que se menciona (id sin «_»: el de una mención son letras y cifras, como los cuid).
  if (!(await L.q(`SELECT 1 FROM "User" WHERE id='r57mencion'`)).length) {
    const [a] = await L.q(`SELECT * FROM "User" WHERE email=$1`, [L.ADMIN]);
    const cols = Object.keys(a).filter((c) => !["id", "email", "name"].includes(c));
    await L.q(`INSERT INTO "User" (id,email,name,${cols.map((c) => `"${c}"`).join(",")}) VALUES ('r57mencion','r57mencion@example.com','Mencionada Rcincuenta',${cols.map((_, i) => `$${i + 1}`).join(",")})`, cols.map((c) => a[c]));
  }
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") SELECT id,'r57mencion' FROM "Project" ON CONFLICT DO NOTHING`);
  const mentions = async (userId) => Number((await L.q(`SELECT count(*)::int n FROM "Notification" WHERE "userId"=$1 AND type='MENTION'`, [userId]))[0].n);
  const body = async () => (await L.q(`SELECT body FROM "TaskComment" WHERE "taskId"=$1`, [taskId]))[0]?.body;
  const m = await L.session({ email: L.USER2, viewport: { width: 390, height: 844 }, mobile: true });
  const a = await L.session({ email: L.ADMIN });
  await U.openTask(m.page, "Editar comentario r57");
  await U.openTask(a.page, "Editar comentario r57");
  await U.dialog(m.page).getByLabel("Nuevo comentario").fill("Primera versión");
  await U.dialog(m.page).getByRole("button", { name: "Comentar", exact: true }).tap();
  await L.eqEventually("EDIT: comentario guardado", body, "Primera versión");
  const mine = U.dialog(m.page).locator("[data-comment-id]").first();
  const pencil = mine.getByRole("button", { name: "Editar comentario" });
  await mine.scrollIntoViewIfNeeded();
  L.eq("EDIT: el botón dice «Editar» (no solo un lápiz) y se ve sin ratón", [(await pencil.innerText()).trim(), await pencil.evaluate((el) => getComputedStyle(el).opacity)], ["Editar", "1"]);
  const theirs = U.dialog(a.page).locator("[data-comment-id]").first();
  await L.waitFor(async () => (await theirs.count()) > 0, { timeout: 8000 });
  L.eq("EDIT: un admin no puede editar el comentario ajeno", await theirs.getByRole("button", { name: "Editar comentario" }).count(), 0);
  await pencil.tap();
  const edit = U.dialog(m.page).locator('textarea[aria-label="Editar comentario"]');
  await edit.waitFor();
  await edit.press("End");
  await m.page.keyboard.type(" para @Mencionada");
  await m.page.keyboard.press("Enter");
  await mine.getByRole("button", { name: "Guardar", exact: true }).tap();
  await L.eqEventually("EDIT: guarda la mención nueva", body, "Primera versión para @[Mencionada Rcincuenta](user:r57mencion)");
  await L.eqEventually("EDIT: la persona mencionada en la edición recibe un aviso", () => mentions("r57mencion"), 1);
  L.check("EDIT: «(editado)» con la fecha en el título", /^Editado el /.test((await mine.getByText("(editado)").getAttribute("title")) ?? ""));
  await L.eqEventually("EDIT: la otra persona ve la edición en vivo", async () => { const x = await theirs.innerText(); return x.includes("para @Mencionada Rcincuenta") && x.includes("(editado)"); }, true, { timeout: 8000 });
  // Segunda edición: quien ya estaba mencionado no recibe otro aviso.
  await mine.getByRole("button", { name: "Editar comentario" }).tap();
  await edit.waitFor();
  await edit.press("End");
  await m.page.keyboard.type(" de nuevo");
  await mine.getByRole("button", { name: "Guardar", exact: true }).tap();
  await L.eqEventually("EDIT: segunda edición guardada", body, "Primera versión para @[Mencionada Rcincuenta](user:r57mencion) de nuevo");
  await sleep(500);
  L.eq("EDIT: sin aviso repetido para quien ya estaba mencionado", await mentions("r57mencion"), 1);
  L.check("EDIT: queda en el historial de la tarea", /Editó un comentario/.test(await U.historyText(m.page)));
  await U.dialog(m.page).getByRole("button", { name: "Deshacer la última acción" }).first().tap();
  await L.eqEventually("EDIT: deshacer devuelve el texto anterior", body, "Primera versión para @[Mencionada Rcincuenta](user:r57mencion)");
  L.assertNoErrors("EDIT", [m, a]);
  await m.ctx.close();
  await a.ctx.close();
}

// --- Red lenta: el editor con barra aún no se ha descargado y ya se está escribiendo -------------------------------
if (only.includes("desc")) {
  L.scenario("desc: escribir la descripción antes de que llegue el editor");
  await L.seedTasks(L.COL.backlog, ["Red lenta vacía", "Red lenta con texto"]);
  await L.q(`UPDATE "Task" SET description='Texto previo.' WHERE title='Red lenta con texto'`);
  const s = await L.session();
  for (const [title, open, before] of [
    ["Red lenta vacía", "Añade una descripción…", ""],
    ["Red lenta con texto", "Editar", "Texto previo."],
  ]) {
    // Página nueva (sin el editor en memoria): el trozo del editor (ProseMirror) tarda 6 s; el resto, red lenta por CDP.
    const page = await s.ctx.newPage();
    await page.route(/\/_next\/static\/chunks\/.*\.js/, async (route) => {
      const res = await route.fetch().catch(() => null);
      if (!res) return route.abort().catch(() => {});
      const body = await res.text();
      if (body.includes("ProseMirror")) await sleep(6000);
      await route.fulfill({ response: res, body }).catch(() => {});
    });
    await page.goto(`${L.BASE}/p/${(await L.project()).id}`);
    await L.board(page);
    const cdp = await s.ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: 200 * 1024, uploadThroughput: 200 * 1024 });
    await U.openTask(page, title);
    const dlg = U.dialog(page);
    await dlg.getByRole("button", { name: open, exact: true }).waitFor({ timeout: 20000 });
    await dlg.getByRole("button", { name: open, exact: true }).click();
    // Se escribe nada más abrir, sin esperar a nada.
    let typed = before ? `${before} Hola equipo,` : "Hola equipo,";
    await page.keyboard.type(typed.slice(before.length), { delay: 60 });
    L.check(`DESC (${title}): mientras llega el editor hay un campo provisional`, (await page.locator("[data-provisional-editor]").count()) === 1);
    // Se sigue escribiendo, tecla a tecla, mientras el editor llega y ocupa su sitio (ninguna se pierde en el cambio).
    const more = " esto va con red lenta";
    for (let i = 0; (await page.locator("[data-provisional-editor]").count()) > 0 && i < 600; i++) {
      const ch = more[i % more.length];
      await page.keyboard.type(ch);
      typed += ch;
      await sleep(25);
    }
    for (const ch of typed.endsWith(" ") ? "y más" : " y más") {
      await page.keyboard.type(ch);
      typed += ch;
    }
    const editor = dlg.locator(".ProseMirror");
    await editor.waitFor({ timeout: 30000 });
    L.eq(`DESC (${title}): el campo provisional desaparece`, await page.locator("[data-provisional-editor]").count(), 0);
    const expected = typed.replace(/ +/g, " ").trim();
    L.eq(`DESC (${title}): el editor tiene todo lo tecleado, con el cursor al final`, (await editor.innerText()).replace(/\s+/g, " ").trim(), expected);
    await page.keyboard.press("Control+Enter");
    await L.eqEventually(`DESC (${title}): se guarda entero`, async () => (await L.dbTask(title)).description, expected, { timeout: 20000 });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.close();
  }
  L.assertNoErrors("DESC", [s]);
  await s.ctx.close();
}

// --- Dos pestañas de la misma persona guardan la descripción -------------------------------------------------------
if (only.includes("tabs")) {
  L.scenario("tabs: dos pestañas, la misma persona");
  await L.seedTasks(L.COL.backlog, ["Dos pestañas"]);
  await L.q(`UPDATE "Task" SET description='Inicial' WHERE title='Dos pestañas'`);
  await L.q(`UPDATE "User" SET "editorMode"='MARKDOWN' WHERE email=$1`, [L.ADMIN]);
  const s = await L.session();
  const a = s.page;
  const b = await s.ctx.newPage();
  await b.goto(`${L.BASE}/p/${(await L.project()).id}`);
  await L.board(b);
  for (const p of [a, b]) await U.openTask(p, "Dos pestañas");
  const box = (p) => U.dialog(p).getByPlaceholder("Markdown · @persona · @docs / @sheets / @slides");
  const type = async (p, text) => {
    await U.dialog(p).getByRole("button", { name: "Editar", exact: true }).click();
    await box(p).waitFor();
    await box(p).fill(text);
  };
  const edit = async (p, text) => {
    await type(p, text);
    await box(p).press("Control+Enter");
  };
  // La pestaña B empieza a escribir su descripción antes de que A guarde: es un conflicto de verdad (el mismo campo,
  // escrito sobre el texto anterior). Si B no la estuviera editando, vería la de A al momento y no habría conflicto.
  await type(b, "Desde B");
  // Una sola pestaña guarda varias veces seguidas (y el título): sin avisos de conflicto.
  await edit(a, "Desde A uno");
  await L.eqEventually("TABS: A guarda", async () => (await L.dbTask("Dos pestañas"))?.description, "Desde A uno");
  // Otra vez y enseguida el título, sin esperar a que termine el guardado anterior (con 400 ms de latencia los dos van a
  // la vez): no es un conflicto.
  const cdp = await s.ctx.newCDPSession(a);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: -1, uploadThroughput: -1 });
  await edit(a, "Desde A dos");
  const title = U.dialog(a).locator("textarea[aria-label='Título']").first();
  await title.fill("Dos pestañas (A)");
  await title.evaluate((el) => el.blur());
  await L.eqEventually("TABS: A vuelve a guardar la descripción y el título justo después", async () => (await L.q(`SELECT title, description FROM "Task" WHERE title LIKE 'Dos pestañas%'`))[0], { title: "Dos pestañas (A)", description: "Desde A dos" });
  L.eq("TABS: A no ha visto ningún aviso de conflicto", await a.getByText(/ha cambiado el texto|Has cambiado el texto/).count(), 0);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  // La pestaña B (abierta antes, con su descripción a medio escribir) la guarda: no pisa la de A y avisa.
  await box(b).press("Control+Enter");
  await b.getByText(/Has cambiado el texto de esta tarea en otra pestaña u otro dispositivo/).first().waitFor({ timeout: 10000 }).catch(() => {});
  L.check("TABS: B recibe el aviso de la otra pestaña", (await b.getByText(/Has cambiado el texto de esta tarea en otra pestaña u otro dispositivo/).count()) > 0);
  L.eq("TABS: la descripción de A no se pierde", (await L.q(`SELECT description FROM "Task" WHERE title='Dos pestañas (A)'`))[0]?.description, "Desde A dos");
  await L.q(`UPDATE "User" SET "editorMode"='WYSIWYG' WHERE email=$1`, [L.ADMIN]);
  await s.ctx.close();
}

// --- Release generada antes de que otra persona renombre una de sus tareas -----------------------------------------
if (only.includes("rel")) {
  L.scenario("rel: título cambiado entre generar y desplegar");
  await L.q(`DELETE FROM "Release"`);
  const [alpha] = await L.seedTasks(L.COL.next, ["Rel Alpha", "Rel Beta"]);
  const s = await L.session({ viewport: U.WIDE });
  const p = s.page;
  for (const [how, open] of [["Generar release", () => p.getByRole("button", { name: "Generar release" }).click()], ["Release con selección", async () => {
    for (const t of ["Rel Alpha", "Rel Beta"]) await L.cardLoc(p, t).locator("[aria-label='Seleccionar']").click();
    await p.getByRole("button", { name: "Release con selección" }).click();
  }]]) {
    await L.reload(p);
    await open();
    const dlg = U.dialog(p);
    await dlg.getByText("Paso 1 de 2").waitFor();
    await dlg.getByRole("button", { name: /Generar con 2 tarea/ }).click();
    await dlg.getByText("Paso 2 de 2").waitFor();
    // Otra persona renombra «Rel Alpha» mientras se revisa el texto.
    await L.q(`UPDATE "Task" SET title='Rel Alpha renombrada', "updatedAt"=NOW() WHERE id=$1`, [alpha]);
    await dlg.getByRole("button", { name: "Marcar como desplegado" }).click();
    await p.locator("[role=dialog]").last().getByRole("button", { name: "Marcar como desplegado" }).click();
    await p.getByText(/Una de las tareas ha cambiado de título mientras tanto: vuelve a generar la release/).first().waitFor({ timeout: 10000 }).catch(() => {});
    L.check(`REL (${how}): aviso de volver a generar`, (await p.getByText(/ha cambiado de título mientras tanto/).count()) > 0);
    L.eq(`REL (${how}): no se registra la release`, (await L.q(`SELECT count(*)::int n FROM "Release"`))[0].n, 0);
    await p.keyboard.press("Escape");
    await sleep(300);
    await p.locator("[role=dialog]").last().getByRole("button", { name: /Descartar|Deshacer todo|Continuar|Cerrar/ }).first().click({ timeout: 2000 }).catch(() => {});
    await L.q(`UPDATE "Task" SET title='Rel Alpha', "updatedAt"=NOW() WHERE id=$1`, [alpha]);
  }
  // Generada de nuevo con los títulos de ahora, sí se despliega.
  await L.reload(p);
  await p.getByRole("button", { name: "Generar release" }).click();
  const dlg = U.dialog(p);
  await dlg.getByRole("button", { name: /Generar con 2 tarea/ }).click();
  await dlg.getByText("Paso 2 de 2").waitFor();
  await dlg.getByRole("button", { name: "Marcar como desplegado" }).click();
  await p.locator("[role=dialog]").last().getByRole("button", { name: "Marcar como desplegado" }).click();
  await L.eqEventually("REL: generada de nuevo, se despliega", async () => (await L.q(`SELECT count(*)::int n FROM "Release"`))[0].n, 1, { timeout: 15000 });
  await s.ctx.close();
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
