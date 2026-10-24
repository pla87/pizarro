-- Posiciones sin empates: dos tarjetas de la misma columna con la misma posición se ordenaban según
-- cómo devolviera las filas PostgreSQL, y su orden podía cambiar tras cualquier acción en otra columna.
-- Solo se renumeran las columnas con algún empate: todas sus tareas (activas, fijas y archivadas, que
-- conservan columna y posición) pasan a 1024, 2048… en su orden actual, desempatando por fecha de
-- creación y después por id. El orden relativo de cada grupo (activas, fijas, archivadas) se conserva.
WITH "tied" AS (
  SELECT DISTINCT "columnId" FROM "Task" GROUP BY "columnId", "position" HAVING COUNT(*) > 1
), "ranked" AS (
  SELECT t."id", ROW_NUMBER() OVER (PARTITION BY t."columnId" ORDER BY t."position", t."createdAt", t."id") AS "rn"
  FROM "Task" t JOIN "tied" USING ("columnId")
)
UPDATE "Task" AS t
SET "position" = "ranked"."rn" * 1024
FROM "ranked"
WHERE t."id" = "ranked"."id";
