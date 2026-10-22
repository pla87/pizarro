-- Productividad: subtareas predefinidas por tipo y tareas recurrentes.
CREATE TYPE "Recurrence" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');

ALTER TABLE "TaskKind" ADD COLUMN "subtaskTemplate" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Task" ADD COLUMN "recurrence" "Recurrence" NOT NULL DEFAULT 'NONE',
ADD COLUMN "recurrenceDay" INTEGER,
ADD COLUMN "recurrenceFromId" TEXT;

CREATE UNIQUE INDEX "Task_recurrenceFromId_key" ON "Task"("recurrenceFromId");

ALTER TABLE "Task" ADD CONSTRAINT "Task_recurrenceFromId_fkey" FOREIGN KEY ("recurrenceFromId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
