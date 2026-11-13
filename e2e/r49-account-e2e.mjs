// «Borrar mi cuenta» en Mi perfil → Cuenta: el último administrador no puede (botón desactivado y por qué), el diálogo
// pide contraseña y palabra de confirmación y avisa, con su lista, de que sus proyectos privados sin más miembros pasan a
// ser de equipo (con la casilla para borrarlos también); contraseña incorrecta no borra; al borrar se va al acceso con el
// aviso, se cierran todas sus sesiones (también la de otro dispositivo) y lo que creó se queda como «Usuario eliminado».
// En móvil (390 px), con verificación en dos pasos activada desde el propio perfil, el diálogo cabe en la pantalla y pide
// el código de la app. Quien entra con Google (sin contraseña conocida) confirma con el código de su app y borra también
// su proyecto privado. Administración → Usuarios → Borrar: la misma regla y la misma casilla. Misma base y servidor que
// board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r49-account-e2e.mjs   # PART=block,desk,mobile,google,admin
import { createHmac } from "node:crypto";
import os from "node:os";
import * as L from "./qa/lib.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "block,desk,mobile,google,admin").split(",");

await L.prepareUsers();
// Restos de una pasada interrumpida: los proyectos que pasaron a ser de equipo ya no tienen dueño que los delate.
await L.q(`DELETE FROM "Project" WHERE id LIKE 'r49\_%'`);
const p = await L.project();
const [base] = await L.q(`SELECT * FROM "User" WHERE email=$1`, [L.ADMIN]);

/** Persona nueva con la contraseña de las pruebas (copia la fila del admin), miembro de los proyectos de equipo. */
async function person(id, email, name, role = "MEMBER") {
  await L.q(`DELETE FROM "Project" WHERE "privateOwnerId"=$1`, [id]);
  await L.q(`DELETE FROM "User" WHERE id=$1 OR email=$2`, [id, email]);
  const cols = Object.keys(base).filter((c) => !["id", "email", "name", "role", "googleSub", "twoFactorMethod", "totpSecretEnc", "totpLastStep"].includes(c));
  await L.q(
    `INSERT INTO "User" (id,email,name,role,${cols.map((c) => `"${c}"`).join(",")}) VALUES ($1,$2,$3,$4,${cols.map((_, i) => `$${i + 5}`).join(",")})`,
    [id, email, name, role, ...cols.map((c) => base[c])],
  );
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") SELECT id,$1 FROM "Project" WHERE NOT "isPrivate" ON CONFLICT DO NOTHING`, [id]);
}

const userCount = async (id) => (await L.q(`SELECT count(*)::int n FROM "User" WHERE id=$1`, [id]))[0].n;

/** Mi perfil → Cuenta, con la sección «Borrar mi cuenta» a la vista. */
async function openAccount(page) {
  await page.goto(`${L.BASE}/settings?tab=cuenta`);
  const section = page.locator("#delete-account");
  await section.waitFor({ timeout: 20000 });
  await section.scrollIntoViewIfNeeded();
  return section;
}

