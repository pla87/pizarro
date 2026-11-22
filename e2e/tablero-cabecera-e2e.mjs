// Caza de bugs 48a: cabecera del tablero que nunca se sale de la pantalla (nombres largos, varios anchos), Alt+Mayús+N
// con un diálogo abierto, Alt+N pulsado antes de hidratar, «Quién está trabajando» al abrir el tablero o una tarea,
// contador del título en caracteres visibles, tope 99+ del aviso móvil, ayuda de atajos completa y borrar un proyecto
// cuyo nombre lleva espacios dobles o duros. Ronda 57: en escritorio la cabecera ya no lleva selector de proyecto (está en
// la barra lateral; en el móvil sigue el de la barra superior) ni «Informe PDF», y los botones de solo icono van juntos
// (4 px entre ellos, cada uno con su zona de toque); «Nueva tarea» preselecciona el último tipo usado. Ronda 60 («tipos»):
// con un proyecto creado desde la plantilla «Casa y familia» (se abre su tablero, no los ajustes), el «+» de una columna
// abre «Nueva tarea» con la plantilla del tipo marcado ya puesta; cambiar de tipo sustituye lo que puso el anterior sin
// acumular y conserva lo editado; en el detalle, cambiar de tipo cambia el prefijo del título y el formulario sin
// rellenar; el editor de plantillas muestra los tipos generales en positivo. Misma base y servidor que tablero-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node tablero-cabecera-e2e.mjs   # PART=hdr,keys,early,pres,title,badge,help,del,kind,tipos
import os from "node:os";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "hdr,keys,early,pres,title,badge,help,del,kind,tipos").split(",");

await L.q(`DELETE FROM "Project" WHERE id='bh48a_proj'`); // de una pasada anterior interrumpida
await L.prepareUsers();
await L.cleanBoard();
const p = await L.project();
const originalName = p.name;
const [admin] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);

