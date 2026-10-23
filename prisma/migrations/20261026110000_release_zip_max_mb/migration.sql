-- Tamaño máximo (MB) del ZIP de adjuntos de una release, por proyecto.
ALTER TABLE "Project" ADD COLUMN "releaseZipMaxMb" INTEGER NOT NULL DEFAULT 80;
