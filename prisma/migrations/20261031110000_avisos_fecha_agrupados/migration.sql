-- CreateTable
CREATE TABLE "PendingDueNotice" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "actorId" TEXT,
    "fromDue" TEXT,
    "toDue" TEXT,
    "sendAfter" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingDueNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingDueNotice_taskId_recipientId_key" ON "PendingDueNotice"("taskId", "recipientId");
CREATE INDEX "PendingDueNotice_sendAfter_idx" ON "PendingDueNotice"("sendAfter");
CREATE INDEX "PendingDueNotice_recipientId_idx" ON "PendingDueNotice"("recipientId");
CREATE INDEX "PendingDueNotice_actorId_idx" ON "PendingDueNotice"("actorId");

-- AddForeignKey
ALTER TABLE "PendingDueNotice" ADD CONSTRAINT "PendingDueNotice_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PendingDueNotice" ADD CONSTRAINT "PendingDueNotice_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PendingDueNotice" ADD CONSTRAINT "PendingDueNotice_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
