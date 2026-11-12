import assert from "node:assert/strict";
import { test } from "node:test";
import { cutChars, descriptionToPlain, markdownToPlain } from "../src/lib/ics";
import { assertFast, bestTime } from "./timing";

/** Las dos expresiones regulares de énfasis tal como estaban antes (cuadráticas): referencia para comprobar que el resultado no cambia. */
const oldEmphasis = (s: string) =>
  s
    .replace(/(?<![\p{L}\p{N}_*])(\*\*|__)(?=\S)(.+?)(?<=\S)\1(?![\p{L}\p{N}_*])/gu, "$2")
    .replace(/(?<![\p{L}\p{N}_*])([*_])(?=[^\s*_])(.+?)(?<=[^\s*_])\1(?![\p{L}\p{N}_*])/gu, "$2");

test("énfasis lineal: «**a » repetido 5000 veces tarda menos de 50 ms (o de 20 veces un texto normal igual de largo)", () => {
  // Cota proporcional a una medida de referencia tomada ahora: con la máquina cargada las dos se inflan a la vez. Lo
  // cuadrático tardaba segundos, cientos de veces la referencia. Cada medida es la mejor de tres.
  const plain = "texto normal sin énfasis, ".repeat(800);
  const max = Math.max(50, 20 * bestTime(() => markdownToPlain(plain)));
  for (const input of ["**a ".repeat(5000), "__a ".repeat(5000), "*a ".repeat(5000), "_a ".repeat(5000), "**a _b *c ".repeat(2000), "**".repeat(10000)]) {
    const ms = bestTime(() => markdownToPlain(input), { under: max });
    assert.ok(ms < max, `${input.slice(0, 12)}… tardó ${ms.toFixed(1)} ms (máximo ${max.toFixed(0)})`);
  }
});

test("énfasis lineal: casos normales dan lo mismo que antes", () => {
  const cases = [
    "**negrita** y __negrita__ y *cursiva* y _cursiva_",
    "(_entre paréntesis_), **con, coma**.",
    "ver https://example.com/a_b_c/d_e y snake_case_name y 2*3*4 = 24",
    "**negrita con *cursiva* dentro** fin",
    "***todo***",
    "**a**b **c** d",
    "línea **uno\ndos** tres",
    "emoji **😀** y _😀_ y ñ_a_ñ _ñandú_",
  ];
  for (const c of cases) assert.equal(markdownToPlain(c), oldEmphasis(c).trim(), c);
  assert.equal(markdownToPlain("**negrita con *cursiva* dentro** fin"), "negrita con cursiva dentro fin");
  assert.equal(markdownToPlain("_cursiva_ y *otra* y **negrita** y __negrita__"), "cursiva y otra y negrita y negrita");
});

test("énfasis lineal: equivale a las expresiones regulares originales (prueba diferencial aleatoria)", () => {
  const alphabet = ["*", "*", "_", "_", "a", "b", " ", " ", "\n", "é", "1", ".", "😀", "\r", " ", "(", "-"];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let compared = 0;
  for (let n = 0; n < 30000; n++) {
    const len = 1 + Math.floor(rnd() * 24);
    let s = "";
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    // Solo texto que el resto de markdownToPlain no toca (viñetas, citas, encabezados, saltos triples).
    if (/^\s*[-*+>#]/m.test(s) || /\n{3,}/.test(s) || /\s[-*+]\s/.test(s)) continue;
    compared++;
    assert.equal(markdownToPlain(s), oldEmphasis(s).trim(), JSON.stringify(s));
  }
  assert.ok(compared > 5000);
});

test("cutChars no parte un par sustituto y descriptionToPlain recorta antes de convertir", () => {
  assert.equal(cutChars("abc", 5), "abc");
  assert.equal(cutChars("ab😀cd", 3), "ab");
  assert.equal(cutChars("ab😀cd", 4), "ab😀");
  const long = "**a ".repeat(100_000);
  const out = assertFast(50, () => descriptionToPlain(long));
  assert.ok(out.length <= 1500);
});
