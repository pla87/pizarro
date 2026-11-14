// «Aplicar plantilla», segunda vuelta: la plantilla elegida en el paso 1 se lee en claro y en oscuro (contraste del
// nombre sobre su fondo, también en las de la instalación y en las demás tarjetas de opción de la app); el resumen de
// «Cambiar a esta plantilla» dice qué tareas fijas pasan a normales; «Añadir lo que falte» vuelve a mostrar los tipos
// generales ocultos que usa la plantilla (y el deshacer los oculta); y el límite de cambios por proyecto avisa con un
// mensaje claro. Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r51-plantilla-e2e.mjs   # PART=estilo,fijas,generales,limite
import os from "node:os";
import * as L from "./qa/lib.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "estilo,fijas,generales,limite").split(",");

await L.prepareUsers();
const PID = "r51_tpl_project";
// El límite cuenta por proyecto en la memoria del servidor: un id nuevo en cada pasada (si no, una segunda pasada en
// menos de 10 minutos ya empezaría con el límite gastado). La segunda persona gasta 5 de sus 20 cambios por hora.
const RATE_PID = `r51_tpl_rate_${Date.now().toString(36)}`;
const [adm] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
const [usr2] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.USER2]);

/** Proyecto privado de `owner`: «Pendiente», «Para publicar» (release, con tres tareas fijas) y «Hecho»; generales ocultos opcionales. */
async function seed({ id = PID, owner = adm.id, hidden = [] } = {}) {
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [id]);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,$2,true,$3,999996,NOW())`, [id, `Zeta ${id}`, owner]);
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [id, owner]);
  const cols = [[`${id}_pend`, "Pendiente", false, "NONE"], [`${id}_rel`, "Para publicar", false, "NEXT_RELEASE"], [`${id}_hecho`, "Hecho", true, "NONE"]];
  for (const [i, [cid, name, done, role]] of cols.entries()) await L.q(`INSERT INTO "Column"(id,"projectId",name,position,"isDone",role) VALUES ($1,$2,$3,$4,$5,$6)`, [cid, id, name, (i + 1) * 1000, done, role]);
  const tasks = [["Normal r51", `${id}_pend`, false], ["Fija uno r51", `${id}_rel`, true], ["Fija dos r51", `${id}_rel`, true], ["Fija tres r51", `${id}_rel`, true]];
  for (const [i, [title, col, ev]] of tasks.entries()) {
    await L.q(`INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,evergreen,"createdById","updatedAt") VALUES ($1,$2,$3,$4,'kind_funcionalidad',$5,$6,$7,NOW())`, [`${id}_t${i}`, id, col, title, (i + 1) * 1024, ev, owner]);
  }
  for (const kindId of hidden) await L.q(`INSERT INTO "ProjectHiddenKind"("projectId","kindId") VALUES ($1,$2)`, [id, kindId]);
  await L.q(`DELETE FROM "ProjectTemplateChange" WHERE "projectId"=$1`, [id]);
}
const hiddenKinds = async (id = PID) => (await L.q(`SELECT "kindId" FROM "ProjectHiddenKind" WHERE "projectId"=$1 ORDER BY "kindId"`, [id])).map((r) => r.kindId);

async function settings(page, id = PID) {
  await page.goto(`${L.BASE}/p/${id}/settings?tab=tablero`);
  await page.locator("[data-apply-template]").waitFor({ timeout: 15000 });
  await sleep(300);
}
const wizard = (page) => page.getByRole("dialog").filter({ has: page.locator("[data-step]") }).first();
async function openWizard(page, template, mode) {
  await page.getByRole("button", { name: "Aplicar plantilla…" }).click();
  const dlg = wizard(page);
  await dlg.getByRole("radio", { name: new RegExp(`^${template}`) }).check();
  await dlg.getByRole("radio", { name: new RegExp(`^${mode}`) }).check();
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  return dlg;
}
const summaryText = (dlg) => dlg.locator("[data-summary]").innerText();
async function undoFromSettings(page) {
  await page.getByRole("button", { name: "Deshacer el cambio de plantilla" }).click();
  await page.getByRole("dialog").filter({ hasText: "Deshacer el cambio de plantilla" }).last().getByRole("button", { name: "Deshacer", exact: true }).click();
}

/**
 * Contraste WCAG entre el texto de `el` y el fondo que tiene detrás (los fondos semitransparentes de sus antepasados,
 * compuestos sobre el de la página). Los colores pueden venir en oklch: un lienzo los convierte a sRGB.
 */
function contrastOf(el) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 1, 1);
  const chain = [];
  for (let n = el; n; n = n.parentElement) chain.unshift(n);
  for (const n of chain) {
    const bg = getComputedStyle(n).backgroundColor;
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") { ctx.fillStyle = bg; ctx.fillRect(0, 0, 1, 1); }
  }
  const [br, bgc, bb] = ctx.getImageData(0, 0, 1, 1).data;
  ctx.fillStyle = getComputedStyle(el).color;
  ctx.fillRect(0, 0, 1, 1);
  const [fr, fg, fb] = ctx.getImageData(0, 0, 1, 1).data;
  const lum = (r, g, b) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [a, b] = [lum(fr, fg, fb), lum(br, bgc, bb)];
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}

/** Elige cada plantilla del paso 1 y mide el contraste de su nombre ya elegida; devuelve [{name, ratio, bg}]. */
async function measureChoices(dlg) {
  const out = [];
  const cards = dlg.locator("[data-template-choice]");
  for (let i = 0; i < (await cards.count()); i++) {
    const card = cards.nth(i);
    await card.locator("input[type=radio]").check();
    await sleep(120); // transición de colores
    const name = card.locator("[data-template-name]");
    out.push({ name: (await name.innerText()).trim(), ratio: await name.evaluate(contrastOf) });
  }
  return out;
}

// --- Estilo de la opción elegida --------------------------------------------------------------------------------------
if (only.includes("estilo")) {
  L.scenario("estilo: la plantilla elegida se lee en claro y en oscuro (también las de la instalación)");
  await seed();
  const s = await L.session();
  const { page } = s;
  // Las plantillas de la instalación solo las ven los administradores: se sube el rol tras entrar (sin el 2FA de admin).
  await L.q(`UPDATE "User" SET role='ADMIN' WHERE id=$1`, [adm.id]);
  try {
    for (const scheme of ["dark", "light"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await settings(page);
      L.eq(`ESTILO ${scheme}: la página está en modo ${scheme === "dark" ? "oscuro" : "claro"}`, await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches), scheme === "dark");
      await page.getByRole("button", { name: "Aplicar plantilla…" }).click();
      const dlg = wizard(page);
      await dlg.locator("[data-template-choice]").first().waitFor({ timeout: 10000 });
      const installation = await dlg.locator("fieldset").filter({ hasText: "Plantillas de la instalación" }).locator("[data-template-choice]").count();
      L.check(`ESTILO ${scheme}: hay plantillas de la instalación (administrador)`, installation > 0, String(installation));
      const all = await measureChoices(dlg);
      const bad = all.filter((x) => !x.name || x.ratio < 4.5);
      L.check(`ESTILO ${scheme}: el nombre de cada plantilla elegida tiene contraste suficiente (≥ 4,5)`, bad.length === 0, JSON.stringify(bad.length ? bad : all.slice(0, 3)));
      const course = all.find((x) => /^Curso o máster/.test(x.name));
      L.check(`ESTILO ${scheme}: la plantilla de serie «Curso o máster» tiene nombre visible`, !!course && course.ratio >= 4.5, JSON.stringify(course ?? all.map((x) => x.name)));
      if (scheme === "dark") {
        // Control: con las clases de antes (fondo claro sin variante oscura), la medida sí detecta el nombre ilegible.
        const card = dlg.locator("[data-template-choice]").first();
        const old = await card.evaluate((el) => { const c = el.className; el.className = "flex items-start gap-2 rounded-md border border-brand-500 bg-brand-50 p-2 text-sm"; return c; });
        const ratio = await card.locator("[data-template-name]").evaluate(contrastOf);
        await card.evaluate((el, c) => { el.className = c; }, old);
        L.check("ESTILO dark: (control) con el estilo antiguo el nombre no se leía", ratio < 2, String(ratio));
      }
      // La captura, con una de la instalación elegida (la de la captura del fallo).
      if (course) await dlg.locator("[data-template-choice]").filter({ hasText: /^Curso o máster/ }).locator("input").check();
      await page.screenshot({ path: `${SHOTS}/r51-plantilla-${scheme}.png` });
      await page.keyboard.press("Escape");
      await dlg.waitFor({ state: "detached", timeout: 5000 });
    }
    // Las demás tarjetas de opción usan el mismo estilo: idioma, edición, tema y tarjetas en Mi perfil → Preferencias.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`${L.BASE}/settings?tab=preferencias`);
    const themeCard = page.getByRole("button", { name: "Oscuro", exact: true });
    await themeCard.waitFor({ timeout: 15000 });
    const pressed = page.locator("button.choice-card[aria-pressed=true], button.choice-card[aria-checked=true]");
    L.check("ESTILO: Mi perfil usa las tarjetas de opción comunes", (await pressed.count()) > 0);
    const ratios = [];
    for (let i = 0; i < (await pressed.count()); i++) ratios.push(await pressed.nth(i).evaluate(contrastOf));
    L.check("ESTILO: las tarjetas elegidas de Mi perfil se leen en oscuro", ratios.every((r) => r >= 4.5), JSON.stringify(ratios));
    await page.screenshot({ path: `${SHOTS}/r51-opciones-dark.png` });
  } finally {
    await L.q(`UPDATE "User" SET role='MEMBER' WHERE id=$1`, [adm.id]);
  }
  L.assertNoErrors("ESTILO", [s]);
  await s.ctx.close();
}

// --- Tareas fijas en el resumen ----------------------------------------------------------------------------------------
if (only.includes("fijas")) {
  L.scenario("fijas: el resumen dice qué tareas fijas pasan a normales al perder su columna de release");
  await seed();
  const s = await L.session();
  const { page } = s;
  await settings(page);
  const dlg = await openWizard(page, "Familia y casa", "Cambiar a esta plantilla");
  await dlg.locator("[data-step='2']").waitFor({ timeout: 10000 });
  const relSelect = dlg.locator(`[data-match-column="Para publicar"] select`);
  // Sin pareja se conserva con su rol (la plantilla no tiene release): siguen fijas y el resumen no dice nada.
  L.eq("FIJAS: «Para publicar» se conserva", await relSelect.inputValue(), "keep");
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  await dlg.locator("[data-step='3']").waitFor();
  L.check("FIJAS: conservada con su rol, el resumen no habla de tareas fijas", !/fija/.test(await summaryText(dlg)), await summaryText(dlg));
  await dlg.getByRole("button", { name: "Atrás" }).click();
  await relSelect.selectOption({ label: "Por hacer" });
  await dlg.getByRole("button", { name: "Siguiente" }).click();
  await dlg.locator("[data-step='3']").waitFor();
  const text = await summaryText(dlg);
  L.check("FIJAS: pasada a una columna sin rol, «3 tareas fijas pasarán a ser normales» con sus nombres", /3 tareas fijas pasarán a ser normales/.test(text) && /Fija uno r51, Fija dos r51, Fija tres r51/.test(text), text);
  await page.screenshot({ path: `${SHOTS}/r51-plantilla-fijas.png` });
  await page.keyboard.press("Escape");
  L.eq("FIJAS: sin aplicar, siguen fijas", Number((await L.q(`SELECT count(*) n FROM "Task" WHERE "projectId"=$1 AND evergreen`, [PID]))[0].n), 3);
  L.assertNoErrors("FIJAS", [s]);
  await s.ctx.close();
}

// --- Añadir lo que falte: generales ocultos ----------------------------------------------------------------------------
if (only.includes("generales")) {
  L.scenario("generales: «Añadir lo que falte» vuelve a mostrar los tipos generales ocultos que usa la plantilla");
  await seed({ hidden: ["kind_correccion", "kind_respuesta"] });
  const s = await L.session();
  const { page } = s;
  await settings(page);
  await page.getByRole("button", { name: "Aplicar plantilla…" }).click();
  L.check("GENERALES: la opción lo dice antes de elegirla", (await wizard(page).innerText()).includes("vuelve a mostrar los tipos generales que usa la plantilla"));
  await page.keyboard.press("Escape");
  const dlg = await openWizard(page, "Equipo de software", "Añadir lo que falte");
  await dlg.locator("[data-step='3']").waitFor({ timeout: 10000 });
  const text = await summaryText(dlg);
  // «Equipo de software» usa «Corrección» y oculta «Respuesta»: solo vuelve la primera.
  L.check("GENERALES: el resumen dice que vuelve a verse «Corrección»", /Volverá a verse 1 tipo general/.test(text) && /Corrección/.test(text) && !/Respuesta/.test(text), text);
  await page.screenshot({ path: `${SHOTS}/r51-plantilla-generales.png` });
  await dlg.getByRole("button", { name: "Aplicar", exact: true }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });
  L.eq("GENERALES: «Corrección» ya no está oculto; «Respuesta», sí", await hiddenKinds(), ["kind_respuesta"]);
  await page.locator("[data-template-undo]").waitFor({ timeout: 10000 });
  await undoFromSettings(page);
  await L.eqEventually("GENERALES: el deshacer los vuelve a ocultar", () => hiddenKinds(), ["kind_correccion", "kind_respuesta"], { timeout: 10000 });
  L.assertNoErrors("GENERALES", [s]);
  await s.ctx.close();
}

// --- Límite de cambios por proyecto ------------------------------------------------------------------------------------
if (only.includes("limite")) {
  L.scenario("limite: tras 5 cambios de plantilla en 10 minutos, el sexto avisa y no cambia nada");
  // Con la segunda persona y un proyecto propio: no gasta los cambios del administrador que usan las demás suites.
  await seed({ id: RATE_PID, owner: usr2.id });
  const s = await L.session({ email: L.USER2 });
  const { page } = s;
  await settings(page, RATE_PID);
  for (let i = 0; i < 5; i++) {
    if (i % 2 === 0) {
      const dlg = await openWizard(page, "Equipo de software", "Añadir lo que falte");
      await dlg.locator("[data-step='3']").waitFor({ timeout: 10000 });
      await dlg.getByRole("button", { name: "Aplicar", exact: true }).click();
      await dlg.waitFor({ state: "detached", timeout: 15000 });
      await page.locator("[data-template-undo]").waitFor({ timeout: 10000 });
    } else {
      await undoFromSettings(page);
      await page.locator("[data-template-undo]").waitFor({ state: "detached", timeout: 10000 });
    }
  }
  L.eq("LIMITE: tras 5 cambios queda uno por deshacer", Number((await L.q(`SELECT count(*) n FROM "ProjectTemplateChange" WHERE "projectId"=$1`, [RATE_PID]))[0].n), 1);
  await undoFromSettings(page);
  const toast = page.getByText(/Este proyecto ya ha cambiado de plantilla 5 veces en los últimos 10 minutos\. Vuelve a intentarlo dentro de \d+ min\./);
  L.check("LIMITE: el sexto avisa con un mensaje claro", await toast.first().waitFor({ timeout: 10000 }).then(() => true, () => false));
  await page.screenshot({ path: `${SHOTS}/r51-plantilla-limite.png` });
  L.eq("LIMITE: y no se ha deshecho", Number((await L.q(`SELECT count(*) n FROM "ProjectTemplateChange" WHERE "projectId"=$1`, [RATE_PID]))[0].n), 1);
  L.check("LIMITE: el aviso es un error esperado (sin errores de consola)", s.errors.length === 0, s.errors.join(" | "));
  await s.ctx.close();
}

// Los proyectos de la suite no se quedan en la base (las demás suites usan el primero).
await L.q(`DELETE FROM "Project" WHERE id IN ($1,$2)`, [PID, RATE_PID]);
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
