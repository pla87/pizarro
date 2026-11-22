-- Las cuentas nuevas tienen marcada de serie «Email con los cambios de fecha límite y los recordatorios de «Esperando»»
-- (Mi perfil → Avisos). Solo cambia el valor por defecto de la columna: las cuentas que ya existen conservan lo que
-- tenían. La versión anterior no se ve afectada (Prisma solo usa el valor por defecto de la base al crear la fila).
BEGIN;

ALTER TABLE "User" ALTER COLUMN "notifyDueEmail" SET DEFAULT true;

COMMIT;
