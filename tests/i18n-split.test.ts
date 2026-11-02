import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { translate } from "../src/i18n/core";
import { ADMIN_PHRASE } from "../src/lib/legal-core";

// El diccionario de inglés (~200 KB) no debe entrar en el JavaScript del navegador de todos: ningún módulo de
// cliente ("use client") puede importar i18n/core ni i18n/en (solo como tipo, que se borra al compilar). El único
// que lo carga es EnglishProvider, desde un import() dinámico en client.tsx. El servidor y las pruebas sí usan core.

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const VALUE_IMPORT = /^import\s+(?!type\b)(?!\{\s*(?:type\s+\w+\s*,?\s*)+\}\s+from)[^;]*?from\s+["'](?:@|\.\.?)\/(?:.*\/)?i18n\/(?:core|en)(?:\/index)?["']/m;

test("ningún módulo de cliente importa el diccionario de inglés por valor", () => {
  const offenders: string[] = [];
  for (const file of walk("src")) {
    if (file.endsWith(join("i18n", "EnglishProvider.tsx"))) continue;
    const text = readFileSync(file, "utf8");
    if (!/^\s*["']use client["']/.test(text)) continue;
    if (VALUE_IMPORT.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

test("el único import del diccionario en cliente es dinámico (client.tsx → EnglishProvider)", () => {
  const client = readFileSync(join("src", "i18n", "client.tsx"), "utf8");
  assert.match(client, /dynamic\(\(\) => import\("\.\/EnglishProvider"\)\)/);
  assert.doesNotMatch(client, /from "\.\/(core|en)"/);
});

test("la fórmula de legal-core (sin diccionario en el navegador) coincide con la del diccionario", () => {
  assert.equal(ADMIN_PHRASE.es, translate("es", ADMIN_PHRASE.es));
  assert.equal(ADMIN_PHRASE.en, translate("en", ADMIN_PHRASE.es));
});
