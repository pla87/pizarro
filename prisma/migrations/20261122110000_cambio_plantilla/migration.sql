-- «Aplicar plantilla» en los ajustes de un proyecto: el último cambio de plantilla de cada proyecto, con lo que había
-- antes, para poder deshacerlo durante un tiempo limitado. Solo añade una tabla.
CREATE TABLE "ProjectTemplateChange" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "templateName" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTemplateChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectTemplateChange_projectId_key" ON "ProjectTemplateChange"("projectId");

ALTER TABLE "ProjectTemplateChange" ADD CONSTRAINT "ProjectTemplateChange_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectTemplateChange" ADD CONSTRAINT "ProjectTemplateChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
