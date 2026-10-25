#!/bin/sh
# Punto de entrada del contenedor: migraciones, tareas de arranque y servidor.
set -e

UPLOAD_DIR="${UPLOAD_DIR:-/app/uploads}"

# Los volúmenes de Railway se montan como root: se ajusta el propietario y se
# vuelve a ejecutar este script como el usuario sin privilegios "node".
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$UPLOAD_DIR"
  # Solo la primera vez (o si cambió el dueño): recorrer todo el volumen en cada arranque es lento con muchos adjuntos.
  [ "$(stat -c %u "$UPLOAD_DIR")" = "$(id -u node)" ] || chown -R node:node "$UPLOAD_DIR"
  exec setpriv --reuid=node --regid=node --init-groups sh "$0" "$@"
fi

mkdir -p "$UPLOAD_DIR"

# Comprobación de variables imprescindibles, con un mensaje claro en los logs.
missing=""
[ -n "$DATABASE_URL" ] || missing="$missing DATABASE_URL"
[ ${#SESSION_SECRET} -ge 32 ] || missing="$missing SESSION_SECRET(>=32)"
# Opcionales, pero si se definen deben ser válidas (vacías = se usa SESSION_SECRET).
for v in TOKEN_SECRET ENCRYPTION_KEY TOKEN_SECRET_PREVIOUS ENCRYPTION_KEY_PREVIOUS; do
  eval "val=\${$v:-}"
  [ -z "$val" ] || [ ${#val} -ge 32 ] || missing="$missing $v(>=32)"
done
if [ -n "$missing" ]; then
  echo "[start] ERROR: faltan variables de entorno:$missing"
  echo "[start] Con Docker Compose: revisa el fichero .env junto a compose.yml (docs/INSTALL.md)."
  echo "[start] En Railway: servicio de la app -> Variables. DATABASE_URL debe ser \${{Postgres.DATABASE_URL}}"
  echo "[start] (usa el nombre exacto de tu servicio de base de datos) y aplica los cambios con «Deploy»."
  # Espera antes de salir para no reiniciar en bucle rápido.
  sleep 20
  exit 1
fi
[ -n "$APP_URL" ] || echo "[start] AVISO: APP_URL no está definida; los enlaces de los avisos y Google no funcionarán bien."

echo "[start] Aplicando migraciones..."
(cd migrator && ./node_modules/.bin/prisma migrate deploy)

# Sincroniza changelog.json → AppVersionLog y crea el admin inicial si no hay usuarios.
node dist/boot.mjs

echo "[start] Arrancando servidor en el puerto ${PORT:-3000}"
exec node server.js
