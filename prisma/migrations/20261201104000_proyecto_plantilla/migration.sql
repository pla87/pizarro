-- De qué plantilla salió cada proyecto (Project.templateKey): la clave de una plantilla de serie («casa-familia»…) o
-- «custom» si fue una propia. Lo rellenan crear un proyecto desde una plantilla y «Aplicar plantilla». Con él, el submenú
-- «Rol de la columna» enseña primero los roles que encajan con la plantilla, y «Casa y familia» ofrece «Organizar por
-- personas». Solo añade una columna que admite null: los proyectos anteriores (y los creados en blanco) la tienen vacía y
-- siguen viendo todos los roles, como hasta ahora.
BEGIN;
ALTER TABLE "Project" ADD COLUMN "templateKey" TEXT;
COMMIT;
