-- Baja del informe semanal recordada: qué dirección se dio de baja desde el enlace del email y cuándo (Ajustes del
-- proyecto → Informes lo muestra y no deja volver a activarlo hacia esa dirección salvo a esa misma persona), y el aviso
-- en la campana a quien lo configuró (REPORT_UNSUBSCRIBED, un aviso de proyecto como PROJECT_TO_TEAM). Solo añade, y
-- la versión anterior no lee las columnas ni escribe este tipo de aviso, pero sí lee las filas de "Notification": si se
-- vuelve a la v1.64 después de crearse avisos REPORT_UNSUBSCRIBED, su cliente Prisma no conoce ese valor y lanza al
-- leerlos, así que la página de Avisos falla a quien los tenga (la campana sigue contando bien: solo lee el id) hasta
-- borrarlos o volver a esta versión.
BEGIN;

ALTER TYPE "NotificationType" ADD VALUE 'REPORT_UNSUBSCRIBED';

ALTER TABLE "ReportSchedule" ADD COLUMN "unsubscribedEmail" TEXT;
ALTER TABLE "ReportSchedule" ADD COLUMN "unsubscribedAt" TIMESTAMP(3);

COMMIT;
