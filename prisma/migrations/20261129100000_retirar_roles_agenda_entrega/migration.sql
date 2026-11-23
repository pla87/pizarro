-- Se retiran los roles de columna «Agenda» (AGENDA) y «Entrega al cliente» (DELIVERY), fase 1 de 2: la app ya no los
-- ofrece ni los escribe, y aquí pasan a «Sin rol» las columnas que los tenían y las columnas de las plantillas guardadas
-- (ProjectTemplate.columns, JSON). Los valores siguen en el enum: la versión anterior lee estas filas sin problema y el
-- valor se quita en una migración de la versión siguiente (expandir y contraer).
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

COMMIT;
