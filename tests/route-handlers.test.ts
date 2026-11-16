// Rutas de la app (route.ts): reglas que valen para todas.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const APP = path.join(import.meta.dirname, "../src/app");

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return routeFiles(full);
    return /^route\.tsx?$/.test(e.name) ? [full] : [];
  });
}

test("ninguna ruta importa un módulo de acciones de servidor (src/actions)", () => {
  // Con un módulo "use server" dentro de una ruta, Next puede reenviar a esa ruta las llamadas a sus acciones hechas desde
  // una página que no las incluye (p. ej. el guardado pendiente al navegar fuera de Ajustes), y no se ejecutan: responde
  // 200 sin hacer nada. La lógica compartida va en src/lib (como changeAppIcon, en app-icon-save.ts).
  const files = routeFiles(APP);
  assert.ok(files.length > 10, "debería encontrar las rutas");
  const offenders = files.filter((f) => /from\s+["'](@\/actions\/|(\.\.\/)+actions\/)/.test(readFileSync(f, "utf8"))).map((f) => path.relative(APP, f));
  assert.deepEqual(offenders, []);
});
