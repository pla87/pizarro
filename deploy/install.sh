#!/bin/sh
# Instalador de Pizarro con Docker Compose (POSIX sh, se puede repetir sin riesgo).

#   cd deploy && ./install.sh                  pregunta el dominio (o modo red local)
#   ./install.sh --domain pizarro.example.com  sin preguntas
#   ./install.sh --local                       solo red local, por HTTP (sin dominio)
#   ./install.sh --no-start                    solo prepara deploy/.env y el kit de recuperación

# Qué hace: comprueba Docker, crea deploy/.env con secretos aleatorios fuertes (nunca pisa los que ya
# existen), arranca los contenedores, espera a que la app esté sana, muestra la URL y el código del
# asistente de configuración (/setup) y escribe deploy/recovery-kit.txt para guardarlo FUERA del servidor.
# Guía completa: docs/INSTALL.md.
set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
ENV_FILE="$DIR/.env"
EXAMPLE="$DIR/.env.example"
KIT="$DIR/recovery-kit.txt"

DOMAIN_ARG="${DOMAIN:-}"
LOCAL=0
START=1
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) [ $# -ge 2 ] || { echo "Falta el valor de --domain" >&2; exit 2; }; DOMAIN_ARG="$2"; shift ;;
    --domain=*) DOMAIN_ARG="${1#--domain=}" ;;
    --local) LOCAL=1 ;;
    --no-start) START=0 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: $1 (prueba --help)" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# --- Requisitos ---------------------------------------------------------------
if [ "$START" = 1 ]; then
  command -v docker >/dev/null 2>&1 || die "Docker no está instalado. Instálalo (https://docs.docker.com/engine/install/) y vuelve a ejecutar este script."
  docker compose version >/dev/null 2>&1 || die "Falta el plugin «docker compose». Instálalo (paquete docker-compose-plugin) y vuelve a ejecutar este script."
  docker info >/dev/null 2>&1 || die "No se puede hablar con el demonio de Docker. ¿Está arrancado? ¿Tu usuario está en el grupo «docker» (o usas sudo)?"
fi

# --- Utilidades ---------------------------------------------------------------
# Aleatorios fuertes: openssl si existe; si no, /dev/urandom.
rand_hex() { # $1 = bytes
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"
  else od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'; echo; fi
}
rand_b64() { # $1 = bytes
  if command -v openssl >/dev/null 2>&1; then openssl rand -base64 "$1" | tr -d '\n'; echo
  else head -c "$1" /dev/urandom | base64 | tr -d '\n'; echo; fi
}

# Valor de una variable del .env (sin comillas); vacío si no está.
get_var() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | sed 's/^"//; s/"[[:space:]]*$//'
}

# Fija KEY="valor" en el .env (reemplaza la línea o la añade). Los valores van por el entorno de awk: sin problemas de escapes.
set_var() {
  tmp=$(mktemp)
  K="$1" V="$2" awk 'BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"]; done = 0 }
    $0 ~ ("^" k "=") && !done { print k "=\"" v "\""; done = 1; next }
    { print }
    END { if (!done) print k "=\"" v "\"" }' "$ENV_FILE" >"$tmp"
  cat "$tmp" >"$ENV_FILE"
  rm -f "$tmp"
}

# Fija la variable solo si está vacía o no existe: nunca pisa un secreto que ya había.
set_if_empty() { # $1 = nombre, $2 = valor
  if [ -z "$(get_var "$1")" ]; then set_var "$1" "$2"; return 0; fi
  return 1
}

ask() { # $1 = pregunta, $2 = valor por defecto
  if [ -t 0 ]; then
    printf '%s [%s]: ' "$1" "$2" >&2
    read -r reply || reply=""
    printf '%s\n' "${reply:-$2}"
  else
    printf '%s\n' "$2"
  fi
}

# --- .env ---------------------------------------------------------------------
umask 077
if [ ! -f "$ENV_FILE" ]; then
  [ -f "$EXAMPLE" ] || die "No encuentro $EXAMPLE. Ejecuta el script desde el repositorio completo."
  cp "$EXAMPLE" "$ENV_FILE"
  say "Creado $ENV_FILE a partir de .env.example."
else
  say "Ya existe $ENV_FILE: se conservan sus valores y solo se rellena lo que falte."