// --- Cabecera: nada se sale de la pantalla y el nombre truncado lleva el nombre completo en el tooltip ---------------
if (only.includes("hdr")) {
  L.scenario("hdr: cabecera con nombres corto y largo");
  await L.seedTasks(L.COL.backlog, ["Cabecera 1"]);
  const LONG = 'Rediseño «Web» 👨‍👩‍👧 "Q3" مشروع التطبيق الجديد 2026 final';
  for (const name of ["Pizarro", LONG]) {
    await L.q(`UPDATE "Project" SET name=$1 WHERE id=$2`, [name, p.id]);
    for (const width of [1920, 1500, 1440, 1280, 1100, 1024, 820, 390]) {
      const s = await L.session({ viewport: { width, height: 900 }, mobile: width < 500 });
      await s.page.goto(`${L.BASE}/p/${p.id}`);
      await L.board(s.page);
      await sleep(300);
      const r = await s.page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const shown = (el) => el.getClientRects().length > 0;
        const bad = [];
        for (const row of [document.querySelector("h1")?.parentElement, document.querySelector("header")].filter((x) => x && shown(x))) {
          for (const el of row.querySelectorAll("button, a, input")) {
            if (!shown(el)) continue;
            const b = el.getBoundingClientRect();
            if (b.right > vw + 0.5 || b.left < -0.5) bad.push(el.getAttribute("aria-label") || el.textContent.trim());
          }
          if (row.scrollWidth > row.clientWidth + 1) bad.push("fila con scroll");
        }
        const text = [...document.querySelectorAll("[data-project-name]")].find(shown);
        // Botones agrupados de la cabecera de escritorio: huecos entre ellos y tamaño de cada uno.
        const tools = document.querySelector("[data-header-tools]");
        const boxes = tools && shown(tools) ? [...tools.querySelectorAll("button")].filter(shown).map((b) => b.getBoundingClientRect()) : [];
        const gaps = boxes.slice(1).map((b, i) => Math.round(b.left - boxes[i].right));
        const labels = document.querySelector("[data-labels]")?.getAttribute("data-labels") ?? null;
        const h1 = document.querySelector("main h1");
        return {
          bad, truncated: text ? text.scrollWidth > text.clientWidth + 1 : false, title: text?.closest("[title]")?.getAttribute("title") ?? "",
          gaps, labels, minSize: boxes.length ? Math.min(...boxes.map((b) => Math.min(b.width, b.height))) : null,
          headerSelector: h1 && shown(h1) ? h1.querySelectorAll("[aria-haspopup]").length : null,
          sidebarSelector: [...document.querySelectorAll("aside button[aria-haspopup=menu]")].filter(shown).length,
          topSelector: [...document.querySelectorAll("header [data-project-name]")].filter((el) => shown(el) && el.closest("button[aria-haspopup=menu]")).length,
          headerReport: [...document.querySelectorAll("main button")].filter((b) => shown(b) && (b.getAttribute("aria-label") === "Informe PDF" || b.textContent.trim() === "Informe PDF")).length,
        };
      });
      const label = `${name === LONG ? "nombre largo" : "nombre corto"} a ${width} px`;
      L.eq(`HDR: ${label}, ningún botón fuera de la pantalla`, r.bad, []);
      L.eq(`HDR: ${label}, sin «Informe PDF» en el tablero`, r.headerReport, 0);
      if (width >= 1024) {
        L.eq(`HDR: ${label}, un solo selector de proyecto (barra lateral; el título no despliega nada)`, [r.sidebarSelector, r.headerSelector], [1, 0]);
        L.check(`HDR: ${label}, botones agrupados: 4 px con solo iconos, 8 px con texto (${r.labels})`, r.gaps.length === 2 && r.gaps.every((g) => g === (r.labels === "full" ? 8 : 4)), JSON.stringify(r.gaps));
        L.check(`HDR: ${label}, cada botón agrupado conserva su tamaño (42 × 34 px)`, r.minSize >= 32, String(r.minSize));
      } else if (width < 500) {
        L.eq(`HDR: ${label}, el selector de proyecto sigue en la barra superior del móvil`, r.topSelector, 1);
      }
      if (r.truncated) L.check(`HDR: ${label}, el nombre truncado lleva el nombre completo en el tooltip`, r.title.startsWith(name), r.title);
      if (name === LONG && width === 1500) {
        await s.page.screenshot({ path: `${SHOTS}/bh48a-cabecera-1500.png` });
        L.check("HDR: a 1500 px con nombre largo se ve el texto «Nueva tarea»", await s.page.getByRole("button", { name: "Nueva tarea", exact: true }).first().isVisible());
      }
      await s.ctx.close();
    }
  }
  await L.q(`UPDATE "Project" SET name=$1 WHERE id=$2`, [originalName, p.id]);
}

// --- Alt+Mayús+N con un diálogo abierto: «Varias tareas» en el hueco de la derecha -----------------------------------
if (only.includes("keys")) {
  L.scenario("keys: Alt+Mayús+N con un diálogo abierto");
  const s = await L.session();
  const { page } = s;
  await page.keyboard.press("Alt+N");
  await U.dialog(page).waitFor();
  // Con el foco en el título de la tarea nueva (escribiendo), como Alt+N.
  await page.keyboard.press("Alt+Shift+N");
  await L.eqEventually("KEYS: abre un segundo diálogo", () => page.locator("[role=dialog]").count(), 2);
  const second = page.locator("[role=dialog]").nth(1);
  await L.eqEventually("KEYS: el segundo es «Crear varias tareas»", async () => (await second.innerText().catch(() => "")).includes("Crear varias tareas"), true);
  // Los dos paneles (data-testid="modal-panel" en Modal.tsx), no un hijo cualquiera con esquinas redondeadas.
  const [a, b] = await page.locator("[data-testid=modal-panel]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
  L.check("KEYS: «Varias tareas» queda a la derecha de la tarea", b > a, `${a} / ${b}`);
  // Otra vez: ya hay dos, no se abre un tercero. El atajo se atiende al pulsarlo y React pinta en el fotograma siguiente:
  // tras dos fotogramas un tercer diálogo ya estaría (el código del de «Varias tareas» ya está cargado).
  await page.keyboard.press("Alt+Shift+N");
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))));
  L.eq("KEYS: con los dos huecos ocupados no se abre otro", await page.locator("[role=dialog]").count(), 2);
  L.assertNoErrors("KEYS", [s]);
  await s.ctx.close();
}

