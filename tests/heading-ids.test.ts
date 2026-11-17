// Títulos del visor de Markdown de la Documentación: cada uno con su id, para que «otro.md#apartado» llegue al apartado.
import assert from "node:assert/strict";
import { test } from "node:test";
import { headingIdForHash, rehypeHeadingIds } from "../src/lib/heading-ids";

// Árbol hast como el que react-markdown pasa a sus plugins de rehype (`npm test` corre con la condición react-server,
// donde react-markdown no se puede importar).
const text = (value: string) => ({ type: "text", value });
const el = (tagName: string, ...children: object[]) => ({ type: "element", tagName, properties: {}, children });
const ids = (tree: { children: { tagName: string; properties: { id?: string } }[] }) => tree.children.map((n) => `${n.tagName}:${n.properties.id ?? ""}`);

test("cada título lleva un id con el slug de la web (sin tildes), con prefijo y sin repetirse", () => {
  const tree = {
    type: "root",
    children: [
      el("h1", text("Instalación rápida")),
      el("p", text("texto")),
      el("h2", text("Uso "), el("em", text("básico")), text(" con "), el("code", text("npm"))),
      el("h2", text("Instalación rápida")),
      el("h3", text("¿?")),
    ],
  };
  rehypeHeadingIds()(tree as never);
  assert.deepEqual(ids(tree as never), ["h1:md-instalacion-rapida", "p:", "h2:md-uso-basico-con-npm", "h2:md-instalacion-rapida-2", "h3:md-seccion"]);
});

test("el #apartado de la dirección se busca por el mismo slug (a mano, con tildes o codificado)", () => {
  assert.equal(headingIdForHash("#instalacion-rapida"), "md-instalacion-rapida");
  assert.equal(headingIdForHash("#Instalaci%C3%B3n-r%C3%A1pida"), "md-instalacion-rapida");
  assert.equal(headingIdForHash("#instalación-rápida-2"), "md-instalacion-rapida-2");
  assert.equal(headingIdForHash("#%E0%A4%A"), "md-e0-a4-a");
  assert.equal(headingIdForHash(""), null);
  assert.equal(headingIdForHash("#"), null);
});
