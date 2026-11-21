// Formato del CSV de logs (Administración → Logs → Descargar CSV): separador según el idioma, escapado y fórmulas.
import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, csvDateParam, csvRow, csvSeparator, parseLogCsvError } from "../src/lib/log-csv";

test("separador: «;» en español (Excel en español), «,» en inglés", () => {
  assert.equal(csvSeparator("es"), ";");
  assert.equal(csvSeparator("en"), ",");
});

test("celdas siempre entre comillas: «;», «,», comillas y saltos de línea no rompen la fila", () => {
  assert.equal(csvCell("a;b"), '"a;b"');
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('dijo "hola"'), '"dijo ""hola"""');
  assert.equal(csvCell("línea 1\r\nlínea 2"), '"línea 1\r\nlínea 2"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
  assert.equal(csvCell(42), '"42"');
  assert.equal(csvCell({ a: "x;y" }), '"{""a"":""x;y""}"');
  assert.equal(csvRow(["a;1", "b", null], ";"), '"a;1";"b";""');
  assert.equal(csvRow(["a,1", "b"], ","), '"a,1","b"');
});

test("inyección de fórmulas: =, +, -, @, tabulador y CR al principio llevan «'» delante", () => {
  for (const s of ["=SUM(A1)", "+1", "-1", "@cmd", "\tx", "\rx"]) assert.equal(csvCell(s), `"'${s}"`);
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  // En medio no es una fórmula.
  assert.equal(csvCell("a=b"), '"a=b"');
});

test("vuelta a la página: solo motivos y fechas conocidos", () => {
  assert.equal(parseLogCsvError("rate"), "rate");
  assert.equal(parseLogCsvError("busy"), "busy");
  assert.equal(parseLogCsvError("otro"), null);
  assert.equal(parseLogCsvError(["rate"]), null);
  assert.equal(csvDateParam("2026-10-24"), "2026-10-24");
  assert.equal(csvDateParam("2026-10-24<script>"), null);
  assert.equal(csvDateParam(undefined), null);
});
