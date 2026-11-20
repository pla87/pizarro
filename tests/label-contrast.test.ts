// Texto de las etiquetas sobre su color (onColor): el que más se lee de blanco y casi negro, y blanco si ya da 4,5:1.
import assert from "node:assert/strict";
import { test } from "node:test";
import { onColor, PALETTE } from "../src/lib/constants";

function lum(c: string): number {
  const h = c.slice(1);
  return [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i]!, 0);
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

test("onColor: blanco con 4,5:1 o más; si no, el de más contraste", () => {
  for (const c of PALETTE) {
    const fg = onColor(c);
    const white = ratio(c, "#ffffff");
    const dark = ratio(c, "#0f172a");
    if (white >= 4.5) assert.equal(fg, "#ffffff", c);
    else assert.equal(fg, dark > white ? "#0f172a" : "#ffffff", c);
  }
  assert.equal(onColor("#ffffff"), "#0f172a");
  assert.equal(onColor("#eab308"), "#0f172a", "amarillo con texto oscuro");
  assert.equal(onColor("#ef4444"), "#0f172a", "rojo con texto oscuro (3,8:1 con blanco)");
  assert.equal(onColor("#1e3a8a"), "#ffffff");
  assert.equal(onColor("#FFF"), "#0f172a", "#rgb y mayúsculas");
  assert.equal(onColor("rojo"), "#ffffff", "lo que no es un color hexadecimal, en blanco como antes");
});
