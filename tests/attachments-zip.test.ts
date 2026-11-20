import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadAttachmentsZip, zipPollDelay } from "../src/components/board/attachments-zip";

/**
 * El paquete lo descarga el navegador (enlace con el vale del plan) y su error se lee del estado del vale. El reintento de
 * «adjuntos cambiados» pasa por el mismo camino que la descarga: el botón vuelve a quedar ocupado.
 */
test("descarga directa con el vale; reintentar tras un 409 vuelve a activar el estado «descargando»", async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { fetch: g.fetch, document: g.document };
  let conflicts = 1;
  const links: string[] = [];
  g.fetch = async (url: string) => {
    if (String(url).includes("plan=1")) return new Response(JSON.stringify({ parts: [{ oversize: false }], maxMb: 10, v: "0123456789abcdef", ticket: "tk", busy: false }), { status: 200 });
    if (String(url).includes("status=1")) {
      const errors = conflicts-- > 0 ? { 1: { status: 409, message: "Los adjuntos han cambiado" } } : {};
      return new Response(JSON.stringify({ started: [1], done: conflicts < 0 ? [1] : [], errors }), { status: 200 });
    }
    throw new Error(`el paquete no se pide con fetch: ${url}`);
  };
  g.document = {
    createElement: () => { const a: { href?: string; click(): void; remove(): void } = { click() { links.push(a.href!); }, remove() {} }; return a; },
    body: { append() {} },
  };
  const busy: boolean[] = [];
  const toasts: string[] = [];
  let retry: (() => void) | undefined;
  try {
    await downloadAttachmentsZip({
      projectId: "p1", items: [{ taskId: "t1", folder: "adjuntos/01-a" }], fileName: () => "a.zip",
      t: ((s: string) => s) as never, setBusy: (b) => busy.push(b),
      toast: (m, _k, action) => { toasts.push(m); retry = action?.onClick; },
    });
    assert.deepEqual(busy, [true, false]);
    assert.deepEqual(toasts, ["Los adjuntos han cambiado"]);
    assert.deepEqual(links, ["/api/projects/p1/release-attachments?ticket=tk&part=1&v=0123456789abcdef&name=a.zip"]);
    assert.ok(retry, "se ofrece Reintentar");
    retry!();
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(busy, [true, false, true]);
    await new Promise((r) => setTimeout(r, 1200));
    assert.deepEqual(busy, [true, false, true, false]);
    assert.equal(links.length, 2);
    assert.equal(toasts.length, 1, "la segunda va bien: sin aviso");
  } finally {
    Object.assign(g, saved);
  }
});

/**
 * El último paquete también se espera hasta que termina de enviarse entero: si la descarga se corta, falla a medias o se
 * cancela, el vale lo apunta como fallido y la página lo avisa (antes dejaba de mirar en cuanto empezaba).
 */
test("el último paquete se espera hasta el final: un corte a medias se avisa como error", async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { fetch: g.fetch, document: g.document };
  let polls = 0;
  g.fetch = async (url: string) => {
    if (String(url).includes("plan=1")) return new Response(JSON.stringify({ parts: [{ oversize: false }], maxMb: 10, v: "0123456789abcdef", ticket: "tk", busy: false }), { status: 200 });
    // Primera consulta: empezado; segunda: falló al enviarse (cortado).
    const errors = ++polls >= 2 ? { 1: { status: 500, message: "No se pudieron descargar los adjuntos" } } : {};
    return new Response(JSON.stringify({ started: [1], done: [], errors }), { status: 200 });
  };
  g.document = { createElement: () => ({ click() {}, remove() {} }), body: { append() {} } };
  const toasts: [string, string | undefined][] = [];
  try {
    await downloadAttachmentsZip({
      projectId: "p1", items: [{ taskId: "t1", code: "A1" }], fileName: () => "a.zip",
      t: ((s: string) => s) as never, toast: (m, k) => void toasts.push([m, k]),
    });
    assert.equal(polls, 2, "sigue consultando aunque el paquete ya haya empezado");
    assert.deepEqual(toasts, [["No se pudieron descargar los adjuntos", "error"]]);
  } finally {
    Object.assign(g, saved);
  }
});

test("consultas del vale: cada segundo los primeros 5 s y luego cada 3 s", () => {
  assert.deepEqual([0, 1000, 4999, 5000, 60_000].map(zipPollDelay), [1000, 1000, 1000, 3000, 3000]);
});