// --- Alt+N pulsado antes de que la página hidrate ------------------------------------------------------------------
if (only.includes("early")) {
  L.scenario("early: Alt+N recién cargado el tablero");
  const s = await L.session();
  const { page } = s;
  // Se retrasa el JavaScript de la página: el HTML ya está a la vista y los atajos de React aún no existen.
  await page.route(/\/_next\/static\/chunks\/.*\.js/, async (route) => {
    await sleep(2500);
    await route.continue().catch(() => {}); // ya atendida si se quitó el retraso entretanto
  });
  await page.goto(`${L.BASE}/p/${p.id}`, { waitUntil: "commit" });
  await page.locator('button[aria-label="Nueva tarea"]').first().waitFor({ state: "attached", timeout: 20000 });
  const hydrated = await page.evaluate(() => !!document.querySelector("[data-labels]"));
  L.check("EARLY: la pulsación llega antes de hidratar", !hydrated);
  await page.keyboard.press("Alt+N");
  await page.unroute(/\/_next\/static\/chunks\/.*\.js/);
  const opened = await U.dialog(page).waitFor({ timeout: 20000 }).then(() => true, () => false);
  L.check("EARLY: al hidratar se abre «Nueva tarea»", opened);
  L.eq("EARLY: un solo diálogo", await page.locator("[role=dialog]").count(), 1);
  await s.ctx.close();
}

// --- «Quién está trabajando»: abrir el tablero ya cuenta ------------------------------------------------------------
if (only.includes("pres")) {
  L.scenario("pres: presencia al abrir el tablero");
  const email = "bh48a@example.com";
  if (!(await L.q(`SELECT 1 FROM "User" WHERE email=$1`, [email])).length) {
    const [a] = await L.q(`SELECT * FROM "User" WHERE email=$1`, [L.ADMIN]);
    const cols = Object.keys(a).filter((c) => !["id", "email", "name"].includes(c));
    await L.q(`INSERT INTO "User" (id,email,name,${cols.map((c) => `"${c}"`).join(",")}) VALUES ('bh48a_user',$1,'Persona Mirona',${cols.map((_, i) => `$${i + 2}`).join(",")})`, [email, ...cols.map((c) => a[c])]);
    await L.q(`INSERT INTO "ProjectMember"("projectId","userId") SELECT id,'bh48a_user' FROM "Project" ON CONFLICT DO NOTHING`);
  }
  const watcher = await L.session({ email });
  await sleep(500);
  const s = await L.session();
  const users = await s.page.evaluate(async (id) => (await (await fetch(`/api/projects/${id}/presence`)).json()).users.map((u) => u.name), p.id);
  L.check("PRES: quien solo ha abierto el tablero aparece entre los activos", users.includes("Persona Mirona"), users.join(", "));
  await watcher.ctx.close();
  await s.ctx.close();
}

// --- Contador del título: caracteres visibles (grafemas) -----------------------------------------------------------
if (only.includes("title")) {
  L.scenario("title: contador en caracteres visibles");
  const s = await L.session();
  const { page } = s;
  await page.keyboard.press("Alt+N");
  const title = U.dialog(page).locator("input[required]").first();
  await title.waitFor();
  const family = "👨‍👩‍👧‍👦";
  await title.fill(`Familia ${family.repeat(50)}`);
  await sleep(200);
  L.eq("TITLE: 58 caracteres con 50 emojis de familia: sin aviso de máximo", await title.getAttribute("aria-invalid"), null);
  await title.fill("😀".repeat(211));
  await sleep(200);
  L.eq("TITLE: 211 emojis cuentan 211/210", await U.dialog(page).getByText(/^\d+\/210$/).first().innerText().catch(() => null), "211/210");
  await page.keyboard.press("Escape");
  await s.ctx.close();
}

