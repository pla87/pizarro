-- Mensaje de los logs también en inglés (AppLog.messageEn), para que «Buscar» en Administración → Logs encuentre las
-- palabras del idioma de quien mira. Solo añade una columna que admite null: las filas anteriores la tienen vacía y el
-- buscador en inglés mira entonces el mensaje en español. Sin índice: la búsqueda en español tampoco lo tiene (ILIKE
-- dentro del periodo elegido, que acota el índice por fecha).
BEGIN;
ALTER TABLE "AppLog" ADD COLUMN "messageEn" TEXT;
COMMIT;
