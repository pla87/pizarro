-- Tarea «bloqueada por» otra del mismo proyecto (una sola, opcional). Si la tarea que bloquea se borra, el enlace se quita.
ALTER TABLE "Task" ADD COLUMN "blockedById" TEXT;
ALTER TABLE "Task" ADD CONSTRAINT "Task_blockedById_fkey" FOREIGN KEY ("blockedById") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_blockedById_not_self" CHECK ("blockedById" IS NULL OR "blockedById" <> "id");
CREATE INDEX "Task_blockedById_idx" ON "Task"("blockedById");
