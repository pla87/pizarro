#!/bin/bash
# Lanza las suites e2e de navegador contra la build de producción ya hecha (npx next build --webpack &&
# node scripts/postbuild.mjs && npm run build:boot). Uso, desde la raíz del repositorio:
#
#   scripts/e2e-all.sh                         # todas (QA primero, luego el resto y al final la instalación)
#   SUITES="board-e2e importar-json-detalle-e2e" scripts/e2e-all.sh
#   AFFECTED=1 scripts/e2e-all.sh              # solo las afectadas por `git diff --name-only origin/main` (y la QA)
#   AFFECTED=1 BASE_REF=HEAD~3 scripts/e2e-all.sh   # afectadas respecto a otro commit
#   AFFECTED=1 DRY_RUN=1 scripts/e2e-all.sh    # solo dice cuáles lanzaría y por qué
#
# En cada ronda bastan las afectadas; antes de publicar una versión, todas (docs/HANDOFF.md §4). El mapa de suites a
# ficheros está en e2e/suites.json (lo lee scripts/e2e-affected.mjs; ver e2e/README.md).
#
# Base: la de DATABASE_URL del .env con el nombre cambiado a $E2E_DB (por defecto pz_qa; créala y aplica las
# migraciones antes: `createdb pz_qa` o psql, y `DATABASE_URL=… npx prisma migrate deploy`). La QA arranca su propio
# servidor; para cada una de las demás se arranca uno nuevo en el puerto $E2E_PORT (por defecto 3231; los límites de
# intentos de acceso viven en memoria y se agotan si varias suites comparten servidor). Las que simulan Google arrancan
# con GOOGLE_CLIENT_ID/SECRET de prueba (no llaman a Google). La instalación (`install-e2e`) va al final con su propia
# base, ${E2E_DB}_install (la borra y la crea), y su propio servidor en el mismo puerto.
# Resultado de cada suite en una línea; el log completo en $OUT/<suite>.log.
set -u
cd "$(dirname "$0")/.." || exit 2
E2E_DB=${E2E_DB:-pz_qa}
E2E_PORT=${E2E_PORT:-3231}
case $E2E_DB in pz_*) ;; *) echo "E2E_DB debe empezar por pz_ (la QA vacía esa base): $E2E_DB" >&2; exit 2 ;; esac
DBURL=$(grep ^DATABASE_URL .env | cut -d'"' -f2 | sed "s#/[^/]*\$#/$E2E_DB#")
URL=http://localhost:$E2E_PORT
OUT=${OUT:-${TMPDIR:-/tmp}/pizarro-e2e}
CHROME=${CHROME:-$(ls -d /opt/pw-browsers/chromium-*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1)}
mkdir -p "$OUT"
# Suites con servidor propio arrancado aquí: todas las e2e/*-e2e.mjs menos la instalación, que va al final.
ALL=qa
for f in e2e/*-e2e.mjs; do f=${f#e2e/}; [ "$f" = install-e2e.mjs ] || ALL="$ALL ${f%.mjs}"; done
ALL="$ALL install-e2e"
if [ -n "${AFFECTED:-}" ]; then
  [ -n "${SUITES:-}" ] && { echo "AFFECTED y SUITES no van juntos." >&2; exit 2; }
  node scripts/e2e-affected.mjs --why ${BASE_REF:+"$BASE_REF"} >&2 || exit 2
  SUITES=$(node scripts/e2e-affected.mjs ${BASE_REF:+"$BASE_REF"}) || exit 2
fi
[ -n "${DRY_RUN:-}" ] && { echo "${SUITES:-$ALL}"; exit 0; }
# Línea de resultado de una suite («N/M OK», o lo último del log si no llegó al final) y suma de todas.
OKS=0; CHECKS=0; BAD=""
report() {
  local line; line=$(grep -E '^[0-9]+/[0-9]+ (comprobaciones )?OK' "$OUT/$1.log" | tail -1)
  if [ -n "$line" ]; then
    local ok=${line%%/*} rest=${line#*/}; local n=${rest%% *}
    OKS=$((OKS + ok)); CHECKS=$((CHECKS + n)); [ "$ok" = "$n" ] || BAD="$BAD $1"
    echo "$1: $line"
  else
    BAD="$BAD $1"; echo "$1: sin resultado ($(tail -1 "$OUT/$1.log"))"
  fi
}
for s in ${SUITES:-$ALL}; do
  if [ "$s" = qa ]; then
    (cd e2e/qa && BASE=$URL DATABASE_URL=$DBURL APP_DIR=$PWD/../.. CHROME=$CHROME node run-all.mjs > "$OUT/$s.log" 2>&1)
    report "$s"; continue
  fi
  if [ "$s" = install-e2e ]; then
    (cd e2e && BASE=$URL DATABASE_URL=${DBURL}_install APP_DIR=$PWD/.. CHROME=$CHROME node install-e2e.mjs > "$OUT/$s.log" 2>&1)
    report "$s"; continue
  fi
  [ -f "e2e/$s.mjs" ] || { echo "$s: no existe e2e/$s.mjs"; BAD="$BAD $s"; continue; }
  # Las que simulan Google (y, sin email, la baja con Google): servidor con Google de prueba.
  case $s in documentacion-formatos-e2e|documentacion-indice-e2e|cuentas-borrar-restos-e2e|documentacion-enlaces-e2e) EXTRA="GOOGLE_CLIENT_ID=r50 GOOGLE_CLIENT_SECRET=r50";; *) EXTRA="";; esac
  env $EXTRA DATABASE_URL=$DBURL PORT=$E2E_PORT APP_URL=$URL node --env-file-if-exists=.env --env-file=scripts/server.env scripts/start-local.mjs > "$OUT/srv-$s.log" 2>&1 &
  SP=$!
  until curl -sf -o /dev/null $URL/api/health; do sleep 1; done
  (cd e2e && BASE=$URL DATABASE_URL=$DBURL APP_DIR=$PWD/.. CHROME=$CHROME node "$s.mjs" > "$OUT/$s.log" 2>&1)
  report "$s"
  kill $SP; wait $SP 2>/dev/null
  while curl -sf -o /dev/null $URL/api/health; do sleep 1; done
done
echo "Total: $OKS/$CHECKS comprobaciones OK${BAD:+ · con fallos o sin terminar:$BAD}"
[ -z "$BAD" ]
