// Ronda 57 («Compartir → Pizarro», share_target de la app instalada): el manifiesto lo declara; el POST multipart que
// manda el navegador al compartir (Sec-Fetch-Site: none) se guarda para su dueño y abre «Nueva tarea» en el último
// proyecto usado con el título, el texto y el enlace en la descripción y los archivos adjuntos; crear la tarea sube los
// archivos por el camino de siempre y borra lo compartido. Un formulario de otra web (cross-site) recibe 403 sin guardar
// nada; sin sesión se va al acceso y, al volver, «Nueva tarea» trae los textos (los archivos no se guardan sin sesión).
// Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node tablero-compartir-e2e.mjs
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
const TITLE = "Artículo compartido r57";
const URL_SHARED = "https://example.com/articulo-r57";

await L.prepareUsers();
await L.cleanBoard();
const proj = await L.project();

L.scenario("manifiesto: declara el destino de compartir");
const manifest = await (await fetch(`${L.BASE}/manifest.webmanifest`)).json();
L.eq("MANIFEST: share_target POST multipart a /api/share", [manifest.share_target?.action, manifest.share_target?.method, manifest.share_target?.enctype, manifest.share_target?.params?.files?.[0]?.name], ["/api/share", "POST", "multipart/form-data", "files"]);

L.scenario("compartir con sesión: «Nueva tarea» con todo y crear");
const s = await L.session();
const page = s.page;
await page.goto(`${L.BASE}/p/${proj.id}`);
await L.board(page);
// El POST tal como lo manda el navegador al compartir desde otra app (navegación suya: Sec-Fetch-Site none, sin Origin).
const res = await page.request.post(`${L.BASE}/api/share`, {
  headers: { "sec-fetch-site": "none" },
  multipart: {
    title: TITLE, text: "Míralo cuando puedas", url: URL_SHARED,
    files: { name: "nota.txt", mimeType: "text/plain", buffer: Buffer.from("hola desde otra app") },
  },
  maxRedirects: 0,
});
const loc = res.headers().location ?? "";
L.check("POST: 303 a /share?id=…", res.status() === 303 && /^\/share\?id=[a-z0-9]+$/.test(loc), `${res.status()} ${loc}`);
const shareId = new URL(loc, L.BASE).searchParams.get("id");
// Un segundo archivo (imagen) llega por un formulario de la propia app: navegación POST real del navegador.
await page.evaluate(([png]) => {
  const form = Object.assign(document.createElement("form"), { method: "POST", action: "/api/share", enctype: "multipart/form-data" });
  const input = Object.assign(document.createElement("input"), { type: "file", name: "files", multiple: true });
  const dt = new DataTransfer();
  dt.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], "foto.png", { type: "image/png" }));
  input.files = dt.files;
  form.append(input, Object.assign(document.createElement("input"), { type: "hidden", name: "title", value: "Solo una foto r57" }));
  document.body.append(form);
  form.submit();
}, [PNG.toString("base64")]);
await page.waitForURL(/\/share\?id=/, { timeout: 15000 });
L.check("FORM: el formulario de la propia app también llega a /share", /\/share\?id=[a-z0-9]+/.test(page.url()), page.url());
await U.dialog(page).waitFor({ timeout: 15000 });
await L.eqEventually("FORM: «Nueva tarea» con el título y la foto", async () => [await U.dialog(page).locator('input[id$="-title"]').inputValue(), await U.dialog(page).getByRole("button", { name: "Ver foto.png" }).count()], ["Solo una foto r57", 1]);
// Descartar: se cierra, vuelve al tablero y lo compartido se borra.
await U.dialog(page).getByRole("button", { name: "Cancelar", exact: true }).click();
const discard = page.getByRole("button", { name: "Descartar", exact: true });
if (await discard.waitFor({ timeout: 3000 }).then(() => true, () => false)) await discard.click();
await page.waitForURL(new RegExp(`/p/${proj.id}`), { timeout: 15000, waitUntil: "commit" });
L.check("FORM: al descartar vuelve al tablero", page.url().includes(`/p/${proj.id}`), page.url());

// Ahora el envío con texto, enlace y archivo.
await page.goto(`${L.BASE}${loc}`);
const dlg = U.dialog(page);
await dlg.waitFor({ timeout: 15000 });
await L.eqEventually("SHARE: el título es el compartido", () => dlg.locator('input[id$="-title"]').inputValue(), TITLE);
await L.checkEventually("SHARE: la descripción lleva el texto y el enlace; el archivo está adjunto", async () => {
  const text = await dlg.innerText();
  return [text.includes("Míralo cuando puedas") && text.includes(URL_SHARED) && text.includes("nota.txt"), text.slice(0, 600)];
});
await dlg.getByRole("button", { name: "Crear tarea" }).click();
await L.eqEventually("SHARE: tarea creada en el último proyecto usado, con descripción y el archivo adjunto", async () => {
  const [row] = await L.q(`SELECT t."projectId", t.description, (SELECT count(*)::int FROM "TaskAttachment" a WHERE a."taskId"=t.id) n FROM "Task" t WHERE t.title=$1`, [TITLE]);
  return row ? [row.projectId, row.description.includes(URL_SHARED) && row.description.includes("Míralo cuando puedas"), row.n] : null;
}, [proj.id, true, 1], { timeout: 20000 });
await page.waitForURL(new RegExp(`/p/${proj.id}`), { timeout: 15000, waitUntil: "commit" });
await L.checkEventually("SHARE: de vuelta en el tablero, con la tarea", async () => [(await U.uiOrder(page, L.COL.backlog)).includes(TITLE), await U.uiOrder(page, L.COL.backlog)]);
await L.eqEventually("SHARE: lo compartido ya no está en el servidor", async () => (await page.request.get(`${L.BASE}/api/share/${shareId}/0`)).status(), 404);

