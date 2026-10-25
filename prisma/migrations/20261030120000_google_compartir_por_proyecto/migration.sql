-- Modo de compartir los Docs/Sheets por proyecto (null = el comportamiento por defecto según GOOGLE_SHARE_ROLE,
-- así que los proyectos existentes no cambian) y resultado de compartir en cada enlace.
ALTER TABLE "Project" ADD COLUMN "googleShareMode" TEXT;
ALTER TABLE "TaskLink" ADD COLUMN "shareStatus" TEXT;
ALTER TABLE "TaskLink" ADD COLUMN "shareFailed" INTEGER NOT NULL DEFAULT 0;
