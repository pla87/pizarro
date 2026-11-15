// Ronda 52 (interfaz): archivar y borrar desde el detalle de una tarea al instante (el diálogo se cierra y la tarjeta
// desaparece sin esperar al servidor; con fallo o sin red, vuelve y avisa; el deshacer sigue igual), cambiar la columna
// desde el detalle dos veces seguidas (turnos por tarjeta: la respuesta lenta del primero no la descoloca), flechas en los
// grupos de opciones («Icono de la app» y «Tema de color»: una sola parada de Tab, flechas, Inicio y Fin), iconos fijos de
// la raíz (/favicon.ico, /apple-touch-icon.png, /icon.png, /icon.svg) en el color de la instalación y nombre corto bajo el
// icono. Para lo optimista, las acciones del servidor tardan 3 s (red lenta) o se quita la red (setOffline).
// Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r52-ui-e2e.mjs      # PART=optimista,columna,flechas,iconos
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { COL, sleep } = L;
const only = (process.env.PART || "optimista,columna,flechas,iconos").split(",");

await L.prepareUsers();
const [me] = await L.q(`SELECT id, accent FROM "User" WHERE email=$1`, [L.ADMIN]);
const isArchived = async (title) => !!(await L.q(`SELECT 1 FROM "Task" WHERE title=$1 AND "archivedAt" IS NOT NULL`, [title])).length;
const exists = async (title) => !!(await L.q(`SELECT 1 FROM "Task" WHERE title=$1`, [title])).length;
const onBoard = (p, title) => L.cardLoc(p, title).count();

/** Las acciones del servidor tardan `ms` (0 = normal). */
async function slowActions(p, get) {
  await p.route("**/*", async (route) => {
    const ms = get();
    if (ms && route.request().method() === "POST" && route.request().headers()["next-action"]) await sleep(ms);
    await route.continue().catch(() => {});
  });
}

