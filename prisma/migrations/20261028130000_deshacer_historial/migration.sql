-- Deshacer borra las entradas de historial que revierte: la entrada recuerda sus ids (UNDO) o una copia para recrearlas (REDO).
ALTER TABLE "UndoEntry" ADD COLUMN IF NOT EXISTS "eventIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "UndoEntry" ADD COLUMN IF NOT EXISTS "events" JSONB;
