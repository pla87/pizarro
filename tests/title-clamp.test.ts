import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTaskLinesInfo } from "../src/lib/bulk";
import { MAX_TITLE, MAX_TITLE_UNITS } from "../src/lib/constants";
import { clampTitle, graphemeCount, titleLength, titleTooLong } from "../src/lib/title-clamp";
import { titleWithReleaseCode } from "../src/lib/release";
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
  // Cada emoji cuenta como un carácter: el que llena el máximo entra entero y el siguiente se queda fuera.
  const pair = clampTitle(`${"a".repeat(MAX_TITLE - 1)}😀😀`);
  assert.equal(pair.value, `${"a".repeat(MAX_TITLE - 1)}😀`);
  const family = "👨‍👩‍👧"; // varios puntos de código unidos: un solo emoji
  const r = clampTitle(`${"a".repeat(MAX_TITLE)}${family}`);
  assert.equal(r.clipped, true);
  assert.equal(r.value, "a".repeat(MAX_TITLE));
  const kept = clampTitle(`${"a".repeat(MAX_TITLE - 1)}${family}${family}`);
  assert.equal(kept.value, `${"a".repeat(MAX_TITLE - 1)}${family}`);
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

test("el máximo cuenta caracteres visibles (grafemas), no unidades UTF-16", () => {
  const family = "👨‍👩‍👧‍👦"; // 11 unidades UTF-16, un solo carácter a la vista
  assert.equal(family.length, 11);
  assert.equal(graphemeCount(family), 1);
  assert.equal(titleLength(`Hola ${family}`), 6);
  assert.equal(titleLength("🇪🇸 e\u0301"), 3); // bandera y «e» + tilde combinada
  // 50 familias son 550 unidades pero 50 caracteres: cabe y no se recorta.
  const fifty = family.repeat(50);
  assert.equal(titleTooLong(fifty), false);
  assert.deepEqual(clampTitle(fifty), { value: fifty, clipped: false });
  // 210 emojis normales (420 unidades) caben; uno más ya no.
  const smile = "😀".repeat(MAX_TITLE);
  assert.equal(titleTooLong(smile), false);
  assert.equal(clampTitle(smile).clipped, false);
  const over = clampTitle(smile + "😀");
  assert.equal(over.clipped, true);
  assert.equal(over.value, smile);
  assert.equal(titleTooLong(smile + "😀"), true);
});

test("tope duro en unidades: un título de emojis muy compuestos no crece sin límite", () => {
  const family = "👨‍👩‍👧‍👦";
  const r = clampTitle(family.repeat(MAX_TITLE)); // 210 caracteres, 2310 unidades
  assert.equal(r.clipped, true);
  assert.ok(r.value.length <= MAX_TITLE_UNITS);
  assert.equal(r.value, family.repeat(Math.floor(MAX_TITLE_UNITS / family.length)));
  assert.equal(titleTooLong(family.repeat(MAX_TITLE)), true);
  // El servidor guarda lo mismo que el cliente recorta.
  assert.equal(taskTitle.parse(family.repeat(MAX_TITLE)), r.value);
});

test("prefijo de release: no parte emojis compuestos y cuenta caracteres", () => {
  const family = "👨‍👩‍👧";
  const out = titleWithReleaseCode(family.repeat(300), "R1F1");
  assert.ok(titleLength(out) <= MAX_TITLE);
  assert.ok(out.length <= MAX_TITLE_UNITS);
  assert.ok(out.startsWith(`R1F1: ${family}`));
  assert.doesNotMatch(out, /[\uD800-\uDBFF]$|\u200d$/);
});
