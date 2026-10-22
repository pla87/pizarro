-- Hasta la v1.14 el cambio y el restablecimiento de contraseña guardaban la contraseña en claro en
-- los argumentos del registro de actividad. Se borran esos argumentos de los registros existentes.
UPDATE "AppLog"
SET "details" = "details" - 'args'
WHERE "action" IN ('profile.changePassword', 'users.resetUserPassword')
  AND "details" IS NOT NULL
  AND jsonb_typeof("details") = 'object'
  AND "details" ? 'args';
