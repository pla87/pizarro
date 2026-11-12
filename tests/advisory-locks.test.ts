// Claves de los bloqueos consultivos de PostgreSQL: distintas entre sí y todas en src/lib/advisory-locks.ts. Dos usos
// con la misma clave se bloqueaban entre sí sin relación alguna (el correo programado y el reparto de exportaciones).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ADVISORY_LOCKS, LOCK_MAIL, LOCK_TRANSFER_CLAIM } from "../src/lib/advisory-locks";

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "generated") out.push(...sources(p));
    } else if (/\.(ts|tsx|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("claves de bloqueo: enteros de 32 bits distintos entre sí", () => {
  const entries = Object.entries(ADVISORY_LOCKS);
  assert.ok(entries.length >= 6);
  for (const [name, key] of entries) assert.ok(Number.isSafeInteger(key) && key > 0 && key < 2 ** 31, name);
  const seen = new Map<number, string>();
  for (const [name, key] of entries) {
    assert.equal(seen.get(key), undefined, `${name} repite la clave de ${seen.get(key)}`);
    seen.set(key, name);
  }
  assert.notEqual(LOCK_MAIL, LOCK_TRANSFER_CLAIM);
});

test("ningún otro fichero define claves numéricas de bloqueo", () => {
  const own = path.resolve("src/lib/advisory-locks.ts");
  const known = new Set(Object.keys(ADVISORY_LOCKS));
  const problems: string[] = [];
  for (const file of [...sources(path.resolve("src")), ...sources(path.resolve("scripts"))]) {
    if (file === own) continue;
    const text = readFileSync(file, "utf8");
    // Una constante LOCK_… o …_LOCK con un número.
    for (const m of text.matchAll(/\b(?:const|let)\s+((?:\w+_)?LOCK(?:_\w+)?)\s*=\s*\d/g)) problems.push(`${path.relative(".", file)}: ${m[1]}`);
    // Un número escrito directamente en la llamada, o una constante que no está en el módulo.
    for (const m of text.matchAll(/pg_(?:try_)?advisory_(?:xact_)?lock(?:_shared)?\(\s*(?:\$\{\s*)?([A-Za-z_]\w*|\d[\d_]*)/g)) {
      const arg = m[1]!;
      if (/^\d/.test(arg) || (/^LOCK_/.test(arg) && !known.has(arg))) problems.push(`${path.relative(".", file)}: ${m[0]}`);
    }
  }
  assert.deepEqual(problems, []);
});
