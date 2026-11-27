-- «Compartir fuera»: se quita ColumnShare.generatedByName, que desde la v1.73 no se lee ni se escribe (el nombre sale de la
-- cuenta por generatedById). Se contrae lo que la migración 20261204100000 anunció.
BEGIN;
ALTER TABLE "ColumnShare" DROP COLUMN "generatedByName";
COMMIT;
