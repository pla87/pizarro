import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Migraciones de Prisma (prisma/migrations/<timestamp>_<nombre>/migration.sql). Las publicadas no se editan nunca (cambia
// su checksum y `prisma migrate deploy` falla donde ya se aplicaron); las nuevas van entre BEGIN; y COMMIT;: si una
// sentencia falla a medias, PostgreSQL deshace todas y la base no queda con media migración aplicada (docs/HANDOFF.md §3).
const DIR = "prisma/migrations";
/** Última migración publicada sin BEGIN;/COMMIT; (v1.62.0). La norma vale para todas las posteriores. */
const LAST_WITHOUT_TRANSACTION = "20261126100000";

const migrations = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

/** Las sentencias de verdad: sin líneas vacías ni comentarios de línea (`-- …`) al principio y al final. */
function body(sql: string): string[] {
  const lines = sql.split(/\r?\n/).map((l) => l.trim());
  const meaningful = (l: string) => l !== "" && !l.startsWith("--");
  const first = lines.findIndex(meaningful);
  const last = lines.findLastIndex(meaningful);
  return first < 0 ? [] : lines.slice(first, last + 1);
}

/** Motivo por el que la migración no va en una transacción explícita, o null si va bien. */
function transactionProblem(sql: string): string | null {
  const b = body(sql);
  if (b.length === 0) return "está vacía";
  if (!/^BEGIN;$/i.test(b[0]!)) return `no empieza por «BEGIN;» (empieza por «${b[0]}»)`;
  if (!/^COMMIT;$/i.test(b.at(-1)!)) return `no termina en «COMMIT;» (termina en «${b.at(-1)}»)`;
  if (b.length < 3) return "no tiene nada entre BEGIN; y COMMIT;";
  return null;
}

test("migraciones: carpetas <timestamp de 14 cifras>_<nombre>, cada una con su migration.sql, sin timestamps repetidos", () => {
  assert.ok(migrations.length > 0);
  const stamps = new Set<string>();
  for (const m of migrations) {
    assert.match(m, /^\d{14}_[a-z0-9_]+$/, m);
    assert.ok(existsSync(join(DIR, m, "migration.sql")), `${m}: falta migration.sql`);
    const stamp = m.slice(0, 14);
    assert.ok(!stamps.has(stamp), `${m}: timestamp repetido`);
    stamps.add(stamp);
  }
  // La referencia existe: si alguien la renombrase, la norma dejaría de vigilar las nuevas sin avisar.
  assert.ok(migrations.some((m) => m.startsWith(`${LAST_WITHOUT_TRANSACTION}_`)), `falta la migración ${LAST_WITHOUT_TRANSACTION}`);
});

test("migraciones nuevas (posteriores a la v1.62.0): empiezan por BEGIN; y terminan en COMMIT;", () => {
  const nuevas = migrations.filter((m) => m.slice(0, 14) > LAST_WITHOUT_TRANSACTION);
  for (const m of nuevas) {
    const problem = transactionProblem(readFileSync(join(DIR, m, "migration.sql"), "utf8"));
    assert.equal(problem, null, `${m}/migration.sql ${problem}: escribe el SQL entre «BEGIN;» y «COMMIT;» (docs/HANDOFF.md §3)`);
  }
});

test("migraciones: la comprobación de BEGIN;/COMMIT; acepta comentarios alrededor y rechaza lo demás", () => {
  assert.equal(transactionProblem("-- Qué hace\n\nBEGIN;\nALTER TABLE \"Task\" ADD COLUMN \"x\" TEXT;\nCOMMIT;\n"), null);
  assert.equal(transactionProblem("begin;\nSELECT 1;\ncommit;\n-- fin\n\n"), null);
  assert.match(transactionProblem("ALTER TABLE \"Task\" ADD COLUMN \"x\" TEXT;\n")!, /no empieza por «BEGIN;»/);
  assert.match(transactionProblem("BEGIN;\nALTER TABLE \"Task\" ADD COLUMN \"x\" TEXT;\n")!, /no termina en «COMMIT;»/);
  assert.match(transactionProblem("BEGIN;\nSELECT 1;\nCOMMIT;\nSELECT 2;\n")!, /no termina en «COMMIT;»/);
  assert.match(transactionProblem("BEGIN;\nCOMMIT;\n")!, /nada entre/);
  assert.match(transactionProblem("-- solo un comentario\n")!, /vacía/);
});
