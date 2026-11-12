#!/usr/bin/env bash
# Mueve la rama «stable» a una versión publicada. Lo usan dos workflows:
#   .github/workflows/release.yml (job «Rama stable»): bash scripts/move-stable.sh move "$GITHUB_SHA"
#   .github/workflows/stable.yml («Mover stable», a mano):  bash scripts/move-stable.sh move --latest
# y, antes de mover, los dos comprueban el token:            bash scripts/move-stable.sh check-token
#
# Reglas (iguales venga de donde venga): solo versiones X.Y.Z sin sufijo, solo commits que ya están en main
# (merge-base) y nunca hacia atrás. El push va con --force-with-lease: si otro proceso movió stable entretanto, falla.
#
# Credenciales: el checkout y las lecturas (fetch, ls-remote) usan siempre github.token. Solo el push usa el secreto
# STABLE_PUSH_TOKEN (sin espacios ni saltos de línea) o, si no existe, GITHUB_TOKEN. El token va en una cabecera
# http.extraheader pasada por variables de entorno (GIT_CONFIG_*): no aparece en la línea de órdenes, en la URL ni en
# el log, y anula la cabecera que deja actions/checkout con github.token.
#
# Entorno: GITHUB_REPOSITORY, GITHUB_SHA, STABLE_PUSH_TOKEN (opcional), GITHUB_TOKEN (sin PAT), GITHUB_STEP_SUMMARY,
# PUBLISHED_TAGS (opcional, con --latest: etiquetas con release publicada, una por línea).
# Solo para pruebas: STABLE_REMOTE_URL (destino del push) y GITHUB_API_URL.
set -euo pipefail

repo="${GITHUB_REPOSITORY:-}"
server="${GITHUB_SERVER_URL:-https://github.com}"
api="${GITHUB_API_URL:-https://api.github.com}"
remote="${STABLE_REMOTE_URL:-$server/$repo.git}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
# Sin espacios, tabuladores ni saltos de línea: un secreto pegado con un salto al final da 401 y git acaba pidiendo
# usuario («could not read Username … terminal prompts disabled»).
pat="$(printf '%s' "${STABLE_PUSH_TOKEN:-}" | tr -d '[:space:]')"
export GIT_TERMINAL_PROMPT=0

if [ -n "$pat" ]; then
  echo "::add-mask::$pat"
  push_token="$pat"
  token_name="STABLE_PUSH_TOKEN"
else
  push_token="$(printf '%s' "${GITHUB_TOKEN:-}" | tr -d '[:space:]')"
  token_name="GITHUB_TOKEN"
fi

how_to="Crea el token así: GitHub → Settings (de tu cuenta) → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token; Resource owner: el dueño del repositorio; Repository access: Only select repositories → ${repo:-el repositorio}; Permissions: Contents Read and write y Workflows Read and write. Luego, en el repositorio: Settings → Secrets and variables → Actions → STABLE_PUSH_TOKEN, pegando solo el valor (sin espacios ni saltos de línea). Después relanza este job o usa Actions → Mover stable → Run workflow."

fail() { # fail "título" "detalle": error visible en el job y en el resumen de la ejecución.
  echo "::error::$1 $2"
  {
    echo "### $1"
    echo
    echo "$2"
  } >> "$summary"
  exit 1
}

# Ejecuta git con la cabecera de autorización del push (y sin la que deja actions/checkout).
git_push_auth() {
  local basic
  basic="$(printf 'x-access-token:%s' "$push_token" | base64 | tr -d '\n')"
  GIT_CONFIG_COUNT=2 \
    GIT_CONFIG_KEY_0="http.$server/.extraheader" GIT_CONFIG_VALUE_0="" \
    GIT_CONFIG_KEY_1="http.$server/.extraheader" GIT_CONFIG_VALUE_1="AUTHORIZATION: basic $basic" \
    git "$@"
}

