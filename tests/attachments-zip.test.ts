import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadAttachmentsZip } from "../src/components/board/attachments-zip";

/** El reintento de «adjuntos cambiados» pasa por el mismo camino que la descarga: el botón vuelve a quedar ocupado. */
test("reintentar la descarga del ZIP vuelve a activar el estado «descargando»", async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { fetch: g.fetch, document: g.document, URL: g.URL };
  let conflicts = 1;
  g.fetch = async (url: string) => {
    if (String(url).includes("plan=1")) return new Response(JSON.stringify({ parts: [{ oversize: false }], maxMb: 10, v: "x" }), { status: 200 });
    if (conflicts-- > 0) return new Response("Los adjuntos han cambiado", { status: 409 });
    return new Response(new Blob(["zip"]), { status: 200 });
  };
  g.document = { createElement: () => ({ click() {} }) };
  g.URL = Object.assign(function () {}, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
  const busy: boolean[] = [];
  let retry: (() => void) | undefined;
  try {
    await downloadAttachmentsZip({
      projectId: "p1", items: [{ taskId: "t1", folder: "adjuntos/01-a" }], fileName: () => "a.zip",
      t: ((s: string) => s) as never, setBusy: (b) => busy.push(b),
      toast: (_m, _k, action) => { retry = action?.onClick; },
    });
    assert.deepEqual(busy, [true, false]);
    assert.ok(retry, "se ofrece Reintentar");
    retry!();
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(busy, [true, false, true, false]);
  } finally {
    Object.assign(g, saved);
  }
});
