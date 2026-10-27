-- Roles de columna que se pueden repetir (WAITING, WEEKLY_PLAN): solo NEXT_RELEASE e IN_PRODUCTION siguen siendo únicos.
ALTER TYPE "ColumnRole" ADD VALUE 'WAITING';
ALTER TYPE "ColumnRole" ADD VALUE 'WEEKLY_PLAN';
ALTER TYPE "NotificationType" ADD VALUE 'WAITING';

ALTER TABLE "Column" ADD COLUMN "waitingDays" INTEGER;
ALTER TABLE "Task" ADD COLUMN "columnEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "waitingNotifiedAt" TIMESTAMP(3);

DROP INDEX "Column_projectId_role_unique";
CREATE UNIQUE INDEX "Column_projectId_role_unique" ON "Column"("projectId", "role") WHERE "role" IN ('NEXT_RELEASE', 'IN_PRODUCTION');

-- Al cambiar una tarea de columna (desde cualquier camino: mover, deshacer, masivo…) empieza una estancia nueva.
CREATE FUNCTION "task_column_entered"() RETURNS trigger AS $$
BEGIN
  IF NEW."columnId" IS DISTINCT FROM OLD."columnId" THEN
    NEW."columnEnteredAt" := CURRENT_TIMESTAMP;
    NEW."waitingNotifiedAt" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Task_column_entered" BEFORE UPDATE OF "columnId" ON "Task"
FOR EACH ROW EXECUTE FUNCTION "task_column_entered"();