check_token() {
  if [ -z "$pat" ]; then
    echo "No hay STABLE_PUSH_TOKEN: stable se moverá con GITHUB_TOKEN (vale mientras la versión no cambie .github/workflows/)."
    return 0
  fi
  local body code push
  body="$(mktemp)"
  # La cabecera va por la entrada estándar (-H @-): el token no aparece en la línea de órdenes.
  code="$(printf 'Authorization: Bearer %s\n' "$pat" | curl -sS -o "$body" -w '%{http_code}' -H @- \
    -H "Accept: application/vnd.github+json" "$api/repos/$repo" 2>/dev/null)" || code="${code:-000}"
  case "$code" in
    200) ;;
    401) rm -f "$body"; fail "STABLE_PUSH_TOKEN no es válido (GitHub responde 401)." "Causas probables: el token ha caducado o se ha revocado, está pendiente de aprobación por el dueño u organización, o el valor del secreto no es el token (copiado incompleto o con texto de más). $how_to" ;;
    403|404) rm -f "$body"; fail "STABLE_PUSH_TOKEN no tiene acceso a $repo (GitHub responde $code)." "Causas probables: el token no incluye este repositorio (Repository access → Only select repositories), su Resource owner no es el dueño del repositorio, o está pendiente de aprobación. $how_to" ;;
    *) rm -f "$body"; fail "No se pudo comprobar STABLE_PUSH_TOKEN (respuesta $code de la API de GitHub)." "Puede ser un fallo pasajero de GitHub: relanza el job. Si se repite, revisa el token. $how_to" ;;
  esac
  push="$(node -e "try{const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).permissions;console.log(p?String(p.push):'')}catch{console.log('')}" "$body")"
  rm -f "$body"
  if [ "$push" = "false" ]; then
    fail "El dueño de STABLE_PUSH_TOKEN no puede escribir en $repo." "El token es válido, pero su cuenta no tiene permiso de escritura en el repositorio: créalo con la cuenta dueña del repositorio (o con una que tenga permiso de escritura). $how_to"
  fi
  # La API responde 200 con cualquier token válido en un repositorio público: lo decisivo es si git deja escribir.
  # Un push de prueba (--dry-run) pide a GitHub permiso de escritura sin cambiar nada.
  local err
  err="$(mktemp)"
  if ! git_push_auth push --dry-run --force "$remote" "HEAD:refs/heads/stable" > /dev/null 2> "$err"; then
    cat "$err" >&2
    rm -f "$err"
    fail "STABLE_PUSH_TOKEN no puede escribir en $repo." "Causas probables: falta el permiso Contents: Read and write, el token no incluye este repositorio (Only select repositories), ha caducado o está pendiente de aprobación. $how_to"
  fi
  rm -f "$err"
  echo "STABLE_PUSH_TOKEN es válido y puede escribir en $repo (el permiso Workflows solo se comprueba al mover stable)."
}

# Versión X.Y.Z del package.json de un commit.
version_at() {
  git show "$1:package.json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))"
}

# Última versión vX.Y.Z (la más alta) cuyo commit está en main y, si se da PUBLISHED_TAGS, que tiene release publicada.
latest_tag() {
  git fetch --no-tags --force origin '+refs/tags/v*:refs/tags/v*' > /dev/null
  local tag
  for tag in $(git tag -l 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -rV); do
    if [ -n "${PUBLISHED_TAGS:-}" ] && ! printf '%s\n' "$PUBLISHED_TAGS" | grep -qxF "$tag"; then continue; fi
    if git merge-base --is-ancestor "$tag^{commit}" origin/main; then echo "$tag"; return 0; fi
  done
  return 0
}

