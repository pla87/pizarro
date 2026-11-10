-- Avisos de comentario: el comentario que los creó (para actualizar o vaciar su extracto al editarlo o borrarlo).
-- Sin clave ajena: deshacer el borrado de un comentario lo recrea con el mismo id.
ALTER TABLE "Notification" ADD COLUMN "commentId" TEXT;

-- CreateIndex
CREATE INDEX "Notification_commentId_idx" ON "Notification"("commentId");
