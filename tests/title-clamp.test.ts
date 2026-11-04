import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTaskLinesInfo } from "../src/lib/bulk";
import { MAX_TITLE } from "../src/lib/constants";
import { clampTitle, titleLength } from "../src/lib/title-clamp";
import { taskTitle } from "../src/lib/validation";

const mention = (name: string, id = "u1") => `@[${name}](user:${id})`;

test("un título que cabe se devuelve igual", () => {
  const t = "a".repeat(MAX_TITLE);
  assert.deepEqual(clampTitle(t), { value: t, clipped: false });
  assert.equal(clampTitle("Hola").clipped, false);
});

test("un título largo se corta al máximo y se avisa", () => {
  const r = clampTitle("x".repeat(500));
  assert.equal(r.clipped, true);
  assert.equal(r.value.length, MAX_TITLE);
});

test("el corte no deja espacios al final", () => {
  const r = clampTitle(`${"a".repeat(MAX_TITLE - 1)} bbbbbbbb`);
  assert.equal(r.clipped, true);
  assert.equal(r.value, "a".repeat(MAX_TITLE - 1));
});

test("no parte un emoji por la mitad (par suplente ni secuencia unida)", () => {
  const pair = clampTitle(`${"a".repeat(MAX_TITLE - 1)}😀😀`);
  assert.equal(pair.value, "a".repeat(MAX_TITLE - 1));
  const family = "👨‍👩‍👧"; // varios puntos de código unidos: un solo emoji
  const r = clampTitle(`${"a".repeat(MAX_TITLE - 3)}${family}`);
  assert.equal(r.clipped, true);
  assert.equal(r.value, "a".repeat(MAX_TITLE - 3));
  assert.doesNotMatch(r.value, /[\uD800-\uDBFF]$|‍$/);
});

test("la longitud cuenta el texto visible de las menciones", () => {
  const t = `${mention("Ana María")} hola`;
  assert.equal(titleLength(t), "@Ana María hola".length);
  assert.equal(clampTitle(t).clipped, false);
});

test("una mención que no cabe entera se quita; las que caben se conservan", () => {
  const head = "a".repeat(MAX_TITLE - 4);
  const r = clampTitle(`${head} ${mention("Ana")} resto`);
  assert.equal(r.clipped, true);
  assert.equal(r.value, head); // «@Ana» ocuparía 4 + el espacio: no cabe
  assert.doesNotMatch(r.value, /@\[|\(user:/);
  const keep = clampTitle(`${mention("Ana")} ${"b".repeat(MAX_TITLE)}`);
  assert.ok(keep.value.startsWith(`${mention("Ana")} b`));
  assert.equal(titleLength(keep.value), MAX_TITLE);
});

test("el esquema del servidor recorta en vez de rechazar", () => {
  assert.equal(taskTitle.parse("  hola  "), "hola");
  assert.equal(taskTitle.parse("x".repeat(5000)).length, MAX_TITLE);
  assert.throws(() => taskTitle.parse("   "), /obligatorio/);
});

test("alta en bloque: cuenta las líneas recortadas", () => {
  const r = parseTaskLinesInfo(`corta\n${"y".repeat(300)}\n- otra`);
  assert.deepEqual(r.lines.map((l) => l.length), [5, MAX_TITLE, 4]);
  assert.equal(r.clipped, 1);
});

test("un título enorme (1 MB) se recorta rápido: no se segmenta entero ni se calcula dos veces", () => {
  // Sin menciones: antes se segmentaba el MB entero (dos veces, ~1,4 s); ahora se para al llegar al máximo.
  const huge = "Texto largo sin menciones 😀 ".repeat(40_000).slice(0, 1_000_000);
  const t0 = performance.now();
  const r = clampTitle(huge.trim());
  const parsed = taskTitle.parse(huge);
  const again = clampTitle(huge.trim());
  const ms = performance.now() - t0;
  assert.equal(r.clipped, true);
  assert.ok(titleLength(r.value) <= MAX_TITLE);
  assert.equal(parsed, r.value);
  assert.equal(again, r, "la segunda consulta (¿se recortó?) reutiliza el resultado");
  assert.ok(ms < 150, `tardó ${ms.toFixed(0)} ms`);
});
