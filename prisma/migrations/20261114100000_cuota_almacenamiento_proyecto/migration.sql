-- Cuota de almacenamiento propia de cada proyecto (MB); NULL = la general.
ALTER TABLE "Project" ADD COLUMN "storageQuotaMb" INTEGER;
