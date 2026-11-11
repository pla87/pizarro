// Endurecimientos sueltos: tope del cuerpo (proxy y subidas), buzón de pruebas, origen de las peticiones y enlaces Markdown.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const { effectiveFileMaxMb, serverUploadCapMb, PROXY_BODY_LIMIT_BYTES } = await import("../src/lib/upload-size");
const { outboxDir } = await import("../src/lib/mail");
const { isSameOrigin } = await import("../src/lib/request");
const { safeMarkdownUrl } = await import("../src/lib/safe-url");
const { config: proxyConfig } = await import("../src/proxy");
const { BodyTooLargeError, readBodyLimited } = await import("../src/lib/upload-slots");

const MB = 1024 * 1024;
const nextRequire = createRequire(import.meta.url);

test("tope del proxy: pequeño (lo que pasa por él son acciones de 1 MB y JSON), no el de los adjuntos", () => {
  assert.ok(PROXY_BODY_LIMIT_BYTES >= 1 * MB + 64 * 1024, "cabe una acción de 1 MB con su envoltorio");
  assert.ok(PROXY_BODY_LIMIT_BYTES <= 4 * MB, "una petición enorme sin cuenta no ocupa su tamaño en memoria");
});

test("matcher del proxy (compilado como lo compila Next): las rutas que reciben archivos quedan fuera, el resto no", () => {
  const { getMiddlewareMatchers } = nextRequire("next/dist/build/analysis/get-page-static-info.js");
  const { getMiddlewareRouteMatcher } = nextRequire("next/dist/shared/lib/router/utils/middleware-route-matcher.js");
  const match = getMiddlewareRouteMatcher(getMiddlewareMatchers(proxyConfig.matcher, {})) as (path: string, req: unknown, query: unknown) => boolean;
  const passes = (path: string) => match(path, { headers: {} }, {});
  for (const path of ["/api/tasks/abc123/attachments", "/api/projects/abc123/documents", "/api/projects/import", "/api/health", "/api/auth/google/callback", "/api/telegram/webhook"]) {
    assert.equal(passes(path), false, `${path} no pasa por el proxy`);
  }
  for (const path of [
    "/", "/login", "/p/abc123", "/api/tasks/abc123/viewers", "/api/tasks/abc123/attachments/x", "/api/tasks/a/b/attachments", "/api/projects/abc123/documents/x",
    "/api/documents/abc123", "/api/attachments/abc123", "/api/projects/abc123/release-attachments", "/api/projects/abc123/export", "/api/client-errors", "/api/projects/importar", "/api/telegram/webhooks", "/api/telegram/webhook/x",
  ]) {
    assert.equal(passes(path), true, `${path} pasa por el proxy`);
  }
});

test("lectura del cuerpo con tope: corta al superarlo aunque no haya Content-Length", async () => {
  const chunked = (parts: number, size: number) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < parts; i++) c.enqueue(new Uint8Array(size).fill(97));
        c.close();
      },
    });
  const post = (body: ReadableStream<Uint8Array> | string, type = "text/plain") =>
    new Request("http://localhost/x", { method: "POST", body, headers: { "content-type": type }, duplex: "half" } as RequestInit);
  assert.equal((await readBodyLimited(post(chunked(4, 1000)), 4000, "text")).length, 4000);
  await assert.rejects(readBodyLimited(post(chunked(5, 1000)), 4000, "text"), BodyTooLargeError);
  // Formulario multipart: dentro del tope se lee igual que req.formData(); por encima, BodyTooLargeError.
  const form = new FormData();
  form.append("file", new File([new Uint8Array(3000).fill(98)], "a.bin"));
  const multipart = new Request("http://localhost/x", { method: "POST", body: form });
  const type = multipart.headers.get("content-type")!;
  const raw = new Uint8Array(await multipart.arrayBuffer());
  const asStream = () => new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < raw.length; i += 512) c.enqueue(raw.slice(i, i + 512)); c.close(); } });
  const file = (await readBodyLimited(post(asStream(), type), raw.length, "formData")).get("file");
  assert.ok(file instanceof File && file.size === 3000);
  await assert.rejects(readBodyLimited(post(asStream(), type), raw.length - 1, "formData"), BodyTooLargeError);
  // Lo que no es un formulario sigue fallando como antes (no como «demasiado grande»).
  await assert.rejects(readBodyLimited(post("hola"), 100, "formData"), (err) => !(err instanceof BodyTooLargeError));
});

