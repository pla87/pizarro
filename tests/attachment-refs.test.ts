// Enlaces a adjuntos en un texto Markdown: Duplicar e importar un proyecto los apuntan a los adjuntos nuevos.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { remapAttachmentRefs } from "../src/lib/attachment-refs";

test("cambia los ids que están en el mapa y deja los demás", () => {
  const map = new Map([["c1a", "c9z"], ["abc", "def"]]);
  assert.equal(
    remapAttachmentRefs("![x](/api/attachments/c1a) [d](/api/attachments/c1a?download=1) ![y](/api/attachments/otro) ![z](/api/attachments/abc)", map),
    "![x](/api/attachments/c9z) [d](/api/attachments/c9z?download=1) ![y](/api/attachments/otro) ![z](/api/attachments/def)",
  );
});

test("un id no se confunde con otro que empieza igual", () => {
  assert.equal(remapAttachmentRefs("![x](/api/attachments/c1ab)", new Map([["c1a", "c9z"]])), "![x](/api/attachments/c1ab)");
});

test("sin mapa o sin enlaces devuelve el mismo texto", () => {
  assert.equal(remapAttachmentRefs("hola", new Map([["a", "b"]])), "hola");
  assert.equal(remapAttachmentRefs("![x](/api/attachments/a)", new Map()), "![x](/api/attachments/a)");
});

// Imágenes de Markdown: solo se pintan las de un adjunto de la app, con la ruta fija. Comprobar solo el prefijo dejaba
// pasar `/api/attachments/../auth/reset`, que el navegador normaliza y pide desde el mismo origen (cerraba la sesión de
// quien abría la tarea) o cualquier otro GET de la app (informes, ZIP de una versión).
const EVIL = ["/api/attachments/../auth/reset", "/api/attachments/%2e%2e/auth/reset", "/api/attachments/%2E%2E/auth/reset", "/api/attachments/..%2fauth/reset"];

test("isAttachmentSrc: solo /api/attachments/<id>, sin consulta o con ?thumb=1", async () => {
  const { isAttachmentSrc } = await import("../src/lib/attachment-refs");
  for (const ok of ["/api/attachments/abc", "/api/attachments/cmabc123xyz0000def456ghi7", "/api/attachments/abc?thumb=1", "/api/attachments/a_b-c"]) {
    assert.equal(isAttachmentSrc(ok), true, ok);
  }
  for (const bad of [...EVIL, "/api/attachments/a/b", "/api/attachments/", "/api/attachments", "//x", "//example.com/api/attachments/abc", "https://example.com/api/attachments/abc", "/api/attachments/abc#x", "/api/attachments/abc/", " /api/attachments/abc", "/api/attachments/abc\n", "/api/attachments/abc?download=1", "/api/attachments/abc?thumb=1&download=1", "/api/attachments/abc?download=1&thumb=1", "/api/attachments/abc?thumb=2", "/api/attachments/abc?", `/api/attachments/${"a".repeat(41)}`, null, undefined, 1]) {
    assert.equal(isAttachmentSrc(bad), false, JSON.stringify(bad));
  }
});

test("el Markdown pintado (react-markdown, como en la tarea) no saca <img> con una ruta que sale de /api/attachments/", () => {
  // `npm test` corre con la condición react-server, donde no hay react-dom/server ni los hooks de react-markdown: se
  // pinta en un proceso aparte, con el mismo HTML que ve el navegador.
  const script = `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import ReactMarkdown from "react-markdown";
    import remarkGfm from "remark-gfm";
    import { markdownComponents, markdownSource } from "./src/components/ui/markdown-parts";
    import { safeMarkdownUrl } from "./src/lib/safe-url";
    const t = (s, v) => s.replace("{alt}", v?.alt ?? "");
    const text = process.argv[1];
    process.stdout.write(renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], urlTransform: safeMarkdownUrl, components: markdownComponents(t) }, markdownSource(text))));
  `;
  // `?download=1` tampoco: cada apertura de la tarea pedía una «descarga» a nombre de quien la abría.
  const text = [...EVIL.map((s) => `![x](${s})`), "![ok](/api/attachments/abc?thumb=1)", "![dl](/api/attachments/abc?download=1)"].join("\n\n");
  const html = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, text], { encoding: "utf8" });
  assert.deepEqual([...html.matchAll(/<img[^>]*src="([^"]*)"/g)].map((m) => m[1]), ["/api/attachments/abc?thumb=1"], html);
  assert.equal((html.match(/\[imagen: x\]/g) ?? []).length, EVIL.length, html);
  assert.match(html, /\[imagen: dl\]/, html);
});

test("el HTML copiado (markdownToHtml) tampoco lleva esas imágenes", async () => {
  const { markdownToHtml } = await import("../src/lib/markdown-html");
  for (const s of EVIL) {
    const html = markdownToHtml(`![x](${s})`, "https://app.example.com");
    assert.doesNotMatch(html, /<img/, s);
  }
  assert.match(markdownToHtml("![ok](/api/attachments/abc)", "https://app.example.com"), /<img alt="ok" src="https:\/\/app\.example\.com\/api\/attachments\/abc">/);
});
