-- Orden de los proyectos elegido por cada usuario (Mi perfil → Preferencias): «Usados recientemente» (de serie) o
-- «Alfabético». Para el primero, la última apertura de cada proyecto por usuario (ProjectVisit), que se borra con el
-- usuario o el proyecto. Solo añade: un tipo nuevo, una columna con valor por defecto y una tabla.
BEGIN;
CREATE TYPE "ProjectOrder" AS ENUM ('RECENT', 'ALPHABETICAL');

ALTER TABLE "User" ADD COLUMN "projectOrder" "ProjectOrder" NOT NULL DEFAULT 'RECENT';

CREATE TABLE "ProjectVisit" (
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectVisit_pkey" PRIMARY KEY ("userId","projectId")
);

CREATE INDEX "ProjectVisit_projectId_idx" ON "ProjectVisit"("projectId");

ALTER TABLE "ProjectVisit" ADD CONSTRAINT "ProjectVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectVisit" ADD CONSTRAINT "ProjectVisit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