move() {
  local target="${1:-${GITHUB_SHA:-}}" sha version tag="" current prev newer err msg
  # Solo commits que ya están en main: una etiqueta puesta en otra rama (o en un commit suelto) no llega a stable.
  git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
  if [ "$target" = "--latest" ]; then
    tag="$(latest_tag)"
    [ -n "$tag" ] || fail "No hay ninguna versión publicada en main." "No se ha encontrado ninguna etiqueta vX.Y.Z con release publicada cuyo commit esté en main: stable no se mueve."
    sha="$(git rev-parse "$tag^{commit}")"
    echo "Última versión publicada en main: $tag ($sha)."
  else
    [ -n "$target" ] || fail "Falta el commit." "Uso: move-stable.sh move <commit>|--latest"
    sha="$(git rev-parse "$target^{commit}")"
  fi
  version="$(version_at "$sha")"
  if [ -n "$tag" ] && [ "v$version" != "$tag" ]; then
    fail "La etiqueta $tag no coincide con package.json ($version)." "stable no se mueve."
  fi
  case "$version" in
    "" | *[!0-9.]*) echo "$version es una preversión: stable no se mueve."; return 0 ;;
  esac
  if ! git merge-base --is-ancestor "$sha" origin/main; then
    echo "::warning::$sha no está en main: stable no se mueve (la release y la imagen ya están publicadas)."
    return 0
  fi
  # Commit actual de stable (vacío si aún no existe).
  current="$(git ls-remote origin refs/heads/stable | cut -f1)"
  if [ "$current" = "$sha" ]; then echo "stable ya está en $sha (v$version)."; return 0; fi
  if [ -n "$current" ]; then
    git cat-file -e "$current^{commit}" 2>/dev/null || git fetch --no-tags origin "$current"
    prev="$(version_at "$current")"
    # Nunca hacia atrás: publicar una corrección de una versión antigua no debe bajar a nadie de versión.
    newer="$(node -e "const p=v=>v.split('.').map(Number);const [a,b]=[p(process.argv[1]),p(process.argv[2])];let c=0;for(let i=0;i<3&&!c;i++)c=a[i]-b[i];console.log(c>0?1:0)" "$version" "$prev")"
    if [ "$newer" != 1 ]; then echo "stable ya tiene la $prev (>= $version): no se mueve."; return 0; fi
  fi
  # --force-with-lease con el commit leído arriba: si otro proceso la movió entretanto, falla en vez de pisarla.
  # Con «current» vacío exige que la rama no exista todavía.
  err="$(mktemp)"
  if ! git_push_auth push --force-with-lease="refs/heads/stable:$current" "$remote" "$sha:refs/heads/stable" 2> "$err"; then
    cat "$err" >&2
    if grep -qi "workflow" "$err"; then
      if [ -n "$pat" ]; then
        msg="GitHub rechaza mover stable porque cambian ficheros de .github/workflows/ y el secreto STABLE_PUSH_TOKEN no tiene el permiso Workflows (lectura y escritura) en este repositorio. $how_to"
      else
        msg="GitHub rechaza mover stable con GITHUB_TOKEN porque esta versión cambia ficheros de .github/workflows/. Crea el secreto STABLE_PUSH_TOKEN (token fine-grained solo de este repositorio con Contents y Workflows en lectura y escritura; pasos en docs/HANDOFF.md). $how_to"
      fi
    elif grep -qiE "could not read Username|Authentication failed|Permission to .* denied|403|401" "$err"; then
      msg="GitHub rechaza las credenciales de $token_name al mover stable. $how_to"
    else
      msg="No se pudo mover stable (ver el error de git arriba)."
    fi
    rm -f "$err"
    fail "stable no se ha movido." "$msg La imagen y la release de v$version ya están publicadas: solo falta stable."
  fi
  rm -f "$err"
  echo "stable → $sha (v$version)."
  echo "stable → \`$sha\` (v$version)." >> "$summary"
}

case "${1:-}" in
  check-token) check_token ;;
  move) shift; move "$@" ;;
  *) echo "Uso: move-stable.sh check-token | move <commit>|--latest" >&2; exit 2 ;;
esac
