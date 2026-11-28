// Comprobaciones de interfaz del acceso y el menú móvil que no tienen arnés de navegador: se leen los fuentes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("VerifyForm: «Recordar este dispositivo» es una casilla controlada y el código no se autocorrige", () => {
  const src = read("src/app/login/verify/VerifyForm.tsx");
  assert.match(src, /const \[remember, setRemember\] = useState\(false\)/);
  assert.match(src, /name="remember"[^>]*checked=\{remember\}[^>]*onChange=/);
  const code = /<input id="code"[^>]*>/.exec(src)?.[0] ?? "";
  assert.match(code, /autoCapitalize="none"/);
  assert.match(code, /autoCorrect="off"/);
  assert.match(code, /spellCheck=\{false\}/);
});

test("AppShell: el menú móvil se cierra con Atrás (useBackToClose sobre drawerOpen)", () => {
  const src = read("src/components/AppShell.tsx");
  assert.match(src, /import \{ useBackToClose \} from "\.\/ui\/useBackToClose"/);
  assert.match(src, /useBackToClose\(drawerOpen, closeDrawer, drawerLeavingByLink\)/);
});

test("el botón flotante de crear se oculta con el teclado abierto (campo con foco)", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /@media \(pointer: coarse\) \{\s*body:has\(input:not\([^{]*textarea:focus[^{]*contenteditable[^{]*\)\s*\[data-board-fab\]\s*\{\s*display:\s*none/);
});
