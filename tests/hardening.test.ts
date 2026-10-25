// Endurecimientos sueltos: tope del cuerpo de subida, buzón de pruebas, origen de las peticiones y enlaces Markdown.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SESSION_SECRET ??= "x".repeat(48);
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const { maxUploadMb, proxyBodyLimitBytes } = await import("../src/lib/upload-size");
const { outboxDir } = await import("../src/lib/mail");
const { isSameOrigin } = await import("../src/lib/request");
const { safeMarkdownUrl } = await import("../src/lib/safe-url");

const MB = 1024 * 1024;

test("tope del proxy: siempre por encima de MAX_UPLOAD_MB (más el envoltorio multipart)", () => {
  assert.equal(maxUploadMb(undefined), 20);
  assert.equal(maxUploadMb(""), 20);
  assert.equal(maxUploadMb("abc"), 20);
  assert.equal(maxUploadMb("0"), 20);
  assert.equal(maxUploadMb("35"), 35);
  for (const mb of [1, 12, 20, 35, 2.5]) {
    const limit = proxyBodyLimitBytes(mb);
    assert.ok(limit >= mb * MB + 64 * 1024, `${mb} MB: el proxy no puede cortar un archivo que la ruta acepta`);
    assert.ok(limit <= mb * MB + 2 * MB);
  }
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
