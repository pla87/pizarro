// Resaltar lo buscado en el histórico de releases (search-highlight.ts): la misma regla que la búsqueda (sin mayúsculas ni
// tildes), con las posiciones del texto original, y el plugin de rehype que marca los nodos de texto del Markdown.
import assert from "node:assert/strict";
import { test } from "node:test";
import { foldQuery, highlightParts, highlightRanges, rehypeSearchHighlight } from "../src/lib/search-highlight";
import { normalizeSearch } from "../src/lib/search-accents";
import { assertFast } from "./timing";

type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] };
const text = (value: string): Node => ({ type: "text", value });
const el = (tagName: string, ...children: Node[]): Node => ({ type: "element", tagName, properties: {}, children });
const root = (...children: Node[]): Node => ({ type: "root", children });
/** El árbol como HTML mínimo, para comparar. */
const html = (n: Node): string =>
  n.type === "text" ? n.value! : n.type === "root" ? n.children!.map(html).join("") : `<${n.tagName}${n.tagName === "mark" ? ` class="${(n.properties!.className as string[]).join(" ")}"` : n.properties?.href ? ` href="${String(n.properties.href)}"` : ""}>${n.children!.map(html).join("")}</${n.tagName}>`;
const run = (tree: Node, query: string) => (rehypeSearchHighlight(query)(tree as never), html(tree));

test("highlightRanges: sin distinguir mayúsculas ni tildes, con las posiciones del original", () => {
  const s = "Desplegable, despleGáble y desplegable";
  const hits = highlightRanges(s, "desplegable").map(([a, b]) => s.slice(a, b));
  assert.deepEqual(hits, ["Desplegable", "despleGáble", "desplegable"]);
  // Lo buscado con tildes encuentra lo escrito sin ellas (y al revés).
  assert.deepEqual(highlightRanges("CANCION y canción", "Canción").map(([a, b]) => "CANCION y canción".slice(a, b)), ["CANCION", "canción"]);
  // Una tilde escrita como marca combinante (e + U+0301) entra en el tramo resaltado.
  const nfd = "café solo";
  assert.deepEqual(highlightRanges(nfd, "café"), [[0, 5]]);
  // Caracteres fuera del BMP antes de la coincidencia no desplazan las posiciones.
  const emoji = "🚀 Ñandú";
  assert.deepEqual(highlightRanges(emoji, "nandu").map(([a, b]) => emoji.slice(a, b)), ["Ñandú"]);
  assert.deepEqual(highlightRanges("algo", ""), []);
  assert.deepEqual(highlightRanges("algo", "   "), []);
  assert.deepEqual(highlightRanges("", "a"), []);
  // Sin solaparse: «aa» en «aaa» es una.
  assert.deepEqual(highlightRanges("aaa", "aa"), [[0, 2]]);
});

test("foldQuery pliega como normalizeSearch (la regla de los buscadores del navegador)", () => {
  for (const q of ["Canción", "PINGÜINO", "Ñandú Çà", "despleGáble", "İstanbul"]) assert.equal(foldQuery(q), normalizeSearch(q), q);
});

test("highlightParts: trozos con y sin coincidencia, en orden", () => {
  assert.deepEqual(highlightParts(" Release desplegable", "DESPLEGABLE"), [{ text: " Release ", hit: false }, { text: "desplegable", hit: true }]);
  assert.deepEqual(highlightParts("nada", "x"), [{ text: "nada", hit: false }]);
  assert.deepEqual(highlightParts("ab", "ab"), [{ text: "ab", hit: true }]);
});

test("rehype: marca en los nodos de texto, dentro de los enlaces sin tocar su destino", () => {
  const tree = root(el("p", text("Ver el "), { ...el("a", text("menú desplegable")), properties: { href: "https://example.com/desplegable" } }, text(" y otro Desplegable.")));
  assert.equal(run(tree, "desplegable"), '<p>Ver el <a href="https://example.com/desplegable">menú <mark class="search-hit">desplegable</mark></a> y otro <mark class="search-hit">Desplegable</mark>.</p>');
});

test("rehype: una coincidencia que cruza una negrita se marca a trozos; un párrafo o un salto de línea la cortan", () => {
  assert.equal(run(root(el("p", text("foo "), el("strong", text("bar")), text(" baz"))), "foo bar"), '<p><mark class="search-hit">foo </mark><strong><mark class="search-hit">bar</mark></strong> baz</p>');
  assert.equal(run(root(el("p", text("foo")), el("p", text("bar"))), "foobar"), "<p>foo</p><p>bar</p>");
  assert.equal(run(root(el("p", text("foo"), el("br"), text("bar"))), "foobar"), "<p>foo<br></br>bar</p>");
  // Sin búsqueda o sin coincidencias, el árbol no cambia.
  assert.equal(run(root(el("p", text("foo"))), ""), "<p>foo</p>");
  assert.equal(run(root(el("p", text("foo"))), "zzz"), "<p>foo</p>");
});

test("rehype: una release de 300 tareas con miles de coincidencias (unas 9.000) se marca enseguida", () => {
  const build = () =>
    root(
      el("h3", text("Funcionalidad")),
      el(
        "ul",
        ...Array.from({ length: 300 }, (_, i) =>
          el(
            "li",
            el("p", el("strong", text(`R12F${i + 1}`)), text(` · Menú desplegable de la tarea ${i + 1}`)),
            el("p", text("Adjuntos: "), { ...el("a", text(`captura-${i + 1}.webp`)), properties: { href: `/api/attachments/a${i}` } }),
            el("p", text("Descripción larga con un Desplegable, otro despleGáble y una lista: ".repeat(4))),
          ),
        ),
      ),
    );
  const out = assertFast(250, () => run(build(), "a"), "300 tareas, búsqueda «a»:");
  assert.ok((out.match(/<mark /g) ?? []).length > 8000);
  const words = run(build(), "desplegable");
  assert.equal((words.match(/<mark /g) ?? []).length, 300 * 9);
});
