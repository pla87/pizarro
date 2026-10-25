-- Tamaño máximo de un adjunto por proyecto (antes, MAX_UPLOAD_MB para todo el servidor).
ALTER TABLE "Project" ADD COLUMN "fileMaxMb" INTEGER NOT NULL DEFAULT 20;
-- Debe cumplirse fileMaxMb <= taskAttachMaxMb: un proyecto con un tope por tarea menor de 20 MB baja el de archivo.
UPDATE "Project" SET "fileMaxMb" = "taskAttachMaxMb" WHERE "fileMaxMb" > "taskAttachMaxMb";
