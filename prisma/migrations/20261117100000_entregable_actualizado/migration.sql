-- AlterTable: fecha del último cambio de cada entregable (la usa el calendario suscrito para SEQUENCE y LAST-MODIFIED).
ALTER TABLE "Deliverable" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Los existentes conservan su fecha de creación (no «cambian» todos a la vez en el momento de migrar).
UPDATE "Deliverable" SET "updatedAt" = "createdAt";
