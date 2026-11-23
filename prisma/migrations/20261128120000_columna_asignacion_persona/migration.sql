-- Columna «Asignación a persona»: la persona a la que pasa toda tarea que entra en la columna y, opcional, el plazo en
-- días para la fecha límite de las que entran sin fecha. Solo añade columnas nulables (la columna sigue con rol NONE):
-- la versión anterior no las lee ni las escribe, y una columna configurada se ve allí como una columna normal.
BEGIN;

ALTER TABLE "Column" ADD COLUMN "assigneeId" TEXT;
ALTER TABLE "Column" ADD COLUMN "assignDueDays" INTEGER;
ALTER TABLE "Column" ADD CONSTRAINT "Column_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Column_assigneeId_idx" ON "Column"("assigneeId");

COMMIT;
