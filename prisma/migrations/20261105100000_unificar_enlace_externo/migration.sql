-- Un solo enlace externo por tarea: el «enlace de referencia» (externalUrl) pasa a linkUrl si este está vacío;
-- si las dos tenían valor (y distinto) se conserva linkUrl y el otro se añade al final de la descripción para no perderlo.
UPDATE "Task" SET "description" = CASE WHEN "description" = '' THEN '' ELSE "description" || E'\n\n' END || 'Enlace de referencia: ' || "externalUrl"
  WHERE "linkUrl" IS NOT NULL AND "externalUrl" IS NOT NULL AND "externalUrl" <> "linkUrl";
UPDATE "Task" SET "linkUrl" = "externalUrl" WHERE "linkUrl" IS NULL AND "externalUrl" IS NOT NULL;

ALTER TABLE "Task" DROP COLUMN "externalUrl";

-- El interruptor del campo opcional desaparece de los proyectos y plantillas.
UPDATE "Project" SET "taskFields" = array_remove("taskFields", 'externalUrl') WHERE 'externalUrl' = ANY("taskFields");
UPDATE "ProjectTemplate" SET "taskFields" = array_remove("taskFields", 'externalUrl') WHERE 'externalUrl' = ANY("taskFields");
