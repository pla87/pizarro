-- Se retiran los roles de columna «Agenda» (AGENDA) y «Entrega al cliente» (DELIVERY), fase 2 de 2: se quitan del enum.
-- Antes se repiten los dos UPDATE de 20261129100000_retirar_roles_agenda_entrega, por si una vuelta atrás a la v1.67
-- volvió a escribirlos (columnas y JSON de las plantillas guardadas). PostgreSQL no puede quitar un valor de un enum: se
-- crea el tipo nuevo, se pasa la columna (sin su valor por defecto ni el índice único parcial, que comparan con valores del
-- tipo viejo), se borra el viejo y el nuevo toma su nombre. La v1.68 ya no escribe estos valores: sigue funcionando aquí.
BEGIN;

UPDATE "Column" SET "role" = 'NONE' WHERE "role" IN ('AGENDA', 'DELIVERY');

UPDATE "ProjectTemplate" AS t
SET "columns" = (
  SELECT jsonb_agg(
    CASE WHEN jsonb_typeof(c.elem) = 'object' AND c.elem->>'role' IN ('AGENDA', 'DELIVERY') THEN jsonb_set(c.elem, '{role}', '"NONE"') ELSE c.elem END
    ORDER BY c.ord
  )
  FROM jsonb_array_elements(t."columns") WITH ORDINALITY AS c(elem, ord)
)
WHERE jsonb_typeof(t."columns") = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(t."columns") AS e(elem) WHERE jsonb_typeof(e.elem) = 'object' AND e.elem->>'role' IN ('AGENDA', 'DELIVERY'));

CREATE TYPE "ColumnRole_new" AS ENUM ('NONE', 'NEXT_RELEASE', 'IN_PRODUCTION', 'WAITING', 'WEEKLY_PLAN', 'BUDGET', 'CHECKLIST', 'REVIEW', 'ROUTINES', 'PROGRAM', 'AI_PLAN');

DROP INDEX "Column_projectId_role_unique";
ALTER TABLE "Column" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "Column" ALTER COLUMN "role" TYPE "ColumnRole_new" USING ("role"::text::"ColumnRole_new");
DROP TYPE "ColumnRole";
ALTER TYPE "ColumnRole_new" RENAME TO "ColumnRole";
ALTER TABLE "Column" ALTER COLUMN "role" SET DEFAULT 'NONE';
CREATE UNIQUE INDEX "Column_projectId_role_unique" ON "Column"("projectId", "role") WHERE "role" IN ('NEXT_RELEASE', 'IN_PRODUCTION');

COMMIT;
