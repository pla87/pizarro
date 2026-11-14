-- Versión del programa del curso: cada «Publicar programa» guardado en Documentación lleva «_vN» al final del nombre.
ALTER TABLE "Project" ADD COLUMN "programVersion" INTEGER NOT NULL DEFAULT 0;

-- Los programas ya guardados (sin versión, de la 1.53) cuentan como versiones anteriores: el siguiente sigue la cuenta.
UPDATE "Project" AS p SET "programVersion" = s.n
FROM (
  SELECT "projectId", count(*)::int AS n FROM "ProjectDocument"
  WHERE "kind" = 'PDF' AND ("name" LIKE 'Programa – %.pdf' OR "name" LIKE 'Programme – %.pdf')
  GROUP BY "projectId"
) AS s
WHERE s."projectId" = p."id";
