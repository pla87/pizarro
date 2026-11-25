# Cerrar y publicar una versión (anexo del traspaso)

Anexo de `docs/HANDOFF.md` §5, que tiene el resumen. Aquí, el detalle: cerrar la versión, el workflow Release, el secreto
`STABLE_PUSH_TOKEN`, mover `stable` sin publicar, publicar desde una sesión y las actualizaciones de Dependabot. Desde el
PC del propietario, ver también `docs/handoff/LOCAL.md` («Ramas y publicación desde local»).

## Índice

1. [Cerrar una versión paso a paso](#cerrar-una-versión-paso-a-paso)
2. [Publicar desde la sesión y rama de trabajo tras la fusión](#publicar-desde-la-sesión-y-rama-de-trabajo-tras-la-fusión)
3. [Actualizaciones de dependencias (Dependabot)](#actualizaciones-de-dependencias-dependabot)

## Cerrar una versión paso a paso

1. `TZ=Europe/Madrid npm run version:bump -- minor --summary "…"` (o `patch`).
2. Rellenar en `changelog.json` el bloque nuevo: `changes` (`nuevas`, `mejoras`, `correcciones`, `tecnicos`) y
   `en: { summary, changes }`. Después `npm run version:bump -- --render`.
3. Actualizar `docs/MANUAL.md` (las dos líneas de versión, `version: "vX"` y «Versión de la aplicación») y las
   secciones afectadas. Generar el PDF en local para revisarlo: `node scripts/build-manual-pdf.mjs` (con `CHROME_PATH`
   si hace falta; `pruebas` para `PRUEBAS.pdf`). **No se sube**: los dos PDF están en `.gitignore` y el workflow Release
   los vuelve a generar desde `docs/` y los adjunta a la GitHub Release.
   Actualiza también `docs/PRUEBAS.md` (sección nueva con lo que hay que probar en real) y `docs/PRUEBAS-CHROME.md`
   (los prompts de Claude in Chrome que sigan pendientes, con lo nuevo de la versión).
4. Commit «vX.Y.Z: …», PR a `main` y fusionar.
5. Publicar la versión (etiqueta, imagen Docker y GitHub Release): en GitHub, **Actions → Release → Run workflow**
   sobre `main` (la publicación manual solo funciona desde `main`: lanzada desde otra rama no hace nada), o `npm run release:tag` y `git push origin vX.Y.Z` desde un equipo con permiso para subir
   etiquetas. Tras la primera publicación, el paquete `ghcr.io/pla87/pizarro` debe hacerse público. El mismo
   workflow mueve la rama `stable` al commit publicado (job «Rama stable», el único con permiso para escribir en el
   repositorio además de la release): de ella despliegan las instalaciones de Railway. Si se protege `stable` en
   GitHub, hay que permitir que la mueva GitHub Actions. Cada arquitectura de la imagen se construye en su máquina
   nativa de GitHub (job «Imagen amd64» en `ubuntu-latest` e «Imagen arm64» en `ubuntu-24.04-arm`, sin emular con QEMU),
   se sube a GHCR solo por su digest y el job «Imagen Docker» las une con `docker buildx imagetools create` en
   `:X.Y.Z` (y `:latest`) y comprueba que la imagen publicada tiene las dos. La imagen se construye con `OFFICIAL_BUILD=1` y
   `RELEASE_VERSION`: así la app sabe que es una build oficial y ofrece «Informar de un error» (en Railway, también
   si el código viene del repositorio oficial y de la rama `stable`; lógica en `src/lib/bug-report-core.ts`). El
   botón abre el formulario `.github/ISSUE_TEMPLATE/bug_report.yml` con datos técnicos rellenos (versión, commit,
   tipo de instalación, navegador y sistema, idioma); nunca usuarios, proyectos, emails ni la dirección de la
   instalación. Los fallos de seguridad van en privado (`SECURITY.md`). *Copiar información técnica* (Ajustes) sale
   de `src/lib/tech-info.ts`. Si cambian esos campos, actualiza a la vez el formulario y `tests/bug-report.test.ts`.
   El job solo mueve `stable` a un commit que ya está en `main` (`git merge-base --is-ancestor`); una etiqueta puesta
   en otra rama publica la imagen y la release, pero deja `stable` donde estaba (con un aviso en el job).
   El job «Manual en PDF» (en paralelo con las imágenes) genera `MANUAL.pdf` y `PRUEBAS.pdf` con
   `scripts/build-manual-pdf.mjs` y el Chrome del runner (`CHROME_PATH` = `CHROME_BIN`); «Imagen Docker» lo espera (si
   falla no se etiqueta nada) y «GitHub Release» los adjunta al crear la release. Si hace falta cambiar uno después:
   `gh release upload vX.Y.Z MANUAL.pdf --clobber`.
6. **Secreto `STABLE_PUSH_TOKEN` (una vez).** GitHub no deja que `GITHUB_TOKEN` mueva una rama si entre su commit
   anterior y el nuevo cambia algún fichero de `.github/workflows/` (error «refusing to allow a GitHub App to create
   or update workflow … without `workflows` permission»; el bloque `permissions:` no tiene un permiso `workflows`).
   Para esas versiones el job usa el secreto `STABLE_PUSH_TOKEN` si existe (si no, `GITHUB_TOKEN`). Crearlo:
   1. GitHub → *Settings* (de tu cuenta) → *Developer settings* → *Personal access tokens* → *Fine-grained tokens* →
      *Generate new token*. *Resource owner*: el dueño del repositorio (`pla87`); *Repository access*: **Only select
      repositories** → `pla87/pizarro`; caducidad: la que admita la organización (apunta cuándo renovarlo).
   2. *Repository permissions*: **Contents: Read and write** y **Workflows: Read and write** (nada más; *Metadata:
      Read* se añade solo).
   3. En el repositorio: *Settings → Secrets and variables → Actions → New repository secret* (o editar el que
      exista), nombre `STABLE_PUSH_TOKEN`, valor solo el token, sin espacios ni saltos de línea.
   Toda la lógica está en `scripts/move-stable.sh`, que usan el job «Rama stable» y el workflow «Mover stable». El
   checkout y las lecturas usan siempre `GITHUB_TOKEN`; el token solo se usa para el `git push` (en una cabecera, sin
   aparecer en el log), limpio de espacios y saltos de línea. Si falta (o le falta el permiso) y la versión cambia
   los workflows, el job termina en rojo con un mensaje que dice qué secreto crear; la imagen y la release ya están
   publicadas y no se tocan. Si `stable` está protegida, la regla debe permitir el push del propietario del token
   (o de GitHub Actions si no hay token).
7. **Comprobar el token.** El paso «Comprobar STABLE_PUSH_TOKEN» (en los dos workflows, antes de mover nada) pregunta
   a la API de GitHub con el token y hace un `git push --dry-run` (no cambia nada) para ver si puede escribir. Si
   falla, el error dice la causa probable:
   - *no es válido (401)*: caducado, revocado, pendiente de aprobación o el valor del secreto no es el token;
   - *no tiene acceso (403/404)*: el token no incluye `pla87/pizarro` (*Only select repositories*) o su *Resource
     owner* no es el dueño del repositorio;
   - *no puede escribir*: falta **Contents: Read and write** (o la cuenta del token no puede escribir en el repo).
   El permiso **Workflows** solo se puede comprobar al mover de verdad: si falta, el paso siguiente falla con «no
   tiene el permiso Workflows». Para revisar el token a mano: *Settings → Developer settings → Fine-grained tokens*,
   abrir el token y mirar *Expiration*, *Repository access* y *Permissions* (o *Regenerate token* y volver a guardar
   el secreto). En el pasado, un token mal creado hacía fallar el `actions/checkout` con «could not read Username
   for 'https://github.com': terminal prompts disabled»; ya no se usa en el checkout.
8. **Mover `stable` sin publicar otra versión.** Tras arreglar el secreto: **Actions → Mover stable → Run workflow**
   (rama `main`; `.github/workflows/stable.yml`). Mueve `stable` a la última versión publicada: la etiqueta `vX.Y.Z`
   más alta con GitHub Release publicada (ni borrador ni preversión) cuyo commit está en `main`, con las mismas reglas
   (nunca hacia atrás, `--force-with-lease`); si `stable` ya está ahí, no hace nada. También vale *Re-run failed
   jobs* en la ejecución de Release, pero esa repetición usa el workflow de la versión publicada (no recoge arreglos
   posteriores del workflow).

## Publicar desde la sesión y rama de trabajo tras la fusión

Visto en las sesiones de la nube (antes en §0 del núcleo). Desde el PC del propietario no se fuerza nunca la subida: ver
`docs/handoff/LOCAL.md`.

- La PR se fusiona aplastada (squash): después, la rama remota de trabajo conserva la historia vieja. Al empezar la
  ronda siguiente, `git checkout -B <rama> origin/main` y `git push --force-with-lease` (solo contiene lo ya fusionado);
  y borra los worktrees de la ronda anterior (`git worktree remove --force` + `git branch -D`), que ya están en `main`.
- Publicar desde la sesión: PR con las herramientas de GitHub, esperar sus tres comprobaciones (tipos/lint/pruebas,
  pruebas con base de datos y «Caddyfile»), fusionar aplastando, lanzar *Release* con `actions_run_trigger` (`release.yml`, ref `main`) y comprobar
  que `origin/stable` y la etiqueta `vX.Y.Z` apuntan al commit fusionado (unos 7 min; antes de la imagen pasan los
  jobs «Comprobaciones» y «Pruebas con base de datos» sobre el commit que se publica).

## Actualizaciones de dependencias (Dependabot)

`.github/dependabot.yml` abre PR contra `main`:

- **Acciones de GitHub**, un PR semanal con todas juntas. En los workflows cada acción va fijada a un commit exacto
  (`uses: owner/acción@<SHA de 40 caracteres> # vX.Y.Z`): nunca se vuelve a poner una etiqueta móvil como `@v4`.
  Para fijar una acción nueva a mano: `git ls-remote https://github.com/<owner>/<acción> refs/tags/<tag>` (si la
  etiqueta es anotada, el commit es el de la línea `^{}`).
- **npm**, un PR mensual con todas las versiones menores y parches. Las versiones mayores no se proponen (se hacen a
  mano, leyendo sus notas de cambios). Las de seguridad llegan en cuanto hay aviso, en su propio PR (requiere
  *Settings → Code security → Dependabot security updates* activado).
- **Imágenes base de Docker** (ecosistemas `docker`, el `Dockerfile`, y `docker-compose`, `deploy/compose.yml`), un PR
  semanal por ecosistema. Van fijadas por digest con su etiqueta (`node:22-bookworm-slim@sha256:…`,
  `caddy:2-alpine@sha256:…`, `postgres:16-alpine@sha256:…`): Dependabot propone el digest nuevo de la misma etiqueta,
  nunca otra versión mayor (PostgreSQL 16 → 17 exige migrar los datos). A mano: `docker buildx imagetools inspect
  <imagen:etiqueta>`, línea `Digest:` (la del índice multiarquitectura, no la de una plataforma).
- En todos, `cooldown: default-days: 7`: solo se proponen versiones publicadas hace al menos 7 días (las de
  seguridad no esperan).
- **`overrides` en `package.json`**: `minimatch` 11 dentro de `@typescript-eslint/typescript-estree` (herramienta de
  lint, no va en la app) por el aviso GHSA-g3hv-75wg-m249; quitarlo cuando `typescript-eslint` traiga una versión
  corregida por sí mismo (`npm ls minimatch` y `npm audit`).

Cómo se revisa cada PR:

1. Leer qué cambia: en las acciones, que el SHA nuevo corresponde a la etiqueta del comentario (enlace «Release
   notes» del PR) y que la acción sigue siendo del mismo propietario; en npm, las notas de los paquetes con cambios
   de comportamiento (Next, Prisma, TipTap, @dnd-kit, sharp…). Prisma: `prisma` y `@prisma/*` deben ir a la misma
   versión; Next y `@next/swc-*`, también.
2. Bajarse la rama y pasar **todas** las comprobaciones de la sección 4 del núcleo (`docs/HANDOFF.md`) (incluidas `npm run test:db` y el build de
   producción) y, si toca Next, TipTap o @dnd-kit, las suites e2e.
3. **Una actualización de dependencias se aprueba solo si pasan todas las pruebas.** Si algo falla, se cierra el PR
   (o se ignora esa versión con `@dependabot ignore this minor version`) y se anota en la sección 6 del núcleo. Nunca se
   «arregla» una prueba para que pase con la dependencia nueva sin entender por qué fallaba.
4. Se fusiona en `main` como cualquier otro cambio; llega a los usuarios con la siguiente versión publicada (nunca
   antes: las instalaciones siguen las releases o la rama `stable`).
