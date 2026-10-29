-- Campos opcionales de las tareas (coste, horas, prioridad, cliente, fecha de inicio, enlace externo) y rol de columna BUDGET.
CREATE TYPE "TaskPriority" AS ENUM ('BAJA', 'MEDIA', 'ALTA', 'URGENTE');

ALTER TABLE "Project" ADD COLUMN "taskFields" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ProjectTemplate" ADD COLUMN "taskFields" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Task" ADD COLUMN "cost" DECIMAL(12,2),
ADD COLUMN "costPaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "estimatedHours" DECIMAL(7,2),
ADD COLUMN "actualHours" DECIMAL(7,2),
ADD COLUMN "priority" "TaskPriority",
ADD COLUMN "client" TEXT,
ADD COLUMN "startDate" DATE,
ADD COLUMN "externalUrl" TEXT;

CREATE INDEX "Task_projectId_client_idx" ON "Task"("projectId", "client");

-- BUDGET se puede repetir (el índice único parcial solo afecta a NEXT_RELEASE e IN_PRODUCTION).
ALTER TYPE "ColumnRole" ADD VALUE 'BUDGET';
