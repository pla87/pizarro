-- Tope de adjuntos de una tarea, separado del tope de cada ZIP de release.
-- Se copia el valor actual para que ningún proyecto cambie de comportamiento.
ALTER TABLE "Project" ADD COLUMN "taskAttachMaxMb" INTEGER NOT NULL DEFAULT 80;
UPDATE "Project" SET "taskAttachMaxMb" = "releaseZipMaxMb";
