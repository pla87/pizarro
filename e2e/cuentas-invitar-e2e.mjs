// Miembros de un proyecto (ronda 59): un administrador asigna a otro administrador en *Ajustes del proyecto → General*
// (sale con la marca «admin», queda elegido y el enlace al tablero se copia con «Copiar enlace») y en *Administración →
// Proyectos* («Asignar usuario…» ofrece también administradores); «Invitar por email» da de alta a alguien sin cuenta
// (servidor sin email: el enlace de invitación se pasa a mano) en el idioma de quien invita, sale marcada como «Invitación
// pendiente» en los miembros y en *Administración → Proyectos* (sin email no hay «Reenviar invitación»; sí «Copiar enlace
// de invitación», que emite uno nuevo y deja sin valor el anterior), elige su contraseña con ese enlace y, al iniciar sesión, llega al tablero del proyecto y pierde la marca; quien no es
// administrador (miembro de un privado) no tiene esa opción; a 390 px el bloque cabe sin desbordar. Misma base y servidor que board-e2e.mjs (sin email):
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node cuentas-invitar-e2e.mjs   # PART=assign,admin,invite,member,mobile
import os from "node:os";
import * as L from "./qa/lib.mjs";
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "assign,admin,invite,member,mobile").split(",");

const TEAM = "inv59_team";
const PRIV = "inv59_priv";
const TEAM_NAME = "Equipo invitar r59";
const INVITED = "inv59.nueva-persona@example.com";
const NEW_PASSWORD = "una-clave-nueva-r59";

await L.prepareUsers();
// Restos de una pasada anterior.
await L.q(`DELETE FROM "Project" WHERE id IN ($1,$2)`, [TEAM, PRIV]);
await L.q(`DELETE FROM "User" WHERE email LIKE 'inv59%'`);
const [admin] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
const [second] = await L.q(`SELECT id,name FROM "User" WHERE email=$1`, [L.USER2]);
// Un proyecto de equipo sin asignados y un privado de la segunda persona.
await L.q(`INSERT INTO "Project"(id,name,description,"isPrivate",position,"updatedAt") VALUES ($1,$2,'',false,999970,NOW())`, [TEAM, TEAM_NAME]);
await L.q(`INSERT INTO "Column"(id,"projectId",name,position) VALUES ('inv59_col',$1,'Pendiente',1000)`, [TEAM]);
await L.q(`INSERT INTO "Project"(id,name,description,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,'Privado invitar r59','',true,$2,999971,NOW())`, [PRIV, second.id]);
await L.q(`INSERT INTO "Column"(id,"projectId",name,position) VALUES ('inv59_pcol',$1,'Pendiente',1000)`, [PRIV]);
await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [PRIV, second.id]);

const isMember = async (projectId, userId) => (await L.q(`SELECT 1 FROM "ProjectMember" WHERE "projectId"=$1 AND "userId"=$2`, [projectId, userId])).length > 0;
const isPicked = async (projectId, userId) => (await L.q(`SELECT 1 FROM "AdminProjectPick" WHERE "projectId"=$1 AND "userId"=$2`, [projectId, userId])).length > 0;

/** Sesión de administrador: se entra como miembro (sin 2FA) y se sube el rol después, a la vez que el de la segunda persona. */
async function adminSession(opts = {}) {
  await L.q(`UPDATE "User" SET role='MEMBER' WHERE id IN ($1,$2)`, [admin.id, second.id]);
  const s = await L.session(opts);
  await L.q(`UPDATE "User" SET role='ADMIN' WHERE id IN ($1,$2)`, [admin.id, second.id]);
  await s.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: L.BASE });
  return s;
}
const general = (page, id = TEAM) => L.goto(page, `${L.BASE}/p/${id}/settings?tab=general`);
const memberRows = (page) => page.locator("ul").filter({ has: page.getByRole("button", { name: /^Quitar a / }) }).first();

