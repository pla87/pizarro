-- Menciones en notas de Documentación y título automático (v1.77). Solo añade columnas (y un índice y su clave ajena):
-- la v1.76 no las lee y sigue funcionando sobre la base migrada. Los avisos de una nota son MENTION (valor que ya
-- existe) con "documentId" y sin tarea ni proyecto, así que la campana de la v1.76 no los muestra.
-- Las notas que siguen con el nombre por defecto («Nota sin título» o «Untitled note») toman su nombre de la primera
-- línea en su próximo guardado.
BEGIN;
ALTER TABLE "Notification" ADD COLUMN "documentId" TEXT;
CREATE INDEX "Notification_documentId_idx" ON "Notification"("documentId");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectDocument" ADD COLUMN "noteAutoName" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ProjectDocument" SET "noteAutoName" = true WHERE "noteContent" IS NOT NULL AND "name" IN ('Nota sin título', 'Untitled note');
ALTER TABLE "User" ADD COLUMN "noteMentionEmail" TEXT;
COMMIT;
