#!/bin/sh
# Instalación de Pizarro en un paso (POSIX sh). Descarga el código, comprueba Docker y ejecuta deploy/install.sh.
#
#   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --domain pizarro.example.com
#
# Guía completa: docs/INSTALL.md. Opciones: ver --help.
#
# Todo el trabajo vive dentro de main(), que se llama en la última línea: si la descarga del script se corta,
# el intérprete no llega a ejecutar nada (una función a medias es un error de sintaxis).
set -eu

REPO="pla87/pizarro"
DIR="/opt/pizarro"
REF="main"
DOMAIN_ARG=""
LOCAL=0
NOSTART=0
YES=0
TARBALL="" # solo para pruebas: usa un .tar.gz local en vez de descargar
TMP=""
NEWDIR=""
SUDO=""

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'EOT'
Instalación de Pizarro en un paso (Docker Compose: Caddy + Pizarro + PostgreSQL 16).

  curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --domain pizarro.example.com

Opciones:
  --domain <dominio>  Dominio público (HTTPS automático; el DNS ya debe apuntar a este servidor)
  --local             Solo red local, por HTTP y sin dominio
  --dir <ruta>        Carpeta de instalación, ruta absoluta (por defecto /opt/pizarro)
  --ref <rama|tag>    Versión que se descarga (por defecto main)
  --no-start          Prepara todo pero no arranca los contenedores
  -y, --yes           Instala Docker si falta, sin preguntar
  -h, --help          Muestra esta ayuda

Qué hace: comprueba Linux (x86_64 o arm64) y root/sudo, comprueba Docker y el plugin «docker compose»
(si faltan, ofrece instalarlos con https://get.docker.com y solo lo hace tras confirmarlo), descarga el
código de GitHub sin necesitar git, lo coloca en la carpeta de instalación y ejecuta deploy/install.sh.

Se puede repetir sin riesgo: actualiza el código y conserva deploy/.env, el kit de recuperación y los
datos (viven en volúmenes de Docker). Si pides otro dominio del que ya hay en deploy/.env, se avisa y
se mantiene el actual. Guía completa: docs/INSTALL.md.
EOT
}