// --- Aviso de la barra móvil con el tope 99+ ------------------------------------------------------------------------
if (only.includes("badge")) {
  L.scenario("badge: más de 99 avisos en móvil");
  const [task] = await L.seedTasks(L.COL.backlog, ["Con muchos avisos"]);
  await L.q(`INSERT INTO "Notification"(id,"userId","taskId",excerpt) SELECT 'bh48a_n'||g,$1,$2,'x' FROM generate_series(1,120) g ON CONFLICT DO NOTHING`, [admin.id, task]);
  const s = await L.session({ viewport: { width: 390, height: 800 }, mobile: true });
  const badge = s.page.locator('header a[href="/notifications"]');
  L.eq("BADGE: la barra móvil muestra 99+", (await badge.innerText()).trim(), "99+");
  await s.ctx.close();
  await L.q(`DELETE FROM "Notification" WHERE id LIKE 'bh48a_n%'`);
}

// --- Ayuda de atajos («?») con lo que lista el manual ---------------------------------------------------------------
if (only.includes("help")) {
  L.scenario("help: atajos del manual en la ayuda");
  const s = await L.session();
  await s.page.keyboard.press("?");
  const help = U.dialog(s.page);
  await help.waitFor();
  const text = await help.innerText();
  for (const label of ["Abrir la tarjeta", "Negrita (editor con barra)", "Elegir persona o comando en la lista de «@»", "Guardar el comentario que editas", "Cancelar la edición del comentario", "Imagen anterior o siguiente", "Editar la subtarea con el foco", "Adjuntar la imagen o los archivos del portapapeles"]) {
    L.check(`HELP: «${label}»`, text.includes(label));
  }
  await s.ctx.close();
}

// --- Borrar un proyecto cuyo nombre tiene dos espacios o un espacio duro --------------------------------------------
if (only.includes("del")) {
  L.scenario("del: borrar proyecto escribiendo el nombre que se ve");
  const id = "bh48a_proj";
  // Primero la sesión (al entrar se abre el primer proyecto: no debe ser este, que no tiene columnas).
  const s = await L.session();
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [id]);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId","updatedAt") VALUES ($1,$2,true,$3,NOW())`, [id, "Borrar  doble espacio", admin.id]);
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [id, admin.id]);
  await s.page.goto(`${L.BASE}/p/${id}/settings`);
  const input = s.page.getByPlaceholder("Nombre del proyecto");
  await input.waitFor({ timeout: 20000 });
  await input.fill("Borrar doble espacio");
  const btn = s.page.getByRole("button", { name: "Borrar proyecto" });
  L.check("DEL: con el nombre tal como se ve, el botón se activa", await btn.isEnabled());
  await btn.click();
  await s.page.waitForURL((u) => !u.pathname.includes(id), { timeout: 15000 }).catch(() => {});
  L.eq("DEL: el proyecto se borra", (await L.q(`SELECT count(*)::int n FROM "Project" WHERE id=$1`, [id]))[0].n, 0);
  await s.ctx.close();
}

