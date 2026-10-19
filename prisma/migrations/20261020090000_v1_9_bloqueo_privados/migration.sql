-- Proyectos privados bloqueados (dueño desactivado o sin rol de admin): se borran a los 30 días.
ALTER TABLE "Project" ADD COLUMN "privateBlockedAt" TIMESTAMP(3);
UPDATE "Project" p SET "privateBlockedAt" = NOW()
FROM "User" u WHERE p."privateOwnerId" = u."id" AND (u."active" = false OR u."role" <> 'ADMIN');

-- Copias de adjuntos de releases: las que no son imagen caducan a los 7 días.
ALTER TABLE "ReleaseAttachment" ADD COLUMN "isImage" BOOLEAN NOT NULL DEFAULT true;
UPDATE "ReleaseAttachment" SET "isImage" = false WHERE lower("fileName") NOT LIKE '%.webp';

-- Logs de proyectos privados: se marcan con su dueño para ocultar el detalle al resto de admins.
ALTER TABLE "AppLog" ADD COLUMN "privateOwnerId" TEXT;
UPDATE "AppLog" l SET "privateOwnerId" = p."privateOwnerId" FROM "Project" p WHERE l."projectId" = p."id" AND p."privateOwnerId" IS NOT NULL;