fi
chmod 600 "$ENV_FILE"

# Dominio y URL: solo se preguntan si todavía no están definidos con un valor real.
cur_domain=$(get_var DOMAIN)
cur_url=$(get_var APP_URL)
case "$cur_domain" in ""|pizarro.example.com) cur_domain="" ;; esac
case "$cur_url" in ""|https://pizarro.example.com) cur_url="" ;; esac

if [ -z "$cur_domain" ] || [ -z "$cur_url" ]; then
  if [ "$LOCAL" = 1 ]; then
    mode=local
  elif [ -n "$DOMAIN_ARG" ]; then
    mode=domain
  elif [ -t 0 ]; then
    say ""
    say "¿Cómo se va a acceder a Pizarro?"
    say "  1) Con un dominio público (HTTPS automático; el DNS ya debe apuntar a este servidor)"
    say "  2) Solo en red local, por HTTP y sin dominio"
    choice=$(ask "Elige 1 o 2" 1)
    if [ "$choice" = 2 ]; then mode=local; else mode=domain; fi
  else
    die "Sin terminal no puedo preguntar el dominio: usa --domain pizarro.example.com o --local."
  fi

  if [ "$mode" = local ]; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}') || ip=""
    host=$(ask "Dirección con la que se entrará (IP o nombre del servidor)" "${ip:-localhost}")
    set_var DOMAIN ":80"
    set_var APP_URL "http://$host"
  else
    dom="$DOMAIN_ARG"
    [ -n "$dom" ] || dom=$(ask "Dominio de Pizarro (p. ej. pizarro.miempresa.com)" "")
    dom=$(printf '%s' "$dom" | sed 's#^https\{0,1\}://##; s#/.*$##' | tr 'A-Z' 'a-z')
    case "$dom" in
      ""|*[!a-z0-9.-]*|.*|*..*) die "El dominio «$dom» no es válido." ;;
      *.*) ;;
      *) die "El dominio «$dom» no es válido (falta el sufijo, p. ej. .com)." ;;
    esac
    set_var DOMAIN "$dom"
    set_var APP_URL "https://$dom"
  fi
fi

# Secretos: solo los que faltan.
created=""
if set_if_empty POSTGRES_PASSWORD "$(rand_hex 24)"; then
  created="$created POSTGRES_PASSWORD"
  # Base de datos nueva: la app usa un rol sin superusuario (deploy/postgres-init). En una instalación
  # existente no se toca: su base ya se creó sin ese rol (migración manual en docs/INSTALL.md, sección 8).
  set_if_empty APP_DB_USER "pizarro_app" || true
  set_if_empty APP_DB_PASSWORD "$(rand_hex 24)" && created="$created APP_DB_PASSWORD"
fi
fresh=0
set_if_empty SESSION_SECRET "$(rand_b64 48)" && created="$created SESSION_SECRET" && fresh=1
set_if_empty BACKUP_KEY "$(rand_b64 32)" && created="$created BACKUP_KEY"
# Claves separadas solo en una instalación nueva: en una existente, crearlas ahora dejaría ilegibles los
# secretos del segundo paso ya cifrados con SESSION_SECRET (para separarlas, ver docs/MANUAL.md 4.4).
if [ "$fresh" = 1 ]; then
  set_if_empty TOKEN_SECRET "$(rand_b64 48)" && created="$created TOKEN_SECRET"
  set_if_empty ENCRYPTION_KEY "$(rand_b64 48)" && created="$created ENCRYPTION_KEY"
fi
if [ -n "$created" ]; then say "Secretos generados:$created"; else say "Los secretos ya existían: no se ha cambiado ninguno."; fi

for v in POSTGRES_PASSWORD SESSION_SECRET BACKUP_KEY DOMAIN APP_URL; do
  [ -n "$(get_var "$v")" ] || die "Falta $v en $ENV_FILE."
done

