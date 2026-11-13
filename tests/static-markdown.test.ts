// Páginas públicas con texto fijo (privacidad, condiciones, licencia): el Markdown se pinta en el servidor
// (StaticMarkdown), así react-markdown y remark (~44 KB comprimidos) no se descargan en el navegador.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (f: string) => readFileSync(f, "utf8");

test("StaticMarkdown es un componente de servidor y comparte los elementos con Markdown", () => {
  const server = read("src/components/ui/StaticMarkdown.tsx");
  assert.doesNotMatch(server, /^["']use client["']/m);
  assert.doesNotMatch(server, /useT|useState|useEffect/);
  for (const f of ["src/components/ui/StaticMarkdown.tsx", "src/components/ui/Markdown.tsx"]) {
    const src = read(f);
    assert.match(src, /markdownComponents\(t\)/, f);
    assert.match(src, /markdownSource\(children\)/, f);
    assert.match(src, /urlTransform=\{safeMarkdownUrl\}/, f);
    assert.match(src, /remarkPlugins=\{\[remarkGfm\]\}/, f);
  }
  assert.doesNotMatch(read("src/components/ui/markdown-parts.tsx"), /^["']use client["']/m);
});

test("privacidad, condiciones y licencia usan StaticMarkdown, no el Markdown del navegador", () => {
  for (const f of ["src/components/auth/LegalPage.tsx", "src/app/licencia/page.tsx"]) {
    const src = read(f);
    assert.match(src, /<StaticMarkdown t=\{t\}>/, f);
    assert.doesNotMatch(src, /components\/ui\/Markdown"/, f);
  }
});
