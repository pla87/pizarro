-- Asignación de proyectos: los usuarios no administradores solo ven los proyectos a los que están asignados
-- (ProjectMember) y los administradores eligen en cuáles trabajan (AdminProjectPick).

CREATE TABLE "AdminProjectPick" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AdminProjectPick_pkey" PRIMARY KEY ("projectId","userId")
);
CREATE INDEX "AdminProjectPick_userId_idx" ON "AdminProjectPick"("userId");
ALTER TABLE "AdminProjectPick" ADD CONSTRAINT "AdminProjectPick_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminProjectPick" ADD CONSTRAINT "AdminProjectPick_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Para conservar el acceso actual: los proyectos de equipo visibles para todos se asignan a todos los usuarios
-- activos que no son administradores.
INSERT INTO "ProjectMember" ("projectId", "userId")
SELECT p."id", u."id"
FROM "Project" p CROSS JOIN "User" u
WHERE p."isPrivate" = false AND p."restricted" = false AND u."role" <> 'ADMIN'
ON CONFLICT DO NOTHING;

-- En los restringidos, los miembros explícitos ya están en ProjectMember. Los administradores no son miembros de los
-- proyectos de equipo (los ven todos): se quitan por si alguno figuraba como miembro de uno restringido y se les
-- marcan como elegidos todos los proyectos de equipo, para que nada desaparezca de sus menús.
DELETE FROM "ProjectMember" pm
USING "Project" p, "User" u
WHERE pm."projectId" = p."id" AND pm."userId" = u."id" AND p."isPrivate" = false AND u."role" = 'ADMIN';

INSERT INTO "AdminProjectPick" ("projectId", "userId")
SELECT p."id", u."id"
FROM "Project" p CROSS JOIN "User" u
WHERE p."isPrivate" = false AND u."role" = 'ADMIN'
ON CONFLICT DO NOTHING;

ALTER TABLE "Project" DROP COLUMN "restricted";
