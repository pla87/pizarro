-- «Compartir fuera»: el token del enlace actual, cifrado con ENCRYPTION_KEY (como los tokens de Telegram y WhatsApp),
-- para que cualquiera del proyecto vuelva a ver la dirección en el diálogo de la columna. Solo añade una columna que
-- admite nulos: una versión anterior la ignora. La búsqueda por la huella (tokenHash) no cambia.
BEGIN;
ALTER TABLE "ColumnShare" ADD COLUMN "tokenEnc" TEXT;
COMMIT;
