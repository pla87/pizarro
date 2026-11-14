// Ronda 52, HTML en Documentación: (1) los enlaces entre HTML de la misma Documentación (tema1.html -> «./Tema2.HTML#apartado»,
// con mayúsculas y %20) abren el otro documento en el visor de la app (otra pestaña, el marco sigue sin permisos nuevos) y
// llevan al apartado; vuelta incluida; un enlace a un fichero que no está queda desactivado con su title; un documento de
// OTRO proyecto con el mismo nombre no se abre; (2) los ficheros HTML, texto y Markdown en Latin-1, Windows-1252 y UTF-16 se
// ven con sus tildes y la descarga los entrega tal cual. Misma base y servidor que board-e2e.mjs:
//   cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r52-html-e2e.mjs      # PART=enlaces,codificacion
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as L from "./qa/lib.mjs";
import * as U from "./qa/ui.mjs";
const { sleep } = L;
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const only = (process.env.PART || "enlaces,codificacion").split(",");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "r52-"));

await L.prepareUsers();
await L.cleanBoard();
const p = await L.project();
const [admin] = await L.q(`SELECT id FROM "User" WHERE email=$1`, [L.ADMIN]);
const P2 = "r52_otro_proyecto";
await L.q(`DELETE FROM "Project" WHERE id=$1`, [P2]);
await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1`, [p.id]);
await L.q(`INSERT INTO "Project"(id,name,"isPrivate","privateOwnerId",position,"updatedAt") VALUES ($1,'Otro r52',true,$2,999990,NOW())`, [P2, admin.id]);
await L.q(`INSERT INTO "ProjectMember"("projectId","userId") VALUES ($1,$2)`, [P2, admin.id]);
await L.q(`UPDATE "User" SET locale='ES' WHERE id=$1`, [admin.id]);

const s = await L.session();
const { page } = s;
// Errores de consola esperados: la CSP del marco bloquea lo externo.
const relevant = () => ({ errors: s.errors.filter((e) => !/Content Security Policy|Refused to (load|frame)|Blocked script execution|net::ERR_ABORTED/i.test(e)) });
page.on("dialog", (d) => { s.errors.push(`dialog: ${d.message()}`); void d.dismiss(); });

async function upload(pg, projectId, name, body) {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, body);
  await pg.goto(`${L.BASE}/p/${projectId}/docs`);
  await pg.getByRole("heading", { name: /Documentación/ }).first().waitFor({ timeout: 15000 });
  await pg.locator("input[type=file][aria-label='Subir archivos']").setInputFiles(file);
  await L.waitFor(async () => (await L.q(`SELECT 1 FROM "ProjectDocument" WHERE "projectId"=$1 AND name=$2`, [projectId, name])).length === 1, { timeout: 15000 });
}
const docId = async (projectId, name) => (await L.q(`SELECT id,kind FROM "ProjectDocument" WHERE "projectId"=$1 AND name=$2`, [projectId, name]))[0];
async function openDoc(pg, projectId, name) {
  await pg.goto(`${L.BASE}/p/${projectId}/docs`);
  const d = await docId(projectId, name);
  await pg.locator(`[data-doc-open="${d.id}"]`).first().click();
  const viewer = U.dialog(pg);
  await viewer.getByText(name).first().waitFor();
  return viewer;
}
const page_ = (title) => `<!doctype html><html><head><title>${title}</title></head><body>`;

// --- Enlaces entre HTML de la misma Documentación ----------------------------------------------------------------------------
if (only.includes("enlaces")) {
  L.scenario("enlaces: ida, vuelta, #apartado, inexistente y de otro proyecto");
  const filler = Array.from({ length: 80 }, (_, i) => `<p>Relleno ${i}</p>`).join("");
  const tema1 = `${page_("Tema 1")}<h1>Tema 1 del curso</h1>
