// Menús y paneles flotantes (src/components/ui/Popover.tsx, Menu.tsx).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const SRC = path.join(import.meta.dirname, "..", "src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return e.name.endsWith(".tsx") ? [full] : [];
  });
}

test("ningún panel de menú o desplegable usa `w-full`/`w-screen`: va con `position: fixed` y sería el ancho de la ventana", () => {
  // Ronda 68: «PDF de la semana ▾» llevaba `w-full` y en una ventana muy ancha salía una franja de lado a lado, pegada a la
  // izquierda. Para que mida lo mismo que su botón está `matchWidth`.
  const bad: string[] = [];
  for (const file of sources(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/panelClassName=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const classes = (m[1] ?? m[2] ?? "").split(/\s+/);
      if (classes.some((c) => /^(?:[a-z0-9-]+:)*w-(?:full|screen)$/.test(c))) bad.push(`${path.relative(SRC, file)}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});
