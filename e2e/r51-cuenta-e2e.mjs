// Ronda 51 (lo que queda al borrar una cuenta): «Volver a entrar con Google» para borrar la cuenta pide a Google que
// vuelva a pedir la contraseña (prompt=login y max_age=0, con la hora de inicio en la cookie) y, si Google no la pidió,
// lo dice claro (la vuelta se simula con «?delete=google_stale»: la comprobación de auth_time del id_token la hace
// test:db con un id_token firmado); iniciar sesión con Google sigue igual. Al borrarse una cuenta, cada administrador
// activo recibe en la campana un aviso por cada proyecto privado que pasa a ser de equipo, en su idioma, con enlace al
// proyecto (los borrados con la casilla, ninguno). Y un administrador que abre un proyecto de equipo que no está en su
// lista (por el aviso, por un enlace o desde Proyectos existentes) ve el selector y la navegación de ese proyecto,
// marcado «No está en tus proyectos» con «Añadir a mis proyectos»; un miembro sin acceso no lo ve.
// Misma base y servidor que bh50b-e2e.mjs (Google con valores de prueba, sin email): GOOGLE_CLIENT_ID=r50 GOOGLE_CLIENT_SECRET=r50.
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r51-cuenta-e2e.mjs      # PART=google,notice,outside,member
import os from "node:os";
import * as L from "./qa/lib.mjs";
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "google,notice,outside,member").split(",");

// Restos de una pasada interrumpida.
const cleanup = async () => {
  await L.q(`DELETE FROM "Project" WHERE id LIKE 'r51c\\_%'`);
  await L.q(`DELETE FROM "User" WHERE id LIKE 'r51c\\_%'`);
};
await cleanup();
await L.prepareUsers();
const [base] = await L.q(`SELECT * FROM "User" WHERE email=$1`, [L.ADMIN]);

/** Persona nueva con la contraseña de las pruebas (copia la fila del admin), miembro de los proyectos de equipo con tablero. */
async function person(id, name, { locale = "ES", teams = true } = {}) {
  const email = `${id.replace(/_/g, "-")}@example.com`;
  const cols = Object.keys(base).filter((c) => !["id", "email", "name", "role", "locale", "googleSub", "twoFactorMethod", "totpSecretEnc", "totpLastStep"].includes(c));
  await L.q(
    `INSERT INTO "User" (id,email,name,role,locale,${cols.map((c) => `"${c}"`).join(",")}) VALUES ($1,$2,$3,'MEMBER',$4,${cols.map((_, i) => `$${i + 5}`).join(",")})`,
    [id, email, name, locale, ...cols.map((c) => base[c])],
  );
  if (teams) await L.q(`INSERT INTO "ProjectMember"("projectId","userId") SELECT id,$1 FROM "Project" p WHERE NOT "isPrivate" AND id NOT LIKE 'r51c\\_%' AND EXISTS (SELECT 1 FROM "Column" c WHERE c."projectId"=p.id) ON CONFLICT DO NOTHING`, [id]);
  return email;
}

/** Proyecto con tres columnas (privado de `owner` o, sin él, de equipo y sin miembros). */
async function project(id, name, owner = null) {
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId","updatedAt") VALUES ($1,$2,$3,$4,NOW())`, [id, name, !!owner, owner]);
  for (const [i, col] of ["Por hacer", "En curso", "Hecho"].entries()) {
    await L.q(`INSERT INTO "Column"(id,"projectId",name,position,"isDone") VALUES ($1,$2,$3,$4,$5)`, [`${id}_c${i}`, id, col, (i + 1) * 1000, i === 2]);
  }
  if (owner) await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [id, owner]);
}

/** Borra su cuenta desde Mi perfil → Cuenta con la contraseña; `alsoProjects`: marca «Borrar también…». */
async function deleteOwnAccount(page, { alsoProjects = false } = {}) {
  await page.goto(`${L.BASE}/settings?tab=cuenta`);
  const section = page.locator("#delete-account");
  await section.waitFor({ timeout: 20000 });
  await section.getByRole("button", { name: "Borrar mi cuenta" }).click();
  const dlg = page.getByRole("dialog", { name: "Borrar mi cuenta" });
  await dlg.waitFor();
  if (alsoProjects) await dlg.getByLabel(/Borrar también (este|estos) proyecto/).check();
  await page.fill("#da-pass", L.PASSWORD);
  await page.fill("#da-word", "borrar");
  await dlg.getByRole("button", { name: "Borrar mi cuenta" }).click();
  await page.waitForURL(/\/login\?info=account_deleted/, { timeout: 20000 });
}

