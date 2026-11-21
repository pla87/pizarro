// «no-transform» en el Cache-Control de las páginas HTML (src/lib/html-no-transform.ts), para que Cloudflare no reescriba
// los emails de la página (su «Email Address Obfuscation» respeta esa directiva). Lo pone el gancho de
// src/lib/response-length.ts al escribir las cabeceras, conservando lo que haya puesto Next.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { applyHtmlNoTransform, isHtmlContentType, withNoTransform } from "../src/lib/html-no-transform";
import { installDeclaredLength } from "../src/lib/response-length";

test("withNoTransform: se añade a lo que haya, sin repetirlo", () => {
  assert.equal(withNoTransform("private, no-cache, no-store, max-age=0, must-revalidate"), "private, no-cache, no-store, max-age=0, must-revalidate, no-transform");
  assert.equal(withNoTransform("s-maxage=31536000"), "s-maxage=31536000, no-transform");
  assert.equal(withNoTransform("no-store, No-Transform"), "no-store, No-Transform");
  assert.equal(withNoTransform(""), "no-transform");
  assert.equal(withNoTransform(undefined), "no-transform");
});

test("solo en text/html: JSON, descargas y RSC no se tocan", () => {
  assert.equal(isHtmlContentType("text/html; charset=utf-8"), true);
  assert.equal(isHtmlContentType(["TEXT/HTML"]), true);
  for (const ct of ["application/json", "text/x-component", "application/octet-stream", "text/plain", undefined, 5]) assert.equal(isHtmlContentType(ct), false, String(ct));
  const res = (ct: string | undefined, cc?: string) => {
    const h = new Map<string, string | number | string[]>();
    if (ct) h.set("content-type", ct);
    if (cc) h.set("cache-control", cc);
    return { h, getHeader: (n: string) => h.get(n), setHeader: (n: string, v: string | number | readonly string[]) => (h.set(n, v as string), undefined as never) };
  };
  const page = res("text/html; charset=utf-8", "private, no-cache, no-store, max-age=0, must-revalidate");
  applyHtmlNoTransform(page);
  assert.equal(page.h.get("cache-control"), "private, no-cache, no-store, max-age=0, must-revalidate, no-transform");
  const json = res("application/json", "no-store");
  applyHtmlNoTransform(json);
  assert.equal(json.h.get("cache-control"), "no-store");
  const bare = res(undefined);
  applyHtmlNoTransform(bare);
  assert.equal(bare.h.has("cache-control"), false);
});

test("con el gancho del servidor instalado: las páginas HTML salen con no-transform; el resto, igual", async () => {
  installDeclaredLength();
  const server = http.createServer((req, res) => {
    if (req.url === "/page") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate");
      res.write("<html>");
      res.end("</html>");
    } else {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end("{}");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { port } = server.address() as AddressInfo;
    const get = (p: string) =>
      new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}${p}`, (res) => {
          res.resume();
          res.on("end", () => resolve(res.headers));
        }).on("error", reject);
      });
    assert.equal((await get("/page"))["cache-control"], "private, no-cache, no-store, max-age=0, must-revalidate, no-transform");
    assert.equal((await get("/api"))["cache-control"], "no-store");
  } finally {
    server.close();
  }
});
