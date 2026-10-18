#!/usr/bin/env node
// Genera MANUAL.pdf a partir de docs/MANUAL.md con Chromium (playwright-core).
//
//   npm run docs:pdf
//
// Usa el Chromium indicado en CHROME_PATH o, si no, el que tenga instalado
// Playwright (`npx playwright install chromium`).
import { readFileSync } from "node:fs";
import { marked } from "marked";
import { chromium } from "playwright-core";

const source = readFileSync("docs/MANUAL.md", "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const body = marked.parse(source, { gfm: true });

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Tablón · Manual de operaciones</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: "Inter", "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #0f172a; font-size: 10.5pt; line-height: 1.55; }
  .cover { height: 245mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
  .cover .logo { width: 64px; height: 64px; border-radius: 14px; background: #4f46e5; display: flex; gap: 6px; padding: 14px 12px; align-items: flex-start; }
  .cover .logo span { display: block; width: 10px; border-radius: 3px; background: #fff; }
  .cover h1 { font-size: 34pt; margin: 28px 0 6px; border: 0; letter-spacing: -0.02em; }
  .cover p { font-size: 13pt; color: #475569; margin: 0; }
  .cover .meta { margin-top: 40px; font-size: 10pt; color: #64748b; }
  h1 { font-size: 20pt; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 2px solid #4f46e5; }
  h2 { font-size: 15pt; color: #312e81; margin: 26px 0 8px; page-break-after: avoid; }
  h2:not(:first-of-type) { page-break-before: always; }
  h3 { font-size: 12pt; margin: 18px 0 6px; page-break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  a { color: #4338ca; text-decoration: none; }
  code { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 0.88em; background: #f1f5f9; padding: 1px 4px; border-radius: 4px; }
  pre { background: #0f172a; color: #e2e8f0; padding: 12px 14px; border-radius: 8px; font-size: 8.6pt; line-height: 1.45; overflow: hidden; white-space: pre-wrap; page-break-inside: avoid; }
  pre code { background: none; padding: 0; color: inherit; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 14px; font-size: 9.2pt; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th { background: #eef2ff; color: #312e81; text-align: left; }
  th, td { border: 1px solid #e2e8f0; padding: 5px 7px; vertical-align: top; }
  blockquote { margin: 10px 0; padding: 6px 12px; border-left: 4px solid #a5b4fc; background: #f8fafc; color: #334155; }
  hr { border: 0; border-top: 1px solid #e2e8f0; margin: 18px 0; }
</style></head>
<body>
  <section class="cover">
    <div class="logo"><span style="height:36px"></span><span style="height:24px;background:#c7d2fe"></span><span style="height:14px;background:#a5b4fc"></span></div>
    <h1>Tablón</h1>
    <p>Manual de operaciones</p>
    <p>Arquitectura, guía de uso y procesos operativos</p>
    <div class="meta">Versión de la aplicación v${version}</div>
  </section>
  ${body}
</body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.pdf({
  path: "MANUAL.pdf",
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="width:100%;font-size:8px;color:#94a3b8;padding:0 16mm;display:flex;justify-content:space-between;font-family:system-ui,sans-serif"><span>Tablón · Manual de operaciones · v${version}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
});
await browser.close();
console.log("MANUAL.pdf generado.");
