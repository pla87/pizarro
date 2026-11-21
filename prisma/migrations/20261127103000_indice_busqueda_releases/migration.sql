-- Búsqueda del histórico de releases con índice (src/lib/release-search.ts). La página compara
-- search_fold("title") y search_fold("content") con un patrón LIKE '%…%' ya plegado (foldedContains): minúsculas y sin
-- tildes. Un índice trigram (pg_trgm, GIN) sobre esa misma expresión evita leer el texto de todas las releases.
--
-- search_fold es IMMUTABLE (lower y translate lo son) para poder indexarla; las letras son ACCENTED → UNACCENTED de
-- src/lib/search-accents.ts (tests/search-accents.test.ts comprueba que coinciden). Va siempre: la consulta la usa con
-- índice o sin él. En plpgsql y con COST alto a propósito: una función SQL se «inlinea» como translate(lower(…)), que el
-- planificador cree barata, y prefería recorrer todas las releases del proyecto por "projectId" (y plegar hasta 200 KB de
-- cada una) antes que el índice; así el plan usa el índice trigram (tests/db/release-search.test.ts lo comprueba).
--
-- pg_trgm viene con PostgreSQL (contrib, también en las imágenes oficiales y en Railway) y es «trusted»: basta con ser
-- dueño de la base (el rol de la aplicación del compose lo es). Si aun así no se puede crear (un PostgreSQL sin contrib,
-- un servicio que no la ofrece), la migración no falla: avisa y sigue sin índice, y la búsqueda funciona como antes. Lo
-- mismo si no se puede crear el índice (la extensión está en un esquema fuera del search_path).
BEGIN;

CREATE OR REPLACE FUNCTION search_fold(text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE COST 1000
  AS $$ BEGIN RETURN pg_catalog.translate(pg_catalog.lower($1), 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc'); END $$;

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Pizarro: no se pudo crear la extensión pg_trgm (%): la búsqueda de releases funciona sin índice.', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    BEGIN
      CREATE INDEX IF NOT EXISTS "Release_title_search_idx" ON "Release" USING gin (search_fold("title") gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS "Release_content_search_idx" ON "Release" USING gin (search_fold("content") gin_trgm_ops);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Pizarro: no se pudieron crear los índices de búsqueda de releases (%): la búsqueda funciona sin ellos.', SQLERRM;
    END;
  END IF;
END
$$;

COMMIT;