/** Selector de proyecto de la barra lateral (escritorio): el primer botón con menú. */
const sidebarSwitcher = (page) => page.locator("aside").first().locator('button[aria-haspopup="menu"]').first();

// --- Volver a entrar con Google: Google tiene que pedir la contraseña ---------------------------------------------------
if (only.includes("google")) {
  for (const lang of ["es", "en"]) {
    const EN = lang === "en";
    const M = EN ? "GOOGLE-EN" : "GOOGLE-ES";
    L.scenario(`google: ${EN ? "inglés, 390 px" : "español"}`);
    const id = `r51c_goo_${lang}`;
    const email = await person(id, EN ? "R51 Google En" : "R51 Google Es", { locale: EN ? "EN" : "ES" });
    const s = await L.session({ email, ...(EN ? { viewport: { width: 390, height: 844 }, mobile: true } : {}) });
    const { page, ctx } = s;
    await L.q(`UPDATE "User" SET "googleSub"=$2, "passwordHash"='$2b$12$' || md5(random()::text) WHERE id=$1`, [id, `r51c-sub-${lang}`]);
    await page.goto(`${L.BASE}/settings?tab=cuenta`);
    const section = page.locator("#delete-account");
    await section.waitFor({ timeout: 20000 });
    await section.getByRole("button", { name: EN ? "Delete my account" : "Borrar mi cuenta" }).click();
    const dlg = page.getByRole("dialog", { name: EN ? "Delete my account" : "Borrar mi cuenta" });
    await dlg.waitFor();
    await dlg.getByText(EN ? "I sign in with Google and don't know my password" : "Entro con Google y no conozco mi contraseña").click();
    const link = dlg.getByRole("link", { name: EN ? "Sign in with Google again" : "Volver a entrar con Google" });
    L.check(`${M}: avisa de que Google pedirá la contraseña`, await dlg.getByText(EN ? "Google will ask for your Google account password even if you're already signed in." : "Google te pedirá la contraseña de tu cuenta de Google aunque ya tengas la sesión abierta.").isVisible());
    const start = await page.request.get(`${L.BASE}${await link.getAttribute("href")}`, { maxRedirects: 0 });
    const to = new URL(start.headers()["location"] ?? "http://x/");
    L.eq(`${M}: va a Google`, to.origin, "https://accounts.google.com");
    L.eq(`${M}: prompt=login (no basta con elegir la cuenta)`, to.searchParams.get("prompt"), "login");
    L.eq(`${M}: max_age=0`, to.searchParams.get("max_age"), "0");
    const parts = ((await ctx.cookies()).find((c) => c.name === "pz_glogin")?.value ?? "").split(".");
    L.check(`${M}: la cookie lleva la hora de inicio y la marca de la baja`, parts.length === 6 && parts[5] === "account-delete" && Math.abs(Number(parts[4]) - Date.now() / 1000) < 120, parts.length);
    // Vuelta de Google sin contraseña nueva (sin auth_time o vieja): mensaje claro y no queda confirmado.
    await page.goto(`${L.BASE}/settings?tab=cuenta&delete=google_stale#delete-account`);
    await dlg.waitFor({ timeout: 15000 });
    const stale = dlg.getByTestId("delete-account-google-stale");
    L.check(`${M}: «Google no te ha pedido la contraseña»`, await stale.waitFor({ timeout: 8000 }).then(() => true, () => false));
    L.check(`${M}: …en su idioma`, (await stale.innerText().catch(() => "")).startsWith(EN ? "Google didn't ask for your password." : "Google no te ha pedido la contraseña."));
    L.eq(`${M}: no queda confirmado`, await dlg.getByTestId("delete-account-google-ok").count(), 0);
    L.check(`${M}: puede volver a intentarlo`, await link.isVisible());
    if (EN) {
      const fit = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
      L.check(`${M}: cabe en 390 px`, fit.sw <= fit.vw, JSON.stringify(fit));
    }
    await page.screenshot({ path: `${SHOTS}/r51-baja-google-stale-${lang}.png` });
    L.eq(`${M}: la cuenta sigue`, (await L.q(`SELECT count(*)::int n FROM "User" WHERE id=$1`, [id]))[0].n, 1);
    L.assertNoErrors(M, [s]);
    await ctx.close();
  }
  // Iniciar sesión con Google no cambia: elegir la cuenta basta.
  L.scenario("google: iniciar sesión con Google, como siempre");
  const b = await L.getBrowser();
  const anon = await b.newContext();
  const res = await anon.request.get(`${L.BASE}/api/auth/google/start`, { maxRedirects: 0 });
  const to = new URL(res.headers()["location"] ?? "http://x/");
  L.eq("LOGIN: prompt=select_account", to.searchParams.get("prompt"), "select_account");
  L.eq("LOGIN: sin max_age", to.searchParams.get("max_age"), null);
  await anon.close();
}

