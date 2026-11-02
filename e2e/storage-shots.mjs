// Capturas de la sección de almacenamiento (Administración → Ajustes y Ajustes del proyecto → Adjuntos y límites) y
// prueba del flujo de borrado. Uso: APP_DIR=. BASE=http://localhost:3371 DATABASE_URL=…/pz_x node e2e/storage-shots.mjs
// Reinicia la base indicada (solo nombres pz_*) y arranca su propio servidor en el puerto de BASE.
import * as L from "./qa/lib.mjs";
import { login as login2fa } from "./login2fa.mjs";

const SHOTS = process.env.SHOTS_DIR || "/tmp";
const MB = 1024 * 1024;
await L.resetDatabase(process.env.APP_DIR);
await L.startServer(process.env.APP_DIR);
let fails = 0;
const ok = (name, c) => {
  console.log(c ? "PASS" : "FAIL", name);
  if (!c) fails++;
};
try {
  const p = await L.project();
  await L.q(`UPDATE "Project" SET "storageQuotaMb"=120 WHERE id=$1`, [p.id]);
  const [u] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
  const cols = await L.columnIds();
  const mkTask = (id, title, archived) =>
    L.q(
      `INSERT INTO "Task"(id,"projectId","columnId","kindId",title,position,"createdById","archivedAt","updatedAt") VALUES ($1,$2,$3,'kind_funcionalidad',$4,1000,$5,$6,NOW())`,
      [id, p.id, cols.Backlog, title, u.id, archived ? new Date(Date.now() - 120 * 86400000) : null],
    );
  await mkTask("tactivex", "Maqueta de la portada", false);
  await mkTask("tarch1x", "Vídeo de la demo antigua", true);
  await mkTask("tarch2x", "Informe anual 2023", true);
  const att = (id, task, name, size, img) =>
    L.q(`INSERT INTO "TaskAttachment"(id,"taskId","originalName","mimeType","isImage",size,"createdById") VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, task, name, img ? "image/webp" : "video/mp4", img, size, u.id]);
  await att("a1x", "tactivex", "portada.png", 6 * MB, true);
  await att("a2x", "tarch1x", "demo.mp4", 38 * MB, false);
  await att("a3x", "tarch2x", "informe.pdf", 12 * MB, false);
  await L.q(`INSERT INTO "Release"(id,"projectId",number,title,content,"deployedAt") VALUES ('r1x',$1,1,'Primera salida','texto',NOW() - interval '200 days')`, [p.id]);
  await L.q(`INSERT INTO "ReleaseAttachment"(id,"releaseId","fileName",size,"isImage",position) VALUES ('ra1x','r1x','F1_demo.webp',30*1024*1024,true,0)`);
  await L.q(
    `INSERT INTO "ProjectDocument"(id,"projectId",name,"mimeType",size,kind,"createdById","updatedAt","deletedAt") VALUES ('d1x',$1,'manual-viejo.pdf','application/pdf',9*1024*1024,'PDF',$2,NOW(),NOW())`,
    [p.id, u.id],
  );

  // El administrador pide segundo paso (código por email): login2fa.mjs lo resuelve con el buzón de pruebas (MAIL_OUTBOX_DIR).
  const ctx = await (await L.getBrowser()).newContext({ viewport: { width: 1100, height: 1900 }, locale: "es-ES" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 300)));
  await login2fa(page, L.BASE);
  await page.goto(`${L.BASE}/p/${p.id}/settings?tab=adjuntos`);
  await page.getByRole("heading", { name: "Almacenamiento" }).waitFor();
  ok("barra de uso", (await page.getByRole("progressbar", { name: "Almacenamiento usado" }).count()) === 1);
  ok("copias en releases", (await page.getByText("Copias en releases").count()) === 1);
  ok("cuota propia visible", (await page.getByText("Cuota propia de este proyecto.").count()) === 1);
  await page.locator("#almacenamiento").screenshot({ path: `${SHOTS}/proyecto-almacenamiento.png` });

  // Borrar adjuntos de tareas archivadas: el diálogo dice qué se borra y cuánto espacio se libera.
  await page.getByRole("button", { name: "Borrar adjuntos de tareas archivadas" }).click();
  await page.getByRole("dialog").waitFor();
  const msg = await page.getByRole("dialog").innerText();
  ok("diálogo muestra cantidad y tamaño", /2 ficheros/.test(msg) && /50 MB/.test(msg));
  await page.screenshot({ path: `${SHOTS}/proyecto-confirmar.png` });
  await page.getByRole("dialog").getByRole("button", { name: "Borrar adjuntos" }).click();
  await page.getByText(/se han liberado 50 MB/).waitFor();
  ok("filas borradas", Number((await L.q(`SELECT count(*) n FROM "TaskAttachment"`))[0].n) === 1);
  ok("uso actualizado", !!(await page.getByText(/45 MB de 120 MB usados/).waitFor({ timeout: 5000 }).then(() => true, () => false)));
  // Vaciar la papelera de documentación
  await page.getByRole("button", { name: "Vaciar la papelera de documentación" }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Vaciar papelera" }).click();
  await page.getByText(/se han liberado 9 MB/).waitFor();
  ok("papelera vacía", Number((await L.q(`SELECT count(*) n FROM "ProjectDocument"`))[0].n) === 0);
  // Administración → Ajustes
  await page.goto(`${L.BASE}/admin/settings`);
  await page.getByRole("heading", { name: "Almacenamiento" }).waitFor();
  await page.locator("section[aria-labelledby=storage-title]").screenshot({ path: `${SHOTS}/admin-almacenamiento.png` });
  await page.fill("#quota-project", "2048");
  await page.locator("section[aria-labelledby=storage-title]").getByRole("button", { name: "Guardar" }).click();
  await page.getByText("Ajuste guardado.").first().waitFor();
  ok("cuota general guardada", (await L.q(`SELECT value FROM "AppState" WHERE key='uploadQuotaMbPerProject'`))[0]?.value === "2048");
  ok("sin errores de consola", errors.length === 0);
  if (errors.length) console.log(errors);
  await ctx.close();
} finally {
  await L.closeBrowser();
  L.stopServer();
  await L.closeDb();
}
process.exit(fails ? 1 : 0);
