// Caza de bugs 50b: en un documento HTML de Documentación, los enlaces internos (índice «#tema-2», también en SVG) se
// desplazan dentro del marco aislado (antes llevaban al marco la página de la app, que no se deja enmarcar, y quedaba un
// error) y `ping` no sale de lo que se pinta; y «Borrar mi cuenta» de quien entra con Google, en un servidor sin envío de
// emails, solo ofrece lo que hay (volver a entrar con Google), sin hablar de un código por email que no existe, en
// español y en inglés (390 px). La vuelta de Google se simula en la base (como test:db, que la prueba de verdad): el
// enlace lleva a Google con la marca de la baja, y con la confirmación de esta sesión se borra la cuenta y su proyecto
// privado pasa a ser de equipo, visible para un administrador. Misma base y servidor que board-e2e.mjs, con Google
// configurado y SIN email (valores de prueba, no llama a Google): GOOGLE_CLIENT_ID=r50 GOOGLE_CLIENT_SECRET=r50.
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh50b-e2e.mjs      # PART=anchor,googleonly
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "anchor,googleonly").split(",");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bh50b-"));

// Restos de una pasada interrumpida (un privado convertido en equipo ya no tiene dueño que lo delate).
await L.q(`DELETE FROM "Project" WHERE id LIKE 'bh50b\\_%'`);
await L.prepareUsers();
const p = await L.project();
const [base] = await L.q(`SELECT * FROM "User" WHERE email=$1`, [L.ADMIN]);

/** Persona nueva con la contraseña de las pruebas (copia la fila del admin), miembro de los proyectos de equipo. */
async function person(id, email, name) {
  await L.q(`DELETE FROM "Project" WHERE "privateOwnerId"=$1`, [id]);
  await L.q(`DELETE FROM "User" WHERE id=$1 OR email=$2`, [id, email]);
  const cols = Object.keys(base).filter((c) => !["id", "email", "name", "role", "googleSub", "twoFactorMethod", "totpSecretEnc", "totpLastStep"].includes(c));
  await L.q(
    `INSERT INTO "User" (id,email,name,role,${cols.map((c) => `"${c}"`).join(",")}) VALUES ($1,$2,$3,'MEMBER',${cols.map((_, i) => `$${i + 4}`).join(",")})`,
    [id, email, name, ...cols.map((c) => base[c])],
  );
  // Solo los que tienen tablero: al entrar se abre uno de ellos (no el privado que otra pasada dejó de equipo, sin columnas).
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") SELECT id,$1 FROM "Project" p WHERE NOT "isPrivate" AND EXISTS (SELECT 1 FROM "Column" c WHERE c."projectId"=p.id) ON CONFLICT DO NOTHING`, [id]);
}

