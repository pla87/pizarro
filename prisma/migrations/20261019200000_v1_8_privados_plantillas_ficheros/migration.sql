-- Proyectos privados (solo los ve su dueño).
ALTER TABLE "Project" ADD COLUMN "privateOwnerId" TEXT;
ALTER TABLE "Project" ADD CONSTRAINT "Project_privateOwnerId_fkey" FOREIGN KEY ("privateOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tareas fijas de la columna de release.
ALTER TABLE "Task" ADD COLUMN "evergreen" BOOLEAN NOT NULL DEFAULT false;

-- Automatización de tipos y tipos del sistema.
ALTER TABLE "TaskKind" ADD COLUMN "titleTemplate" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TaskKind" ADD COLUMN "descriptionTemplate" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TaskKind" ADD COLUMN "system" BOOLEAN NOT NULL DEFAULT false;
-- «Respuesta» (comportamiento fijo hasta ahora) pasa a ser un tipo del sistema con su automatización.
UPDATE "TaskKind" SET "system" = true, "titleTemplate" = 'Respuesta',
  "descriptionTemplate" = 'Respondo a las preguntas y lo que necesitas de mi:'
WHERE "projectId" IS NULL AND lower(trim("name")) = 'respuesta';
-- Instalaciones sin ese tipo: se crea.
INSERT INTO "TaskKind" ("id", "name", "color", "position", "system", "titleTemplate", "descriptionTemplate")
SELECT 'kind_respuesta', 'Respuesta', '#a855f7', COALESCE((SELECT MAX("position") FROM "TaskKind" WHERE "projectId" IS NULL), 0) + 1024,
       true, 'Respuesta', 'Respondo a las preguntas y lo que necesitas de mi:'
WHERE NOT EXISTS (SELECT 1 FROM "TaskKind" WHERE "projectId" IS NULL AND lower(trim("name")) = 'respuesta')
  AND NOT EXISTS (SELECT 1 FROM "TaskKind" WHERE lower(trim("name")) = 'respuesta');

-- Tipos generales que un proyecto no usa.
CREATE TABLE "ProjectHiddenKind" (
    "projectId" TEXT NOT NULL,
    "kindId" TEXT NOT NULL,
    CONSTRAINT "ProjectHiddenKind_pkey" PRIMARY KEY ("projectId", "kindId")
);
CREATE INDEX "ProjectHiddenKind_kindId_idx" ON "ProjectHiddenKind"("kindId");
ALTER TABLE "ProjectHiddenKind" ADD CONSTRAINT "ProjectHiddenKind_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectHiddenKind" ADD CONSTRAINT "ProjectHiddenKind_kindId_fkey" FOREIGN KEY ("kindId") REFERENCES "TaskKind"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Plantillas de proyecto.
CREATE TABLE "ProjectTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "columns" JSONB NOT NULL,
    "kinds" JSONB NOT NULL DEFAULT '[]',
    "hiddenGeneralKinds" JSONB NOT NULL DEFAULT '[]',
    "labels" JSONB NOT NULL DEFAULT '[]',
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectTemplate_pkey" PRIMARY KEY ("id")
);

-- Adjuntos de cualquier tipo (las imágenes siguen convirtiéndose a WebP).
ALTER TABLE "TaskAttachment" ADD COLUMN "mimeType" TEXT NOT NULL DEFAULT 'image/webp';
ALTER TABLE "TaskAttachment" ADD COLUMN "isImage" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TaskAttachment" ALTER COLUMN "width" DROP NOT NULL;
ALTER TABLE "TaskAttachment" ALTER COLUMN "height" DROP NOT NULL;
