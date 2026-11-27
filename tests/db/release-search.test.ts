// Búsqueda del histórico de releases (página Releases, ?q=; src/lib/release-search.ts): sin distinguir mayúsculas ni
// tildes y con el índice trigram de search_fold("title") y search_fold("content") (migración
// 20261127103000_indice_busqueda_releases), contra PostgreSQL real.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Prisma } from "../../src/generated/prisma/client";
import { releaseSearchSql, searchReleaseIds } from "../../src/lib/release-search";
import { db, makeProject } from "./helpers";

describe("búsqueda de releases", () => {
  test("ignora tildes y mayúsculas, busca en el título y en el texto, y % o _ son texto", async () => {
    const f = await makeProject();
    const other = await makeProject();
    const at = (i: number) => new Date(Date.now() - i * 60_000);
    const mk = (projectId: string, number: number, title: string, content: string) => db.release.create({ data: { projectId, number, title, content, deployedAt: at(number) }, select: { id: true } });
    const r1 = await mk(f.project.id, 1, "Menú DESPLEGABLE", "");
    const r2 = await mk(f.project.id, 2, "Otra", "- **R2F1** · El despleGáble del ÑANDÚ al 50% listo_ya");
    await mk(f.project.id, 3, "Nada que ver", "texto");
    await mk(other.project.id, 1, "Desplegable de otro proyecto", "");
    const find = (q: string) => searchReleaseIds(f.project.id, q, 10);
    // De la más reciente a la más antigua (r1 se desplegó un minuto después que r2); solo las del proyecto.
    assert.deepEqual(await find("desplegable"), [r1.id, r2.id]);
    assert.deepEqual(await find("Desplegáble"), [r1.id, r2.id]);
    assert.deepEqual(await find("ñandu"), [r2.id]);
    assert.deepEqual(await find("50%"), [r2.id]);
    assert.deepEqual(await find("listo_ya"), [r2.id]);
    assert.deepEqual(await find("list__ya"), []);
    assert.deepEqual(await find("5%"), []);
    assert.equal((await searchReleaseIds(f.project.id, "desplegable", 1)).length, 1);
    // Con menos de 3 letras solo el título (sin trigramas el índice no sirve): «50» está en el texto de r2, «ot» en su título.
    assert.deepEqual(await find("50"), []);
    assert.deepEqual(await find("ot"), [r2.id]);
  });

  test("con miles de releases (2.000 en el proyecto) el plan usa los índices trigram (no recorre el texto de todas)", async () => {
    const [ext] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'pg_trgm'`;
    assert.equal(ext!.n, 1, "la migración crea pg_trgm (el usuario de las pruebas puede)");
    const f = await makeProject();
    const other = await makeProject();
    // 2.000 releases de un proyecto (y 500 de otro), cada una con un texto como el de una release de 40 tareas.
    for (const [projectId, n] of [[f.project.id, 2000], [other.project.id, 500]] as const) {
      await db.$executeRaw`
        INSERT INTO "Release"("id", "projectId", "number", "title", "content", "deployedAt")
        SELECT ${projectId} || '_r' || g, ${projectId}, g, 'Release ' || g || ' de otoño',
          repeat('- **R' || g || 'F1** · Tarea número ' || g || ' con descripción ' || md5(g::text) || E'\\n', 40),
          ${new Date()}::timestamp - g * interval '1 minute'
        FROM generate_series(1, ${n}::int) g`;
    }
    await db.$executeRaw`UPDATE "Release" SET "content" = "content" || 'Menú DespleGáble nuevo' WHERE "id" IN (${`${f.project.id}_r10`}, ${`${f.project.id}_r1500`})`;
    await db.$executeRawUnsafe(`ANALYZE "Release"`);
    const sql = releaseSearchSql(f.project.id, "desplegable", 201);
    const [row] = await db.$queryRaw<{ "QUERY PLAN": unknown }[]>(Prisma.sql`EXPLAIN (FORMAT JSON) ${sql}`);
    const plan = JSON.stringify(row!["QUERY PLAN"]);
    assert.match(plan, /"Index Name":"Release_content_search_idx"/, plan);
    assert.match(plan, /"Index Name":"Release_title_search_idx"/, plan);
    assert.doesNotMatch(plan, /"Node Type":"Seq Scan"/, plan);
    assert.doesNotMatch(plan, /Release_projectId_deployedAt_idx/, plan);
    assert.deepEqual(await searchReleaseIds(f.project.id, "DESPLEGABLE", 201), [`${f.project.id}_r10`, `${f.project.id}_r1500`]);
  });
});