test("límite de un archivo: el del proyecto, y MAX_UPLOAD_MB (opcional) solo lo recorta", () => {
  assert.equal(serverUploadCapMb(undefined), null);
  assert.equal(serverUploadCapMb(""), null);
  assert.equal(serverUploadCapMb("abc"), null);
  assert.equal(serverUploadCapMb("0"), null);
  assert.equal(serverUploadCapMb("35"), 35);
  assert.equal(effectiveFileMaxMb(20, undefined), 20);
  assert.equal(effectiveFileMaxMb(60, undefined), 60);
  assert.equal(effectiveFileMaxMb(60, "35"), 35);
  assert.equal(effectiveFileMaxMb(10, "35"), 10, "el tope del servidor no sube el del proyecto");
  assert.equal(effectiveFileMaxMb(10, "no"), 10);
});

test("buzón de pruebas: se ignora en producción salvo permiso explícito", () => {
  assert.equal(outboxDir({ NODE_ENV: "development", MAIL_OUTBOX_DIR: "/tmp/o" }), "/tmp/o");
  assert.equal(outboxDir({ NODE_ENV: "test", MAIL_OUTBOX_DIR: "/tmp/o" }), "/tmp/o");
  assert.equal(outboxDir({ NODE_ENV: "production", MAIL_OUTBOX_DIR: "/tmp/o" }), null);
  assert.equal(outboxDir({ NODE_ENV: "production", MAIL_OUTBOX_DIR: "/tmp/o", MAIL_OUTBOX_IN_PRODUCTION: "1" }), "/tmp/o");
  assert.equal(outboxDir({ NODE_ENV: "development", MAIL_OUTBOX_DIR: "  " }), null);
  assert.equal(outboxDir({ NODE_ENV: "development" }), null);
});

const req = (headers: Record<string, string>) => new Request("http://interno:3000/api/x", { method: "POST", headers });

test("origen: con APP_URL vale su host o la cabecera Host, nunca X-Forwarded-Host", () => {
  const app = "https://pizarro.example.com";
  assert.equal(isSameOrigin(req({ origin: "https://pizarro.example.com", host: "interno:3000" }), app), true);
  assert.equal(isSameOrigin(req({ origin: "http://localhost:3271", host: "localhost:3271" }), app), true);
  assert.equal(isSameOrigin(req({ origin: "https://evil.example", host: "interno:3000", "x-forwarded-host": "evil.example" }), app), false);
  assert.equal(isSameOrigin(req({ origin: "https://evil.example", host: "pizarro.example.com" }), app), false);
  assert.equal(isSameOrigin(req({ host: "pizarro.example.com" }), app), false, "sin Origin no vale");
  assert.equal(isSameOrigin(req({ origin: "null", host: "pizarro.example.com" }), app), false);
});

test("origen: sin APP_URL (desarrollo) se compara con X-Forwarded-Host o Host", () => {
  assert.equal(isSameOrigin(req({ origin: "http://localhost:3000", host: "localhost:3000" }), ""), true);
  assert.equal(isSameOrigin(req({ origin: "https://app.example", host: "interno", "x-forwarded-host": "app.example" }), ""), true);
  assert.equal(isSameOrigin(req({ origin: "https://evil.example", host: "localhost:3000" }), ""), false);
});

test("enlaces Markdown: lista blanca de esquemas", () => {
  for (const ok of ["https://example.com/a?b=1", "http://example.com", "mailto:ana@example.com", "tel:+34600000000", "/api/attachments/abc", "#mention-abc", "#u", "relativa/pagina", "//example.com/x"]) {
    assert.equal(safeMarkdownUrl(ok), ok, ok);
  }
  for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "vbscript:msgbox(1)", "file:///etc/passwd"]) {
    assert.equal(safeMarkdownUrl(bad), "", JSON.stringify(bad));
  }
});

test("/api/auth/reset rechaza la petición iniciada desde otro sitio y acepta la del mismo origen", async () => {
  const { GET } = await import("../src/app/api/auth/reset/route");
  const cross = GET(new Request("http://localhost/api/auth/reset", { headers: { "sec-fetch-site": "cross-site" } }));
  assert.equal(cross.status, 403);
  assert.equal(cross.headers.get("set-cookie"), null);
  for (const site of ["same-origin", "none", null]) {
    const res = GET(new Request("http://localhost/api/auth/reset", { headers: site ? { "sec-fetch-site": site } : {} }));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/login");
  }
});
