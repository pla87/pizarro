import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { foldedContains } from "./search-accents";

// Búsqueda del histórico de releases (página Releases, ?q=): por título o texto, sin distinguir mayúsculas ni tildes.
// Compara `search_fold(columna)` (función IMMUTABLE de la migración 20261127103000_indice_busqueda_releases:
// translate(lower(…)) con las letras de ACCENTED → UNACCENTED de search-accents.ts) con el patrón de foldedContains. La
// misma expresión tiene un índice trigram (pg_trgm, GIN) en "title" y en "content": con miles de releases ya no se lee
// el texto de todas (hasta 200 KB cada una). Sin la extensión (no se pudo crear) la consulta es la misma, sin índice.

/** La consulta, aparte para poder comprobar su plan (tests/db/release-search.test.ts). */
export function releaseSearchSql(projectId: string, q: string, limit: number): Prisma.Sql {
  const needle = foldedContains(q);
  return Prisma.sql`
    SELECT "id" FROM "Release" WHERE "projectId" = ${projectId}
      AND (search_fold("title") LIKE ${needle} OR search_fold("content") LIKE ${needle})
    ORDER BY "deployedAt" DESC LIMIT ${limit}`;
}

/** Ids de las releases del proyecto que coinciden, de la más reciente a la más antigua (como mucho `limit`). */
export async function searchReleaseIds(projectId: string, q: string, limit: number): Promise<string[]> {
  return (await db.$queryRaw<{ id: string }[]>(releaseSearchSql(projectId, q, limit))).map((r) => r.id);
}
