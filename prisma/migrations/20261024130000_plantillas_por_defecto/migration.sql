-- Plantillas de proyecto incluidas de serie: clave estable y registro de las ya sembradas.
ALTER TABLE "ProjectTemplate" ADD COLUMN "builtinKey" TEXT;
CREATE UNIQUE INDEX "ProjectTemplate_builtinKey_key" ON "ProjectTemplate"("builtinKey");

CREATE TABLE "BuiltinTemplateSeeded" (
    "key" TEXT NOT NULL,
    "seededAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuiltinTemplateSeeded_pkey" PRIMARY KEY ("key")
);