// --- «Nueva tarea» recuerda el último tipo usado en el proyecto (ronda 57) ------------------------------------------
if (only.includes("kind")) {
  L.scenario("kind: el último tipo usado se preselecciona");
  await L.cleanBoard();
  const s = await L.session();
  const { page } = s;
  const checkedKind = () => U.dialog(page).getByRole("radiogroup", { name: "Tipo" }).locator("[role=radio][aria-checked=true]").innerText().then((x) => x.trim());
  await page.keyboard.press("Alt+N");
  await U.dialog(page).waitFor();
  const radios = U.dialog(page).getByRole("radiogroup", { name: "Tipo" }).locator("[role=radio]");
  const [first, second] = [(await radios.nth(0).innerText()).trim(), (await radios.nth(1).innerText()).trim()];
  L.eq("KIND: sin historial, el primer tipo", await checkedKind(), first);
  await radios.nth(1).click();
  await U.dialog(page).locator("input[required]").first().fill("Con el segundo tipo");
  await U.dialog(page).getByRole("button", { name: "Crear tarea" }).click();
  await U.dialog(page).waitFor({ state: "detached" });
  await page.keyboard.press("Alt+N");
  await U.dialog(page).waitFor();
  await L.eqEventually("KIND: la siguiente «Nueva tarea» abre con el tipo usado", checkedKind, second);
  await page.keyboard.press("Escape");
  await U.dialog(page).waitFor({ state: "detached" });
  // Tras recargar también (localStorage); otra persona u otro navegador empiezan por el primero.
  await page.reload();
  await L.board(page);
  await page.keyboard.press("Alt+N");
  await U.dialog(page).waitFor();
  L.eq("KIND: tras recargar, sigue el último tipo", await checkedKind(), second);
  await page.keyboard.press("Escape");
  await U.dialog(page).waitFor({ state: "detached" });
  // Ronda 57: el tipo preseleccionado trae su automatización (título, descripción y subtareas de plantilla), como al
  // elegirlo en el selector; y lo que pone la plantilla no cuenta como escrito (Escape cierra sin preguntar).
  const [kindRow] = await L.q(`SELECT id, "titleTemplate" tt, "descriptionTemplate" dt, "subtaskTemplate" st FROM "TaskKind" WHERE name=$1 AND ("projectId" IS NULL OR "projectId"=$2) ORDER BY "projectId" NULLS LAST LIMIT 1`, [second, p.id]);
  await L.q(`UPDATE "TaskKind" SET "titleTemplate"='Plantilla del tipo', "descriptionTemplate"='Pasos para reproducir:', "subtaskTemplate"=ARRAY['Revisar','Probar'] WHERE id=$1`, [kindRow.id]);
  try {
    await page.reload();
    await L.board(page);
    await page.keyboard.press("Alt+N");
    await U.dialog(page).waitFor();
    // Con un espacio detrás, para seguir escribiendo (se quita al guardar).
    L.eq("KIND: el tipo preseleccionado aplica su título de plantilla", await U.dialog(page).locator("input[required]").first().inputValue(), "Plantilla del tipo ");
    // La descripción puede ser un textarea o el editor con formato (según el perfil): se lee lo que haya en el diálogo.
    const dialogText = () => U.dialog(page).evaluate((el) => [...el.querySelectorAll("textarea")].map((x) => x.value).join("\n") + "\n" + el.innerText);
    L.check("KIND: y su descripción de plantilla", (await dialogText()).includes("Pasos para reproducir:"));
    const items = (await U.dialog(page).locator("ul li").allInnerTexts()).map((x) => x.trim());
    L.check("KIND: y sus subtareas", items.some((x) => x.includes("Revisar")) && items.some((x) => x.includes("Probar")), items.join(" | "));
    await page.keyboard.press("Escape");
    L.check("KIND: lo que puso la plantilla no pide confirmar al cerrar", await U.dialog(page).waitFor({ state: "detached", timeout: 3000 }).then(() => true, () => false));
  } finally {
    await L.q(`UPDATE "TaskKind" SET "titleTemplate"=$2, "descriptionTemplate"=$3, "subtaskTemplate"=$4 WHERE id=$1`, [kindRow.id, kindRow.tt, kindRow.dt, kindRow.st]);
  }
  L.assertNoErrors("KIND", [s]);
  await s.ctx.close();
  const other = await L.session();
  await other.page.keyboard.press("Alt+N");
  await U.dialog(other.page).waitFor();
  L.eq("KIND: en un navegador nuevo, el primer tipo", (await U.dialog(other.page).getByRole("radiogroup", { name: "Tipo" }).locator("[role=radio][aria-checked=true]").innerText()).trim(), first);
  await other.ctx.close();
}

