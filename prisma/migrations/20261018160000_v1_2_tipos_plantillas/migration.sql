-- v1.2: tipos de tarea configurables, varias plantillas de release por usuario y estilo de tarjeta.
-- Migración escrita a mano para conservar los datos existentes.

-- 1. Tipos de tarea configurables -------------------------------------------------
CREATE TABLE "TaskKind" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskKind_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaskKind_name_key" ON "TaskKind"("name");

INSERT INTO "TaskKind" ("id", "name", "color", "position") VALUES
    ('kind_funcionalidad', 'Funcionalidad', '#22c55e', 1024),
    ('kind_correccion', 'Corrección', '#f97316', 2048);

-- Feature, Chore y Refactor pasan a Funcionalidad; Fix y Hotfix, a Corrección.
ALTER TABLE "Task" ADD COLUMN "kindId" TEXT;
UPDATE "Task" SET "kindId" = CASE WHEN "type" IN ('FIX', 'HOTFIX') THEN 'kind_correccion' ELSE 'kind_funcionalidad' END;
ALTER TABLE "Task" ALTER COLUMN "kindId" SET NOT NULL;
ALTER TABLE "Task" DROP COLUMN "type";
CREATE INDEX "Task_kindId_idx" ON "Task"("kindId");
ALTER TABLE "Task" ADD CONSTRAINT "Task_kindId_fkey" FOREIGN KEY ("kindId") REFERENCES "TaskKind"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Las releases guardan el nombre del tipo como instantánea.
ALTER TABLE "ReleaseTask" ADD COLUMN "kindName" TEXT;
UPDATE "ReleaseTask" SET "kindName" = CASE WHEN "type" IN ('FIX', 'HOTFIX') THEN 'Corrección' ELSE 'Funcionalidad' END;
ALTER TABLE "ReleaseTask" ALTER COLUMN "kindName" SET NOT NULL;
ALTER TABLE "ReleaseTask" DROP COLUMN "type";

DROP TYPE "TaskType";

-- 2. Varias cabeceras y pies por usuario ------------------------------------------
CREATE TYPE "TemplateKind" AS ENUM ('HEADER', 'FOOTER');
CREATE TABLE "ReleaseTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "TemplateKind" NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReleaseTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReleaseTemplate_userId_kind_position_idx" ON "ReleaseTemplate"("userId", "kind", "position");
ALTER TABLE "ReleaseTemplate" ADD CONSTRAINT "ReleaseTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ReleaseTemplate" ("id", "userId", "kind", "name", "content", "position")
    SELECT 'tplh_' || "id", "id", 'HEADER', 'Predeterminada', "releaseHeaderTemplate", 1024 FROM "User" WHERE btrim("releaseHeaderTemplate") <> '';
INSERT INTO "ReleaseTemplate" ("id", "userId", "kind", "name", "content", "position")
    SELECT 'tplf_' || "id", "id", 'FOOTER', 'Predeterminado', "releaseFooterTemplate", 1024 FROM "User" WHERE btrim("releaseFooterTemplate") <> '';

ALTER TABLE "User" DROP COLUMN "releaseHeaderTemplate";
ALTER TABLE "User" DROP COLUMN "releaseFooterTemplate";

-- 3. Estilo de tarjeta ---------------------------------------------------------------
CREATE TYPE "CardStyle" AS ENUM ('STRIPE', 'FILLED');
ALTER TABLE "User" ADD COLUMN "cardStyle" "CardStyle" NOT NULL DEFAULT 'STRIPE';
