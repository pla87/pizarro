-- Tema de la interfaz por usuario.
CREATE TYPE "Theme" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');
ALTER TABLE "User" ADD COLUMN "theme" "Theme" NOT NULL DEFAULT 'SYSTEM';

-- Adjuntos de cada release (copias reducidas) para descargarlos desde el histórico.
CREATE TABLE "ReleaseAttachment" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReleaseAttachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReleaseAttachment_releaseId_idx" ON "ReleaseAttachment"("releaseId");
ALTER TABLE "ReleaseAttachment" ADD CONSTRAINT "ReleaseAttachment_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;
