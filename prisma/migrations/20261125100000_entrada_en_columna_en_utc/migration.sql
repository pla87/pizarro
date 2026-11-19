-- La hora de entrada en la columna se guarda en UTC aunque la base o la sesión estén en otra zona: las columnas son
-- timestamp(3) sin zona y Prisma las lee como UTC (CURRENT_TIMESTAMP a secas dejaba la hora local de la sesión).
CREATE OR REPLACE FUNCTION "task_column_entered"() RETURNS trigger AS $$
BEGIN
  IF NEW."columnId" IS DISTINCT FROM OLD."columnId" THEN
    NEW."columnEnteredAt" := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
    NEW."waitingNotifiedAt" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