<a id="ida" href="./Tema2.HTML#apartado-b">Ir al tema 2 (apartado B)</a>
<a id="sin" href="tema2.html">Tema 2 sin apartado</a>
<a id="espacios" href="tema%20tres.html">Tema tres</a>
<a id="falta" href="inexistente.html">No existe</a>
<a id="ajeno" href="ajeno.html">De otro proyecto</a>
<a id="fuera" href="https://example.com/tema2.html">Externo</a>
<a id="js" href="javascript:alert(1)">js</a>
<a id="interno" href="#abajo">Abajo</a>
<div id="dsd"><template shadowrootmode="open"><a id="sombra" href="tema2.html" onclick="x()">En la sombra</a><link rel="preconnect" href="https://example.com"><link rel="dns-prefetch" href="https://example.com"></template></div>${filler}<h2 id="abajo">Abajo del todo</h2></body></html>`;
  const tema2 = `${page_("Tema 2")}<h1>Tema 2 del curso</h1><a id="vuelta" href="tema1.html">Volver al tema 1</a>${filler}<h2 id="apartado-b">Apartado B</h2><p>Texto del apartado B.</p>${filler}</body></html>`;
  await upload(page, p.id, "tema1.html", tema1);
  await upload(page, p.id, "tema2.html", tema2);
  await upload(page, p.id, "tema tres.html", `${page_("Tres")}<h1>Tema tres del curso</h1></body></html>`);
  // En el otro proyecto: un «ajeno.html» y un «tema2.html» con el mismo nombre que el del primero.
  await upload(page, P2, "ajeno.html", `${page_("Ajeno")}<h1>Documento AJENO</h1></body></html>`);
  await upload(page, P2, "tema2.html", `${page_("Tema 2 ajeno")}<h1>Tema 2 AJENO</h1></body></html>`);
  const d2 = await docId(p.id, "tema2.html");
  const d1 = await docId(p.id, "tema1.html");
  const dTres = await docId(p.id, "tema tres.html");
  const ajeno2 = await docId(P2, "tema2.html");

  const viewer = await openDoc(page, p.id, "tema1.html");
  const frameEl = viewer.locator("iframe[data-testid=doc-html]");
  const frame = page.frameLocator("iframe[data-testid=doc-html]");
  await frame.getByRole("heading", { name: "Tema 1 del curso" }).waitFor({ timeout: 10000 });
  L.eq("ENL: el marco no gana permisos (sandbox igual que antes)", await frameEl.getAttribute("sandbox"), "allow-popups allow-popups-to-escape-sandbox");
  const attr = (id, a) => frame.locator(`#${id}`).getAttribute(a);
  L.eq("ENL: «./Tema2.HTML#apartado-b» apunta al documento de esta Documentación", await attr("ida", "href"), `/p/${p.id}/docs?doc=${d2.id}#apartado-b`);
  L.eq("ENL: «tema2.html» sin apartado", await attr("sin", "href"), `/p/${p.id}/docs?doc=${d2.id}`);
  L.eq("ENL: «tema%20tres.html» (espacio codificado)", await attr("espacios", "href"), `/p/${p.id}/docs?doc=${dTres.id}`);
  L.eq("ENL: los enlaces a documentos se abren aparte y sin acceso a la app", [await attr("ida", "target"), await attr("ida", "rel")], ["_blank", "noopener noreferrer"]);
  for (const id of ["falta", "ajeno"]) {
    L.eq(`ENL: ${id}: sin dirección, desactivado, con su title`, [await attr(id, "href"), await attr(id, "title"), await attr(id, "aria-disabled")], [null, "Enlace a otro archivo que no está en la Documentación", "true"]);
  }
  L.eq("ENL: «ajeno.html» (solo existe en otro proyecto) no apunta a ningún documento", await attr("ajeno", "href"), null);
  L.eq("ENL: el enlace externo sigue igual (otra pestaña)", [await attr("fuera", "href"), await attr("fuera", "target")], ["https://example.com/tema2.html", null]);
  L.eq("ENL: javascript: sigue bloqueado", await frame.locator("#js").getAttribute("href"), null);
  const srcdoc = await frameEl.getAttribute("srcdoc");
  L.check("ENL: la CSP sin red y sin scripts sigue en el marco", srcdoc.includes(`content="default-src 'none'`) && !/<script|onerror=|javascript:/i.test(srcdoc));
  L.check("ENL: ningún id de otro proyecto aparece en el marco", !srcdoc.includes(ajeno2.id));
  // Shadow DOM declarativo (<template shadowrootmode>): DOMParser no lo monta (su contenido no pasa por el saneado), pero el
  // marco sí al leer el srcdoc. Sin quitarlo, sus <link rel=preconnect>, manejadores y enlaces sin resolver llegaban vivos.
  L.check("ENL: sin shadow DOM declarativo ni lo que llevaba dentro (preconnect, onclick, enlace sin resolver)", !/shadowrootmode|<template|preconnect|dns-prefetch"|onclick|id="sombra"/i.test(srcdoc), srcdoc.slice(0, 600));
  L.eq("ENL: el marco no monta ninguna raíz de sombra", await frame.locator("#dsd").evaluate((el) => !!el.shadowRoot), false);

  // Clic en un enlace desactivado: no se abre nada ni cambia la dirección.
  let popped = false;
  const onPopup = () => { popped = true; };
  page.context().on("page", onPopup);
  const url0 = page.url();
  for (const id of ["falta", "ajeno"]) await frame.locator(`#${id}`).click({ force: true }).catch(() => null);
  await sleep(800);
  L.check("ENL: pulsar un enlace desactivado no abre ni navega", !popped && page.url() === url0 && await frameEl.count() === 1);
  page.context().off("page", onPopup);

  // Ida: se abre el documento 2 en el visor de la app, llevando al apartado B.
  const [tab2] = await Promise.all([page.context().waitForEvent("page", { timeout: 10000 }), frame.locator("#ida").click()]);
  await tab2.waitForLoadState();
  const frame2 = tab2.frameLocator("iframe[data-testid=doc-html]");
  await frame2.getByRole("heading", { name: "Tema 2 del curso" }).waitFor({ timeout: 15000 });
  L.check("ENL ida: la pestaña es el visor de la Documentación de este proyecto, con el documento 2", new URL(tab2.url()).pathname === `/p/${p.id}/docs` && new URL(tab2.url()).search === `?doc=${d2.id}` && new URL(tab2.url()).hash === "#apartado-b", tab2.url());
  L.check("ENL ida: es el tema 2 de ESTE proyecto (no el homónimo ajeno)", !(await frame2.locator("h1").allInnerTexts()).join().includes("AJENO"));
  await L.checkEventually("ENL ida: el marco se desplaza al apartado B", async () => await frame2.locator("#apartado-b").evaluate((el) => { const r = el.getBoundingClientRect(); return r.top > -20 && r.top < window.innerHeight; }));
  await tab2.screenshot({ path: `${SHOTS}/r52-ida.png` });
  // Vuelta: desde el tema 2 al tema 1.
  const [tab1] = await Promise.all([tab2.context().waitForEvent("page", { timeout: 10000 }), frame2.locator("#vuelta").click()]);
  await tab1.waitForLoadState();
  await tab1.frameLocator("iframe[data-testid=doc-html]").getByRole("heading", { name: "Tema 1 del curso" }).waitFor({ timeout: 15000 });
  L.eq("ENL vuelta: abre el documento 1", new URL(tab1.url()).search, `?doc=${d1.id}`);
  // «tema2.html» sin apartado: arriba, sin desplazar.
  await tab1.close();
  await tab2.close();

  // Un ?doc= de otro proyecto no abre nada (ni siquiera con su identificador a mano).
  await page.goto(`${L.BASE}/p/${p.id}/docs?doc=${ajeno2.id}`);
  await page.getByRole("heading", { name: /Documentación/ }).first().waitFor({ timeout: 15000 });
  await sleep(500);
  L.eq("ENL: ?doc= de un documento de otro proyecto no abre el visor", await page.locator("iframe[data-testid=doc-html]").count(), 0);
  L.eq("ENL: …y el API de ese documento sigue siendo del otro proyecto (la app no lo mezcla)", (await L.q(`SELECT "projectId" FROM "ProjectDocument" WHERE id=$1`, [ajeno2.id]))[0].projectId, P2);

  // Un documento borrado (papelera) deja de resolverse: el enlace queda desactivado.
  await L.q(`UPDATE "ProjectDocument" SET "deletedAt"=NOW() WHERE id=$1`, [dTres.id]);
  const v2 = await openDoc(page, p.id, "tema1.html");
  void v2;
  await page.frameLocator("iframe[data-testid=doc-html]").getByRole("heading", { name: "Tema 1 del curso" }).waitFor({ timeout: 10000 });
  L.eq("ENL: un documento en la papelera no se enlaza", await page.frameLocator("iframe[data-testid=doc-html]").locator("#espacios").getAttribute("href"), null);
  await L.q(`UPDATE "ProjectDocument" SET "deletedAt"=NULL WHERE id=$1`, [dTres.id]);
  L.assertNoErrors("enlaces", [relevant()]);
}

