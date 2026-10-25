-- AlterTable
ALTER TABLE "User" ADD COLUMN "googleRelinkBlocked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AppState" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppState_pkey" PRIMARY KEY ("key")
);