// --- Archivar y borrar al instante ------------------------------------------------------------------------------------
if (only.includes("optimista")) {
  L.scenario("optimista: archivar y borrar desde el detalle");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Archivable", "Borrable", "Sin red", "Falla"]);
  const s = await L.session({ viewport: U.WIDE });
  const p = s.page;
  let delay = 0;
  await slowActions(p, () => delay);
  await L.reload(p);

  // Archivar con red lenta: se cierra y desaparece antes de que responda el servidor.
  delay = 3000;
  await U.openTask(p, "Archivable");
  const t0 = Date.now();
  await U.dialog(p).getByRole("button", { name: "Archivar" }).first().click();
  await U.dialog(p).waitFor({ state: "detached", timeout: 1500 });
  await L.checkEventually("archivar (red lenta): la tarjeta desaparece al momento", async () => (await onBoard(p, "Archivable")) === 0, { timeout: 1500 });
  L.check("archivar (red lenta): sin esperar los 3 s del servidor", Date.now() - t0 < 2500, `${Date.now() - t0} ms`);
  L.check("archivar (red lenta): el servidor aún no había terminado", !(await isArchived("Archivable")) || Date.now() - t0 > 2500);
  await L.checkEventually("archivar (red lenta): al responder queda archivada en la BD", () => isArchived("Archivable"), { timeout: 10000 });
  await p.getByText("Tarea archivada").first().waitFor({ timeout: 8000 });
  L.eq("archivar: sigue fuera del tablero tras responder", await onBoard(p, "Archivable"), 0);
  // El deshacer sigue funcionando.
  delay = 0;
  await U.undoKey(p, "Control+z");
  await L.checkEventually("archivar: Deshacer la devuelve al tablero", async () => (await onBoard(p, "Archivable")) === 1);
  L.eq("archivar: … y desarchivada en la BD", await isArchived("Archivable"), false);

  // Borrar con red lenta.
  delay = 3000;
  await U.openTask(p, "Borrable");
  const t1 = Date.now();
  await U.dialog(p).getByRole("button", { name: "Borrar" }).first().click();
  await p.getByRole("button", { name: "Borrar", exact: true }).last().click(); // confirmación
  await U.dialog(p).waitFor({ state: "detached", timeout: 1500 });
  await L.checkEventually("borrar (red lenta): la tarjeta desaparece al momento", async () => (await onBoard(p, "Borrable")) === 0, { timeout: 1500 });
  L.check("borrar (red lenta): sin esperar al servidor", Date.now() - t1 < 2500, `${Date.now() - t1} ms`);
  await L.checkEventually("borrar (red lenta): al responder, borrada en la BD", async () => !(await exists("Borrable")), { timeout: 10000 });
  await p.getByText("Tarea borrada").first().waitFor({ timeout: 8000 });

  // Sin red: la tarjeta vuelve a su sitio y avisa; nada se guarda.
  delay = 0;
  await U.openTask(p, "Sin red");
  await s.ctx.setOffline(true);
  await U.dialog(p).getByRole("button", { name: "Archivar" }).first().click();
  await U.dialog(p).waitFor({ state: "detached", timeout: 1500 });
  await L.checkEventually("archivar sin red: la tarjeta vuelve al tablero", async () => (await onBoard(p, "Sin red")) === 1, { timeout: 8000 });
  L.check("archivar sin red: aviso «Sin conexión»", (await p.getByText(/Sin conexión/).count()) > 0);
  L.eq("archivar sin red: no se ha guardado", await isArchived("Sin red"), false);
  L.eq("archivar sin red: sigue en su columna", await L.dbOrder(COL.backlog).then((o) => o.includes("Sin red")), true);
  await s.ctx.setOffline(false);

  // Borrar sin red.
  await sleep(500);
  await U.openTask(p, "Falla");
  await s.ctx.setOffline(true);
  await U.dialog(p).getByRole("button", { name: "Borrar" }).first().click();
  await p.getByRole("button", { name: "Borrar", exact: true }).last().click();
  await U.dialog(p).waitFor({ state: "detached", timeout: 1500 });
  await L.checkEventually("borrar sin red: la tarjeta vuelve al tablero", async () => (await onBoard(p, "Falla")) === 1, { timeout: 8000 });
  L.eq("borrar sin red: sigue en la BD", await exists("Falla"), true);
  await s.ctx.setOffline(false);

  await p.unroute("**/*");
  s.errors = s.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e)); // los de las pruebas sin red
  L.assertNoErrors("optimista", [s]);
  await s.ctx.close();
  await L.cleanBoard();
}

// --- Cambiar la columna dos veces seguidas ---------------------------------------------------------------------------
if (only.includes("columna")) {
  L.scenario("columna: dos cambios seguidos desde el detalle");
  await L.cleanBoard();
  await L.seedTasks(COL.backlog, ["Viajera"]);
  await L.seedTasks(COL.doing, ["Otra 1", "Otra 2"]);
  const s = await L.session({ viewport: U.WIDE });
  const p = s.page;
  let delay = 0;
  await slowActions(p, () => delay);
  await L.reload(p);
  await U.openTask(p, "Viajera");
  const d = U.dialog(p);
  const select = d.locator("select", { has: p.locator("option", { hasText: COL.next }) }).first();
  const label = (name) => ({ label: name });
  delay = 1500;
  // Segundo cambio antes de que responda el primero (la respuesta del primero llegaría después de pintar el segundo).
  await select.selectOption(label(COL.doing));
  await select.selectOption(label(COL.next));
  L.eq("columna: el desplegable enseña la última columna elegida", await select.inputValue().then((v) => select.locator(`option[value="${v}"]`).innerText()), COL.next);
  await L.sleep(2500); // llegan las dos respuestas
  L.eq("columna: tras las dos respuestas, sigue en la última columna (tablero)", await U.uiOrder(p, COL.next), ["Viajera"]);
  L.eq("columna: … y no queda en la anterior", await U.uiOrder(p, COL.doing), ["Otra 1", "Otra 2"]);
  L.eq("columna: el desplegable sigue en la última", await select.locator("option:checked").innerText(), COL.next);
  await L.eqEventually("columna: la BD, también", () => L.dbOrder(COL.next), ["Viajera"], { timeout: 8000 });
  L.eq("columna: … y la anterior intacta (BD)", await L.dbOrder(COL.doing), ["Otra 1", "Otra 2"]);
  // Tras recargar, igual (la posición pintada coincide con la guardada).
  delay = 0;
  await U.closeDialog(p);
  await L.reload(p);
  L.eq("columna: tras recargar, igual", [await U.uiOrder(p, COL.next), await U.uiOrder(p, COL.doing)], [["Viajera"], ["Otra 1", "Otra 2"]]);
  await p.unroute("**/*");
  L.assertNoErrors("columna", [s]);
  await s.ctx.close();
  await L.cleanBoard();
}

