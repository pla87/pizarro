-- Detección de ediciones simultáneas
ALTER TABLE "Task" ADD COLUMN "contentUpdatedAt" TIMESTAMP(3), ADD COLUMN "contentUpdatedById" TEXT;

-- Deshacer: últimas acciones de cada usuario por proyecto
CREATE TABLE "UndoEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ops" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UndoEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UndoEntry_userId_projectId_createdAt_idx" ON "UndoEntry"("userId", "projectId", "createdAt");
CREATE INDEX "UndoEntry_createdAt_idx" ON "UndoEntry"("createdAt");
ALTER TABLE "UndoEntry" ADD CONSTRAINT "UndoEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UndoEntry" ADD CONSTRAINT "UndoEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
