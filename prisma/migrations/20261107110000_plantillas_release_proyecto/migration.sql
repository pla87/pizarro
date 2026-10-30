-- Cabeceras y pies de release a nivel de proyecto (se borran con el proyecto).
CREATE TABLE "ProjectReleaseTemplate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "TemplateKind" NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectReleaseTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectReleaseTemplate_projectId_kind_position_idx" ON "ProjectReleaseTemplate"("projectId", "kind", "position");

ALTER TABLE "ProjectReleaseTemplate" ADD CONSTRAINT "ProjectReleaseTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