// --- Flechas en los grupos de opciones --------------------------------------------------------------------------------
if (only.includes("flechas")) {
  L.scenario("flechas: «Icono de la app» y «Tema de color» como radiogroup");
  await L.q(`DELETE FROM "AppState" WHERE key='instance.appIcon'`);
  const s = await L.session();
  const p = s.page;
  await L.q(`UPDATE "User" SET role='ADMIN' WHERE id=$1`, [me.id]); // tras entrar: el administrador pide 2FA al iniciar sesión
  const checkedOf = (group) => group.locator("[role=radio][aria-checked=true]");
  /** Prueba un grupo: una sola parada de Tab, las cuatro flechas, el cruce de extremos, Inicio y Fin. `key` lee la opción elegida. */
  async function exercise(name, group, key, keys) {
    const radios = group.locator("[role=radio]");
    const n = await radios.count();
    L.check(`${name}: tiene varias opciones`, n >= 4, String(n));
    L.eq(`${name}: una sola parada de Tab`, await radios.evaluateAll((els) => els.filter((e) => e.tabIndex === 0).length), 1);
    const start = await key(checkedOf(group));
    L.eq(`${name}: la parada de Tab es la opción elegida`, await radios.evaluateAll((els) => els.findIndex((e) => e.tabIndex === 0)), keys.indexOf(start));
    await checkedOf(group).focus();
    await p.keyboard.press("ArrowRight");
    L.eq(`${name}: → elige la siguiente`, await key(checkedOf(group)), keys[(keys.indexOf(start) + 1) % n]);
    L.check(`${name}: … y el foco la acompaña`, await radios.nth((keys.indexOf(start) + 1) % n).evaluate((e) => e === document.activeElement));
    await p.keyboard.press("ArrowDown");
    L.eq(`${name}: ↓ elige la siguiente`, await key(checkedOf(group)), keys[(keys.indexOf(start) + 2) % n]);
    await p.keyboard.press("ArrowLeft");
    L.eq(`${name}: ← vuelve`, await key(checkedOf(group)), keys[(keys.indexOf(start) + 1) % n]);
    await p.keyboard.press("ArrowUp");
    L.eq(`${name}: ↑ vuelve`, await key(checkedOf(group)), start);
    await p.keyboard.press("End");
    L.eq(`${name}: Fin elige la última`, await key(checkedOf(group)), keys[n - 1]);
    await p.keyboard.press("ArrowRight");
    L.eq(`${name}: → desde la última da la vuelta a la primera`, await key(checkedOf(group)), keys[0]);
    await p.keyboard.press("ArrowLeft");
    L.eq(`${name}: ← desde la primera va a la última`, await key(checkedOf(group)), keys[n - 1]);
    await p.keyboard.press("Home");
    L.eq(`${name}: Inicio elige la primera`, await key(checkedOf(group)), keys[0]);
    L.eq(`${name}: sigue habiendo una sola parada de Tab (en la elegida)`, await radios.evaluateAll((els) => els.filter((e) => e.tabIndex === 0).length), 1);
    L.eq(`${name}: … y solo una opción marcada`, await group.locator("[role=radio][aria-checked=true]").count(), 1);
  }
  try {
    await p.goto(`${L.BASE}/admin/settings`);
    const section = p.locator("[data-app-icon-settings]");
    await section.waitFor({ timeout: 15000 });
    const icons = section.locator("[role=radiogroup]");
    const t0 = new Date();
    await exercise("icono de la app", icons, (loc) => loc.getAttribute("data-app-icon"), ["blue", "forest", "sienna", "mustard", "mono", "eva"]);
    // Con las flechas solo se guarda el color en el que se para (~300 ms sin cambios), no cada uno por el que se pasa. El
    // recorrido de arriba acaba en el azul, que es el que ya había: no queda nada que guardar.
    const savedIcon = async () => (await L.q(`SELECT value FROM "AppState" WHERE key='instance.appIcon'`))[0]?.value ?? null;
    // Cada guardado deja una línea en el registro (se escribe por tandas, unos segundos después): se comprueban todas al final.
    const iconSaves = async () => (await L.q(`SELECT message FROM "AppLog" WHERE action='settings.saveAppIcon' AND "createdAt" > $1 ORDER BY "createdAt"`, [t0])).map((r) => r.message.replace(/^.* de (\w+) a (\w+)$/, "$1>$2"));
    await sleep(1200);
    L.eq("icono de la app: el recorrido con flechas que vuelve al color guardado no guarda nada", await savedIcon(), null);
    // Tres flechas seguidas: la vista previa va con cada una y se guarda una sola vez, el último.
    await checkedOf(icons).focus();
    for (let i = 0; i < 3; i++) {
      await p.keyboard.press("ArrowRight");
      await sleep(60);
    }
    L.eq("icono de la app: la vista previa cambia al momento (mostaza marcada)", await checkedOf(icons).getAttribute("data-app-icon"), "mustard");
    L.eq("icono de la app: … y todavía no se ha guardado nada", await savedIcon(), null);
    await L.eqEventually("icono de la app: al parar se guarda el último (BD)", savedIcon, "mustard", { timeout: 10000 });
    await p.getByText("Color del icono guardado.").first().waitFor({ timeout: 8000 });
    // Tab justo después de una flecha: el foco sale del grupo y lo pendiente se guarda sin esperar.
    await checkedOf(icons).focus();
    await p.keyboard.press("ArrowRight");
    await p.keyboard.press("Tab");
    await L.eqEventually("icono de la app: al salir del grupo con un cambio pendiente se guarda", savedIcon, "mono", { timeout: 10000 });
    // Navegar a otra pantalla justo después de una flecha: también.
    await checkedOf(icons).focus();
    await p.keyboard.press("ArrowRight");
    await p.locator('a[href="/"], a[href^="/p/"]').first().evaluate((a) => a.click());
    await L.eqEventually("icono de la app: al navegar a otra pantalla con un cambio pendiente se guarda", savedIcon, "eva", { timeout: 10000 });
    await p.goto(`${L.BASE}/admin/settings`);
    await section.waitFor({ timeout: 15000 });
    L.eq("icono de la app: al volver sigue el último elegido", await checkedOf(icons).getAttribute("data-app-icon"), "eva");
    // Un clic guarda en el acto, y volver con las flechas al color guardado no guarda otra vez.
    await icons.locator("[data-app-icon=blue]").click();
    await L.eqEventually("icono de la app: un clic guarda en el acto", savedIcon, "blue", { timeout: 10000 });
    await p.keyboard.press("ArrowRight");
    await p.keyboard.press("ArrowLeft");
    await sleep(1200);
    L.eq("icono de la app: ida y vuelta con flechas al color guardado, sigue el azul", await savedIcon(), "blue");
    // En total, cuatro guardados: uno por cada parada (no uno por flecha, que habrían sido más de veinte).
    await L.eqEventually("icono de la app: un solo guardado por parada (registro)", iconSaves, ["blue>mustard", "mustard>mono", "mono>eva", "eva>blue"], { timeout: 12000 });
    // Tab: entra una sola vez al grupo y sale al siguiente control.
    await checkedOf(icons).focus();
    await p.keyboard.press("Tab");
    L.check("icono de la app: Tab sale del grupo (no recorre cada opción)", await icons.evaluate((g) => !g.contains(document.activeElement)));

    await p.goto(`${L.BASE}/settings?tab=preferencias`);
    const theme = p.getByRole("radiogroup", { name: "Tema de color" });
    await theme.waitFor({ timeout: 15000 });
    await exercise("tema de color", theme, async (loc) => (await loc.innerText()).trim(), ["Azul", "Verde bosque", "Siena", "Mostaza", "Blanco y negro", "Eva"].filter(Boolean));
    await L.eqEventually("tema de color: lo elegido con el teclado se guarda (BD)", async () => (await L.q(`SELECT accent FROM "User" WHERE id=$1`, [me.id]))[0]?.accent, "BLUE", { timeout: 10000 }).catch(() => {});
    const language = p.getByRole("radiogroup", { name: "Idioma · Language" });
    await checkedOf(language).focus();
    L.eq("idioma: una sola parada de Tab", await language.locator("[role=radio]").evaluateAll((els) => els.filter((e) => e.tabIndex === 0).length), 1);
    L.assertNoErrors("flechas", [s]);
  } finally {
    await L.q(`DELETE FROM "AppState" WHERE key='instance.appIcon'`);
    await L.q(`UPDATE "User" SET role='MEMBER', accent=$2 WHERE id=$1`, [me.id, me.accent]);
    await s.ctx.close();
  }
}

