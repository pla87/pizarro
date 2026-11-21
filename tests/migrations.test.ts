import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Migraciones de Prisma (prisma/migrations/<timestamp>_<nombre>/migration.sql). Las publicadas no se editan nunca (cambia
// su checksum y `prisma migrate deploy` falla donde ya se aplicaron); las nuevas van entre BEGIN; y COMMIT;: si una
// sentencia falla a medias, PostgreSQL deshace todas y la base no queda con media migración aplicada (docs/HANDOFF.md §3).
const DIR = "prisma/migrations";
// La norma y su comprobación viven en el arranque (scripts/migrate.mjs): con ellas decide si una migración fallida se puede
// volver a aplicar sola (P3009). Especificador no literal: el script es .mjs y tsc no tiene sus tipos.
const SCRIPT = new URL("../scripts/migrate.mjs", import.meta.url);
const { LAST_WITHOUT_TRANSACTION, transactionProblem } = (await import(SCRIPT.href)) as {
  /** Última migración publicada sin BEGIN;/COMMIT; (v1.62.0). La norma vale para todas las posteriores. */
  LAST_WITHOUT_TRANSACTION: string;
  /** Motivo por el que la migración no va en una transacción explícita, o null si va bien. */
  transactionProblem: (sql: string) => string | null;
};

const migrations = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

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

test("migraciones: nada en medio que cierre la transacción o no pueda ir en ella (el reintento de P3009 repetiría lo confirmado)", () => {
  assert.match(transactionProblem("BEGIN;\nSELECT 1;\nCOMMIT;\nCREATE INDEX CONCURRENTLY i ON t (x);\nBEGIN;\nSELECT 2;\nCOMMIT;\n")!, /entre BEGIN; y COMMIT;/);
  assert.match(transactionProblem("BEGIN;\nCREATE INDEX CONCURRENTLY i ON t (x);\nCOMMIT;\n")!, /CONCURRENTLY/);
  assert.match(transactionProblem("BEGIN;\nSELECT 1;\nROLLBACK;\nSELECT 2;\nCOMMIT;\n")!, /ROLLBACK/);
  // Los BEGIN/END de un bloque DO o de una función entre $$ son suyos, no de la transacción.
  assert.equal(transactionProblem("BEGIN;\nDO $$\nBEGIN\n  PERFORM 1;\nEND\n$$;\nCREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $fn$ BEGIN RETURN 1; END; $fn$;\nCOMMIT;\n"), null);
});

test("migraciones: sentencias enteras, sin falsos positivos por CASE … END ni textos entre comillas", () => {
  assert.equal(transactionProblem("BEGIN;\nUPDATE \"Task\" SET x = CASE WHEN y THEN 1 ELSE 2 END;\nUPDATE t SET note = 'COMMIT;';\nCOMMIT;\n"), null);
  assert.match(transactionProblem("BEGIN;\nSELECT 1;\nCOMMIT WORK;\nSELECT 2;\nCOMMIT;\n")!, /COMMIT WORK/);
  assert.match(transactionProblem("BEGIN;\nSELECT 1;\nEND TRANSACTION;\nBEGIN TRANSACTION;\nSELECT 2;\nCOMMIT;\n")!, /END TRANSACTION/);
  assert.match(transactionProblem("BEGIN;\n/* nota */\nSAVEPOINT a;\nCOMMIT;\n")!, /SAVEPOINT/);
});
