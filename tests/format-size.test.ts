// Tamaños legibles: los de la interfaz (Ajustes → Adjuntos, detalle de la tarea) y los de los mensajes del registro.
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSize, logSize } from "../src/lib/format-size";

test("formatSize: KB por debajo de 1 MB (nunca «0 KB» si hay algo), MB y GB", () => {
  assert.equal(formatSize(0), "0 KB");
  assert.equal(formatSize(10), "1 KB");
  assert.equal(formatSize(340 * 1024), "340 KB");
  assert.equal(formatSize(2.34 * 1024 * 1024), "2,3 MB");
  assert.equal(formatSize(2.34 * 1024 * 1024, "en-US"), "2.3 MB");
  assert.equal(formatSize(1.25 * 1024 ** 3), "1,25 GB");
});

test("logSize: bytes por debajo de 1 KB (antes «subido (0 KB)»), KB redondeados por encima", () => {
  assert.equal(logSize(0), "0 B");
  assert.equal(logSize(312), "312 B");
  assert.equal(logSize(1024), "1 KB");
  assert.equal(logSize(5 * 1024 * 1024), "5120 KB");
});
