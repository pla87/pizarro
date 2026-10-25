// Documentación del proyecto: detección del tipo, nombres, ficheros huérfanos y suma de cuota (sin base de datos).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  confirmDocumentKind, detectDocumentKind, documentDownloadName, documentMime, isPreviewable, looksLikePdf, looksLikeText, sanitizeDocumentName,
} from "../src/lib/document-kind";
import { cleanOrphanFiles, parseUploadName } from "../src/lib/orphan-files";
import { documentPath } from "../src/lib/uploads";

test("detectDocumentKind: por extensión, sin distinguir mayúsculas", () => {
  assert.equal(detectDocumentKind("notas.txt", "text/plain"), "TEXT");
  assert.equal(detectDocumentKind("LEEME.MD", ""), "MARKDOWN");
  assert.equal(detectDocumentKind("guia.markdown", "text/plain"), "MARKDOWN");
  assert.equal(detectDocumentKind("Contrato.PDF", "application/octet-stream"), "PDF");
  assert.equal(detectDocumentKind("foto.JPEG", "image/jpeg"), "IMAGE");
  assert.equal(detectDocumentKind("datos.csv", "text/csv"), "TEXT");
  assert.equal(detectDocumentKind("hoja.xlsx", "application/vnd.ms-excel"), "OTHER");
  assert.equal(detectDocumentKind("paquete.zip", "application/zip"), "OTHER");
});

test("detectDocumentKind: el SVG y el HTML nunca son imagen ni texto previsualizable", () => {
  assert.equal(detectDocumentKind("logo.svg", "image/svg+xml"), "OTHER");
  assert.equal(detectDocumentKind("pagina.html", "text/html"), "OTHER");
  assert.equal(detectDocumentKind("pagina.htm", "text/plain"), "OTHER");
  assert.equal(detectDocumentKind("sin-extension", "image/svg+xml"), "OTHER");
  assert.equal(detectDocumentKind("sin-extension", "text/html"), "OTHER");
});

test("detectDocumentKind: sin extensión se usa el MIME; con extensión desconocida manda la extensión", () => {
  assert.equal(detectDocumentKind("captura", "image/png"), "IMAGE");
  assert.equal(detectDocumentKind("captura", "image/heic"), "OTHER");
  assert.equal(detectDocumentKind("informe", "application/pdf"), "PDF");
  assert.equal(detectDocumentKind("nota", "text/plain; charset=utf-8"), "TEXT");
  assert.equal(detectDocumentKind("nota", "text/markdown"), "MARKDOWN");
  assert.equal(detectDocumentKind("raro.exe", "text/plain"), "OTHER");
});

test("confirmDocumentKind: el contenido manda sobre la extensión", () => {
  const pdf = Buffer.from("%PDF-1.4\n...");
  assert.equal(confirmDocumentKind("PDF", pdf), "PDF");
  assert.equal(confirmDocumentKind("PDF", Buffer.from("<html><script>alert(1)</script></html>")), "OTHER");
  assert.equal(confirmDocumentKind("TEXT", Buffer.from("hola ñandú ✓")), "TEXT");
  assert.equal(confirmDocumentKind("MARKDOWN", Buffer.from("# Título")), "MARKDOWN");
  // Un binario con extensión .txt (bytes nulos o UTF-8 inválido) no se muestra como texto.
  assert.equal(confirmDocumentKind("TEXT", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01])), "OTHER");
  assert.equal(confirmDocumentKind("MARKDOWN", Buffer.from([0xff, 0xfe, 0xfa, 0x41])), "OTHER");
  assert.equal(confirmDocumentKind("OTHER", pdf), "OTHER");
  assert.equal(confirmDocumentKind("IMAGE", Buffer.from("x")), "IMAGE");
});

test("looksLikePdf / looksLikeText: casos límite", () => {
  assert.equal(looksLikePdf(Buffer.from("\n\n%PDF-1.7")), true);
  assert.equal(looksLikePdf(Buffer.from("PDF")), false);
  assert.equal(looksLikeText(Buffer.alloc(0)), true);
  // Un carácter multibyte cortado en el límite de la muestra (64 KB) sigue siendo texto válido.
  const big = Buffer.from("a".repeat(64 * 1024 - 1) + "ñ" + "b".repeat(10));
  assert.equal(looksLikeText(big), true);
});

test("sanitizeDocumentName: quita rutas, caracteres raros y puntos iniciales", () => {
  assert.equal(sanitizeDocumentName("informe final.pdf"), "informe final.pdf");
  assert.equal(sanitizeDocumentName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeDocumentName("C:\\Users\\x\\nota.txt"), "nota.txt");
  assert.equal(sanitizeDocumentName("a<b>c|d?.txt"), "a_b_c_d_.txt");
  assert.equal(sanitizeDocumentName(".hidden"), "hidden");
  assert.equal(sanitizeDocumentName("  ...  "), "documento");
  assert.equal(sanitizeDocumentName(""), "documento");
  assert.equal(sanitizeDocumentName(null), "documento");
  assert.equal(sanitizeDocumentName("ñandú café.md"), "ñandú café.md");
  assert.equal(sanitizeDocumentName("a\n\tb.txt"), "a__b.txt");
  assert.equal(sanitizeDocumentName("x".repeat(300) + ".pdf").length <= 120, true);
});

test("documentMime / documentDownloadName / isPreviewable", () => {
  assert.equal(documentMime("TEXT", "text/html"), "text/plain");
  assert.equal(documentMime("MARKDOWN", "text/html"), "text/markdown");
  assert.equal(documentMime("PDF", "x/y"), "application/pdf");
  assert.equal(documentMime("IMAGE", "image/png"), "image/webp");
  assert.equal(documentMime("OTHER", "application/zip"), "application/zip");
  assert.equal(documentDownloadName("foto.png", "IMAGE"), "foto.webp");
  assert.equal(documentDownloadName("foto.png", "OTHER"), "foto.png");
  assert.equal(isPreviewable("OTHER"), false);
  assert.equal(isPreviewable("PDF"), true);
});

test("documentPath: por id, dentro de documents/, nunca con el nombre del usuario", () => {
  assert.match(documentPath("abc123"), /[\\/]documents[\\/]abc123\.bin$/);
  assert.throws(() => documentPath("../evil"));
  assert.throws(() => documentPath("a/b"));
});

test("huérfanos: documents/ se limpia por separado y no se mezcla con los adjuntos", async () => {
  assert.deepEqual(parseUploadName("abc.bin", "documents"), { id: "abc" });
  assert.equal(parseUploadName("abc.webp", "documents"), null);
  assert.equal(parseUploadName("abc.thumb.webp", "documents"), null);
  const dir = await mkdtemp(path.join(tmpdir(), "pz-docs-"));
  try {
    await mkdir(path.join(dir, "documents"));
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    for (const f of ["documents/vivo.bin", "documents/huerfano.bin", "huerfano2.bin"]) {
      await writeFile(path.join(dir, f), "x");
      await utimes(path.join(dir, f), old, old);
    }
    const report = await cleanOrphanFiles(dir, { attachments: new Set(), releaseAttachments: new Set(), documents: new Set(["vivo"]) });
    assert.equal(report.deleted, 2);
    // Un documento conocido (con fila en la base de datos) no se toca.
    await writeFile(path.join(dir, "documents", "vivo.bin"), "x");
    await utimes(path.join(dir, "documents", "vivo.bin"), old, old);
    const keep = await cleanOrphanFiles(dir, { attachments: new Set(), releaseAttachments: new Set(), documents: new Set(["vivo"]) });
    assert.equal(keep.deleted, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
