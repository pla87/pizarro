-- Tipos de tarea exclusivos de un proyecto.
ALTER TABLE "TaskKind" ADD COLUMN "projectId" TEXT;
ALTER TABLE "TaskKind" ADD CONSTRAINT "TaskKind_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "TaskKind_projectId_idx" ON "TaskKind"("projectId");

-- El nombre deja de ser único global: único entre los generales y dentro de cada proyecto.
DROP INDEX "TaskKind_name_key";
CREATE UNIQUE INDEX "TaskKind_global_name_key" ON "TaskKind"(lower("name")) WHERE "projectId" IS NULL;
CREATE UNIQUE INDEX "TaskKind_project_name_key" ON "TaskKind"("projectId", lower("name")) WHERE "projectId" IS NOT NULL;