// --- Iconos de la raíz y nombre corto ---------------------------------------------------------------------------------
if (only.includes("iconos")) {
  L.scenario("iconos: /favicon.ico, /apple-touch-icon.png, /icon.png y nombre corto");
  const [orgBefore] = await L.q(`SELECT value FROM "AppState" WHERE key='instance.orgName'`);
  const s = await L.session();
  const p = s.page;
  const pixel = (url) => p.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(Math.round(c.width * 0.12), Math.round(c.height / 2), 1, 1).data;
    return { size: `${c.width}x${c.height}`, color: "#" + [...d].slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("") };
  }, url);
  const get = (path) => fetch(`${L.BASE}${path}`); // sin cookies, como el navegador al pedir el favicon
  const setIcon = (v) => v === null ? L.q(`DELETE FROM "AppState" WHERE key='instance.appIcon'`) : L.q(`INSERT INTO "AppState"(key,value,"updatedAt") VALUES ('instance.appIcon',$1,NOW()) ON CONFLICT (key) DO UPDATE SET value=$1`, [v]);
  const setOrg = (v) => L.q(`INSERT INTO "AppState"(key,value,"updatedAt") VALUES ('instance.orgName',$1,NOW()) ON CONFLICT (key) DO UPDATE SET value=$1`, [v]);
  try {
    await p.goto(`${L.BASE}/my-tasks`);
    await setIcon(null);
    // La caché de proceso de los ajustes dura unos segundos: se espera a que el color nuevo llegue a la ruta.
    L.eq("raíz: sin ajuste, /apple-touch-icon.png en azul (180x180)", await pixel("/apple-touch-icon.png"), { size: "180x180", color: "#4f46e5" });
    await setIcon("forest");
    await L.eqEventually("raíz: elegido el verde, /apple-touch-icon.png en verde", () => pixel(`/apple-touch-icon.png?x=${Date.now()}`), { size: "180x180", color: "#1f6b42" }, { timeout: 40000, step: 2000 });
    L.eq("raíz: /favicon.ico en verde y de 32x32", await pixel(`/favicon.ico?x=${Date.now()}`), { size: "32x32", color: "#1f6b42" });
    L.eq("raíz: /icon.png en verde", (await pixel(`/icon.png?x=${Date.now()}`)).color, "#1f6b42");
    const svg = await get("/icon.svg");
    L.check("raíz: /icon.svg en verde", svg.status === 200 && (await svg.text()).includes("#1f6b42"));
    for (const path of ["/favicon.ico", "/apple-touch-icon.png", "/icon.png", "/icon.svg"]) {
      const res = await get(path);
      const cc = res.headers.get("cache-control") ?? "";
      L.check(`raíz: ${path} sin sesión y con caché corta (no inmutable)`, res.status === 200 && !/immutable/.test(cc) && /max-age=\d{1,4}\b/.test(cc) && !res.headers.get("set-cookie"), `${res.status} ${cc}`);
    }
    L.eq("raíz: /favicon.ico es un .ico", (await get("/favicon.ico")).headers.get("content-type"), "image/x-icon");
    // ETag (color + revisión del dibujo + tamaño): con If-None-Match, 304 sin cuerpo; al cambiar el color, otro ETag y el icono entero.
    const etags = {};
    for (const path of ["/favicon.ico", "/apple-touch-icon.png", "/icon.png", "/icon.svg"]) {
      const etag = (etags[path] = (await get(path)).headers.get("etag"));
      L.check(`raíz: ${path} lleva ETag con el color`, /^"forest-r\d+-[a-z]+-(\d+|svg)(-ico)?"$/.test(etag ?? ""), String(etag));
      const again = await fetch(`${L.BASE}${path}`, { headers: { "If-None-Match": etag } });
      L.eq(`raíz: ${path} con If-None-Match responde 304 sin cuerpo y con el mismo ETag`, [again.status, (await again.arrayBuffer()).byteLength, again.headers.get("etag")], [304, 0, etag]);
      L.eq(`raíz: ${path} con otro ETag responde 200`, (await fetch(`${L.BASE}${path}`, { headers: { "If-None-Match": '"otro"' } })).status, 200);
    }
    L.eq("raíz: un ETag distinto por dirección", new Set(Object.values(etags)).size, 4);
    await setIcon(null);
    await L.eqEventually("raíz: de vuelta al azul, /apple-touch-icon.png en azul", async () => (await pixel(`/apple-touch-icon.png?x=${Date.now()}`)).color, "#4f46e5", { timeout: 40000, step: 2000 });
    const stale = await fetch(`${L.BASE}/favicon.ico`, { headers: { "If-None-Match": etags["/favicon.ico"] } });
    L.check("raíz: cambiado el color, el ETag anterior ya no vale (200 con el nuevo)", stale.status === 200 && /^"blue-/.test(stale.headers.get("etag") ?? ""), `${stale.status} ${stale.headers.get("etag")}`);

    // Nombre corto: el largo del manifiesto («Org · Pizarro») no cambia; el corto cabe bajo el icono.
    const manifest = async () => (await get("/manifest.webmanifest")).json();
    const appleTitle = () => p.goto(`${L.BASE}/my-tasks`).then(() => p.evaluate(() => document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content")));
    for (const [org, short] of [["Casa r52", "Casa r52"], ["Acme Corporation Internacional", "Acme"], ["Construcciones Hermanos Ejemplo", "Construccio…"]]) {
      await setOrg(org);
      await L.eqEventually(`nombre: «${org}» → manifiesto`, async () => { const m = await manifest(); return [m.name, m.short_name]; }, [`${org} · Pizarro`, short], { timeout: 40000, step: 2000 });
      L.eq(`nombre: «${org}» → título de iPhone`, await appleTitle(), short);
      L.check(`nombre: «${org}» → corto de 12 caracteres como mucho`, Array.from(short).length <= 12);
    }
    L.assertNoErrors("iconos", [s]);
  } finally {
    await setIcon(null);
    if (orgBefore) await setOrg(orgBefore.value);
    else await L.q(`DELETE FROM "AppState" WHERE key='instance.orgName'`);
    await s.ctx.close();
  }
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
