-- Cabeceras y pies de release en las plantillas de proyecto.
ALTER TABLE "ProjectTemplate" ADD COLUMN "releaseTemplates" JSONB NOT NULL DEFAULT '[]';
