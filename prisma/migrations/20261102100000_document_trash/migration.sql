-- AlterTable
ALTER TABLE "ProjectDocument" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT;

-- CreateIndex
CREATE INDEX "ProjectDocument_deletedById_idx" ON "ProjectDocument"("deletedById");

-- CreateIndex
CREATE INDEX "ProjectDocument_deletedAt_idx" ON "ProjectDocument"("deletedAt");

-- CreateIndex
CREATE INDEX "ProjectDocument_projectId_deletedAt_idx" ON "ProjectDocument"("projectId", "deletedAt");

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