// --- Ajustes del proyecto: asignar a un administrador -------------------------------------------------------------------
if (only.includes("assign")) {
  L.scenario("assign: asignar a un administrador en Ajustes del proyecto");
  const s = await adminSession();
  const { page } = s;
  await general(page);
  const select = page.getByLabel("Añadir miembro", { exact: true });
  await select.waitFor({ timeout: 20000 });
  const options = await select.locator("option").allInnerTexts();
  L.check("ASSIGN: «Añadir miembro…» ofrece a otro administrador", options.includes(second.name), options.join(" | "));
  await select.selectOption({ label: second.name });
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await L.checkEventually("ASSIGN: queda asignado y elegido", async () => (await isMember(TEAM, second.id)) && (await isPicked(TEAM, second.id)));
  const row = memberRows(page).locator("li").filter({ hasText: second.name });
  await row.waitFor({ timeout: 15000 });
  L.check("ASSIGN: en la lista, con la marca «admin»", /admin/.test(await row.innerText()), await row.innerText());
  const note = page.getByTestId("member-link-note");
  await note.waitFor({ timeout: 10000 });
  L.eq("ASSIGN: el enlace a pasar es el del tablero", await note.getByTestId("member-link").inputValue(), `${L.BASE}/p/${TEAM}`);
  L.check("ASSIGN: el texto dice para quién es", (await note.innerText()).includes(`Enlace al tablero para pasárselo a ${second.name}`), await note.innerText());
  await note.getByRole("button", { name: "Copiar enlace" }).click();
  await L.checkEventually("ASSIGN: «Copiar enlace» lo deja en el portapapeles", async () => (await page.evaluate(() => navigator.clipboard.readText())) === `${L.BASE}/p/${TEAM}`);
  await page.screenshot({ path: `${SHOTS}/r59-asignar-admin.png` });
  // Quitarlo de asignados: sigue con el proyecto elegido (es administrador y lo ve igual).
  await row.getByRole("button", { name: `Quitar a ${second.name}` }).click();
  await L.checkEventually("ASSIGN: quitado de asignados", async () => !(await isMember(TEAM, second.id)));
  L.check("ASSIGN: conserva la elección", await isPicked(TEAM, second.id));
  L.assertNoErrors("ASSIGN", [s]);
  await s.ctx.close();
}

// --- Administración → Proyectos: «Asignar usuario…» con administradores ---------------------------------------------------
if (only.includes("admin")) {
  L.scenario("admin: Administración → Proyectos");
  const s = await adminSession();
  const { page } = s;
  await L.goto(page, `${L.BASE}/admin/projects`);
  const card = page.locator("li.card").filter({ has: page.getByRole("link", { name: TEAM_NAME, exact: true }) });
  await card.waitFor({ timeout: 20000 });
  const select = card.getByLabel("Asignar usuario");
  const options = await select.locator("option").allInnerTexts();
  L.check("ADMIN: «Asignar usuario…» ofrece administradores", options.includes(second.name), options.join(" | "));
  await select.selectOption({ label: second.name });
  await card.getByRole("button", { name: "Asignar", exact: true }).click();
  await L.checkEventually("ADMIN: queda asignado", () => isMember(TEAM, second.id));
  const chip = card.locator("li").filter({ has: page.getByRole("button", { name: `Quitar a ${second.name}` }) });
  await chip.waitFor({ timeout: 15000 });
  L.check("ADMIN: sale como asignado, con la marca «admin»", /admin/.test(await chip.innerText()), await chip.innerText());
  L.eq("ADMIN: ya no sale como botón «elegido / no elegido»", await card.getByRole("button", { name: new RegExp(`^${second.name}`) }).count(), 0);
  L.assertNoErrors("ADMIN", [s]);
  await s.ctx.close();
  await L.q(`DELETE FROM "ProjectMember" WHERE "projectId"=$1 AND "userId"=$2`, [TEAM, second.id]);
}

