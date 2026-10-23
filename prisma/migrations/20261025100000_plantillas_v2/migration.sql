-- Plantillas v2: opción de ocultar todos los tipos generales y huella del contenido canónico aplicado (actualización automática).
ALTER TABLE "ProjectTemplate" ADD COLUMN "hideAllGeneralKinds" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BuiltinTemplateSeeded" ADD COLUMN "appliedHash" TEXT;
