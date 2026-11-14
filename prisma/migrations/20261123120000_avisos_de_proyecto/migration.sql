-- Avisos de un proyecto (sin tarea): a los administradores cuando un proyecto privado pasa a ser de equipo al borrarse
-- la cuenta de su único miembro. Solo añade: la versión anterior no escribe este tipo ni la columna, y sus consultas de
-- avisos filtran por tarea, así que no los lee.
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_TO_TEAM';

ALTER TABLE "Notification" ADD COLUMN "projectId" TEXT;

CREATE INDEX "Notification_projectId_idx" ON "Notification"("projectId");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
