-- Preferencias de usuario: color de acento, idioma y modo de edición de descripciones
CREATE TYPE "Accent" AS ENUM ('BLUE', 'FOREST', 'SIENNA', 'MUSTARD', 'MONO');
CREATE TYPE "Locale" AS ENUM ('ES', 'EN');
CREATE TYPE "EditorMode" AS ENUM ('MARKDOWN', 'WYSIWYG');
ALTER TABLE "User" ADD COLUMN "accent" "Accent" NOT NULL DEFAULT 'BLUE',
  ADD COLUMN "locale" "Locale" NOT NULL DEFAULT 'ES',
  ADD COLUMN "editorMode" "EditorMode" NOT NULL DEFAULT 'MARKDOWN';

-- «Respuesta» deja de ser especial: se puede borrar como cualquier otro tipo
ALTER TABLE "TaskKind" DROP COLUMN "system";

-- Releases numeradas por proyecto (las existentes, por fecha de despliegue)
ALTER TABLE "Release" ADD COLUMN "number" INTEGER;
UPDATE "Release" r SET "number" = n.rn
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY "deployedAt", "id") AS rn FROM "Release") n
WHERE r."id" = n."id";
ALTER TABLE "Release" ALTER COLUMN "number" SET NOT NULL;
CREATE UNIQUE INDEX "Release_projectId_number_key" ON "Release"("projectId", "number");

-- Deshacer con contexto de tarea
ALTER TABLE "UndoEntry" ADD COLUMN "taskId" TEXT;
CREATE INDEX "UndoEntry_userId_taskId_createdAt_idx" ON "UndoEntry"("userId", "taskId", "createdAt");
