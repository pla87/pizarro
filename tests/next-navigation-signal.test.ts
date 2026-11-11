// Redirecciones y «no encontrado» de Next que llegan con la página a medio enviar (React #419 con su digest): no son
// errores del navegador. Y /admin redirige con un 307 antes de pintar nada (next.config), no con redirect() en la página.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isNextNavigationSignal } from "../src/lib/next-navigation-signal";
import nextConfig from "../next.config";

test("reconoce los digest de redirect(), notFound() y forbidden() de Next", () => {
  assert.equal(isNextNavigationSignal("NEXT_REDIRECT;replace;/admin/users;307;"), true);
  assert.equal(isNextNavigationSignal("NEXT_REDIRECT;push;/login;303;"), true);
  assert.equal(isNextNavigationSignal("NEXT_HTTP_ERROR_FALLBACK;404"), true);
  assert.equal(isNextNavigationSignal("NEXT_HTTP_ERROR_FALLBACK;403"), true);
  assert.equal(isNextNavigationSignal("NEXT_NOT_FOUND"), true);
  // En desarrollo: sin digest, con el mensaje.
  assert.equal(isNextNavigationSignal(undefined, "NEXT_REDIRECT"), true);
});

test("los errores de verdad se siguen registrando", () => {
  assert.equal(isNextNavigationSignal("3891245", "Minified React error #419"), false);
  assert.equal(isNextNavigationSignal(undefined, "Cannot read properties of undefined (reading 'NEXT_REDIRECT')"), false);
  assert.equal(isNextNavigationSignal("NEXT_REDIRECTED", undefined), false);
  assert.equal(isNextNavigationSignal(null, null), false);
});

test("/admin y /admin/types redirigen desde next.config (307 sin pintar la página) y el menú enlaza directamente", async () => {
  const redirects = await nextConfig.redirects!();
  const find = (source: string) => redirects.find((r) => r.source === source);
  assert.deepEqual([find("/admin")?.destination, find("/admin")?.permanent], ["/admin/users", false]);
  assert.deepEqual([find("/admin/types")?.destination, find("/admin/types")?.permanent], ["/admin/templates?vista=tipos", false]);
  assert.doesNotMatch(readFileSync(new URL("../src/components/AppShell.tsx", import.meta.url), "utf8"), /href="\/admin"/);
});
