-- Historial de versiones también en inglés
ALTER TABLE "AppVersionLog" ADD COLUMN "summaryEn" TEXT NOT NULL DEFAULT '', ADD COLUMN "changesEn" JSONB;

-- Descripciones: por defecto con barra de formato (también para quien no lo había cambiado)
ALTER TABLE "User" ALTER COLUMN "editorMode" SET DEFAULT 'WYSIWYG';
UPDATE "User" SET "editorMode" = 'WYSIWYG';