// --- Plantillas de los tipos en «Nueva tarea» y en el detalle (ronda 60) -------------------------------------------
if (only.includes("tipos")) {
  L.scenario("tipos: proyecto de «Casa y familia», tipo marcado con su plantilla y cambios de tipo sin acumular");
  const NAME = "Casa R60";
  await L.q(`DELETE FROM "Project" WHERE name=$1`, [NAME]);
  // La sesión se abre como miembro (sin el segundo paso de acceso de los administradores) y pasa a admin: crea un
  // proyecto de equipo y abre el editor de plantillas.
  const s = await L.session();
  const { page } = s;
  try {
    await L.q(`UPDATE "User" SET role='ADMIN' WHERE email=$1`, [L.ADMIN]);
    await L.reload(page);
    await L.board(page);
    await page.locator("aside").first().locator("button[aria-haspopup]").first().click();
    await page.getByRole("menuitem", { name: "Nuevo proyecto" }).click();
    const nd = page.locator("[role=dialog]").filter({ has: page.locator("#project-name") });
    await nd.waitFor();
    await L.waitFor(async () => (await nd.locator("#project-start optgroup[label='Plantillas de serie'] option", { hasText: "Casa y familia" }).count()) === 1, { timeout: 8000 });
    await nd.locator("#project-start").selectOption({ label: "Casa y familia" });
    await nd.locator("#project-name").fill(NAME);
    const from = new URL(page.url()).pathname;
    await nd.getByRole("button", { name: "Crear", exact: true }).click();
    // Ya se estaba en un tablero: se espera a otro (el del proyecto nuevo) o a sus ajustes.
    await page.waitForURL((u) => u.pathname !== from && /^\/p\/[^/]+/.test(u.pathname), { timeout: 15000 });
    L.check("TIPOS: con una plantilla, al crear el proyecto se abre su tablero (no los ajustes)", !page.url().includes("/settings"), page.url());
    const [proj] = await L.q(`SELECT id, description FROM "Project" WHERE name=$1`, [NAME]);
    L.check("TIPOS: el proyecto toma la descripción de la plantilla", /^Compras, tareas de casa/.test(proj?.description ?? ""), proj?.description);
    L.eq("TIPOS: sin la casilla, sin tarjetas de ejemplo", Number((await L.q(`SELECT count(*) n FROM "Task" WHERE "projectId"=$1`, [proj.id]))[0].n), 0);
    const col = L.colLoc(page, "Por hacer");
    await col.waitFor({ timeout: 15000 });
    await sleep(500);

    const dlg = U.dialog(page);
    const titleBox = () => dlg.locator('input[id$="-title"]');
    const checked = () => dlg.getByRole("radiogroup", { name: "Tipo" }).locator("[role=radio][aria-checked=true]").innerText().then((x) => x.trim());
    // La descripción puede ser un textarea o el editor con formato (según el perfil).
    const descText = () => dlg.evaluate((el) => [...el.querySelectorAll("textarea")].map((x) => x.value).join("\n") + "\n" + (el.querySelector("[contenteditable=true]")?.textContent ?? ""));
    const subtasks = async () => (await dlg.locator("ul li").allInnerTexts()).map((x) => x.trim());
    const state = async () => ({ kind: await checked(), title: await titleBox().inputValue(), desc: await descText(), subtasks: await subtasks() });
    const PAPELEO_SUBS = ["Reunir documentos", "Pedir cita o hacerlo online", "Archivar el justificante"];
    const CITA_SUBS = ["Pedir la cita", "Preparar documentación", "Apuntar indicaciones"];
    const openPlus = async () => {
      await col.getByRole("button", { name: "Añadir tarea en Por hacer" }).click();
      await dlg.waitFor();
      await titleBox().waitFor();
      await sleep(300);
    };
    const closesWithoutAsking = async () => {
      await page.keyboard.press("Escape");
      return dlg.waitFor({ state: "detached", timeout: 3000 }).then(() => true, () => false);
    };

    // 1. El «+» de una columna: el tipo marcado (el primero, «Compras») trae su plantilla sin pulsarlo.
    await openPlus();
    const first = await state();
    // El prefijo va con un espacio detrás para escribir a continuación (se quita al guardar).
    L.eq("TIPOS: «+» abre con «Compras» marcado, su título de plantilla y sin subtareas", [first.kind, first.title, first.subtasks], ["Compras", "Comprar ", []]);
    L.check("TIPOS: y su descripción de plantilla", first.desc.includes("Para cuándo"), first.desc);
    L.check("TIPOS: lo que puso la plantilla no pide confirmar al cerrar", await closesWithoutAsking());

    // 2. Cambiar de tipo sin tocar nada: se sustituye, no se acumula.
    await openPlus();
    await dlg.getByRole("radio", { name: "Papeleo", exact: true }).click();
    await sleep(200);
    const papeleo = await state();
    L.eq("TIPOS: a «Papeleo»: su título y sus tres subtareas", [papeleo.title, papeleo.subtasks], ["Gestionar ", PAPELEO_SUBS]);
    L.check("TIPOS: y su descripción, sin la de «Compras»", papeleo.desc.includes("Trámite") && !papeleo.desc.includes("Para cuándo"), papeleo.desc);
    await dlg.getByRole("radio", { name: "Cita", exact: true }).click();
    await sleep(200);
    const cita = await state();
    L.eq("TIPOS: a «Cita»: su título y sus tres subtareas, sin las de «Papeleo»", [cita.title, cita.subtasks], ["Cita: ", CITA_SUBS]);
    L.check("TIPOS: y su descripción, sin la de «Papeleo»", cita.desc.includes("Quién") && !cita.desc.includes("Trámite"), cita.desc);
    await dlg.getByRole("radio", { name: "Papeleo", exact: true }).click();
    await sleep(200);
    const back = await state();
    L.eq("TIPOS: y otra vez a «Papeleo»: lo suyo, sin acumular", [back.title, back.subtasks], ["Gestionar ", PAPELEO_SUBS]);
    L.check("TIPOS: la descripción solo lleva la de «Papeleo»", back.desc.includes("Trámite") && !back.desc.includes("Quién"), back.desc);
    L.check("TIPOS: cambiar de tipo sin escribir nada tampoco pide confirmar al cerrar", await closesWithoutAsking());

    // 3. Con algo editado: el prefijo del título se cambia y lo escrito se conserva; la subtarea propia también.
    await openPlus();
    await dlg.getByRole("radio", { name: "Papeleo", exact: true }).click();
    await sleep(200);
    await titleBox().fill("Gestionar padrón R60");
    await dlg.getByPlaceholder("Añadir subtarea…").fill("Mía R60");
    await dlg.getByPlaceholder("Añadir subtarea…").press("Enter");
    await dlg.getByRole("radio", { name: "Cita", exact: true }).click();
    await sleep(200);
    const edited = await state();
    L.eq("TIPOS: con lo escrito, el prefijo pasa a «Cita:» y se conserva el resto", edited.title, "Cita: padrón R60");
    L.eq("TIPOS: la subtarea propia se queda y las del tipo se cambian", edited.subtasks, [...["Mía R60"], ...CITA_SUBS]);
    await dlg.getByRole("button", { name: "Crear tarea" }).click();
    await dlg.waitFor({ state: "detached", timeout: 10000 });
    const TITLE = "Cita: padrón R60";
    const row = async () => (await L.q(`SELECT t.id, t.title, t.description, k.name kind, (SELECT count(*)::int FROM "Subtask" s WHERE s."taskId"=t.id) subs FROM "Task" t JOIN "TaskKind" k ON k.id=t."kindId" WHERE t."projectId"=$1 ORDER BY t."createdAt" DESC LIMIT 1`, [proj.id]))[0];
    const created = await row();
    L.eq("TIPOS: la tarea se crea con el tipo, el título y las cuatro subtareas", [created?.kind, created?.title, created?.subs], ["Cita", TITLE, 4]);
    L.check("TIPOS: y con la descripción de «Cita» sola", /^\*\*Quién:\*\*/.test(created?.description ?? "") && !created.description.includes("Trámite"), created?.description);

    // 4. En el detalle: cambiar de tipo cambia el prefijo del título y el formulario sin rellenar del anterior.
    await L.cardLoc(page, TITLE).click();
    await dlg.waitFor();
    // Hasta que llega la descripción (el cambio de tipo la necesita para cambiar la plantilla).
    await L.waitFor(async () => (await dlg.innerText()).includes("Quién"), { timeout: 10000 });
    await sleep(300);
    await dlg.getByRole("radiogroup", { name: "Tipo" }).getByRole("radio", { name: "Papeleo", exact: true }).click();
    await L.eqEventually("TIPOS: detalle: el título pasa a «Gestionar padrón R60»", async () => (await row())?.title, "Gestionar padrón R60");
    const after = await row();
    L.check("TIPOS: detalle: la descripción pasa a la de «Papeleo», sin la de «Cita»", /^\*\*Trámite:\*\*/.test(after?.description ?? "") && !after.description.includes("Quién"), after?.description);
    // 4b. Con la descripción abierta y sin guardar: cambiar de tipo parte de lo escrito y no lo pierde (antes el editor se
    // volvía a montar con lo guardado). El editor sigue abierto y la descripción no se guarda hasta pulsar Guardar.
    await dlg.getByRole("button", { name: "Editar", exact: true }).first().click();
    await sleep(400);
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Nota R60 sin guardar");
    await sleep(400);
    await dlg.getByRole("radiogroup", { name: "Tipo" }).getByRole("radio", { name: "Cita", exact: true }).click();
    await L.eqEventually("TIPOS: detalle con la descripción abierta: el título pasa a «Cita: padrón R60»", async () => (await row())?.title, "Cita: padrón R60");
    const typedDesc = await descText();
    L.check("TIPOS: detalle: lo escrito sin guardar sigue en el editor, con el formulario de «Cita»", typedDesc.includes("Nota R60 sin guardar") && typedDesc.includes("Quién"), typedDesc);
    L.check("TIPOS: detalle: la descripción sin guardar no se guarda sola", /^\*\*Trámite:\*\*/.test((await row())?.description ?? ""), (await row())?.description);
    await dlg.getByRole("button", { name: "Cancelar", exact: true }).first().click();
    await sleep(300);
    await page.keyboard.press("Escape");
    await dlg.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

    // 5. Editor de plantillas: tipos generales en positivo; con «ocultar todos», ninguno marcado.
    await page.goto(`${L.BASE}/admin/templates`);
    await page.getByRole("button", { name: "Editar Casa y familia" }).click();
    const ed = page.getByRole("dialog").filter({ hasText: "Editar plantilla" });
    await ed.waitFor();
    const generals = ed.locator("section").filter({ has: page.getByRole("heading", { name: "Tipos generales que se usan" }) });
    L.check("TIPOS: el editor dice «Tipos generales que se usan»", (await generals.count()) === 1);
    const boxes = await generals.locator("label").evaluateAll((ls) => ls.map((l) => [l.textContent.trim(), l.querySelector("input").checked]));
    L.check("TIPOS: «Ninguno» marcado y ningún tipo general marcado (sin contradicción)", boxes.length > 1 && boxes.every(([name, on]) => (name.startsWith("Ninguno") ? on : !on)), JSON.stringify(boxes));
    await ed.getByRole("button", { name: "Cancelar" }).click();
    L.assertNoErrors("TIPOS", [s]);
  } finally {
    await s.ctx.close();
    await L.q(`DELETE FROM "Project" WHERE name=$1`, [NAME]);
    await L.q(`UPDATE "User" SET role='MEMBER' WHERE email=$1`, [L.ADMIN]);
  }
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
