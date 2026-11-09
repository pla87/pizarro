-- AlterTable: recordatorio de licencia para administradores. Hasta esta fecha no se le vuelve a mostrar (se fija al
-- verlo o al pulsar «Recordar más tarde»: como mucho una vez cada 30 días). Null: aún no lo ha visto.
ALTER TABLE "User" ADD COLUMN "licenseNudgeUntil" TIMESTAMP(3);
