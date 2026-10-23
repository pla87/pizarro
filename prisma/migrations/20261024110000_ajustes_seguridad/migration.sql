-- Preferencia: borrar los borradores locales al cerrar sesión.
ALTER TABLE "User" ADD COLUMN "clearDraftsOnLogout" BOOLEAN NOT NULL DEFAULT false;