main() {
  trap 'rm -rf "$TMP"; if [ -n "$NEWDIR" ]; then $SUDO rm -rf "$NEWDIR"; fi' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  while [ $# -gt 0 ]; do
    case "$1" in
      --domain) [ $# -ge 2 ] || die "Falta el valor de --domain"; DOMAIN_ARG="$2"; shift ;;
      --domain=*) DOMAIN_ARG="${1#--domain=}" ;;
      --dir) [ $# -ge 2 ] || die "Falta el valor de --dir"; DIR="$2"; shift ;;
      --dir=*) DIR="${1#--dir=}" ;;
      --ref) [ $# -ge 2 ] || die "Falta el valor de --ref"; REF="$2"; shift ;;
      --ref=*) REF="${1#--ref=}" ;;
      --tarball) [ $# -ge 2 ] || die "Falta el valor de --tarball"; TARBALL="$2"; shift ;;
      --local) LOCAL=1 ;;
      --no-start) NOSTART=1 ;;
      -y|--yes) YES=1 ;;
      -h|--help) usage; exit 0 ;;
      *) die "Opción desconocida: $1 (prueba --help)" ;;
    esac
    shift
  done

  if [ "$LOCAL" = 1 ] && [ -n "$DOMAIN_ARG" ]; then die "Usa --domain o --local, no los dos."; fi
  case "$REF" in
    ""|*[!A-Za-z0-9._/-]*|-*|*..*) die "La referencia «$REF» no es válida (solo letras, números, . _ - /, y sin «..»)." ;;
  esac
  case "$DIR" in
    *..*) die "--dir no puede contener «..»." ;;
    /*) ;;
    *) die "--dir debe ser una ruta absoluta (p. ej. /opt/pizarro)." ;;
  esac
  DIR=$(printf '%s' "$DIR" | sed 's#//*#/#g; s#/$##')
  case "$DIR" in
    ""|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/opt|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/var)
      die "--dir apunta a una carpeta del sistema: usa una propia, como /opt/pizarro." ;;
  esac

  # Terminal para las preguntas: stdin es la tubería de curl, así que se lee de /dev/tty
  # (y a los programas que lanzamos se les cierra la entrada con </dev/null para que no se coman el script).
  HAVE_TTY=0
  if (: </dev/tty) 2>/dev/null; then HAVE_TTY=1; fi

  ask() { # $1 = pregunta; imprime la respuesta
    printf '%s ' "$1" >&2
    reply=""
    read -r reply </dev/tty || reply=""
    printf '%s\n' "$reply"
  }
  confirm() { # $1 = pregunta; 0 = sí
    if [ "$YES" = 1 ]; then return 0; fi
    if [ "$HAVE_TTY" != 1 ]; then return 1; fi
    case "$(ask "$1 [s/N]")" in s|S|si|SI|Si|sí|Sí|y|Y|yes) return 0 ;; *) return 1 ;; esac
  }

  # --- Sistema y permisos -----------------------------------------------------------
  [ "$(uname -s)" = Linux ] || die "Este instalador solo funciona en Linux (tu sistema es $(uname -s))."
  case "$(uname -m)" in
    x86_64|amd64|aarch64|arm64) ;;
    *) die "Arquitectura no admitida: $(uname -m). Se necesita x86_64 o arm64." ;;
  esac
  if [ "$(id -u)" != 0 ]; then
    command -v sudo >/dev/null 2>&1 || die "Ejecútalo como root o instala sudo."
    SUDO="sudo"
    say "No eres root: se usará sudo para crear $DIR y hablar con Docker (puede pedirte la contraseña)."
  fi

  fetch() { # $1 = URL, $2 = destino (solo HTTPS, TLS 1.2 o superior)
    if command -v curl >/dev/null 2>&1; then curl --proto '=https' --tlsv1.2 -fsSL "$1" -o "$2" </dev/null
    elif command -v wget >/dev/null 2>&1; then wget --https-only -qO "$2" "$1" </dev/null
    else die "Hace falta curl o wget."; fi
  }
  command -v tar >/dev/null 2>&1 || die "Hace falta tar."
  command -v gzip >/dev/null 2>&1 || die "Hace falta gzip."

  TMP=$(mktemp -d)

  # --- Docker -------------------------------------------------------------------------
  docker_ok() { command -v docker >/dev/null 2>&1 && $SUDO docker compose version >/dev/null 2>&1 </dev/null; }
  if ! docker_ok; then
    say "No encuentro Docker con el plugin «docker compose»."
    if confirm "¿Instalo Docker con el script oficial (https://get.docker.com)?"; then
      fetch https://get.docker.com "$TMP/get-docker.sh" || die "No se pudo descargar https://get.docker.com."
      $SUDO sh "$TMP/get-docker.sh" </dev/null
      docker_ok || die "Docker no ha quedado instalado correctamente. Instálalo a mano: https://docs.docker.com/engine/install/"
    else
      die "Sin Docker no puedo seguir. Instálalo (https://docs.docker.com/engine/install/) o repite el comando con --yes para que lo haga este script."
    fi
  fi
  say "Docker listo: $($SUDO docker --version 2>/dev/null </dev/null || echo docker)."

  # --- Descarga del código -----------------------------------------------------------
  SRC="$TMP/src"
  mkdir -p "$SRC"
  if [ -n "$TARBALL" ]; then
    [ -f "$TARBALL" ] || die "No existe el fichero $TARBALL."
    ARCHIVE="$TARBALL"
  else
    ARCHIVE="$TMP/pizarro.tar.gz"
    URL="https://codeload.github.com/$REPO/tar.gz/$REF"
    say "Descargando Pizarro ($REF) desde GitHub..."
    fetch "$URL" "$ARCHIVE" || die "No se pudo descargar $URL. Comprueba la conexión y que «$REF» existe."
  fi
  tar -xzf "$ARCHIVE" -C "$SRC" --strip-components=1 </dev/null || die "El fichero descargado no es un tar.gz válido."
  if [ ! -f "$SRC/deploy/install.sh" ] || [ ! -f "$SRC/deploy/compose.yml" ] || [ ! -f "$SRC/Dockerfile" ]; then
    die "La descarga no contiene Pizarro completo (faltan deploy/install.sh, deploy/compose.yml o Dockerfile)."
  fi

  # --- Colocar en la carpeta de instalación --------------------------------------------
  # Solo se sustituye el código; se conservan deploy/.env y deploy/recovery-kit.txt. Los datos viven en
  # volúmenes de Docker, fuera de esta carpeta. El código nuevo se prepara aparte ($DIR.new, en el mismo
  # sistema de ficheros) y se cambia de golpe: una ejecución interrumpida nunca deja la carpeta vaciada.
  $SUDO mkdir -p "$(dirname "$DIR")" </dev/null
  # Restos de una ejecución interrumpida: si se cortó entre los dos «mv», la copia buena está en $DIR.old.
  if [ ! -e "$DIR" ] && [ -d "$DIR.old" ]; then $SUDO mv "$DIR.old" "$DIR" </dev/null; fi
  $SUDO rm -rf "$DIR.old" "$DIR.new" </dev/null
  EXISTING=0
  if [ -e "$DIR" ] || [ -L "$DIR" ]; then
    [ -d "$DIR" ] || die "$DIR existe y no es una carpeta."
    if [ -n "$($SUDO ls -A "$DIR" 2>/dev/null </dev/null)" ]; then
      EXISTING=1
      ours=0
      if [ -f "$DIR/deploy/install.sh" ] && [ -f "$DIR/Dockerfile" ]; then
        ours=1
      elif [ -z "$($SUDO find "$DIR" -mindepth 1 ! -path "$DIR/deploy" ! -path "$DIR/deploy/.env" ! -path "$DIR/deploy/recovery-kit.txt" 2>/dev/null </dev/null | head -n 1)" ]; then
        ours=1 # solo quedan .env y/o el kit de una ejecución anterior interrumpida
      fi
      [ "$ours" = 1 ] || die "$DIR no está vacía y no parece una instalación de Pizarro. Elige otra carpeta con --dir."
    fi
  fi
  if [ "$EXISTING" = 1 ]; then
    say "Actualizando el código en $DIR (se conservan deploy/.env y el kit de recuperación)..."
  else
    say "Instalando en $DIR..."
  fi
  NEWDIR="$DIR.new"
  $SUDO mkdir -p "$NEWDIR" </dev/null
  $SUDO cp -R "$SRC"/. "$NEWDIR"/ </dev/null
  [ -f "$NEWDIR/deploy/install.sh" ] || die "No se pudo copiar el código a $DIR."
  if [ "$EXISTING" = 1 ]; then
    for keep in .env recovery-kit.txt; do
      if [ -f "$DIR/deploy/$keep" ]; then
        $SUDO cp -p "$DIR/deploy/$keep" "$NEWDIR/deploy/$keep" </dev/null || die "No se pudo conservar deploy/$keep."
      fi
    done
    $SUDO mv "$DIR" "$DIR.old" </dev/null || die "No se pudo apartar la carpeta actual $DIR."
    if ! $SUDO mv "$NEWDIR" "$DIR" </dev/null; then
      $SUDO mv "$DIR.old" "$DIR" </dev/null || true
      die "No se pudo colocar el código nuevo en $DIR (se ha dejado como estaba)."
    fi
    NEWDIR=""
    $SUDO rm -rf "$DIR.old" </dev/null
  else
    $SUDO rm -rf "$DIR" </dev/null
    $SUDO mv "$NEWDIR" "$DIR" </dev/null || die "No se pudo colocar el código en $DIR."
    NEWDIR=""
  fi

  # --- Dominio ------------------------------------------------------------------------
  # install.sh conserva el dominio que ya haya en deploy/.env: si se pidió otro, se avisa (no se cambia solo).
  OLD_URL=$($SUDO sed -n 's/^APP_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$DIR/deploy/.env" 2>/dev/null </dev/null | head -n 1)
  case "$OLD_URL" in https://pizarro.example.com*) OLD_URL="" ;; esac
  if [ -n "$OLD_URL" ]; then
    DIFFERENT=0
    if [ "$LOCAL" = 1 ]; then
      case "$OLD_URL" in https://*) DIFFERENT=1 ;; esac
    elif [ -n "$DOMAIN_ARG" ]; then
      want=$(printf '%s' "$DOMAIN_ARG" | sed 's#^https\{0,1\}://##; s#/.*$##' | tr 'A-Z' 'a-z')
      have=$(printf '%s' "$OLD_URL" | sed 's#^https\{0,1\}://##; s#/.*$##' | tr 'A-Z' 'a-z')
      if [ "$want" != "$have" ]; then DIFFERENT=1; fi
    fi
    if [ "$DIFFERENT" = 1 ]; then
      say ""
      say "AVISO: esta instalación ya usa $OLD_URL y se mantiene: ${DOMAIN_ARG:---local} no la cambia."
      say "Para cambiarla, edita DOMAIN y APP_URL en $DIR/deploy/.env y ejecuta «docker compose up -d» en $DIR/deploy (ver docs/INSTALL.md)."
      say ""
    fi
  fi
  set --
  if [ "$LOCAL" = 1 ]; then
    set -- --local
  elif [ -n "$DOMAIN_ARG" ]; then
    set -- --domain "$DOMAIN_ARG"
  else
    have_real=""
    if $SUDO grep -q '^APP_URL=' "$DIR/deploy/.env" 2>/dev/null </dev/null \
       && ! $SUDO grep -q '^APP_URL="\{0,1\}https://pizarro.example.com' "$DIR/deploy/.env" 2>/dev/null </dev/null; then
      have_real=1
    fi
    if [ -z "$have_real" ]; then
      if [ "$HAVE_TTY" = 1 ]; then
        say ""
        say "¿Cómo se va a acceder a Pizarro?"
        say "  1) Con un dominio público (HTTPS automático; el DNS ya debe apuntar a este servidor)"
        say "  2) Solo en red local, por HTTP y sin dominio"
        case "$(ask "Elige 1 o 2 [1]:")" in
          2) set -- --local ;;
          *) d=$(ask "Dominio de Pizarro (p. ej. pizarro.miempresa.com):"); [ -n "$d" ] || die "Falta el dominio."; set -- --domain "$d" ;;
        esac
      else
        die "Sin terminal no puedo preguntar el dominio: usa --domain pizarro.example.com o --local."
      fi
    fi
  fi
  if [ "$NOSTART" = 1 ]; then set -- "$@" --no-start; fi

  # --- Instalar ------------------------------------------------------------------------
  say ""
  say "Ejecutando deploy/install.sh ..."
  cd "$DIR/deploy"
  # Sin stdin (es la tubería de curl): las opciones ya van completas.
  $SUDO sh ./install.sh "$@" </dev/null

  say ""
  say "Hecho. Próximos pasos:"
  say "  1. Abre la dirección que ha mostrado el instalador (/setup) y crea el primer administrador con el código."
  say "  2. Guarda $DIR/deploy/recovery-kit.txt FUERA del servidor (sin él, las copias de seguridad no se pueden leer)."
  say "  3. Configura el email en Administración → Ajustes y revisa las copias (docs/INSTALL.md, sección 4)."
  say "Para actualizar más adelante, repite el mismo comando: conserva tu configuración y tus datos."
}

main "$@"