// Eligiendo otro proyecto en el selector, al crear se va al tablero de ese proyecto (antes volvía al inicial).
const OTHER = "r57_share_otro";
const [me] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
await L.q(`DELETE FROM "Project" WHERE id=$1`, [OTHER]);
await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,'Zeta compartir',true,$2,999996,NOW())`, [OTHER, me.id]);
await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [OTHER, me.id]);
await L.q(`INSERT INTO "Column"(id,"projectId",name,position) VALUES ($1,$2,'Pendiente',1000)`, [`${OTHER}_col`, OTHER]);
try {
  const res2 = await page.request.post(`${L.BASE}/api/share`, { headers: { "sec-fetch-site": "none" }, multipart: { title: "Compartida en otro r57" }, maxRedirects: 0 });
  await page.goto(`${L.BASE}${res2.headers().location}`);
  await dlg.waitFor({ timeout: 15000 });
  await dlg.getByLabel("Proyecto", { exact: true }).selectOption(OTHER);
  await L.eqEventually("OTRO: con las columnas del proyecto elegido", async () => (await dlg.innerText()).includes("Pendiente"), true);
  await dlg.getByRole("button", { name: "Crear tarea" }).click();
  await L.eqEventually("OTRO: la tarea se crea en el proyecto elegido", async () => (await L.q(`SELECT "projectId" FROM "Task" WHERE title='Compartida en otro r57'`))[0]?.projectId ?? null, OTHER, { timeout: 20000 });
  await page.waitForURL(new RegExp(`/p/${OTHER}`), { timeout: 15000, waitUntil: "commit" }).catch(() => {});
  L.check("OTRO: al cerrar va al tablero de ese proyecto", page.url().includes(`/p/${OTHER}`), page.url());
  await page.locator('[aria-label="Pendiente"]').first().waitFor({ timeout: 20000 });
} finally {
  await page.goto(`${L.BASE}/p/${proj.id}`).catch(() => {});
  await L.q(`DELETE FROM "Project" WHERE id=$1`, [OTHER]);
}

L.assertNoErrors("compartir", [s]);

L.scenario("otra web: un formulario cross-site no guarda nada");
await page.route("https://evil.example.com/**", (route) => route.fulfill({
  contentType: "text/html",
  body: `<form id="f" method="POST" action="${L.BASE}/api/share" enctype="multipart/form-data"><input name="text" value="ataque"></form><script>document.getElementById("f").submit()</script>`,
}));
const blocked = page.waitForResponse((r) => r.url().endsWith("/api/share") && r.request().method() === "POST");
await page.goto("https://evil.example.com/");
L.eq("CSRF: el POST desde otra web recibe 403", (await blocked).status(), 403);
await sleep(300);
L.eq("CSRF: nada nuevo en «Nueva tarea»", await L.q(`SELECT count(*)::int n FROM "Task" WHERE description LIKE '%ataque%'`).then((r) => r[0].n), 0);
await s.ctx.close();

L.scenario("sin sesión: al acceso y de vuelta con los textos");
const ctx = await (await L.getBrowser()).newContext({ locale: "es-ES" });
const anon = await ctx.newPage();
const r2 = await anon.request.post(`${L.BASE}/api/share`, {
  headers: { "sec-fetch-site": "none" },
  multipart: { title: "Sin sesión r57", url: URL_SHARED, files: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") } },
  maxRedirects: 0,
});
const toLogin = r2.headers().location ?? "";
L.check("ANON: 303 al acceso con vuelta a /share", r2.status() === 303 && toLogin.startsWith("/login?next=%2Fshare"), toLogin);
await anon.goto(`${L.BASE}${toLogin}`);
await anon.fill("#email", L.ADMIN); await anon.fill("#password", L.PASSWORD);
await anon.click("button[type=submit]");
await anon.waitForURL(/\/share\?/, { timeout: 20000 });
await U.dialog(anon).waitFor({ timeout: 15000 });
await L.eqEventually("ANON: tras entrar, «Nueva tarea» con el título compartido", () => U.dialog(anon).locator('input[id$="-title"]').inputValue(), "Sin sesión r57");
L.check("ANON: avisa de que el archivo no se guardó sin sesión", await anon.getByText(/Sin sesión no se guardan los archivos compartidos \(1\)/).isVisible());
await ctx.close();

await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
