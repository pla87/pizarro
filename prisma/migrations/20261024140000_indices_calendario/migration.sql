-- Calendario: tareas y entregables por proyecto y fecha.
CREATE INDEX IF NOT EXISTS "Task_projectId_dueDate_idx" ON "Task"("projectId", "dueDate");
CREATE INDEX IF NOT EXISTS "Deliverable_projectId_dueDate_idx" ON "Deliverable"("projectId", "dueDate");
