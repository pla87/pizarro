-- Notas de Documentación (v1.76): el texto de una nota escrita en la app va en su fila (sin fichero), con una versión
-- para avisar de los cambios simultáneos, y cualquier documento se puede fijar arriba en la lista. Solo añade columnas:
-- la versión anterior no las lee y sigue funcionando sobre la base migrada (las notas le salen como Markdown sin fichero).
BEGIN;
ALTER TABLE "ProjectDocument" ADD COLUMN "noteContent" TEXT;
ALTER TABLE "ProjectDocument" ADD COLUMN "noteVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProjectDocument" ADD COLUMN "pinnedAt" TIMESTAMP(3);
COMMIT;