// --- Aviso a los administradores --------------------------------------------------------------------------------------
if (only.includes("notice") || only.includes("outside")) {
  // Dos administradores (uno en inglés) que entran como miembros y pasan a administradores (sin la verificación en dos pasos).
  await person("r51c_adm_es", "R51 Admin Es");
  await person("r51c_adm_en", "R51 Admin En", { locale: "EN" });
}
const adminSession = async (id, opts = {}) => {
  await L.q(`UPDATE "User" SET role='MEMBER' WHERE id=$1`, [id]);
  const s = await L.session({ email: `${id.replace(/_/g, "-")}@example.com`, ...opts });
  await L.q(`UPDATE "User" SET role='ADMIN' WHERE id=$1`, [id]);
  return s;
};

if (only.includes("notice")) {
  L.scenario("notice: un proyecto privado pasa a ser de equipo al borrarse la cuenta");
  // Quien se va: un proyecto privado que pasa a ser de equipo. Otra persona borra el suyo con la casilla.
  // Con sesión antes de tener el privado (al entrar se abre un tablero de equipo).
  const gone = await L.session({ email: await person("r51c_baja", "R51 Baja") });
  const gone2 = await L.session({ email: await person("r51c_baja2", "R51 Baja Dos") });
  await project("r51c_priv", "R51 Huerto", "r51c_baja");
  await project("r51c_priv2", "R51 Borrado", "r51c_baja2");
  // Los dos administradores, ya con sesión (antes de las bajas: el aviso va a los activos).
  const es = await adminSession("r51c_adm_es");
  const en = await adminSession("r51c_adm_en", { viewport: { width: 390, height: 844 }, mobile: true });
  for (const [s, also] of [[gone, false], [gone2, true]]) {
    await deleteOwnAccount(s.page, { alsoProjects: also });
    L.assertNoErrors(`NOTICE: baja${also ? " (borrando su proyecto)" : ""}`, [s]);
    await s.ctx.close();
  }
  const rows = await L.q(`SELECT "userId","projectId","taskId",excerpt FROM "Notification" WHERE type='PROJECT_TO_TEAM' AND excerpt LIKE 'R51 Baja%' ORDER BY "userId"`);
  L.eq("NOTICE: uno por administrador activo y proyecto", rows.map((r) => `${r.userId}:${r.projectId}`), ["r51c_adm_en:r51c_priv", "r51c_adm_es:r51c_priv"]);
  L.check("NOTICE: de proyecto, con el nombre de la cuenta borrada", rows.every((r) => r.taskId === null && r.excerpt === "R51 Baja"));
  L.eq("NOTICE: el borrado con la casilla no avisa", (await L.q(`SELECT count(*)::int n FROM "Project" WHERE id='r51c_priv2'`))[0].n, 0);

  // En español: en la campana, con el contador, y al pulsarlo abre el proyecto con su selector y su navegación.
  const p = es.page;
  await p.goto(`${L.BASE}/notifications`);
  const headline = "El proyecto «R51 Huerto» de R51 Baja ha pasado a ser de equipo al borrarse su cuenta";
  const item = p.getByRole("button", { name: new RegExp(headline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
  L.check("NOTICE-ES: en la campana", await item.waitFor({ timeout: 15000 }).then(() => true, () => false));
  L.check("NOTICE-ES: con la explicación", await p.getByText("Ahora lo ven los administradores. Ábrelo para darle miembros, añadirlo a tus proyectos o borrarlo.").first().isVisible());
  L.check("NOTICE-ES: cuenta como sin leer", /\d/.test(await p.locator("aside").first().getByRole("link", { name: /Avisos/ }).innerText()));
  await p.screenshot({ path: `${SHOTS}/r51-aviso-equipo-es.png` });
  await item.click();
  await p.waitForURL(/\/p\/r51c_priv$/, { timeout: 15000 });
  await L.eqEventually("NOTICE-ES: el selector muestra el proyecto", async () => (await sidebarSwitcher(p).innerText()).trim(), "R51 Huerto");
  L.check("NOTICE-ES: …marcado «No está en tus proyectos»", await p.getByTestId("outside-list-notice").first().isVisible());
  for (const nav of ["Tablero", "Releases", "Documentación", "Ajustes del proyecto"]) {
    L.check(`NOTICE-ES: navegación «${nav}»`, await p.locator("aside").first().getByRole("link", { name: nav, exact: true }).isVisible());
  }
  L.eq("NOTICE-ES: el título del tablero es el proyecto (no «Pizarro»)", (await p.locator("main [data-project-name]").first().innerText().catch(() => "")).trim(), "R51 Huerto");
  L.eq("NOTICE-ES: leído", (await L.q(`SELECT ("readAt" IS NOT NULL) r FROM "Notification" WHERE "userId"='r51c_adm_es' AND type='PROJECT_TO_TEAM'`))[0]?.r, true);
  L.eq("NOTICE-ES: abrirlo no lo añade a su lista", (await L.q(`SELECT count(*)::int n FROM "AdminProjectPick" WHERE "userId"='r51c_adm_es'`))[0].n, 0);
  L.assertNoErrors("NOTICE-ES", [es]);

  // En inglés y en el móvil: el aviso en su idioma; el menú del título añade el proyecto a su lista.
  const q = en.page;
  await q.goto(`${L.BASE}/notifications`);
  const enItem = q.getByRole("button", { name: /R51 Baja's account was deleted: the project “R51 Huerto” is now a team project/ });
  L.check("NOTICE-EN: en su idioma", await enItem.waitFor({ timeout: 15000 }).then(() => true, () => false));
  await q.screenshot({ path: `${SHOTS}/r51-aviso-equipo-en.png` });
  await enItem.click();
  await q.waitForURL(/\/p\/r51c_priv$/, { timeout: 15000 });
  const title = q.locator("header [data-project-name]").first();
  await L.eqEventually("NOTICE-EN: cabecera con el proyecto", async () => (await title.innerText().catch(() => "")).trim(), "R51 Huerto");
  await title.click();
  const add = q.getByRole("menuitem", { name: "Add to my projects" });
  L.check("NOTICE-EN: el menú lo marca «Not in your projects»", await q.getByRole("menu").getByText("Not in your projects").isVisible().catch(() => false));
  L.check("NOTICE-EN: …y ofrece «Add to my projects»", await add.isVisible().catch(() => false));
  const fit = await q.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
  L.check("NOTICE-EN: cabe en 390 px", fit.sw <= fit.vw, JSON.stringify(fit));
  await q.screenshot({ path: `${SHOTS}/r51-fuera-de-lista-en.png` });
  await add.click();
  await L.eqEventually("NOTICE-EN: queda en su lista", async () => (await L.q(`SELECT count(*)::int n FROM "AdminProjectPick" WHERE "userId"='r51c_adm_en' AND "projectId"='r51c_priv'`))[0].n, 1, { timeout: 10000 });
  await title.click();
  await L.eqEventually("NOTICE-EN: y ya no sale marcado", async () => q.getByRole("menu").getByText("Not in your projects").count(), 0, { timeout: 10000 });
  await q.keyboard.press("Escape");
  L.assertNoErrors("NOTICE-EN", [en]);
  await es.ctx.close();
  await en.ctx.close();
}

// --- Proyecto de equipo fuera de la lista: por enlace (carga completa) y desde Proyectos existentes ---------------------
if (only.includes("outside")) {
  L.scenario("outside: un administrador abre un proyecto de equipo que no está en su lista");
  await project("r51c_team", "R51 Equipo");
  await project("r51c_team2", "R51 Equipo Dos");
  const s = await adminSession("r51c_adm_es");
  const { page } = s;
  // Por enlace: el HTML ya trae el selector y la navegación del proyecto (sin esperar a la hidratación).
  const html = await (await page.request.get(`${L.BASE}/p/r51c_team`)).text();
  L.check("OUTSIDE: en el HTML, el selector con el proyecto", html.includes("R51 Equipo") && html.includes("No está en tus proyectos"));
  L.check("OUTSIDE: …y la navegación del proyecto", html.includes('href="/p/r51c_team/docs"') && html.includes('href="/p/r51c_team/settings"'));
  await page.goto(`${L.BASE}/p/r51c_team`);
  await L.eqEventually("OUTSIDE: selector", async () => (await sidebarSwitcher(page).innerText()).trim(), "R51 Equipo");
  // Desde «Proyectos existentes» con la navegación de la app (sin recargar).
  await page.goto(`${L.BASE}/projects`);
  await page.getByRole("link", { name: "Abrir «R51 Equipo Dos»" }).click();
  await page.waitForURL(/\/p\/r51c_team2$/, { timeout: 15000 });
  await L.eqEventually("OUTSIDE-NAV: el selector cambia al proyecto abierto", async () => (await sidebarSwitcher(page).innerText()).trim(), "R51 Equipo Dos");
  L.check("OUTSIDE-NAV: marcado", await page.getByTestId("outside-list-notice").first().isVisible());
  L.check("OUTSIDE-NAV: con «Documentación»", await page.locator("aside").first().getByRole("link", { name: "Documentación", exact: true }).isVisible());
  // En el desplegable sale el abierto (marcado) y los de su lista; el otro de fuera, no.
  await sidebarSwitcher(page).click();
  const menu = page.getByRole("menu");
  L.check("OUTSIDE-NAV: el desplegable lo lista marcado", await menu.getByRole("menuitem", { name: /R51 Equipo Dos\s*No está en tus proyectos/ }).isVisible().catch(() => false));
  L.eq("OUTSIDE-NAV: …sin el otro proyecto de fuera", await menu.getByRole("menuitem", { name: /^R51 Equipo(?! Dos)/ }).count(), 0);
  await page.screenshot({ path: `${SHOTS}/r51-fuera-de-lista-es.png` });
  await page.keyboard.press("Escape");
  await page.getByTestId("outside-list-notice").first().getByRole("button", { name: "Añadir a mis proyectos" }).click();
  L.check("OUTSIDE-NAV: «Proyecto añadido a tus proyectos»", await page.getByText("Proyecto añadido a tus proyectos").first().waitFor({ timeout: 10000 }).then(() => true, () => false));
  await L.eqEventually("OUTSIDE-NAV: ya no sale marcado", async () => page.getByTestId("outside-list-notice").count(), 0, { timeout: 10000 });
  L.eq("OUTSIDE-NAV: solo ese en su lista", (await L.q(`SELECT array_agg("projectId" ORDER BY "projectId") ids FROM "AdminProjectPick" WHERE "userId"='r51c_adm_es'`))[0].ids, ["r51c_team2"]);
  // Fuera de un proyecto, uno que no está en su lista no se queda seleccionado; uno de su lista, sí.
  await page.goto(`${L.BASE}/p/r51c_team`);
  await L.eqEventually("OUTSIDE: vuelve a uno de fuera", async () => (await sidebarSwitcher(page).innerText()).trim(), "R51 Equipo");
  await page.locator("aside").first().getByRole("link", { name: "Calendario" }).click();
  await page.waitForURL(/\/calendar/);
  await L.eqEventually("OUTSIDE: en el calendario ya no se muestra", async () => page.getByTestId("outside-list-notice").count(), 0);
  L.check("OUTSIDE: …ni su navegación", (await page.locator("aside").first().getByRole("link", { name: "Documentación", exact: true }).count()) === 0 || (await sidebarSwitcher(page).innerText()).trim() !== "R51 Equipo");
  L.assertNoErrors("OUTSIDE", [s]);
  await s.ctx.close();
}

// --- Un miembro no ve proyectos sin acceso ------------------------------------------------------------------------------
if (only.includes("member")) {
  L.scenario("member: un proyecto de equipo sin acceso no existe para él");
  if (!(await L.q(`SELECT 1 FROM "Project" WHERE id='r51c_team'`)).length) await project("r51c_team", "R51 Equipo");
  const email = await person("r51c_member", "R51 Miembro");
  const s = await L.session({ email });
  await s.page.goto(`${L.BASE}/p/r51c_team`);
  // Con loading.tsx la respuesta ya ha empezado (200): lo que cuenta es la página.
  L.check("MEMBER: «No encontrado»", await s.page.getByText("La página no existe o no tienes acceso.").waitFor({ timeout: 15000 }).then(() => true, () => false));
  L.check("MEMBER: el selector no lo muestra", !(await sidebarSwitcher(s.page).innerText().catch(() => "")).includes("R51 Equipo"));
  L.eq("MEMBER: sin marca de «fuera de la lista»", await s.page.getByTestId("outside-list-notice").count(), 0);
  L.check("MEMBER: ni en el HTML", !(await (await s.page.request.get(`${L.BASE}/p/r51c_team`)).text()).includes("R51 Equipo"));
  s.errors.splice(0, s.errors.length, ...s.errors.filter((e) => !/404/.test(e)));
  L.assertNoErrors("MEMBER", [s]);
  await s.ctx.close();
}

await cleanup();
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
