-- Índices sobre claves foráneas usadas al borrar tareas/proyectos (cascada) y en la limpieza de avisos.
CREATE INDEX IF NOT EXISTS "Notification_taskId_idx" ON "Notification"("taskId");
CREATE INDEX IF NOT EXISTS "Notification_readAt_createdAt_idx" ON "Notification"("readAt", "createdAt");
CREATE INDEX IF NOT EXISTS "UndoEntry_projectId_idx" ON "UndoEntry"("projectId");
