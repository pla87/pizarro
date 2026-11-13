// Ronda 49 (textos breves): descripciones de una línea con el resto en notas «i» fuera de «Ajustes del proyecto»
// (Administración, Mi perfil) y botones desactivados cuando no harían nada (guardar sin cambios, «Limpiar» los logs sin
// filtros, «Todas»/«Ninguna» al generar una release, «Partir del texto por defecto» con ese texto ya puesto).
// Una nota «i» dentro de un diálogo se cierra con Escape sin cerrar el diálogo. Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r49-textos-e2e.mjs      # PART=admin,profile,release
import os from "node:os";
import * as L from "./qa/lib.mjs";
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "admin,profile,release").split(",");

await L.prepareUsers();
await L.cleanBoard();
const bodyText = (page) => page.locator("body").innerText();
const tip = (page) => page.locator("[role=dialog][aria-label^='Más información']");

if (only.includes("admin")) {
  L.scenario("admin: textos breves, notas «i» y botones sin efecto");
  // Las dos sesiones antes de pasar a administrador (como administrador, entrar pide la verificación en dos pasos).
  const s = await L.session();
  const m = await L.session({ viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = s;
  await L.q(`UPDATE "User" SET role='ADMIN' WHERE email=$1`, [L.ADMIN]);
  try {
    // Usuarios: una línea a la vista; el «por qué» en la nota.
    await page.goto(`${L.BASE}/admin/users`);
    await page.getByRole("heading", { name: "Usuarios" }).waitFor({ timeout: 20000 });
    const text = await bodyText(page);
    L.check("USERS: el recuento va solo, sin la explicación larga", /\d+ de \d+ usuarios activos/.test(text) && !text.includes("No hay registro público"));
    await page.getByRole("button", { name: "Más información: Usuarios" }).click();
    await L.eqEventually("USERS: la nota «i» se abre con la explicación", async () => (await tip(page).count()) && (await tip(page).innerText()).includes("No hay registro público"), true);
    await page.keyboard.press("Escape");
    await L.eqEventually("USERS: Escape cierra la nota", () => tip(page).count(), 0);

    // Nota «i» dentro de un diálogo: Escape cierra la nota y el diálogo sigue abierto.
    await page.getByRole("button", { name: "Borrar Segunda Persona" }).click();
    const dlg = page.getByRole("dialog", { name: "Borrar a Segunda Persona" });
    await dlg.waitFor({ timeout: 10000 });
    await dlg.getByRole("button", { name: "Más información: Borrar usuario" }).click();
    await L.eqEventually("USERS: la nota del diálogo de borrar se abre", async () => (await tip(page).count()) > 0 && (await tip(page).innerText()).includes("proyectos privados"), true);
    await page.screenshot({ path: `${SHOTS}/r49-textos-nota-en-dialogo.png` });
    await page.keyboard.press("Escape");
    await L.eqEventually("USERS: Escape cierra la nota", () => tip(page).count(), 0);
    L.eq("USERS: …y el diálogo sigue abierto", await dlg.count(), 1);
    await page.keyboard.press("Escape");
    await L.eqEventually("USERS: un segundo Escape cierra el diálogo", () => dlg.count(), 0);

    // Logs: «Limpiar» sin filtros no es un enlace (atenuado); con un filtro, sí.
    await page.goto(`${L.BASE}/admin/logs`);
    const clear = page.getByText("Limpiar", { exact: true });
    await clear.waitFor({ timeout: 20000 });
    L.eq("LOGS: sin filtros, «Limpiar» está desactivado", await clear.getAttribute("aria-disabled"), "true");
    await page.goto(`${L.BASE}/admin/logs?level=error`);
    const clearLink = page.getByRole("link", { name: "Limpiar", exact: true });
    await clearLink.waitFor({ timeout: 20000 }).catch(() => {});
    L.eq("LOGS: con un filtro, «Limpiar» es un enlace", await clearLink.count(), 1);

    // Ajustes → Almacenamiento: «Guardar» solo con cambios.
    await page.goto(`${L.BASE}/admin/settings`);
    const storage = page.locator("section[aria-labelledby=storage-title]");
    await storage.waitFor({ timeout: 20000 });
    const saveQuota = storage.getByRole("button", { name: "Guardar", exact: true });
    L.eq("SETTINGS: sin cambios, «Guardar» las cuotas está desactivado", await saveQuota.isEnabled(), false);
    await storage.locator("#quota-total").fill("5000");
    L.eq("SETTINGS: con un cambio, se activa", await saveQuota.isEnabled(), true);
    await storage.locator("#quota-total").fill("");
    L.eq("SETTINGS: al deshacerlo, vuelve a desactivarse", await saveQuota.isEnabled(), false);
    L.check("SETTINGS: la explicación del diagnóstico va en su nota", !(await bodyText(page)).includes("No lleva datos personales, mensajes de los logs"));

    // Textos legales: «Partir del texto por defecto» con ese texto ya puesto no haría nada.
    await page.goto(`${L.BASE}/admin/legal`);
    const editor = page.getByTestId("legal-editor-privacy");
    await editor.waitFor({ timeout: 20000 });
    const fromDefault = editor.getByRole("button", { name: "Partir del texto por defecto" });
    L.eq("LEGAL: con el texto vacío, «Partir del texto por defecto» está activo", await fromDefault.isEnabled(), true);
    await fromDefault.click();
    L.eq("LEGAL: con el texto por defecto ya puesto, se desactiva", await fromDefault.isEnabled(), false);

    // Móvil: la nota cabe en la pantalla.
    await m.page.goto(`${L.BASE}/admin/users`);
    await m.page.getByRole("button", { name: "Más información: Usuarios" }).click();
    await tip(m.page).waitFor({ timeout: 10000 });
    const box = await tip(m.page).boundingBox();
    L.check("MÓVIL: la nota cabe en 390 px", !!box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
    await m.page.screenshot({ path: `${SHOTS}/r49-textos-nota-390.png` });
    L.assertNoErrors("ADMIN", [s, m]);
  } finally {
    await L.q(`UPDATE "User" SET role='MEMBER' WHERE email=$1`, [L.ADMIN]);
    await m.ctx.close();
    await s.ctx.close();
  }
}

if (only.includes("profile")) {
  L.scenario("profile: guardar solo con cambios");
  const s = await L.session();
  const { page } = s;
  await page.goto(`${L.BASE}/settings`);
  const name = page.locator("#pf-name");
  await name.waitFor({ timeout: 20000 });
  const saveName = page.locator("form").filter({ has: name }).getByRole("button", { name: "Guardar", exact: true });
  L.eq("PERFIL: sin cambios, «Guardar» está desactivado", await saveName.isEnabled(), false);
  const before = await name.inputValue();
  await name.fill(before + " X");
  L.eq("PERFIL: al cambiar el nombre, se activa", await saveName.isEnabled(), true);
  await name.fill(before);
  L.eq("PERFIL: al volver al nombre guardado, se desactiva", await saveName.isEnabled(), false);
  const changePw = page.getByRole("button", { name: "Cambiar contraseña", exact: true });
  L.eq("PERFIL: «Cambiar contraseña» sin rellenar está desactivado", await changePw.isEnabled(), false);

  await page.goto(`${L.BASE}/settings?tab=avisos`);
  const mention = page.locator("section").filter({ hasText: "Avisos de menciones" });
  await mention.waitFor({ timeout: 20000 });
  const saveMention = mention.getByRole("button", { name: "Guardar avisos" });
  L.eq("AVISOS: sin cambios, «Guardar avisos» está desactivado", await saveMention.isEnabled(), false);
  await mention.getByRole("checkbox").first().click();
  L.eq("AVISOS: al marcar una casilla, se activa", await saveMention.isEnabled(), true);
  L.check("AVISOS: la descripción es de una línea", !(await bodyText(page)).includes("Cuando alguien te menciona con @"));
  L.assertNoErrors("PROFILE", [s]);
  await s.ctx.close();
}

if (only.includes("release")) {
  L.scenario("release: «Todas» y «Ninguna» solo cuando cambian algo");
  await L.seedTasks(L.COL.next, ["R49 textos uno", "R49 textos dos"]);
  const s = await L.session();
  const { page } = s;
  await page.getByRole("button", { name: "Generar Release" }).first().click();
  const dlg = page.getByRole("dialog", { name: /Generar release/ });
  await dlg.waitFor({ timeout: 15000 });
  const all = dlg.getByRole("button", { name: "Todas", exact: true });
  const none = dlg.getByRole("button", { name: "Ninguna", exact: true });
  L.eq("RELEASE: con todas marcadas, «Todas» desactivado y «Ninguna» activo", [await all.isEnabled(), await none.isEnabled()], [false, true]);
  await none.click();
  L.eq("RELEASE: sin ninguna, «Todas» activo y «Ninguna» desactivado", [await all.isEnabled(), await none.isEnabled()], [true, false]);
  await dlg.getByRole("checkbox").first().click();
  L.eq("RELEASE: con una marcada, los dos activos", [await all.isEnabled(), await none.isEnabled()], [true, true]);
  await page.screenshot({ path: `${SHOTS}/r49-textos-release.png` });
  L.assertNoErrors("RELEASE", [s]);
  await s.ctx.close();
  await L.cleanBoard();
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
