-- Copias de adjuntos pendientes de una release (se retoman al arrancar) y cadencia de las tareas fijas.
ALTER TABLE "Release" ADD COLUMN "attachmentsPending" JSONB;
ALTER TABLE "Task" ADD COLUMN "evergreenEvery" INTEGER NOT NULL DEFAULT 1;
