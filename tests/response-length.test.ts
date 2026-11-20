// Content-Length de las descargas en flujo: Next lo quita al copiar la respuesta de una ruta; la ruta lo declara en una
// cabecera interna y el gancho del servidor lo vuelve a poner (src/lib/response-length.ts).
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { applyDeclaredLength, DECLARED_LENGTH_HEADER, installDeclaredLength } from "../src/lib/response-length";

test("applyDeclaredLength: la cabecera interna pasa a Content-Length; un valor raro o un cuerpo comprimido, no", () => {
  const res = () => {
    const h = new Map<string, string>();
    return {
      h,
      getHeader: (n: string): string | undefined => h.get(n),
      removeHeader: (n: string) => void h.delete(n),
      setHeader: (n: string, v: string) => (h.set(n, v), undefined as never),
      hasHeader: (n: string) => h.has(n),
    };
  };
  const a = res();
  a.h.set(DECLARED_LENGTH_HEADER, "1234");
  applyDeclaredLength(a);
  assert.deepEqual([...a.h], [["content-length", "1234"]]);
  const b = res();
  b.h.set(DECLARED_LENGTH_HEADER, "12; x");
  applyDeclaredLength(b);
  assert.deepEqual([...b.h], []);
  const c = res();
  c.h.set(DECLARED_LENGTH_HEADER, "10");
  c.h.set("content-encoding", "gzip");
  applyDeclaredLength(c);
  assert.deepEqual([...c.h], [["content-encoding", "gzip"]]);
});

test("con el gancho instalado, una respuesta en flujo sale con Content-Length y sin la cabecera interna", async () => {
  installDeclaredLength();
  const server = http.createServer((_req, res) => {
    res.setHeader(DECLARED_LENGTH_HEADER, "6");
    res.write("abc");
    res.end("def");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { port } = server.address() as AddressInfo;
    const got = await new Promise<{ headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/`, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ headers: res.headers, body }));
      }).on("error", reject);
    });
    assert.equal(got.body, "abcdef");
    assert.equal(got.headers["content-length"], "6");
    assert.equal(got.headers["transfer-encoding"], undefined);
    assert.equal(got.headers[DECLARED_LENGTH_HEADER], undefined);
  } finally {
    server.close();
  }
});
