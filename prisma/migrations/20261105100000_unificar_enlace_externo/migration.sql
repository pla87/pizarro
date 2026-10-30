-- Un solo enlace externo por tarea: el «enlace de referencia» (externalUrl) pasa a linkUrl si este está vacío;
-- si las dos tenían valor se conserva linkUrl.
UPDATE "Task" SET "linkUrl" = "externalUrl" WHERE "linkUrl" IS NULL AND "externalUrl" IS NOT NULL;

ALTER TABLE "Task" DROP COLUMN "externalUrl";

-- El interruptor del campo opcional desaparece de los proyectos y plantillas.
UPDATE "Project" SET "taskFields" = array_remove("taskFields", 'externalUrl') WHERE 'externalUrl' = ANY("taskFields");
UPDATE "ProjectTemplate" SET "taskFields" = array_remove("taskFields", 'externalUrl') WHERE 'externalUrl' = ANY("taskFields");
