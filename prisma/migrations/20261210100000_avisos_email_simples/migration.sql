-- «Notificaciones por email» simplificadas (v1.79). Solo añade columnas (no borra ni cambia ninguna): la v1.78 no las
-- lee y sigue funcionando sobre la base migrada con lo que tenía (notifyEmail sigue como «menciones»).
--   emailNotices: casilla principal. Marcada si la persona recibía algún email de avisos o el resumen diario.
--   notifyAdminEmail: emails de administración, que hasta ahora iban con notifyEmail: se copia su valor.
-- Quien tiene el resumen diario lo seguirá recibiendo igual: ahora el resumen solo trae lo que está marcado, así que se
-- marcan para esas cuentas asignaciones, fechas y comentarios (el resumen ya los traía siempre). Con resumen diario los
-- emails de menciones, asignaciones y comentarios dejan de salir además al momento: van solo en el resumen.
-- noteMentionEmail (v1.77) ya no se lee ni se escribe (no se borra la columna en esta versión) y NO se convierte: las
-- menciones en notas pasan a seguir la casilla de menciones (notifyEmail), porque no hay forma de separar notas de
-- tareas. Lo menos sorprendente es dejar las menciones como estaban: quien tenía «No» en las notas y menciones marcadas
-- recibe ahora también las de notas; quien tenía «Al momento» en notas con las menciones desmarcadas ya no las recibe
-- (no se le marcan las de tareas, que no pidió); quien tenía «En el resumen» sin resumen activo las recibe al momento.
BEGIN;
ALTER TABLE "User" ADD COLUMN "emailNotices" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "notifyAdminEmail" BOOLEAN NOT NULL DEFAULT true;
UPDATE "User" SET "notifyAdminEmail" = "notifyEmail";
UPDATE "User" SET "emailNotices" = ("notifyEmail" OR "notifyAssignedEmail" OR "notifyDueEmail" OR "notifyCommentEmail" OR "dailyDigest");
UPDATE "User" SET "notifyAssignedEmail" = true, "notifyDueEmail" = true, "notifyCommentEmail" = true WHERE "dailyDigest";
COMMIT;
