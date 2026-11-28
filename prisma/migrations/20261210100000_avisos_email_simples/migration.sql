-- «Notificaciones por email» simplificadas (v1.79). Solo añade columnas (no borra ni cambia ninguna): la v1.78 no las
-- lee y sigue funcionando sobre la base migrada con lo que tenía (notifyEmail sigue como «menciones»).
--   emailNotices: casilla principal. Marcada si la persona recibía algún email de avisos o el resumen diario.
--   notifyAdminEmail: emails de administración, que hasta ahora iban con notifyEmail: se copia su valor.
-- Quien tiene el resumen diario lo seguirá recibiendo igual: ahora el resumen solo trae lo que está marcado, así que se
-- marcan para esas cuentas asignaciones, fechas y comentarios (el resumen ya los traía siempre). noteMentionEmail ya no
-- se lee (no se borra la columna en esta versión).
BEGIN;
ALTER TABLE "User" ADD COLUMN "emailNotices" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "notifyAdminEmail" BOOLEAN NOT NULL DEFAULT true;
UPDATE "User" SET "notifyAdminEmail" = "notifyEmail";
UPDATE "User" SET "emailNotices" = ("notifyEmail" OR "notifyAssignedEmail" OR "notifyDueEmail" OR "notifyCommentEmail" OR "dailyDigest");
UPDATE "User" SET "notifyAssignedEmail" = true, "notifyDueEmail" = true, "notifyCommentEmail" = true WHERE "dailyDigest";
COMMIT;
