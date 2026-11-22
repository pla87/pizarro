-- Las cuentas nuevas tienen marcada de serie «Email con los cambios de fecha límite y los recordatorios de «Esperando»»
-- (Mi perfil → Avisos). Lo que lo hace es el @default de schema.prisma: el cliente de cada versión manda su propio
-- valor por defecto en el INSERT, sin usar el de la base. Esto solo alinea la base con el esquema (cuenta para filas
-- creadas con SQL a mano); las cuentas que ya existen conservan lo que tenían, y la versión anterior, si se vuelve a
-- ella, sigue creando las cuentas con su valor (false).
BEGIN;

ALTER TABLE "User" ALTER COLUMN "notifyDueEmail" SET DEFAULT true;

COMMIT;
