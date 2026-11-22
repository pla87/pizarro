// Texto de las etiquetas sobre su color (onColor): el que más se lee de blanco y casi negro, y blanco si ya da 4,5:1.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { onColor, PALETTE } from "../src/lib/constants";
import { PRIORITY_COLOR } from "../src/lib/task-fields";

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

test("emails: el pie (con el enlace de baja) y los recuentos en gris medio, no en #94a3b8 (2,6:1 sobre blanco)", () => {
  assert.ok(ratio("#64748b", "#ffffff") >= 4.5);
  for (const f of ["notify", "digest", "periodic-mail", "auth-mail"]) {
    const src = readFileSync(`src/lib/${f}.ts`, "utf8");
    assert.ok(!src.includes("#94a3b8"), f);
  }
});

test("insignias de prioridad: el texto blanco se lee sobre todas (4,5:1 o más; «Alta» daba 3,2:1)", () => {
  for (const [p, c] of Object.entries(PRIORITY_COLOR)) assert.ok(ratio(c, "#ffffff") >= 4.5, `${p} ${c}: ${ratio(c, "#ffffff").toFixed(2)}`);
});
