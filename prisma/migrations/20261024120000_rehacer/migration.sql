-- Rehacer: las entradas de deshacer pasan a tener pila (UNDO o REDO).
CREATE TYPE "UndoKind" AS ENUM ('UNDO', 'REDO');

ALTER TABLE "UndoEntry" ADD COLUMN "kind" "UndoKind" NOT NULL DEFAULT 'UNDO';

DROP INDEX "UndoEntry_userId_projectId_createdAt_idx";
CREATE INDEX "UndoEntry_userId_projectId_kind_createdAt_idx" ON "UndoEntry"("userId", "projectId", "kind", "createdAt");
