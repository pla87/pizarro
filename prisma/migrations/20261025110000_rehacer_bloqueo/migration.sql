-- Rehacer: huella del estado afectado para no rehacer sobre cambios ajenos.
ALTER TABLE "UndoEntry" ADD COLUMN IF NOT EXISTS "fingerprint" TEXT;
