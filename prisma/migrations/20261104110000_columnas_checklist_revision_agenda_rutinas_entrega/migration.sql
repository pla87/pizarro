-- Nuevos roles de columna repetibles (el índice único parcial solo afecta a NEXT_RELEASE e IN_PRODUCTION).
ALTER TYPE "ColumnRole" ADD VALUE 'CHECKLIST';
ALTER TYPE "ColumnRole" ADD VALUE 'REVIEW';
ALTER TYPE "ColumnRole" ADD VALUE 'AGENDA';
ALTER TYPE "ColumnRole" ADD VALUE 'ROUTINES';
ALTER TYPE "ColumnRole" ADD VALUE 'DELIVERY';

-- Rutinas: columna destino de la siguiente aparición (null = la misma columna).
ALTER TABLE "Column" ADD COLUMN "routineTargetColumnId" TEXT;
ALTER TABLE "Column" ADD CONSTRAINT "Column_routineTargetColumnId_fkey" FOREIGN KEY ("routineTargetColumnId") REFERENCES "Column"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rutinas: la tarea recuerda la última columna ROUTINES en la que estuvo, venga el cambio de donde venga.
ALTER TABLE "Task" ADD COLUMN "routineColumnId" TEXT;

CREATE FUNCTION "task_routine_origin"() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW."columnId" IS DISTINCT FROM OLD."columnId")
     AND EXISTS (SELECT 1 FROM "Column" WHERE "id" = NEW."columnId" AND "role" = 'ROUTINES') THEN
    NEW."routineColumnId" := NEW."columnId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Task_routine_origin" BEFORE INSERT OR UPDATE OF "columnId" ON "Task"
FOR EACH ROW EXECUTE FUNCTION "task_routine_origin"();
