#!/bin/sh
# Crea el rol de la aplicación: puede crear bases de datos (prueba mensual de restauración) pero NO es
# superusuario. El superusuario (POSTGRES_USER) queda solo para administrar PostgreSQL.
# Se ejecuta solo al crear el volumen de datos. En una instalación existente, ver docs/INSTALL.md (sección 8):
#   docker compose exec -T postgres sh /docker-entrypoint-initdb.d/10-app-role.sh
# Es idempotente. Sin APP_DB_USER/APP_DB_PASSWORD no hace nada (la app sigue con el superusuario).
set -eu

if [ -z "${APP_DB_USER:-}" ] || [ -z "${APP_DB_PASSWORD:-}" ]; then
  echo "[initdb] APP_DB_USER/APP_DB_PASSWORD sin definir: no se crea rol de aplicación."
  exit 0
fi
case "$APP_DB_USER" in *[!a-z0-9_]*) echo "[initdb] APP_DB_USER no válido" >&2; exit 1 ;; esac

DB="${POSTGRES_DB:-$POSTGRES_USER}"
export PGPASSWORD="${POSTGRES_PASSWORD:-}"

# \gexec ejecuta cada fila resultante como una sentencia; %L/%I escapan la contraseña y los nombres.
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$DB" -v appuser="$APP_DB_USER" -v apppw="$APP_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER CREATEDB NOCREATEROLE PASSWORD %L', :'appuser', :'apppw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'appuser') \gexec
SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER CREATEDB NOCREATEROLE PASSWORD %L', :'appuser', :'apppw') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', current_database(), :'appuser') \gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'appuser') \gexec
-- Instalaciones existentes: los objetos ya creados pasan a ser del rol de la aplicación.
SELECT format('ALTER TABLE %I.%I OWNER TO %I', n.nspname, c.relname, :'appuser')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p') \gexec
SELECT format('ALTER TYPE %I.%I OWNER TO %I', n.nspname, t.typname, :'appuser')
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e' \gexec
SQL
echo "[initdb] Rol de aplicación «$APP_DB_USER» listo (sin superusuario, con CREATEDB)."
