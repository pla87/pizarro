// Pegados enormes o maliciosos: tablas que desbordaban la pila o se multiplicaban con celdas combinadas, HTML que tardaba
// un tiempo cuadrático en leerse, el aviso de las subtareas que no caben y los permisos de los workflows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { htmlHasText } from "../src/lib/clipboard-files";
import { htmlTableToMarkdown, MAX_TABLE_CELLS, MAX_TABLE_HTML, replaceHtmlTables, tablesOnlyMarkdown } from "../src/lib/paste-table";
import { subtaskBatch } from "../src/lib/subtask-lines";

/** Milisegundos que tarda `fn`. Los límites de abajo son holgados (antes del arreglo eran segundos o más). */
function ms(fn: () => unknown): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

test("una tabla con muchísimas filas no desborda la pila: pasa del tope de celdas y se pega como antes", () => {
  const rows = "<tr><td>a</td><td>b</td></tr>".repeat(130_000);
  assert.equal(tablesOnlyMarkdown(`<table>${rows}</table>`), null);
  assert.equal(htmlTableToMarkdown(`<table>${rows}</table>`), null);
  // Por debajo del tope se sigue convirtiendo.
  const md = tablesOnlyMarkdown(`<table>${"<tr><td>a</td><td>b</td></tr>".repeat(1000)}</table>`);
  assert.ok(md?.startsWith("| a | b |\n| --- | --- |"));
});

test("celdas combinadas que se multiplican (300 de 100×100): no se convierte la tabla", () => {
  const html = `<table>${'<tr><td colspan="100" rowspan="100">x</td></tr>'.repeat(300)}</table>`;
  assert.equal(replaceHtmlTables(html), html);
  assert.equal(htmlTableToMarkdown(html), null);
  // En el tope justo, sí.
  const cols = MAX_TABLE_CELLS / 500;
  const ok = `<table>${`<tr>${"<td>c</td>".repeat(cols)}</tr>`.repeat(500)}</table>`;
  assert.ok(htmlTableToMarkdown(ok));
  assert.equal(htmlTableToMarkdown(ok.replace("<td>c</td>", '<td colspan="2">c</td>')), null);
});

test("HTML de más de 2 MB: no se buscan tablas (se pega como antes)", () => {
  const table = "<table><tr><td>a</td><td>b</td></tr></table>";
  const big = table + `<p>${"x".repeat(MAX_TABLE_HTML)}</p>`;
  assert.equal(replaceHtmlTables(big), big);
  assert.equal(tablesOnlyMarkdown(big), null);
  assert.notEqual(replaceHtmlTables(table), table);
});

test("muchos «<» sin cerrar no tardan un tiempo cuadrático", () => {
  const html = "<table><tr><td>a</td><td>b</td></tr></table>" + "<a".repeat(60_000);
  let out = "";
  const took = ms(() => (out = replaceHtmlTables(html)));
  assert.ok(took < 1500, `tardó ${Math.round(took)} ms`);
  assert.ok(out.startsWith('<table data-md-table="| a | b |'));
  // Un «>» dentro de comillas sigue sin cerrar la etiqueta.
  assert.equal(htmlTableToMarkdown('<table><tr><td title="a>b">x</td><td>y</td></tr></table>'), "| x | y |\n| --- | --- |");
});

test("htmlHasText: <style> o «<» sin cerrar, en tiempo lineal y con el mismo resultado", () => {
  let took = ms(() => assert.equal(htmlHasText("<style>".repeat(60_000)), false));
  assert.ok(took < 1500, `<style>: tardó ${Math.round(took)} ms`);
  took = ms(() => assert.equal(htmlHasText("<a".repeat(100_000)), true));
  assert.ok(took < 1500, `«<a»: tardó ${Math.round(took)} ms`);
  // Mismo criterio que antes.
  assert.equal(htmlHasText("<style>p{}</style><img src=x><!-- c --> &nbsp; "), false);
  assert.equal(htmlHasText("<STYLE>p{}</style ><p>&#160;</p>"), false);
  assert.equal(htmlHasText("<script>x</script><head><title>t</title></head><b> hola </b>"), true);
  assert.equal(htmlHasText("<!-- sin cerrar <p>"), false);
  assert.equal(htmlHasText("<style>sin cerrar"), true, "sin cierre, el contenido cuenta como texto (como antes)");
  assert.equal(htmlHasText("a < b"), true);
  assert.equal(htmlHasText(""), false);
});

test("subtareas pegadas: se envían como mucho 100 y las demás cuentan como «no caben»", () => {
  const lines = Array.from({ length: 150 }, (_, i) => `s${i}`);
  const { send, dropped } = subtaskBatch(lines, 100);
  assert.equal(send.length, 100);
  assert.equal(send[99], "s99");
  assert.equal(dropped, 50);
  assert.deepEqual(subtaskBatch(["a", "b"], 100), { send: ["a", "b"], dropped: 0 });
});

test("workflows: la web solo escribe en Pages al desplegar y la release a mano solo desde main", () => {
  const site = readFileSync(".github/workflows/site.yml", "utf8");
  const [top, jobs] = site.split(/^jobs:$/m) as [string, string];
  assert.doesNotMatch(top, /pages: write|id-token: write/, "sin permisos de Pages para todo el workflow");
  const [build, deploy] = jobs.split(/^ {2}deploy:$/m) as [string, string];
  assert.match(build, /permissions:\n\s+contents: read\n/);
  assert.doesNotMatch(build, /pages: write|id-token: write/);
  assert.match(deploy, /pages: write/);
  assert.match(deploy, /id-token: write/);

  const release = readFileSync(".github/workflows/release.yml", "utf8");
  const guard = "if: github.event_name == 'push' || github.ref == 'refs/heads/main'";
  const releaseJobs = release.split(/^jobs:$/m)[1]!.split(/^ {2}(?=\w)/m).filter((j) => j.trim());
  assert.deepEqual(releaseJobs.map((j) => j.split(":")[0]), ["image", "release", "stable"]);
  for (const job of releaseJobs) assert.ok(job.includes(guard), `job sin la condición de main: ${job.split("\n")[0]}`);
});
