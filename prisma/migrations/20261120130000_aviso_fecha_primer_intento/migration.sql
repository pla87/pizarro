-- Avisos de cambio de fecha: primer intento de envío. Los reintentos se abandonan a las 24 h desde aquí (antes, desde
-- el primer cambio, y un apagado de más de un día tiraba todos los avisos pendientes). Las filas existentes empiezan
-- sin intento: el siguiente reclamo lo fija.
ALTER TABLE "PendingDueNotice" ADD COLUMN "claimedAt" TIMESTAMP(3);
