-- Material de curso: presentaciones de Google Slides enlazadas a una tarjeta y documentos HTML en Documentación (se
-- ven en un marco aislado, sin scripts). Solo añade valores: la versión anterior no los escribe nunca.
ALTER TYPE "TaskLinkKind" ADD VALUE 'GOOGLE_SLIDES';
ALTER TYPE "DocumentKind" ADD VALUE 'HTML';
