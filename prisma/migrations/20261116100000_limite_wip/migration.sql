-- Límite orientativo de tarjetas por columna (solo avisa; nunca bloquea).
ALTER TABLE "Column" ADD COLUMN "wipLimit" INTEGER;
ALTER TABLE "Column" ADD CONSTRAINT "Column_wipLimit_range" CHECK ("wipLimit" IS NULL OR ("wipLimit" >= 1 AND "wipLimit" <= 999));
