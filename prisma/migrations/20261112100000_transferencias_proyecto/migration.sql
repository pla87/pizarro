-- CreateEnum
CREATE TYPE "TransferKind" AS ENUM ('EXPORT', 'IMPORT');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ProjectTransferJob" (
    "id" TEXT NOT NULL,
    "kind" "TransferKind" NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'QUEUED',
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "options" JSONB NOT NULL DEFAULT '{}',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ProjectTransferJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectTransferJob_status_createdAt_idx" ON "ProjectTransferJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectTransferJob_userId_createdAt_idx" ON "ProjectTransferJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectTransferJob_projectId_idx" ON "ProjectTransferJob"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectTransferJob" ADD CONSTRAINT "ProjectTransferJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
