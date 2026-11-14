-- Rol de columna repetible «Plan de trabajo para IA» (genera un plan en Markdown para un agente, con tareas fijas),
-- sus plantillas de cabecera y pie (en las mismas tablas que las de release) y el contador de versiones del plan.
ALTER TYPE "ColumnRole" ADD VALUE 'AI_PLAN';
ALTER TYPE "TemplateKind" ADD VALUE 'PLAN_HEADER';
ALTER TYPE "TemplateKind" ADD VALUE 'PLAN_FOOTER';
ALTER TABLE "Project" ADD COLUMN "aiPlanCount" INTEGER NOT NULL DEFAULT 0;