// --- Invitar por email (sin email en el servidor: el enlace se pasa a mano) ----------------------------------------------
if (only.includes("invite")) {
  L.scenario("invite: invitar a alguien sin cuenta");
  const s = await adminSession();
  const { page } = s;
  await general(page);
  const input = page.getByLabel("Invitar por email", { exact: true });
  await input.waitFor({ timeout: 20000 });
  await input.fill(INVITED);
  await page.getByRole("button", { name: "Invitar", exact: true }).click();
  const note = page.getByTestId("member-link-note");
  await note.waitFor({ timeout: 15000 });
  let link = await note.getByTestId("member-link").inputValue();
  L.check("INVITE: el enlace es el de la invitación", link.startsWith(`${L.BASE}/reset/`), link);
  L.check("INVITE: sin email, dice que se lo pases tú", (await note.innerText()).includes("Pásale este enlace a Inv59 Nueva Persona"), await note.innerText());
  const [invited] = await L.q(`SELECT id,name,role,"mustChangePassword",locale FROM "User" WHERE email=$1`, [INVITED]);
  L.check("INVITE: la cuenta existe como invitación", !!invited && invited.role === "MEMBER" && invited.mustChangePassword, JSON.stringify(invited));
  L.check("INVITE: ya está en el proyecto", !!invited && (await isMember(TEAM, invited.id)));
  const [inviter] = await L.q(`SELECT locale FROM "User" WHERE id=$1`, [admin.id]);
  L.eq("INVITE: con el idioma de quien invita", invited?.locale, inviter.locale);
  await L.checkEventually("INVITE: sale en la lista de asignados", async () => (await memberRows(page).innerText()).includes("Inv59 Nueva Persona"));
  const invitedRow = memberRows(page).locator("li").filter({ hasText: "Inv59 Nueva Persona" });
  L.check("INVITE: marcada como «Invitación pendiente»", (await invitedRow.innerText()).includes("Invitación pendiente"), await invitedRow.innerText());
  L.eq("INVITE: sin email no hay «Reenviar invitación»", await invitedRow.getByRole("button", { name: /^Reenviar invitación/ }).count(), 0);
  await note.getByRole("button", { name: "Copiar enlace" }).click();
  await L.checkEventually("INVITE: «Copiar enlace» copia el de la invitación", async () => (await page.evaluate(() => navigator.clipboard.readText())) === link);
  // «Copiar enlace de invitación» (sin email): un enlace nuevo, que no se envía; el anterior deja de valer.
  await invitedRow.getByRole("button", { name: "Copiar enlace de invitación de Inv59 Nueva Persona" }).click();
  await L.checkEventually("INVITE: «Copiar enlace de invitación» muestra un enlace nuevo", async () => {
    const v = await page.getByTestId("member-link").inputValue().catch(() => "");
    return [v.startsWith(`${L.BASE}/reset/`) && v !== link, v];
  });
  const fresh = await page.getByTestId("member-link").inputValue();
  L.check("INVITE: …y dice que se lo pases tú", (await page.getByTestId("member-link-note").innerText()).includes("Pásale este enlace a Inv59 Nueva Persona"));
  L.eq("INVITE: solo vale una invitación (la nueva)", (await L.q(`SELECT count(*)::int n FROM "AuthToken" WHERE "userId"=$1 AND purpose='INVITE'`, [invited.id]))[0].n, 1);
  await L.checkEventually("INVITE: queda en el registro, sin el enlace", async () => {
    const [row] = await L.q(`SELECT message, coalesce(details::text,'') d FROM "AppLog" WHERE action='users.copyInviteLink' ORDER BY "createdAt" DESC LIMIT 1`);
    return [!!row && /Generó un enlace de invitación nuevo para «Inv59 Nueva Persona»/.test(row.message) && !row.d.includes(fresh.split("/reset/")[1]), JSON.stringify(row)];
  });
  link = fresh;
  await page.screenshot({ path: `${SHOTS}/r59-invitar.png` });
  // En Administración → Proyectos, también marcada.
  await L.goto(page, `${L.BASE}/admin/projects`);
  const card = page.locator("li.card").filter({ has: page.getByRole("link", { name: TEAM_NAME, exact: true }) });
  const chip = card.locator("li").filter({ has: page.getByRole("button", { name: "Quitar a Inv59 Nueva Persona" }) });
  await chip.waitFor({ timeout: 20000 });
  L.check("INVITE: Administración → Proyectos la marca como «Invitación pendiente»", (await chip.innerText()).includes("Invitación pendiente"), await chip.innerText());
  L.assertNoErrors("INVITE", [s]);
  await s.ctx.close();

  // La persona invitada abre el enlace en su navegador, elige contraseña y entra: llega al tablero.
  const b = await L.getBrowser();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, locale: "es-ES" });
  const guest = await ctx.newPage();
  const errors = [];
  guest.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 300)));
  await guest.goto(link);
  await guest.fill("#rs-new", NEW_PASSWORD);
  await guest.fill("#rs-repeat", NEW_PASSWORD);
  await guest.getByRole("button", { name: "Guardar contraseña" }).click();
  const go = guest.getByRole("link", { name: "Iniciar sesión" });
  await go.waitFor({ timeout: 15000 });
  L.check("INVITE: «Iniciar sesión» lleva al tablero del proyecto", (await go.getAttribute("href")) === `/login?next=${encodeURIComponent(`/p/${TEAM}`)}`, await go.getAttribute("href"));
  await go.click();
  await guest.fill("#email", INVITED);
  await guest.fill("#password", NEW_PASSWORD);
  await guest.click("button[type=submit]");
  await guest.waitForURL(new RegExp(`/p/${TEAM}`), { timeout: 20000 });
  await guest.locator(`[aria-label="Pendiente"]`).first().waitFor({ state: "attached", timeout: 20000 });
  L.check("INVITE: entra directamente en el tablero", new URL(guest.url()).pathname === `/p/${TEAM}`, guest.url());
  L.check("INVITE: sin errores en el navegador de la invitada", errors.length === 0, errors.join(" | "));
  await ctx.close();

  // Ya ha entrado: deja de salir como invitación pendiente.
  const s2 = await adminSession();
  await general(s2.page);
  const rows = memberRows(s2.page);
  await rows.waitFor({ timeout: 20000 });
  const after = await rows.locator("li").filter({ hasText: "Inv59 Nueva Persona" }).innerText();
  L.check("INVITE: tras entrar, sin la marca", !after.includes("Invitación pendiente"), after);
  L.assertNoErrors("INVITE", [s2]);
  await s2.ctx.close();
}

