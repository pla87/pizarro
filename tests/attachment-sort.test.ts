import assert from "node:assert/strict";
import { test } from "node:test";
import { sortByFileName } from "../src/lib/attachment-sort";

const names = (l: { originalName: string }[]) => l.map((a) => a.originalName);

test("adjuntos: orden alfabético natural, sin mayúsculas ni acentos", () => {
  const list = ["foto 10.png", "Árbol.pdf", "foto 2.png", "zeta.txt", "acta.docx", "Foto 1.png", "éxito.md", "Banco.xlsx"].map((originalName) => ({ originalName }));
  assert.deepEqual(names(sortByFileName(list, (a) => a.originalName, "es")), [
    "acta.docx", "Árbol.pdf", "Banco.xlsx", "éxito.md", "Foto 1.png", "foto 2.png", "foto 10.png", "zeta.txt",
  ]);
});

test("adjuntos: nombres iguales conservan el orden de llegada y no se toca la lista original", () => {
  const list = [{ originalName: "captura.png", id: "b" }, { originalName: "Captura.png", id: "a" }, { originalName: "a.png", id: "c" }];
  const sorted = sortByFileName(list, (a) => a.originalName, "es");
  assert.deepEqual(sorted.map((a) => a.id), ["c", "b", "a"]);
  assert.deepEqual(list.map((a) => a.id), ["b", "a", "c"]);
});