// --- HTML de Documentación: enlaces internos dentro del marco ---------------------------------------------------------
if (only.includes("anchor")) {
  L.scenario("anchor: índice de un HTML en el marco aislado");
  await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1 AND name='temario-bh50b.html'`, [p.id]);
  const filler = Array.from({ length: 60 }, (_, i) => `<p>Párrafo de relleno ${i + 1} del tema 1.</p>`).join("\n");
  const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Temario</title></head><body>
<nav><a id="ir" href="#tema-2">Ir al tema 2</a> · <a id="arriba" href="#">Arriba</a> · <a id="fuera" href="https://example.com/bh50b" ping="https://example.com/rastreo">Fuera</a></nav>
<svg width="220" height="30"><a id="svg-ir" href="#tema-2"><text x="4" y="20">Tema 2 (SVG)</text></a></svg>
<h1>Tema 1</h1>${filler}
<h2 id="tema-2">Tema 2: Derivadas</h2><p>Contenido del tema 2.</p>${filler}
</body></html>`;
  const file = path.join(TMP, "temario-bh50b.html");
  fs.writeFileSync(file, HTML);
  const s = await L.session();
  const { page } = s;
  page.on("dialog", (d) => { s.errors.push(`dialog: ${d.message()}`); void d.dismiss(); });
  await page.goto(`${L.BASE}/p/${p.id}/docs`);
  await page.getByRole("heading", { name: /Documentación/ }).first().waitFor({ timeout: 15000 });
  await page.locator("input[type=file][aria-label='Subir archivos']").setInputFiles(file);
  await L.waitFor(async () => (await L.q(`SELECT 1 FROM "ProjectDocument" WHERE "projectId"=$1 AND name='temario-bh50b.html'`, [p.id])).length === 1, { timeout: 15000 });
  const [doc] = await L.q(`SELECT id,kind FROM "ProjectDocument" WHERE "projectId"=$1 AND name='temario-bh50b.html'`, [p.id]);
  L.eq("ANCHOR: se sube como HTML", doc.kind, "HTML");
  await page.reload();
  await page.locator(`[data-doc-open="${doc.id}"]`).first().click();
  const viewer = U.dialog(page);
  const frameEl = viewer.locator("iframe[data-testid=doc-html]");
  await frameEl.waitFor({ timeout: 10000 });
  const frame = page.frameLocator("iframe[data-testid=doc-html]");
  await frame.getByRole("heading", { name: "Tema 1" }).waitFor({ timeout: 10000 });
  const child = await (await frameEl.elementHandle()).contentFrame();
  const srcdoc = await frameEl.getAttribute("srcdoc");
  L.check("ANCHOR: sin `ping` en lo que se pinta (avisaría a otra dirección al pulsar)", !/\sping=/i.test(srcdoc), srcdoc.slice(0, 400));
  const pageUrl = page.url();
  const state = () => child.evaluate(() => ({ url: location.href, y: Math.round(scrollY), top: Math.round(document.getElementById("tema-2").getBoundingClientRect().top) }));
  const atTop = await state();
  L.eq("ANCHOR: el documento empieza arriba", atTop.y, 0);
  await frame.locator("#ir").click();
  await L.waitFor(async () => (await state().catch(() => ({ y: 0 }))).y > 0, { timeout: 5000 });
  const after = await state().catch((e) => ({ url: `error: ${e.message}`, y: 0, top: -1 }));
  L.check("ANCHOR: el enlace del índice se queda en el documento (no carga otra página en el marco)", after.url.startsWith("about:srcdoc"), after.url);
  L.check("ANCHOR: …y desplaza el marco hasta «Tema 2»", after.y > 0 && Math.abs(after.top) < 40, JSON.stringify(after));
  L.check("ANCHOR: el tema 2 se ve", await frame.getByRole("heading", { name: "Tema 2: Derivadas" }).isVisible());
  L.eq("ANCHOR: la página de la app no se mueve", page.url(), pageUrl);
  await page.screenshot({ path: `${SHOTS}/bh50b-indice.png` });
  await frame.locator("#arriba").click();
  await L.waitFor(async () => (await state()).y === 0, { timeout: 5000 });
  L.eq("ANCHOR: «#» vuelve arriba", (await state()).y, 0);
  await frame.locator("#svg-ir").click();
  await L.waitFor(async () => (await state()).y > 0, { timeout: 5000 });
  const svg = await state();
  L.check("ANCHOR: el enlace interno de un SVG también se desplaza dentro del documento", svg.url.startsWith("about:srcdoc") && svg.y > 0, JSON.stringify(svg));
  L.check("ANCHOR: el visor sigue abierto", await frameEl.isVisible());
  L.assertNoErrors("ANCHOR", [s]);
  await s.ctx.close();
}

