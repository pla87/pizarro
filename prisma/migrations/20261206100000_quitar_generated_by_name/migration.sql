-- Quita ColumnShare.generatedByName (en desuso desde la v1.72 y fuera del esquema desde la v1.74): la versión anterior
-- (v1.74) ya no la lee ni la escribe, así que volver a ella tras migrar sigue funcionando.
BEGIN;
ALTER TABLE "ColumnShare" DROP COLUMN IF EXISTS "generatedByName";
COMMIT;
