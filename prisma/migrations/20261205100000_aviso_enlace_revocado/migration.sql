-- Aviso «otra persona revocó tu enlace de Compartir fuera» (SHARE_REVOKED, un aviso de proyecto). Solo añade el valor
-- del enum y nada lo escribe todavía (lo hará la v1.75): así la versión anterior nunca se encuentra una fila con un valor
-- que su cliente Prisma no conoce (lanzaría al leerla).
BEGIN;
ALTER TYPE "NotificationType" ADD VALUE 'SHARE_REVOKED';
COMMIT;
