-- Proyectos privados con miembros: ya no son de una sola persona.
-- Se marca «isPrivate» aparte de privateOwnerId (que pasa a ser solo el creador y se pone a null al borrarlo).
ALTER TABLE "Project" ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Project" SET "isPrivate" = true WHERE "privateOwnerId" IS NOT NULL;

-- El dueño de cada privado existente pasa a ser su primer miembro (si no lo era ya).
INSERT INTO "ProjectMember" ("projectId", "userId")
SELECT p."id", p."privateOwnerId" FROM "Project" p
WHERE p."privateOwnerId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Se elimina el bloqueo por dueño inactivo / no admin: basta con que quede algún miembro activo.
ALTER TABLE "Project" DROP COLUMN "privateBlockedAt";

-- Logs: en lugar del dueño se anota el proyecto privado afectado (la visibilidad se decide por membresía).
-- Las filas antiguas conservan su privacidad; si no tenían projectId quedan ocultas para todos salvo la hora y el usuario.
ALTER TABLE "AppLog" ADD COLUMN "privateProjectId" TEXT;
UPDATE "AppLog" SET "privateProjectId" = COALESCE("projectId", '-') WHERE "privateOwnerId" IS NOT NULL;
ALTER TABLE "AppLog" DROP COLUMN "privateOwnerId";
