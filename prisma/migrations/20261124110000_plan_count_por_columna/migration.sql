-- El ritmo («cada dos», «cada tres») de las tareas fijas de un plan de trabajo para IA se cuenta por columna, no por proyecto.
-- Las columnas de plan existentes parten del contador del proyecto: así el siguiente plan de cada una sigue tocando lo mismo que hasta ahora.
ALTER TABLE "Column" ADD COLUMN "planCount" INTEGER NOT NULL DEFAULT 0;
UPDATE "Column" c SET "planCount" = p."aiPlanCount" FROM "Project" p WHERE p."id" = c."projectId" AND c."role" = 'AI_PLAN';
