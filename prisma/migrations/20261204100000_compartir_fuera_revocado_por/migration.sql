-- «Compartir fuera»: quién revocó el enlace (si lo revocó una persona del proyecto), para decírselo a quien lo generó.
-- Solo añade una columna opcional, sin clave ajena (como generatedById: al borrar la cuenta se vacía). La columna
-- generatedByName deja de escribirse y de leerse; se quitará en una versión posterior.
BEGIN;
ALTER TABLE "ColumnShare" ADD COLUMN "revokedById" TEXT;
COMMIT;
