-- Columna de origen de las tareas archivadas (para restaurarlas en su sitio).
ALTER TABLE "Task" ADD COLUMN "archivedFromColumnId" TEXT;
UPDATE "Task" SET "archivedFromColumnId" = "columnId" WHERE "archivedAt" IS NOT NULL;

-- Registro de actividad (logs de administración).
CREATE TABLE "AppLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "userName" TEXT,
    "projectId" TEXT,
    "path" TEXT,
    "durationMs" INTEGER,
    "ip" TEXT,
    "details" JSONB,
    CONSTRAINT "AppLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AppLog_createdAt_idx" ON "AppLog"("createdAt");
CREATE INDEX "AppLog_category_createdAt_idx" ON "AppLog"("category", "createdAt");
CREATE INDEX "AppLog_userId_createdAt_idx" ON "AppLog"("userId", "createdAt");
