// Textos con un número que también salen con 1: «1 tarjeta», «Se añadió 1 subtarea; 1 no cabe…», y los avisos de
// importación en singular también en inglés (antes «1 títulos eran…», «1 titles were…»).
import assert from "node:assert/strict";
import { test } from "node:test";
import { cardCount, subtasksDidNotFit } from "../src/components/board/count-texts";
import { makeT } from "../src/i18n/core";
import { parseForeign } from "../src/lib/foreign-import/parse";

const es = makeT("es");
const en = makeT("en");

test("contador de tarjetas: 1 en singular, el resto en plural", () => {
  assert.equal(cardCount(es, 1), "1 tarjeta");
  assert.equal(cardCount(es, 0), "0 tarjetas");
  assert.equal(cardCount(es, 7), "7 tarjetas");
  assert.equal(cardCount(en, 1), "1 card");
  assert.equal(cardCount(en, 2), "2 cards");
});

test("subtareas que no caben: las cuatro combinaciones de 1 y varias", () => {
  assert.equal(subtasksDidNotFit(es, 1, 1, 30), "Se añadió 1 subtarea; 1 no cabe (máximo 30 por tarea).");
  assert.equal(subtasksDidNotFit(es, 1, 4, 30), "Se añadió 1 subtarea; 4 no caben (máximo 30 por tarea).");
  assert.equal(subtasksDidNotFit(es, 3, 1, 30), "Se añadieron 3 subtareas; 1 no cabe (máximo 30 por tarea).");
  assert.equal(subtasksDidNotFit(es, 3, 4, 30), "Se añadieron 3 subtareas; 4 no caben (máximo 30 por tarea).");
  assert.equal(subtasksDidNotFit(en, 1, 1, 30), "Added 1 subtask; 1 doesn't fit (maximum 30 per task).");
});

test("avisos de importación con un solo elemento, en singular en los dos idiomas", () => {
  const csv = "title,priority\nA,rarísima\n,alta";
  assert.deepEqual(parseForeign(csv, "csv", { t: es }).warnings.sort(), ["1 fila no tenía título y se ha ignorado.", "1 prioridad no se reconoció y se ha ignorado."]);
  assert.deepEqual(parseForeign(csv, "csv", { t: en }).warnings.sort(), ["1 priority was not recognised and was ignored.", "1 row had no title and was ignored."]);
  // Con varios, el plural de siempre.
  const many = parseForeign("title,priority\nA,rara\nB,rarísima\n,x\n,y", "csv", { t: en }).warnings.sort();
  assert.deepEqual(many, ["2 priorities were not recognised and were ignored.", "2 rows had no title and were ignored."]);
});
