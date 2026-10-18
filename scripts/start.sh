#!/bin/sh
# Punto de entrada del contenedor: migraciones, tareas de arranque y servidor.
set -e

mkdir -p "${UPLOAD_DIR:-/app/uploads}"

echo "[start] Aplicando migraciones..."
(cd migrator && ./node_modules/.bin/prisma migrate deploy)

# Sincroniza changelog.json → AppVersionLog y crea el admin inicial si no hay usuarios.
node dist/boot.mjs

echo "[start] Arrancando servidor en el puerto ${PORT:-3000}"
exec node server.js
