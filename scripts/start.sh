#!/bin/sh
# Punto de entrada del contenedor: migraciones, tareas de arranque y servidor.
set -e

UPLOAD_DIR="${UPLOAD_DIR:-/app/uploads}"

# Los volúmenes de Railway se montan como root: se ajusta el propietario y se
# vuelve a ejecutar este script como el usuario sin privilegios "node".
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$UPLOAD_DIR"
  chown -R node:node "$UPLOAD_DIR"
  exec setpriv --reuid=node --regid=node --init-groups sh "$0" "$@"
fi

mkdir -p "$UPLOAD_DIR"

echo "[start] Aplicando migraciones..."
(cd migrator && ./node_modules/.bin/prisma migrate deploy)

# Sincroniza changelog.json → AppVersionLog y crea el admin inicial si no hay usuarios.
node dist/boot.mjs

echo "[start] Arrancando servidor en el puerto ${PORT:-3000}"
exec node server.js