// --- Codificaciones -----------------------------------------------------------------------------------------------------------
if (only.includes("codificacion")) {
  L.scenario("codificacion: Latin-1, Windows-1252 y UTF-16 con tildes");
  s.errors.length = 0;
  const TXT = "Camión, niño, año, ñandú, ¿qué? Ünïcödé";
  const sinMeta = (t) => `<!doctype html><html><head><title>t</title></head><body><h1>Título ${t}</h1><p id="t">${TXT}</p></body></html>`;
  const files = {
    "latin1.html": Buffer.from(sinMeta("latin1"), "latin1"),
    "win1252.htm": Buffer.from(`<!doctype html><html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>t</title></head><body><h1>Título win</h1><p id="t">${TXT} \x80 \x93comillas\x94</p></body></html>`, "latin1"),
    "metalatin.html": Buffer.from(`<!doctype html><html><head><meta charset="iso-8859-1"><title>t</title></head><body><h1>Título meta</h1><p id="t">${TXT}</p></body></html>`, "latin1"),
    "utf16le.html": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(sinMeta("utf16le"), "utf16le")]),
    "utf16be.html": Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(sinMeta("utf16be"), "utf16le").swap16()]),
    "utf8bom.html": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(sinMeta("utf8bom"))]),
    "nota.txt": Buffer.from(`Nota ${TXT}`, "latin1"),
    "guia.md": Buffer.from(`# Guía ${TXT}\n\nTexto **ñoño** é.\n`, "latin1"),
    "utf16.txt": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`Nota ${TXT}`, "utf16le")]),
    // Un «.html» binario sigue siendo solo descarga.
    "roto.html": Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02]),
  };
  await L.q(`DELETE FROM "ProjectDocument" WHERE "projectId"=$1`, [p.id]);
  for (const [name, body] of Object.entries(files)) await upload(page, p.id, name, body);
  const kinds = Object.fromEntries((await L.q(`SELECT name,kind FROM "ProjectDocument" WHERE "projectId"=$1`, [p.id])).map((d) => [d.name, d.kind]));
  L.eq("COD: tipos de los ficheros subidos", kinds, { "latin1.html": "HTML", "win1252.htm": "HTML", "metalatin.html": "HTML", "utf16le.html": "HTML", "utf16be.html": "HTML", "utf8bom.html": "HTML", "nota.txt": "TEXT", "guia.md": "MARKDOWN", "utf16.txt": "TEXT", "roto.html": "OTHER" });
  const frame = page.frameLocator("iframe[data-testid=doc-html]");
  for (const name of ["latin1.html", "win1252.htm", "metalatin.html", "utf16le.html", "utf16be.html", "utf8bom.html"]) {
    const viewer = await openDoc(page, p.id, name);
    await frame.locator("#t").waitFor({ timeout: 10000 });
    const text = await frame.locator("#t").innerText();
    L.check(`COD: ${name}: tildes y ñ bien en la vista previa`, text.startsWith(TXT), text);
    if (name === "win1252.htm") L.check("COD: win1252.htm: euro y comillas tipográficas", text.includes("€ “comillas”"), text);
    L.check(`COD: ${name}: sin caracteres de sustitución ni BOM`, !/[�﻿]/.test(text) && !/﻿/.test(await viewer.locator("iframe").getAttribute("srcdoc")));
    await page.keyboard.press("Escape");
    await sleep(200);
  }
  // Descarga: el fichero tal cual.
  for (const name of ["latin1.html", "utf16le.html", "nota.txt"]) {
    const d = await docId(p.id, name);
    const r = await page.request.get(`${L.BASE}/api/documents/${d.id}?download=1`);
    L.check(`COD: ${name}: la descarga entrega los bytes originales`, r.status() === 200 && Buffer.compare(await r.body(), files[name]) === 0);
  }
  await openDoc(page, p.id, "latin1.html");
  await frame.locator("#t").waitFor();
  await page.screenshot({ path: `${SHOTS}/r52-latin1.png` });
  await page.keyboard.press("Escape");
  const dl = async (name) => { const v = await openDoc(page, p.id, name); const [d] = await Promise.all([page.waitForEvent("download"), v.getByRole("link", { name: /Descargar/ }).click()]); return fs.readFileSync(await d.path()); };
  L.check("COD: el botón «Descargar» baja el .html Latin-1 tal cual", Buffer.compare(await dl("latin1.html"), files["latin1.html"]) === 0);
  await page.keyboard.press("Escape");
  // Texto y Markdown.
  await openDoc(page, p.id, "nota.txt");
  L.check("COD: nota.txt (Latin-1): tildes bien", (await page.locator("[data-testid=doc-text]").innerText()).includes(TXT));
  await page.keyboard.press("Escape");
  await openDoc(page, p.id, "utf16.txt");
  L.check("COD: utf16.txt (UTF-16 con BOM): tildes bien y sin BOM", (await page.locator("[data-testid=doc-text]").innerText()) === `Nota ${TXT}`);
  await page.keyboard.press("Escape");
  await openDoc(page, p.id, "guia.md");
  const md = await page.locator("[data-testid=doc-markdown]").innerText();
  L.check("COD: guia.md (Latin-1): tildes bien", md.includes(TXT) && md.includes("ñoño é"), md);
  await page.keyboard.press("Escape");
  await openDoc(page, p.id, "roto.html");
  L.check("COD: un .html binario sigue sin vista previa", (await page.locator("iframe[data-testid=doc-html]").count()) === 0 && await U.dialog(page).getByText(/no tiene vista previa/).isVisible());
  L.assertNoErrors("codificacion", [relevant()]);
}

await s.ctx.close();
await L.q(`DELETE FROM "Project" WHERE id=$1`, [P2]);
fs.rmSync(TMP, { recursive: true, force: true });
await L.closeBrowser(); await L.closeDb();
const failed = L.results.filter((r) => !r.pass);
console.log(`\n${L.results.length - failed.length}/${L.results.length} OK`);
for (const f of failed) console.log("FAIL", f.name, f.detail);
process.exitCode = failed.length ? 1 : 0;
