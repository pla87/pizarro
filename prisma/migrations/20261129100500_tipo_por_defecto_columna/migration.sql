-- «Tipo por defecto» de una columna: el tipo con el que se abre «Nueva tarea» desde ella (null = el último que usó la
-- persona). Solo añade una columna nulable: la versión anterior no la lee ni la escribe. Si el tipo se borra, vuelve a null.
BEGIN;

ALTER TABLE "Column" ADD COLUMN "defaultKindId" TEXT;
ALTER TABLE "Column" ADD CONSTRAINT "Column_defaultKindId_fkey" FOREIGN KEY ("defaultKindId") REFERENCES "TaskKind"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Column_defaultKindId_idx" ON "Column"("defaultKindId");

COMMIT;
