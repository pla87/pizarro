-- Colaboración: más avisos, seguimiento de tareas, historial, respuestas a comentarios, resumen diario e informe semanal.
ALTER TYPE "NotificationType" ADD VALUE 'ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'DUE_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'COMMENT';
ALTER TYPE "NotificationType" ADD VALUE 'REPLY';

ALTER TABLE "User" ADD COLUMN "notifyAssignedEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "notifyDueEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "notifyCommentEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "dailyDigest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "digestHour" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN "lastDigestAt" TIMESTAMP(3);

ALTER TABLE "TaskComment" ADD COLUMN "parentId" TEXT;
CREATE INDEX "TaskComment_parentId_idx" ON "TaskComment"("parentId");
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TaskComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TaskFollower" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskFollower_pkey" PRIMARY KEY ("taskId","userId")
);
CREATE INDEX "TaskFollower_userId_idx" ON "TaskFollower"("userId");
ALTER TABLE "TaskFollower" ADD CONSTRAINT "TaskFollower_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskFollower" ADD CONSTRAINT "TaskFollower_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TaskEvent_taskId_createdAt_idx" ON "TaskEvent"("taskId", "createdAt");
CREATE INDEX "TaskEvent_projectId_code_createdAt_idx" ON "TaskEvent"("projectId", "code", "createdAt");
CREATE INDEX "TaskEvent_createdAt_idx" ON "TaskEvent"("createdAt");
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReportSchedule" (
    "projectId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "recipient" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL DEFAULT 1,
    "hour" INTEGER NOT NULL DEFAULT 8,
    "lastSentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("projectId")
);
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