# --- Kit de recuperación --------------------------------------------------------
write_kit() {
  {
    echo "KIT DE RECUPERACIÓN DE PIZARRO"
    echo "Generado el $(date '+%Y-%m-%d %H:%M') en $(hostname 2>/dev/null || echo servidor)"
    echo
    echo "GUARDA ESTE FICHERO FUERA DEL SERVIDOR (gestor de contraseñas, USB cifrado, otro equipo)."
    echo "Quien lo tenga puede leer tus copias de seguridad. No lo envíes por email ni lo subas a un repositorio."
    echo
    echo "Dirección:          $(get_var APP_URL)"
    echo "Dominio:            $(get_var DOMAIN)"
    echo
    echo "SESSION_SECRET=\"$(get_var SESSION_SECRET)\""
    echo "TOKEN_SECRET=\"$(get_var TOKEN_SECRET)\""
    echo "ENCRYPTION_KEY=\"$(get_var ENCRYPTION_KEY)\""
    echo "BACKUP_KEY=\"$(get_var BACKUP_KEY)\""
    echo "POSTGRES_PASSWORD=\"$(get_var POSTGRES_PASSWORD)\""
    echo
    echo "Para qué sirve cada uno:"
    echo "  BACKUP_KEY         Descifra las copias de seguridad diarias. Sin ella las copias no se pueden leer."
    echo "  SESSION_SECRET     Firma las sesiones. Si se pierde o cambia, todo el mundo tiene que volver a entrar."
    echo "  TOKEN_SECRET       Firma los enlaces de los emails y los códigos de recuperación."
    echo "  ENCRYPTION_KEY     Cifra los secretos de la verificación en dos pasos y las conexiones con Google."
    echo "                     Si se pierde, todos tienen que configurar de nuevo su segundo paso y reconectar Google."
    echo "  POSTGRES_PASSWORD  Contraseña de la base de datos (solo la usan los contenedores entre sí)."
    echo
    echo "Si pierdes el servidor:"
    echo "  1. Instala Docker en el nuevo servidor y clona el repositorio de Pizarro."
    echo "  2. Ejecuta deploy/install.sh y detén la app (docker compose stop app)."
    echo "  3. Pon en deploy/.env los valores de arriba (BACKUP_KEY y ENCRYPTION_KEY son imprescindibles)."
    echo "  4. Restaura la base de datos y los adjuntos desde tu copia externa (docs/INSTALL.md, sección 6)."
  } >"$KIT"
  chmod 600 "$KIT"
}
write_kit
say "Kit de recuperación escrito en $KIT (permisos 600)."

if [ "$START" = 0 ]; then
  say "Opción --no-start: no se arrancan los contenedores. Cuando quieras: cd $DIR && docker compose up -d --build"
  exit 0
fi

# --- Arranque -----------------------------------------------------------------
cd "$DIR"
say ""
say "Arrancando Pizarro (la primera vez construye la imagen: unos minutos)..."
docker compose up -d --build

say "Esperando a que la app esté lista..."
i=0
status=""
while [ "$i" -lt 90 ]; do
  cid=$(docker compose ps -q app 2>/dev/null || true)
  if [ -n "$cid" ]; then
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo "")
    [ "$status" = healthy ] && break
  fi
  i=$((i + 1))
  sleep 4
done
if [ "$status" != healthy ]; then
  say "La app no ha llegado a «healthy» en 6 minutos. Revisa:  cd $DIR && docker compose logs --tail 80 app" >&2
  exit 1
fi

url=$(get_var APP_URL)
code=$(docker compose logs app 2>&1 | grep 'introduce el código:' | tail -n 1 | sed 's/.*código: //' | tr -d '\r' || true)

say ""
say "Pizarro está en marcha."
say ""
say "  Dirección:  $url"
if [ -n "$code" ]; then
  say "  Asistente:  $url/setup"
  say "  Código:     $code      (caduca en 24 horas; se renueva si se reinicia la app)"
  say ""
  say "Abre la dirección del asistente, escribe el código y crea el primer administrador."
else
  say "  La instalación ya estaba configurada: entra con tu usuario."
fi

cat <<EOF

#############################################################################
#  ATENCIÓN: GUARDA EL KIT DE RECUPERACIÓN FUERA DE ESTE SERVIDOR
#
#  Fichero:  $KIT
#
#  Sin BACKUP_KEY las copias de seguridad NO se pueden leer, y sin
#  ENCRYPTION_KEY todos pierden la verificación en dos pasos. Si el
#  servidor se pierde, el kit es lo único que salva tus datos.
#  Cópialo ahora a un gestor de contraseñas o a otro equipo y después
#  bórralo de aquí (rm) si no quieres dejarlo en el servidor.
#############################################################################
EOF
