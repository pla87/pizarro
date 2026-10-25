-- Una copia por nombre en cada release: dos procesos que la copian a la vez (despliegue y reanudación) no la duplican.
DELETE FROM "ReleaseAttachment" a USING "ReleaseAttachment" b
  WHERE a."releaseId" = b."releaseId" AND a."fileName" = b."fileName" AND a."id" > b."id";
CREATE UNIQUE INDEX IF NOT EXISTS "ReleaseAttachment_releaseId_fileName_key" ON "ReleaseAttachment"("releaseId", "fileName");
