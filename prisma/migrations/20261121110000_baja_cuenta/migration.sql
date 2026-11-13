-- «Borrar mi cuenta» desde «Mi perfil»: el código de verificación en dos pasos (por email, de la app o de recuperación)
-- se comprueba contra un desafío propio, ligado a la sesión como los de ENROLL. Solo añade un valor.
ALTER TYPE "LoginChallengeKind" ADD VALUE 'ACCOUNT_DELETE';
