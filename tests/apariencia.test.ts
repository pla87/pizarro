// Apariencia (Mi perfil) y capas sobre los diálogos: comprobaciones sobre el CSS y los componentes, sin navegador.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const profile = readFileSync(new URL("../src/app/(app)/settings/ProfileSettings.tsx", import.meta.url), "utf8");

test("las muestras de «Tarjetas» usan el color del tema elegido (antes, índigo fijo también con «Mostaza»)", () => {
  assert.match(profile, /const sample = "var\(--color-brand-500\)"/);
  assert.doesNotMatch(profile, /const sample = "#/);
  // Cada tema de color define ese color (si no, la muestra tomaría el del tema por defecto).
  const accents = [...css.matchAll(/:root\[data-accent="(\w+)"\] \{([\s\S]*?)\n\}/g)];
  assert.ok(accents.length >= 5, "temas de color en globals.css");
  for (const [, name, body] of accents) assert.match(body!, /--color-brand-500:/, `el tema ${name} define --color-brand-500`);
});

test("un diálogo centrado encima de otro oculta las copias flotantes de Deshacer y «Nueva tarea»", () => {
  // Las copias (data-pz-layer, z-70) quedaban por encima del fondo de «Cambios sin guardar», brillantes y pulsables.
  assert.match(css, /body:has\(> \[data-pz-modal\] ~ \[data-pz-modal\]\[data-pz-side="center"\]\) > button\[data-pz-layer\] \{\s*display: none;/);
  const modal = readFileSync(new URL("../src/components/ui/Modal.tsx", import.meta.url), "utf8");
  assert.match(modal, /data-pz-side=\{side\}/);
});
