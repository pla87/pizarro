#!/bin/bash
# Lanza las suites e2e de navegador contra la build de producción ya hecha (npx next build --webpack &&
# node scripts/postbuild.mjs && npm run build:boot). Uso, desde la raíz del repositorio:
#
#   scripts/e2e-all.sh                         # todas (QA primero, luego el resto)
#   SUITES="board-e2e r53-json-e2e" scripts/e2e-all.sh
#
# Base: la de DATABASE_URL del .env con el nombre cambiado a pz_qa (créala y aplica las migraciones antes:
# `createdb pz_qa` o psql, y `DATABASE_URL=… npx prisma migrate deploy`). La QA arranca su propio servidor; para cada
# una de las demás se arranca uno nuevo en el puerto 3231 (los límites de intentos de acceso viven en memoria y se
# agotan si varias suites comparten servidor). Las que simulan Google arrancan con GOOGLE_CLIENT_ID/SECRET de prueba
# (no llaman a Google). La instalación (`e2e/install-e2e.mjs`) va aparte: crea su propia base (ver e2e/README.md).
# Resultado de cada suite en una línea; el log completo en $OUT/<suite>.log.
set -u
cd "$(dirname "$0")/.."
DBURL=$(grep ^DATABASE_URL .env | cut -d'"' -f2 | sed 's#/[^/]*$#/pz_qa#')
OUT=${OUT:-${TMPDIR:-/tmp}/pizarro-e2e}
CHROME=${CHROME:-$(ls -d /opt/pw-browsers/chromium-*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1)}
mkdir -p "$OUT"
ALL="qa $(cd e2e && ls *-e2e.mjs | grep -v '^install-e2e' | sed 's/\.mjs$//' | tr '\n' ' ')"
for s in ${SUITES:-$ALL}; do
  if [ "$s" = qa ]; then
    (cd e2e/qa && BASE=http://localhost:3231 DATABASE_URL=$DBURL APP_DIR=$PWD/../.. node run-all.mjs > "$OUT/$s.log" 2>&1)
    echo "$s: $(tail -1 "$OUT/$s.log")"; continue
  fi
  case $s in r50-formatos-e2e|bh50b-e2e|r51-cuenta-e2e|r52-html-e2e) EXTRA="GOOGLE_CLIENT_ID=r50 GOOGLE_CLIENT_SECRET=r50";; *) EXTRA="";; esac
  env $EXTRA DATABASE_URL=$DBURL PORT=3231 APP_URL=http://localhost:3231 node --env-file-if-exists=.env --env-file=scripts/server.env scripts/start-local.mjs > "$OUT/srv-$s.log" 2>&1 &
  SP=$!
  until curl -sf -o /dev/null http://localhost:3231/api/health; do sleep 1; done
  (cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL APP_DIR=$PWD/.. CHROME=$CHROME node "$s.mjs" > "$OUT/$s.log" 2>&1)
  echo "$s: $(tail -1 "$OUT/$s.log")"
  kill $SP; wait $SP 2>/dev/null
  while curl -sf -o /dev/null http://localhost:3231/api/health; do sleep 1; done
done
