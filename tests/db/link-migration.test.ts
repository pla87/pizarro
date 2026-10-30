// Migración «unificar enlace externo»: externalUrl pasa a linkUrl si este está vacío y se quita de taskFields.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { db } from "./helpers";

describe("migración unificar_enlace_externo", () => {
  test("copia externalUrl a linkUrl solo si está vacío, borra la columna y limpia taskFields", async () => {
    const sql = readFileSync("prisma/migrations/20261105100000_unificar_enlace_externo/migration.sql", "utf8");
    // Esquema de pruebas aparte: tablas mínimas con la forma previa a la migración.
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS mig_enlace CASCADE`);
    await db.$executeRawUnsafe(`CREATE SCHEMA mig_enlace`);
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO mig_enlace`);
        await tx.$executeRawUnsafe(`CREATE TABLE "Task" ("id" TEXT PRIMARY KEY, "linkUrl" TEXT, "externalUrl" TEXT)`);
        await tx.$executeRawUnsafe(`CREATE TABLE "Project" ("id" TEXT PRIMARY KEY, "taskFields" TEXT[])`);
        await tx.$executeRawUnsafe(`CREATE TABLE "ProjectTemplate" ("id" TEXT PRIMARY KEY, "taskFields" TEXT[])`);
        await tx.$executeRawUnsafe(`INSERT INTO "Task" VALUES ('a', NULL, 'https://example.com/ref'), ('b', 'https://example.com/pr', 'https://example.com/ref'), ('c', 'https://example.com/pr', NULL), ('d', NULL, NULL)`);
        await tx.$executeRawUnsafe(`INSERT INTO "Project" VALUES ('p1', ARRAY['cost','externalUrl','startDate']), ('p2', ARRAY[]::TEXT[])`);
        await tx.$executeRawUnsafe(`INSERT INTO "ProjectTemplate" VALUES ('t1', ARRAY['externalUrl'])`);
        for (const stmt of sql.split(";").map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean)) await tx.$executeRawUnsafe(stmt);
        const rows = await tx.$queryRawUnsafe<{ id: string; linkUrl: string | null }[]>(`SELECT "id", "linkUrl" FROM "Task" ORDER BY "id"`);
        assert.deepEqual(rows.map((r) => r.linkUrl), ["https://example.com/ref", "https://example.com/pr", "https://example.com/pr", null]);
        const cols = await tx.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'mig_enlace' AND table_name = 'Task'`);
        assert.ok(!cols.some((c) => c.column_name === "externalUrl"));
        const projects = await tx.$queryRawUnsafe<{ id: string; taskFields: string[] }[]>(`SELECT * FROM "Project" ORDER BY "id"`);
        assert.deepEqual(projects.map((p) => p.taskFields), [["cost", "startDate"], []]);
        const templates = await tx.$queryRawUnsafe<{ taskFields: string[] }[]>(`SELECT * FROM "ProjectTemplate"`);
        assert.deepEqual(templates[0]?.taskFields, []);
      });
    } finally {
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS mig_enlace CASCADE`);
    }
  });
});
