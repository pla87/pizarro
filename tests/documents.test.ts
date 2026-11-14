// Documentación del proyecto: detección del tipo, nombres, ficheros huérfanos y suma de cuota (sin base de datos).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  confirmDocumentKind, decodeDocumentText, detectDocumentKind, documentDownloadName, documentMime, isPreviewable, looksLikePdf, looksLikeText, sanitizeDocumentName,
} from "../src/lib/document-kind";
import { classifyHtmlLink } from "../src/lib/html-doc-links";
import { cleanOrphanFiles, parseUploadName } from "../src/lib/orphan-files";
import { documentPath } from "../src/lib/uploads";
import { documentFailuresMessage } from "../src/components/docs/uploadDocuments";

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

test("detectDocumentKind: el SVG nunca es imagen; el HTML es su propio tipo (vista aislada, nunca como página)", () => {
  assert.equal(detectDocumentKind("logo.svg", "image/svg+xml"), "OTHER");
  assert.equal(detectDocumentKind("sin-extension", "image/svg+xml"), "OTHER");
  assert.equal(detectDocumentKind("pagina.html", "text/html"), "HTML");
  assert.equal(detectDocumentKind("PAGINA.HTM", "text/plain"), "HTML");
  assert.equal(detectDocumentKind("sin-extension", "text/html; charset=utf-8"), "HTML");
  // La extensión manda: un «.svg» o un «.xhtml» declarado como HTML no pasa a serlo.
  assert.equal(detectDocumentKind("logo.svg", "text/html"), "OTHER");
  assert.equal(detectDocumentKind("pagina.xhtml", "text/html"), "OTHER");
  // Formatos del material de un curso: Word y PowerPoint se suben como ficheros para descargar.
  assert.equal(detectDocumentKind("tema.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "OTHER");
  assert.equal(detectDocumentKind("clase.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"), "OTHER");
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
  assert.equal(confirmDocumentKind("MARKDOWN", Buffer.from([0x01, 0x02, 0xfa, 0x41, 0x05, 0x06])), "OTHER");
  // HTML: solo si es texto; un binario con extensión .html queda para descargar.
  assert.equal(confirmDocumentKind("HTML", Buffer.from("<!doctype html><p>Hola</p><script>alert(1)</script>")), "HTML");
  assert.equal(confirmDocumentKind("HTML", Buffer.from([0x00, 0x3c, 0x68])), "OTHER");
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
  // De una ruta absoluta (navegadores antiguos: «C:\fakepath\…») solo queda el nombre.
  assert.equal(sanitizeDocumentName("C:\\Users\\x\\nota.txt"), "nota.txt");
  assert.equal(sanitizeDocumentName("C:\\fakepath\\informe.pdf"), "informe.pdf");
  assert.equal(sanitizeDocumentName("/home/x/nota.md"), "nota.md");
  // Un nombre normal con «\» o «/» no pierde lo anterior: pasan a «_», como en los adjuntos.
  assert.equal(sanitizeDocumentName("Informe 1\\2 final.pdf"), "Informe 1_2 final.pdf");
  assert.equal(sanitizeDocumentName("Ventas Q1/Q2.xlsx"), "Ventas Q1_Q2.xlsx");
  assert.equal(sanitizeDocumentName("../../etc/passwd"), "etc_passwd");
  assert.equal(sanitizeDocumentName("../nuevo<x>.md"), "nuevo_x_.md");
  assert.equal(sanitizeDocumentName("a<b>c|d?.txt"), "a_b_c_d_.txt");
  assert.equal(sanitizeDocumentName(".hidden"), "hidden");
  assert.equal(sanitizeDocumentName("  ...  "), "documento");
  assert.equal(sanitizeDocumentName(""), "documento");
  assert.equal(sanitizeDocumentName(null), "documento");
  assert.equal(sanitizeDocumentName("ñandú café.md"), "ñandú café.md");
  assert.equal(sanitizeDocumentName("a\n\tb.txt"), "a b.txt");
  assert.equal(sanitizeDocumentName("informe (final), v2 & anexo+1 #3.pdf"), "informe (final), v2 & anexo+1 #3.pdf");
  assert.equal(sanitizeDocumentName("x".repeat(300) + ".pdf"), "x".repeat(116) + ".pdf");
  assert.equal(sanitizeDocumentName("x".repeat(300) + ".pdf").length <= 120, true);
});

test("documentMime / documentDownloadName / isPreviewable", () => {
  assert.equal(documentMime("TEXT", "text/html"), "text/plain");
  assert.equal(documentMime("MARKDOWN", "text/html"), "text/markdown");
  assert.equal(documentMime("HTML", "application/octet-stream"), "text/html");
  assert.equal(documentMime("PDF", "x/y"), "application/pdf");
  assert.equal(documentMime("IMAGE", "image/png"), "image/webp");
  assert.equal(documentMime("OTHER", "application/zip"), "application/zip");
  assert.equal(documentDownloadName("foto.png", "IMAGE"), "foto.webp");
  assert.equal(documentDownloadName("foto.png", "OTHER"), "foto.png");
  assert.equal(isPreviewable("OTHER"), false);
  assert.equal(isPreviewable("PDF"), true);
  assert.equal(isPreviewable("HTML"), true);
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

test("varios documentos sin subir: cuáles y por qué, agrupados por motivo", () => {
  const t = (key: string, vars?: Record<string, string | number>) => key.replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? `{${k}}`));
  const quota = "Cuota de almacenamiento del proyecto superada (1,2 de 1 MB).";
  assert.equal(documentFailuresMessage(t, [], 2), null);
  // Un solo archivo en la tanda: solo su motivo (sin repetir el nombre que ya sale en «Subiendo «x»…»).
  assert.equal(documentFailuresMessage(t, [{ name: "a.pdf", error: quota }], 1), quota);
  assert.equal(
    documentFailuresMessage(t, [{ name: "a.pdf", error: quota }, { name: "b.pdf", error: quota }], 2),
    `2 archivos no se han subido a Documentación: «a.pdf», «b.pdf»: ${quota}`,
  );
  assert.equal(
    documentFailuresMessage(t, [{ name: "a.pdf", error: quota }, { name: "vacio.txt", error: "El archivo está vacío." }], 3),
    `2 archivos no se han subido a Documentación: «a.pdf»: ${quota} · «vacio.txt»: El archivo está vacío.`,
  );
  assert.equal(documentFailuresMessage(t, [{ name: "b.pdf", error: quota }], 2), `1 archivo no se ha subido a Documentación: «b.pdf»: ${quota}`);
  const many = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}.pdf`, error: quota }));
  assert.match(documentFailuresMessage(t, many, 8)!, /^8 archivos .*«f4\.pdf» … \+3: Cuota/);
});

test("looksLikeText: Latin-1/Windows-1252 y UTF-16 con BOM son texto; un binario sin nulos tampoco", () => {
  assert.equal(confirmDocumentKind("HTML", Buffer.from("<p>Camión, niño, año</p>", "latin1")), "HTML");
  assert.equal(confirmDocumentKind("TEXT", Buffer.from("Precio: 5\x80 \x93cita\x94", "latin1")), "TEXT");
  assert.equal(confirmDocumentKind("HTML", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("<p>Camión</p>", "utf16le")])), "HTML");
  assert.equal(confirmDocumentKind("HTML", Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from("<p>Camión</p>", "utf16le").swap16()])), "HTML");
  // UTF-16 con BOM pero lleno de controles: binario.
  assert.equal(confirmDocumentKind("TEXT", Buffer.from([0xff, 0xfe, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00])), "OTHER");
  // Sin nulos pero con muchos controles (no es texto).
  assert.equal(confirmDocumentKind("TEXT", Buffer.from(Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? 0x01 : 0xe9)))), "OTHER");
  assert.equal(confirmDocumentKind("TEXT", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01])), "OTHER");
});

test("decodeDocumentText: BOM, charset declarado, UTF-8 y Windows-1252", () => {
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("<p>Camión ñandú</p>", "utf16le")]);
  assert.equal(decodeDocumentText(utf16le, "HTML"), "<p>Camión ñandú</p>");
  assert.equal(decodeDocumentText(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from("Año", "utf16le").swap16()]), "TEXT"), "Año");
  assert.equal(decodeDocumentText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Año")]), "TEXT"), "Año");
  assert.equal(decodeDocumentText(Buffer.from("Año ✓ ñ"), "TEXT"), "Año ✓ ñ");
  // Sin declaración y no UTF-8: Windows-1252 (con comillas y euro).
  assert.equal(decodeDocumentText(Buffer.from("Año \x80 \x93x\x94", "latin1"), "TEXT"), "Año € \u201cx\u201d");
  assert.equal(decodeDocumentText(Buffer.from("Año \x80", "latin1"), "MARKDOWN"), "Año €");
  // Declarado en el HTML (meta charset y http-equiv), con o sin comillas y en mayúsculas.
  assert.equal(decodeDocumentText(Buffer.from('<meta charset="ISO-8859-1"><p>ñ\xe9</p>', "latin1"), "HTML"), '<meta charset="ISO-8859-1"><p>ñé</p>');
  assert.equal(decodeDocumentText(Buffer.from('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=windows-1252"><p>\x93a\x94</p>', "latin1"), "HTML").endsWith("<p>\u201ca\u201d</p>"), true);
  assert.equal(decodeDocumentText(Buffer.from("<meta charset=iso-8859-15><p>\xa4</p>", "latin1"), "HTML").endsWith("<p>€</p>"), true);
  // Declarado UTF-8 pero el contenido no lo es: no se rompe, cae a Windows-1252.
  assert.equal(decodeDocumentText(Buffer.from('<meta charset="utf-8"><p>ñ</p>', "latin1"), "HTML").endsWith("<p>ñ</p>"), true);
  // UTF-16 declarado sin BOM, y codificaciones «replacement» o desconocidas: se ignoran (nunca lanza).
  assert.equal(decodeDocumentText(Buffer.from('<meta charset="utf-16"><p>ñ</p>', "latin1"), "HTML").endsWith("<p>ñ</p>"), true);
  assert.equal(decodeDocumentText(Buffer.from('<meta charset="iso-2022-kr"><p>ñ</p>', "latin1"), "HTML").endsWith("<p>ñ</p>"), true);
  assert.equal(decodeDocumentText(Buffer.from('<meta charset="inventada"><p>ñ</p>', "latin1"), "HTML").endsWith("<p>ñ</p>"), true);
  // En texto y Markdown no se mira el meta.
  assert.equal(decodeDocumentText(Buffer.from("<meta charset=shift_jis>ñ", "latin1"), "TEXT"), "<meta charset=shift_jis>ñ");
  assert.equal(decodeDocumentText(new Uint8Array(0), "HTML"), "");
});

test("classifyHtmlLink: enlaces entre documentos de la misma Documentación", () => {
  const docs = [{ id: "d2", name: "Tema 2.html" }, { id: "d1", name: "tema1.html" }, { id: "d3", name: "TEMA1.HTML" }];
  assert.deepEqual(classifyHtmlLink("#apartado", docs), { type: "internal" });
  assert.deepEqual(classifyHtmlLink("https://example.com/tema1.html", docs), { type: "external" });
  assert.deepEqual(classifyHtmlLink("//example.com/x.html", docs), { type: "external" });
  assert.deepEqual(classifyHtmlLink("mailto:a@example.com", docs), { type: "external" });
  assert.deepEqual(classifyHtmlLink("tema1.html", docs), { type: "document", id: "d1", hash: "" });
  assert.deepEqual(classifyHtmlLink("./tema1.html", docs), { type: "document", id: "d1", hash: "" });
  assert.deepEqual(classifyHtmlLink("../otra/Tema1.HTML?x=1", docs), { type: "document", id: "d1", hash: "" });
  assert.deepEqual(classifyHtmlLink("Tema%202.html#Secci%C3%B3n 3", docs), { type: "document", id: "d2", hash: "#Secci%C3%B3n%203" });
  assert.deepEqual(classifyHtmlLink("tema 2.html#a", docs), { type: "document", id: "d2", hash: "#a" });
  assert.deepEqual(classifyHtmlLink("tema1.html#", docs), { type: "document", id: "d1", hash: "" });
  assert.deepEqual(classifyHtmlLink("tema9.html", docs), { type: "missing" });
  assert.deepEqual(classifyHtmlLink("", docs), { type: "missing" });
  assert.deepEqual(classifyHtmlLink("carpeta/", docs), { type: "missing" });
  assert.deepEqual(classifyHtmlLink("tema1.html%", docs), { type: "missing" });
  // Sin documentos en el proyecto (o solo de otro): nada se resuelve.
  assert.deepEqual(classifyHtmlLink("tema1.html", []), { type: "missing" });
});