// --- Borrar mi cuenta con Google en un servidor sin email ----------------------------------------------------------------
if (only.includes("googleonly")) {
  for (const lang of ["es", "en"]) {
    const EN = lang === "en";
    const M = EN ? "GOO-EN" : "GOO-ES";
    L.scenario(`googleonly: ${EN ? "inglés, 390 px y modo oscuro" : "español"}`);
    const id = `bh50b_goo_${lang}`;
    const email = `bh50b-goo-${lang}@example.com`;
    await person(id, email, EN ? "Google Only En" : "Solo Google Es");
    if (EN) await L.q(`UPDATE "User" SET locale='EN', theme='DARK' WHERE id=$1`, [id]);
    const s = await L.session({ email, ...(EN ? { viewport: { width: 390, height: 844 }, mobile: true } : {}) });
    const { page, ctx } = s;
    // Desde ahora entra con Google y su contraseña es una que nadie conoce; tiene un proyecto privado propio.
    await L.q(`UPDATE "User" SET "googleSub"=$2, "passwordHash"='$2b$12$' || md5(random()::text) WHERE id=$1`, [id, `bh50b-sub-${lang}`]);
    const pid = `bh50b_priv_${lang}`;
    await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId","updatedAt") VALUES ($1,$2,true,$3,NOW())`, [pid, `Apuntes bh50b ${lang}`, id]);
    await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [pid, id]);
    await page.goto(`${L.BASE}/settings?tab=cuenta`);
    const section = page.locator("#delete-account");
    await section.waitFor({ timeout: 20000 });
    await section.scrollIntoViewIfNeeded();
    await section.getByRole("button", { name: EN ? "Delete my account" : "Borrar mi cuenta" }).click();
    const dlg = page.getByRole("dialog", { name: EN ? "Delete my account" : "Borrar mi cuenta" });
    await dlg.waitFor();
    await dlg.getByText(EN ? "I sign in with Google and don't know my password" : "Entro con Google y no conozco mi contraseña").click();
    const text = await dlg.innerText();
    const hasEmail = (await dlg.getByRole("button", { name: EN ? "Send code" : "Enviar código" }).count()) > 0;
    L.check(`${M}: servidor sin envío de emails (como el de las pruebas)`, !hasEmail, "arranca el servidor sin MAIL_OUTBOX_DIR ni SMTP");
    L.check(`${M}: ofrece volver a entrar con Google`, await dlg.getByRole("link", { name: EN ? "Sign in with Google again" : "Volver a entrar con Google" }).isVisible());
    L.check(`${M}: explica solo esa forma`, text.includes(EN ? "Confirm it by signing in with Google again." : "Confírmalo volviendo a entrar con Google."), text);
    L.check(`${M}: no habla de un código por email que no hay`, !/email/i.test(text.replace(/\S+@\S+/g, "")), text);
    L.eq(`${M}: ni pide un código`, await page.locator("#da-code").count(), 0);
    if (EN) {
      const fit = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
      L.check(`${M}: cabe en 390 px`, fit.sw <= fit.vw, JSON.stringify(fit));
    }
    await page.screenshot({ path: `${SHOTS}/bh50b-baja-google-${lang}.png` });
    // El enlace va a Google con la marca de la baja (sin seguir la redirección: no se llama a Google).
    const href = await dlg.getByRole("link", { name: EN ? "Sign in with Google again" : "Volver a entrar con Google" }).getAttribute("href");
    const start = await page.request.get(`${L.BASE}${href}`, { maxRedirects: 0 });
    const location = start.headers()["location"] ?? "";
    L.check(`${M}: «Volver a entrar con Google» lleva a Google`, start.status() >= 300 && start.status() < 400 && location.startsWith("https://accounts.google.com/"), `${start.status()} ${location.slice(0, 80)}`);
    const glogin = (await ctx.cookies()).find((c) => c.name === "pz_glogin");
    L.check(`${M}: con la marca de la baja en la cookie del acceso con Google`, !!glogin && glogin.value.endsWith(".account-delete"), glogin?.value.split(".").length);
    // La vuelta de Google con la misma cuenta (como la prueba test:db): queda confirmada para esta sesión.
    const [sess] = await L.q(`SELECT id FROM "Session" WHERE "userId"=$1`, [id]);
    await L.q(`DELETE FROM "LoginChallenge" WHERE "userId"=$1`, [id]);
    await L.q(`INSERT INTO "LoginChallenge"(id,"userId",kind,"tokenHash",via,confirmed,next,"expiresAt") VALUES ($1,$2,'ACCOUNT_DELETE',md5(random()::text),'google',true,$3,NOW()+interval '10 minutes')`, [`bh50b_ch_${lang}`, id, sess.id]);
    await page.goto(`${L.BASE}/settings?tab=cuenta&delete=google#delete-account`);
    await dlg.waitFor({ timeout: 15000 });
    L.check(`${M}: a la vuelta, el diálogo se abre confirmado`, await dlg.getByTestId("delete-account-google-ok").waitFor({ timeout: 8000 }).then(() => true, () => false));
    await page.fill("#da-word", EN ? "delete" : "borrar");
    await dlg.getByRole("button", { name: EN ? "Delete my account" : "Borrar mi cuenta" }).click();
    await page.waitForURL(/\/login\?info=account_deleted/, { timeout: 20000 });
    L.eq(`${M}: la cuenta ya no existe`, (await L.q(`SELECT count(*)::int n FROM "User" WHERE id=$1`, [id]))[0].n, 0);
    L.eq(`${M}: su proyecto privado pasa a ser de equipo, sin miembros`, (await L.q(`SELECT "isPrivate", (SELECT count(*)::int FROM "ProjectMember" WHERE "projectId"=$1) AS members FROM "Project" WHERE id=$1`, [pid]))[0], { isPrivate: false, members: 0 });
    L.assertNoErrors(M, [s]);
    await s.ctx.close();
  }
  // Un administrador encuentra después esos proyectos (Proyectos y Administración → Proyectos) y puede abrirlos.
  L.scenario("googleonly: un administrador ve los proyectos que pasaron a ser de equipo");
  const a = await L.session({ email: L.USER2 });
  await L.q(`UPDATE "User" SET role='ADMIN' WHERE id='qa_user_2'`);
  for (const url of ["/projects", "/admin/projects"]) {
    await a.page.goto(`${L.BASE}${url}`);
    await L.eqEventually(`ADMIN-VE: ${url} lista los dos`, async () => {
      const main = await a.page.locator("main").innerText().catch(() => "");
      return main.includes("Apuntes bh50b es") && main.includes("Apuntes bh50b en");
    }, true, { timeout: 10000 });
  }
  // «Abrir» desde Proyectos: el tablero (vacío, sin columnas) se carga, no un «no encontrado».
  const res = await a.page.goto(`${L.BASE}/p/bh50b_priv_es`);
  L.eq("ADMIN-VE: lo puede abrir", res?.status(), 200);
  L.check("ADMIN-VE: …con su tablero", await a.page.getByText("0 tarjetas").first().waitFor({ timeout: 15000 }).then(() => true, () => false));
  L.assertNoErrors("ADMIN-VE", [a]);
  await a.ctx.close();
  await L.q(`UPDATE "User" SET role='MEMBER' WHERE id='qa_user_2'`);
  await L.q(`DELETE FROM "Project" WHERE id LIKE 'bh50b\\_%'`);
}

fs.rmSync(TMP, { recursive: true, force: true });
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
