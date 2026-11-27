-- Avisos push del navegador (v1.78). Solo añade: una tabla nueva (los dispositivos suscritos), las preferencias por tipo
-- en "User" (con sus valores por defecto) y "Notification"."pushSentAt". La v1.77 no las lee y sigue funcionando sobre la
-- base migrada (no envía avisos push; cerrar una sesión o borrar una cuenta borra sus dispositivos por las claves ajenas).
-- Sin valores de enum nuevos.
BEGIN;
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpointHash" TEXT NOT NULL,
    "endpointEnc" TEXT NOT NULL,
    "keysEnc" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "sessionId" TEXT NOT NULL,
    "vapidPublicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSentAt" TIMESTAMP(3),
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushSubscription_endpointHash_key" ON "PushSubscription"("endpointHash");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
CREATE INDEX "PushSubscription_sessionId_idx" ON "PushSubscription"("sessionId");
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Cerrar la sesión (por cualquier vía, también desde la v1.77) borra los avisos push de ese dispositivo.
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "User" ADD COLUMN "pushNotifyMention" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "pushNotifyAssigned" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "pushNotifyDue" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "pushNotifyComment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Notification" ADD COLUMN "pushSentAt" TIMESTAMP(3);
COMMIT;
