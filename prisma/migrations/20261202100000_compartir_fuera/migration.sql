-- «Compartir fuera»: una columna (rol NONE, sin valor nuevo del enum) cuyas tareas se publican en una página sin cuenta
-- (/x/<token>). Solo añade: el interruptor del proyecto (apagado por defecto) y la tabla ColumnShare, que una versión
-- anterior ignora (la columna vuelve a ser una columna normal). Del token solo se guarda su huella HMAC.
BEGIN;
ALTER TABLE "Project" ADD COLUMN "shareOutEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ColumnShare" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "columnId" TEXT,
    "tokenHash" TEXT,
    "expiryDays" INTEGER NOT NULL DEFAULT 30,
    "taskIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "generatedAt" TIMESTAMP(3),
    "generatedById" TEXT,
    "generatedByName" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "oldTokenHash" TEXT,
    "oldEndedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ColumnShare_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ColumnShare_columnId_key" ON "ColumnShare"("columnId");
CREATE UNIQUE INDEX "ColumnShare_tokenHash_key" ON "ColumnShare"("tokenHash");
CREATE UNIQUE INDEX "ColumnShare_oldTokenHash_key" ON "ColumnShare"("oldTokenHash");
CREATE INDEX "ColumnShare_projectId_idx" ON "ColumnShare"("projectId");
ALTER TABLE "ColumnShare" ADD CONSTRAINT "ColumnShare_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ColumnShare" ADD CONSTRAINT "ColumnShare_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "Column"("id") ON DELETE SET NULL ON UPDATE CASCADE;
COMMIT;