// --- Quien no es administrador no invita -------------------------------------------------------------------------------
if (only.includes("member")) {
  L.scenario("member: miembro de un privado");
  await L.q(`UPDATE "User" SET role='MEMBER' WHERE id IN ($1,$2)`, [admin.id, second.id]);
  const s = await L.session({ email: L.USER2 });
  await general(s.page, PRIV);
  await s.page.getByLabel("Añadir miembro", { exact: true }).waitFor({ timeout: 20000 });
  L.eq("MEMBER: puede añadir miembros, pero no tiene «Invitar por email»", await s.page.getByLabel("Invitar por email", { exact: true }).count(), 0);
  L.assertNoErrors("MEMBER", [s]);
  await s.ctx.close();
}

// --- Móvil: el bloque con el enlace cabe a 390 px ------------------------------------------------------------------------
if (only.includes("mobile")) {
  L.scenario("mobile: 390 px");
  const s = await adminSession({ viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = s;
  await general(page);
  const select = page.getByLabel("Añadir miembro", { exact: true });
  await select.waitFor({ timeout: 20000 });
  await select.selectOption({ label: second.name });
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await page.getByTestId("member-link-note").waitFor({ timeout: 15000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  L.check("MOBILE: sin desbordamiento horizontal", overflow <= 0, `${overflow}px`);
  await page.getByTestId("member-link-note").screenshot({ path: `${SHOTS}/r59-enlace-movil.png` });
  L.assertNoErrors("MOBILE", [s]);
  await s.ctx.close();
}

await L.q(`UPDATE "User" SET role='MEMBER' WHERE id IN ($1,$2)`, [admin.id, second.id]);
await L.q(`DELETE FROM "Project" WHERE id IN ($1,$2)`, [TEAM, PRIV]);
await L.q(`DELETE FROM "User" WHERE email LIKE 'inv59%'`);
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
