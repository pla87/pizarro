// Caza de bugs 48a: cabecera del tablero que nunca se sale de la pantalla (nombres largos, varios anchos), Alt+Mayús+N
// con un diálogo abierto, Alt+N pulsado antes de hidratar, «Quién está trabajando» al abrir el tablero o una tarea,
// contador del título en caracteres visibles, tope 99+ del aviso móvil, ayuda de atajos completa y borrar un proyecto
// cuyo nombre lleva espacios dobles o duros. Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh48a-e2e.mjs
import os from "node:os";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "hdr,keys,early,pres,title,badge,help,del").split(",");

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
    for (const width of [1920, 1500, 1280, 1100, 1024, 820, 390]) {
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
        return { bad, truncated: text ? text.scrollWidth > text.clientWidth + 1 : false, title: text?.closest("button")?.getAttribute("title") ?? "" };
      });
      const label = `${name === LONG ? "nombre largo" : "nombre corto"} a ${width} px`;
      L.eq(`HDR: ${label}, ningún botón fuera de la pantalla`, r.bad, []);
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
  await sleep(800);
  L.eq("KEYS: abre un segundo diálogo", await page.locator("[role=dialog]").count(), 2);
  const second = page.locator("[role=dialog]").nth(1);
  L.check("KEYS: el segundo es «Crear varias tareas»", (await second.innerText().catch(() => "")).includes("Crear varias tareas"));
  const [a, b] = await page.locator("[role=dialog]").evaluateAll((els) => els.map((e) => (e.querySelector("[class*=rounded]") ?? e).getBoundingClientRect().left));
  L.check("KEYS: «Varias tareas» queda a la derecha de la tarea", b > a, `${a} / ${b}`);
  // Otra vez: ya hay dos, no se abre un tercero.
  await page.keyboard.press("Alt+Shift+N");
  await sleep(500);
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
    await route.continue();
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

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
