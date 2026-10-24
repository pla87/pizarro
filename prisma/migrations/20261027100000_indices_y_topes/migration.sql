-- Índices: createdAt de Task y TaskComment (resumen periódico por correo) y claves foráneas con SetNull sin índice
-- (al borrar un usuario, PostgreSQL recorría la tabla entera para anular sus referencias).
CREATE INDEX IF NOT EXISTS "Task_createdAt_idx" ON "Task"("createdAt");
CREATE INDEX IF NOT EXISTS "Task_createdById_idx" ON "Task"("createdById");
CREATE INDEX IF NOT EXISTS "TaskComment_createdAt_idx" ON "TaskComment"("createdAt");
CREATE INDEX IF NOT EXISTS "TaskComment_authorId_idx" ON "TaskComment"("authorId");
CREATE INDEX IF NOT EXISTS "TaskAttachment_createdById_idx" ON "TaskAttachment"("createdById");
CREATE INDEX IF NOT EXISTS "TaskLink_createdById_idx" ON "TaskLink"("createdById");
CREATE INDEX IF NOT EXISTS "Release_createdById_idx" ON "Release"("createdById");
CREATE INDEX IF NOT EXISTS "Notification_actorId_idx" ON "Notification"("actorId");