// TOTP (RFC 6238, SHA-1, 30 s, 6 cifras) a partir de la clave que enseña la pantalla, como haría la app del móvil.
function totp(secretB32, now = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secretB32.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** Activa la verificación en dos pasos con app desde Mi perfil → Cuenta y devuelve la clave (para calcular los códigos). */
async function enrollTotp(page) {
  await page.goto(`${L.BASE}/settings?tab=cuenta`);
  const tf = page.locator("#two-factor");
  await tf.waitFor({ timeout: 20000 });
  await tf.getByRole("button", { name: "Activar" }).click();
  await page.fill("#tf-pass", L.PASSWORD);
  await tf.getByRole("button", { name: "App de autenticación" }).click();
  const secret = (await page.getByTestId("totp-secret").innerText({ timeout: 15000 })).replace(/\s/g, "");
  await page.fill("#enroll-code", totp(secret));
  await tf.getByRole("button", { name: "Activar" }).click();
  await page.getByTestId("recovery-codes").waitFor({ timeout: 15000 });
  await tf.getByRole("button", { name: "He guardado los códigos" }).click();
  return secret;
}

// --- El último administrador: botón desactivado y el motivo ----------------------------------------------------------
if (only.includes("block")) {
  L.scenario("block: último administrador");
  const id = "r49_admin";
  await person(id, "r49-admin@example.com", "Admin Único");
  const s = await L.session({ email: "r49-admin@example.com" });
  // prepareUsers deja a todos como miembros: esta persona pasa a ser la única administradora (sin cerrar su sesión).
  await L.q(`UPDATE "User" SET role='ADMIN' WHERE id=$1`, [id]);
  const section = await openAccount(s.page);
  const reason = await section.getByTestId("delete-account-block").innerText().catch(() => "");
  L.check("BLOCK: explica que es el único administrador y qué hacer", /único administrador/.test(reason) && /Nombra antes a otro/.test(reason), reason);
  L.check("BLOCK: el botón está desactivado", await section.getByRole("button", { name: "Borrar mi cuenta" }).isDisabled());
  await section.screenshot({ path: `${SHOTS}/r49-ultimo-admin.png` });
  // Con otro administrador activo, ya se puede.
  await L.q(`UPDATE "User" SET role='ADMIN' WHERE id='qa_user_2'`);
  await openAccount(s.page);
  L.check("BLOCK: con otro administrador, el botón se activa", await s.page.locator("#delete-account").getByRole("button", { name: "Borrar mi cuenta" }).isEnabled());
  L.assertNoErrors("BLOCK", [s]);
  await s.ctx.close();
  await L.q(`UPDATE "User" SET role='MEMBER' WHERE id='qa_user_2'`);
  await L.q(`DELETE FROM "User" WHERE id=$1`, [id]);
}

// --- Escritorio: contraseña incorrecta, proyecto privado, borrado y sesiones -------------------------------------------
if (only.includes("desk")) {
  L.scenario("desk: borrar la cuenta en escritorio");
  const deskStart = await L.dbNow();
  const id = "r49_desk";
  const email = "r49-desk@example.com";
  await person(id, email, "Persona Que Se Va");
  // Lo que ha creado en el proyecto de equipo: una tarea con un comentario y una entrada de historial.
  const [col] = await L.q(`SELECT id FROM "Column" WHERE "projectId"=$1 ORDER BY position LIMIT 1`, [p.id]);
  const [kind] = await L.q(`SELECT id FROM "TaskKind" WHERE "projectId" IS NULL OR "projectId"=$1 ORDER BY position LIMIT 1`, [p.id]);
  const [task] = await L.q(
    `INSERT INTO "Task"(id,"projectId","columnId",title,"kindId",position,"createdById","assigneeId","updatedAt") VALUES ('r49_task',$1,$2,'Tarea de quien se va',$3,1,$4,$4,NOW())
     ON CONFLICT (id) DO UPDATE SET "createdById"=$4,"assigneeId"=$4 RETURNING id`,
    [p.id, col.id, kind.id, id],
  );
  await L.q(`DELETE FROM "TaskComment" WHERE "taskId"=$1`, [task.id]);
  await L.q(`INSERT INTO "TaskComment"(id,"taskId","authorId",body) VALUES ('r49_comment',$1,$2,'Comentario de quien se va')`, [task.id, id]);
  await L.q(`INSERT INTO "TaskEvent"(id,"taskId","projectId","userId","userName",code,label) VALUES ('r49_event',$1,$2,$3,'Persona Que Se Va','update','Cambió la tarea') ON CONFLICT (id) DO UPDATE SET "userName"='Persona Que Se Va'`, [task.id, p.id, id]);
  const other = await L.session({ email }); // otro dispositivo con sesión abierta
  const s = await L.session({ email });
  // Un proyecto privado en el que es el único miembro (después de entrar: al entrar se abriría él, que no tiene columnas).
  await L.q(`DELETE FROM "Project" WHERE id='r49_private'`);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId","updatedAt") VALUES ('r49_private','Privado de quien se va',true,$1,NOW())`, [id]);
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ('r49_private',$1)`, [id]);
  L.eq("DESK: dos sesiones abiertas", (await L.q(`SELECT count(*)::int n FROM "Session" WHERE "userId"=$1`, [id]))[0].n, 2);
  const section = await openAccount(s.page);
  L.check("DESK: la sección explica en una línea qué pasa", (await section.innerText()).includes("Lo que creaste se queda, sin tu nombre."));
  await section.getByRole("button", { name: "Borrar mi cuenta" }).click();
  const dlg = s.page.getByRole("dialog", { name: "Borrar mi cuenta" });
  await dlg.waitFor();
  const submit = dlg.getByRole("button", { name: "Borrar mi cuenta" });
  L.check("DESK: el foco empieza en la contraseña", await s.page.evaluate(() => document.activeElement?.id === "da-pass"));
  const privateBox = dlg.getByTestId("delete-account-private");
  const privateText = await privateBox.innerText().catch(() => "");
  L.check("DESK: avisa de que su proyecto privado pasa a ser de equipo y lo verán los administradores", privateText.includes("pasará a ser un proyecto de equipo y lo verán los administradores"), privateText);
  L.eq("DESK: con la lista de esos proyectos", (await dlg.getByTestId("delete-account-private-list").innerText().catch(() => "")).trim(), "Privado de quien se va");
  L.check("DESK: la casilla para borrarlo también, sin marcar", !(await dlg.getByLabel("Borrar también este proyecto").isChecked()));
  L.check("DESK: sin «Entro con Google» (tiene contraseña y no tiene Google)", (await dlg.getByText("Entro con Google y no conozco mi contraseña").count()) === 0);
  L.check("DESK: sin rellenar nada, no se puede borrar", await submit.isDisabled());
  await s.page.fill("#da-pass", "una-clave-que-no-es");
  await s.page.fill("#da-word", "borrar");
  L.check("DESK: con contraseña y palabra, el botón se activa (la palabra sin distinguir mayúsculas)", await submit.isEnabled());
  await s.page.screenshot({ path: `${SHOTS}/r49-dialogo-escritorio.png` });
  await submit.click();
  await L.eqEventually("DESK: contraseña incorrecta: aviso claro", async () => (await s.page.locator("body").innerText()).includes("La contraseña actual no es correcta."), true);
  L.eq("DESK: con la contraseña incorrecta la cuenta sigue", await userCount(id), 1);
  L.check("DESK: el diálogo sigue abierto para corregir", await dlg.isVisible());

  await s.page.fill("#da-pass", L.PASSWORD);
  await submit.click();
  await s.page.waitForURL(/\/login\?info=account_deleted/, { timeout: 20000 });
  const notice = await s.page.getByRole("status").innerText().catch(() => "");
  L.eq("DESK: el acceso dice que la cuenta se ha borrado", notice.trim(), "Tu cuenta se ha borrado.");
  await s.page.screenshot({ path: `${SHOTS}/r49-acceso-tras-borrar.png` });
  L.eq("DESK: la cuenta ya no existe", await userCount(id), 0);
  L.eq("DESK: ninguna sesión queda", (await L.q(`SELECT count(*)::int n FROM "Session" WHERE "userId"=$1`, [id]))[0].n, 0);
  L.eq("DESK: su proyecto privado pasa a ser de equipo, sin miembros", (await L.q(`SELECT "isPrivate", (SELECT count(*)::int FROM "ProjectMember" WHERE "projectId"='r49_private') AS members FROM "Project" WHERE id='r49_private'`))[0], { isPrivate: false, members: 0 });
  await L.eqEventually("DESK: la conversión queda en el registro de actividad", async () => (await L.q(`SELECT count(*)::int n FROM "AppLog" WHERE action='users.privateProjectToTeam' AND "projectId"='r49_private' AND "createdAt" >= $1`, [deskStart]))[0].n, 1);
  const [t] = await L.q(`SELECT "createdById","assigneeId" FROM "Task" WHERE id=$1`, [task.id]);
  L.eq("DESK: la tarea se queda, sin autor ni responsable", t, { createdById: null, assigneeId: null });
  L.eq("DESK: el comentario se queda, sin autor", (await L.q(`SELECT "authorId" FROM "TaskComment" WHERE id='r49_comment'`))[0]?.authorId, null);
  L.eq("DESK: su nombre no queda en el historial", (await L.q(`SELECT "userName" FROM "TaskEvent" WHERE id='r49_event'`))[0]?.userName, "");
  // El otro dispositivo: al recargar, fuera.
  await other.page.goto(`${L.BASE}/settings`);
  await other.page.waitForURL(/\/login/, { timeout: 20000 }).catch(() => {});
  L.check("DESK: el otro dispositivo vuelve al acceso", other.page.url().includes("/login"), other.page.url());
  // Los demás ven su comentario como «Usuario eliminado».
  const viewer = await L.session({ email: L.USER2 });
  await viewer.page.goto(`${L.BASE}/p/${p.id}?task=${task.id}`);
  await L.eqEventually("DESK: el comentario sale como «Usuario eliminado»", async () => (await viewer.page.getByRole("dialog").innerText().catch(() => "")).includes("Usuario eliminado"), true, { timeout: 20000 });
  L.assertNoErrors("DESK", [s, viewer]);
  for (const x of [s, other, viewer]) await x.ctx.close();
  await L.q(`DELETE FROM "Task" WHERE id=$1`, [task.id]);
  await L.q(`DELETE FROM "Project" WHERE id='r49_private'`);
}

// --- Móvil (390 px): activar la verificación en dos pasos y borrar con el código de la app ----------------------------
if (only.includes("mobile")) {
  L.scenario("mobile: 390 px con verificación en dos pasos");
  const id = "r49_mob";
  const email = "r49-mob@example.com";
  await person(id, email, "Persona Móvil");
  const s = await L.session({ email, viewport: { width: 390, height: 844 }, mobile: true });
  const { page } = s;
  const secret = await enrollTotp(page);
  await L.eqEventually("MOB: verificación activada", async () => (await L.q(`SELECT "twoFactorMethod" m FROM "User" WHERE id=$1`, [id]))[0]?.m, "TOTP");

  const section = await openAccount(page);
  await section.getByRole("button", { name: "Borrar mi cuenta" }).click();
  const dlg = page.getByRole("dialog", { name: "Borrar mi cuenta" });
  await dlg.waitFor();
  await sleep(400); // animación de entrada
  const fit = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const panel = document.querySelector("[data-testid=modal-panel]")?.getBoundingClientRect();
    const out = [...document.querySelectorAll("[role=dialog] input, [role=dialog] button")]
      .filter((el) => el.getClientRects().length)
      .filter((el) => { const b = el.getBoundingClientRect(); return b.left < -0.5 || b.right > vw + 0.5; })
      .map((el) => el.id || el.textContent.trim());
    return { vw, left: panel?.left ?? -1, right: panel?.right ?? 9999, out, scroll: document.documentElement.scrollWidth > vw + 1 };
  });
  L.check("MOB: el diálogo cabe en los 390 px", fit.left >= -0.5 && fit.right <= fit.vw + 0.5 && fit.out.length === 0 && !fit.scroll, JSON.stringify(fit));
  L.check("MOB: pide el código de verificación", await page.locator("#da-code").isVisible());
  L.check("MOB: explica qué código vale", (await dlg.innerText()).includes("De tu app o un código de recuperación."));
  await page.fill("#da-pass", L.PASSWORD);
  await page.fill("#da-word", "BORRAR");
  const submit = dlg.getByRole("button", { name: "Borrar mi cuenta" });
  L.check("MOB: sin código no se puede borrar", await submit.isDisabled());
  await page.fill("#da-code", "000000" === totp(secret) ? "111111" : "000000");
  await page.screenshot({ path: `${SHOTS}/r49-dialogo-movil.png` });
  await submit.click();
  await L.eqEventually("MOB: código incorrecto: aviso", async () => (await page.locator("body").innerText()).includes("Código incorrecto o caducado."), true);
  L.eq("MOB: con el código incorrecto la cuenta sigue", await userCount(id), 1);
  await page.fill("#da-code", totp(secret));
  await submit.click();
  await page.waitForURL(/\/login\?info=account_deleted/, { timeout: 20000 });
  L.eq("MOB: el acceso dice que la cuenta se ha borrado", (await page.getByRole("status").innerText()).trim(), "Tu cuenta se ha borrado.");
  await page.screenshot({ path: `${SHOTS}/r49-acceso-movil.png` });
  L.eq("MOB: la cuenta ya no existe", await userCount(id), 0);
  L.eq("MOB: sin códigos de recuperación ni sesiones", (await L.q(`SELECT (SELECT count(*) FROM "RecoveryCode" WHERE "userId"=$1)::int + (SELECT count(*) FROM "Session" WHERE "userId"=$1)::int n`, [id]))[0].n, 0);
  L.assertNoErrors("MOB", [s]);
  await s.ctx.close();
}

// --- Entra con Google y no conoce su contraseña: confirma con el código de su app y borra también su proyecto privado ---
if (only.includes("google")) {
  L.scenario("google: sin contraseña conocida, con el código de la app");
  const id = "r49_goo";
  const email = "r49-goo@example.com";
  await person(id, email, "Persona Con Google");
  const s = await L.session({ email });
  const { page } = s;
  const secret = await enrollTotp(page);
  await L.eqEventually("GOO: verificación activada", async () => (await L.q(`SELECT "twoFactorMethod" m FROM "User" WHERE id=$1`, [id]))[0]?.m, "TOTP");
  // Desde ahora entra con Google (cuenta enlazada) y su contraseña es una que nadie conoce.
  await L.q(`UPDATE "User" SET "googleSub"='r49-goo-sub', "passwordHash"='$2b$12$' || md5(random()::text) WHERE id=$1`, [id]);
  await L.q(`DELETE FROM "Project" WHERE id IN ('r49_goo_a','r49_goo_b')`);
  await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId","updatedAt") VALUES ('r49_goo_a','Notas de Google A',true,$1,NOW()),('r49_goo_b','Notas de Google B',true,$1,NOW())`, [id]);
  await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ('r49_goo_a',$1),('r49_goo_b',$1)`, [id]);
  const section = await openAccount(page);
  await section.getByRole("button", { name: "Borrar mi cuenta" }).click();
  const dlg = page.getByRole("dialog", { name: "Borrar mi cuenta" });
  await dlg.waitFor();
  L.eq("GOO: lista sus dos proyectos privados", (await dlg.getByTestId("delete-account-private-list").innerText()).split("\n").map((x) => x.trim()), ["Notas de Google A", "Notas de Google B"]);
  L.check("GOO: dice que pasarán a ser de equipo", (await dlg.innerText()).includes("pasarán a ser proyectos de equipo y los verán los administradores"));
  await dlg.getByText("Entro con Google y no conozco mi contraseña").click();
  L.check("GOO: ya no pide la contraseña", (await page.locator("#da-pass").count()) === 0);
  L.check("GOO: pide el código de la app", await page.locator("#da-code").isVisible());
  L.check("GOO: el foco va al código", await page.evaluate(() => document.activeElement?.id === "da-code"));
  await dlg.getByLabel("Borrar también estos proyectos").check();
  L.check("GOO: al marcar la casilla, avisa de que no se pueden recuperar", (await dlg.innerText()).includes("Se borrarán con todas sus tareas, releases y adjuntos, y no se pueden recuperar."));
  await page.fill("#da-word", "BORRAR");
  const submit = dlg.getByRole("button", { name: "Borrar mi cuenta" });
  L.check("GOO: sin código no se puede borrar", await submit.isDisabled());
  await page.fill("#da-code", "000000" === totp(secret) ? "111111" : "000000");
  await submit.click();
  await L.eqEventually("GOO: código incorrecto: aviso", async () => (await page.locator("body").innerText()).includes("Código incorrecto o caducado."), true);
  L.eq("GOO: con el código incorrecto la cuenta sigue", await userCount(id), 1);
  await page.fill("#da-code", totp(secret));
  await page.screenshot({ path: `${SHOTS}/r50-baja-google.png` });
  await submit.click();
  await page.waitForURL(/\/login\?info=account_deleted/, { timeout: 20000 });
  L.eq("GOO: la cuenta ya no existe", await userCount(id), 0);
  L.eq("GOO: sus dos proyectos privados se han borrado con ella", (await L.q(`SELECT count(*)::int n FROM "Project" WHERE id IN ('r49_goo_a','r49_goo_b')`))[0].n, 0);
  L.assertNoErrors("GOO", [s]);
  await s.ctx.close();
}

// --- Administración → Usuarios → Borrar: la misma regla y la misma casilla -------------------------------------------
if (only.includes("admin")) {
  L.scenario("admin: borrar usuarios con proyectos privados");
  const targets = [["r49_adm_keep", "r49-adm-keep@example.com", "Se Va Y Deja"], ["r49_adm_drop", "r49-adm-drop@example.com", "Se Va Y Borra"]];
  for (const [id, email, name] of targets) {
    await person(id, email, name);
    await L.q(`DELETE FROM "Project" WHERE id=$1`, [`${id}_p`]);
    await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId","updatedAt") VALUES ($1,$2,true,$3,NOW())`, [`${id}_p`, `Privado de ${name}`, id]);
    await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [`${id}_p`, id]);
  }
  const s = await L.session({ email: L.USER2 });
  await L.q(`UPDATE "User" SET role='ADMIN' WHERE id='qa_user_2'`);
  const { page } = s;
  const remove = async (name, alsoProjects) => {
    await page.goto(`${L.BASE}/admin/users`);
    await page.getByRole("button", { name: `Borrar ${name}` }).click();
    const dlg = page.getByRole("dialog", { name: `Borrar a ${name}` });
    await dlg.waitFor();
    const box = dlg.getByTestId("delete-user-private");
    const text = await box.innerText();
    L.check(`ADM ${name}: avisa de que su proyecto privado pasa a ser de equipo`, text.includes("Es el único miembro de 1 proyecto privado.") && text.includes("Pasará a ser un proyecto de equipo, sin miembros: lo verán los administradores."), text);
    L.check(`ADM ${name}: sin el nombre del proyecto (los administradores no lo ven)`, !text.includes("Privado de"), text);
    if (alsoProjects) {
      await dlg.getByLabel("Borrar también este proyecto").check();
      L.check(`ADM ${name}: al marcar, avisa de que se borra`, (await box.innerText()).includes("Se borrarán con todas sus tareas, releases y adjuntos"));
      await page.screenshot({ path: `${SHOTS}/r50-admin-borrar.png` });
    }
    await dlg.getByRole("button", { name: "Borrar usuario", exact: true }).click();
    await dlg.waitFor({ state: "hidden", timeout: 15000 });
  };
  await remove("Se Va Y Deja", false);
  L.eq("ADM: la cuenta sin marcar ya no existe", await userCount("r49_adm_keep"), 0);
  L.eq("ADM: su proyecto pasa a ser de equipo", (await L.q(`SELECT "isPrivate" FROM "Project" WHERE id='r49_adm_keep_p'`))[0]?.isPrivate, false);
  await page.goto(`${L.BASE}/admin/users`);
  await remove("Se Va Y Borra", true);
  L.eq("ADM: la cuenta marcada ya no existe", await userCount("r49_adm_drop"), 0);
  L.eq("ADM: su proyecto se ha borrado", (await L.q(`SELECT count(*)::int n FROM "Project" WHERE id='r49_adm_drop_p'`))[0].n, 0);
  L.assertNoErrors("ADM", [s]);
  await s.ctx.close();
  await L.q(`UPDATE "User" SET role='MEMBER' WHERE id='qa_user_2'`);
  await L.q(`DELETE FROM "Project" WHERE id='r49_adm_keep_p'`);
}

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
