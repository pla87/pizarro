# Traspaso para una sesión nueva

Documento para retomar el desarrollo de Pizarro en una sesión nueva sin perder el método de trabajo. Este es el
**núcleo**: léelo entero antes de empezar. El detalle técnico, la historia de decisiones y la publicación paso a paso
están en anexos que se leen solo cuando hacen falta (índice en la sección 7). No contiene datos personales: el
repositorio es público y debe seguir sin ellos.

## 0. Arranque de una sesión nueva

1. Lee este núcleo entero, el índice del manual (`grep -n '^#' docs/MANUAL.md`) y solo las secciones del tema de la
   ronda, `e2e/README.md` y `docs/PRUEBAS-CHROME.md`. Los anexos (§7), solo cuando toque su tema.
2. Rama de trabajo: la que indique la sesión, igual que `main` (`git fetch origin main && git checkout -B <rama> origin/main`).
3. Entorno. **En el PC del propietario:** sección 0b. **En la nube** (si no está hecho): `pg_ctlcluster 16 main start`;
   si `postgres` no tiene contraseña,
   `su postgres -c "psql -c \"alter user postgres password 'postgres'\""`; `.env` a partir de `.env.example` con
   `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pizarro"`, un `SESSION_SECRET` aleatorio,
   `APP_URL="http://localhost:3000"`, `UPLOAD_DIR="./uploads"`, `SEED_ADMIN_EMAIL="admin@example.com"`,
   `SEED_ADMIN_PASSWORD="cambia-esta-clave"` y `SEED_ADMIN_NAME="Administrador"`; `npm ci` (comprueba que existe
   `node_modules/@next/swc-linux-x64-gnu`, ver `docs/handoff/GUARDAS.md`, «Entorno»), `createdb pizarro` y
   `npx prisma migrate deploy`.
4. Añade `.claude/` a `.git/info/exclude` (ahí van los worktrees de los agentes).
5. Los ZIP de capturas del propietario se extraen en una carpeta temporal fuera del repositorio. Las capturas y las
   auditorías que manda pueden llevar nombres, dominios y datos de su instalación: no se suben ni se copian a los briefs.
6. Antes de cada fusión en `main`, busca en el diff, en los PDF y en los mensajes de commit los términos personales que
   indique el propietario (no se apuntan aquí: el repositorio es público).
7. Trampas del entorno de la nube (rondas 58–63; `createdb` con `PGPASSWORD`, `NODE_OPTIONS=--use-openssl-ca`, bases
   `pizarro_test_<hex>`, `rm -rf .next/types`, memoria y número de agentes, reinicios del contenedor):
   `docs/handoff/GUARDAS.md`, «Entorno». Rama tras la fusión aplastada y publicar desde la sesión:
   `docs/handoff/PUBLICAR.md`.
8. Prompts para Claude in Chrome pendientes: `docs/PRUEBAS-CHROME.md` (se actualizan al cerrar cada ronda).
9. Las capturas, los informes de Claude in Chrome y las auditorías pueden traer el dominio real de la instalación del
   propietario y su email: nunca se copian a ficheros, briefs ni commits (el grep de privacidad antes de cada fusión).

## 0b. Sesión local en el PC del propietario (Claude Code + Claude in Chrome)

Desde la ronda 65 el propietario puede seguir en **Claude Code en el terminal de su PC**, con **Claude in Chrome** (la
extensión del navegador, herramientas `mcp__claude-in-chrome__*`), en lugar de la nube. El método (§2–§5) es el mismo;
cambian el entorno, los recursos y cómo se publica.

**Qué leer al empezar en local:** este núcleo (incluida esta sección), el índice del manual
(`grep -n '^#' docs/MANUAL.md`) y solo las secciones del tema de la ronda, `e2e/README.md` y `docs/PRUEBAS-CHROME.md`.
Los anexos (§7), cuando toque su tema.

**Requisitos** (cualquier sistema; notas para Windows y macOS):

- **Git.** Windows: Git for Windows, que trae **Git Bash** (los scripts `scripts/*.sh`, como `scripts/e2e-all.sh`, son de
  bash: lánzalos desde Git Bash o WSL, no desde PowerShell ni cmd). macOS: el de las *Command Line Tools*
  (`xcode-select --install`) o Homebrew.
- **Node 22** (`package.json` pide `"engines": { "node": ">=22" }`; no hay `.nvmrc`; las imágenes Docker y las
  builds usan Node 22). Windows: instalador de nodejs.org (LTS 22) o `nvm-windows`/`fnm`. macOS: `brew install node@22`,
  `nvm install 22` o `fnm`. Comprueba con `node -v`.
- **PostgreSQL 16** (ni 15 ni 17: la imagen de Compose usa `postgres:16-alpine`). Instalado (Windows: instalador de
  EDB; macOS: Postgres.app o `brew install postgresql@16`) con usuario `postgres` y contraseña `postgres`, o con Docker:

  ```sh
  docker run -d --name pizarro-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
  ```

  Tras reiniciar el PC: `docker start pizarro-pg` (o el servicio de PostgreSQL instalado). El usuario debe poder crear
  bases (`npm run test:db` crea y borra `pizarro_test_*`; las suites e2e, `pz_qa`).
- **`gh`** (GitHub CLI) autenticado con `gh auth login`, o la web de GitHub para la PR y el workflow.

**Puesta en marcha:**

```sh
git clone https://github.com/pla87/pizarro.git && cd pizarro
cp .env.example .env        # y edítalo (abajo)
npm ci                      # nunca npm install: reescribe el package-lock.json
createdb -h localhost -U postgres pizarro   # o: docker exec pizarro-pg createdb -U postgres pizarro
npx prisma migrate deploy
npm run dev                 # desarrollo en http://localhost:3000
```

En el `.env`, los mismos valores que en §0: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pizarro"`, un
`SESSION_SECRET` aleatorio (`openssl rand -base64 48`, que trae Git Bash, o
`node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`), `APP_URL="http://localhost:3000"`,
`UPLOAD_DIR="./uploads"`, `SEED_ADMIN_EMAIL="admin@example.com"`, `SEED_ADMIN_PASSWORD="cambia-esta-clave"` y
`SEED_ADMIN_NAME="Administrador"` (valores de ejemplo: nunca los reales del propietario). `createdb` pide la contraseña
(`postgres`) si no tienes `PGPASSWORD`. Añade `.claude/` a `.git/info/exclude` (worktrees de los agentes).

Build de producción, la que prueban las suites e2e y la que hay que mirar antes de fusionar (§4):
`npx prisma generate && npx next build --webpack && node scripts/postbuild.mjs && npm run build:boot` y después
`npm start` (funciona también en Windows: el script `start` no lleva `exec`).

**Lo que en la nube hacía falta y en local no («solo nube»):**

- El binario SWC `@next/swc-linux-x64-gnu` extraído a mano: *solo nube*. En local `npm ci` instala el de tu sistema
  (Windows, macOS Intel o ARM).
- `NODE_OPTIONS=--use-openssl-ca` para `npm test` y las pruebas de PDF: *solo nube* (allí `NODE_OPTIONS` traía
  `--max-old-space-size=8192`). En local no lo pongas; si tu `NODE_OPTIONS` lleva `--max-old-space-size`, quítalo para
  `npm test` (anula el tope del worker de PDF).
- `pg_ctlcluster 16 main start` y el `alter user postgres password`: *solo nube*. En local, el servicio o el
  contenedor de PostgreSQL.
- `PGPASSWORD=postgres … </dev/null` para que `createdb`/`dropdb` no se queden esperando: *solo nube* (en local te lo
  pregunta y contestas).
- Los límites de la nube (sin descargar binarios, sin `npx --yes knip@5` para los agentes, reinicios del contenedor):
  *solo nube*. En local, `npx --yes knip@5` lo puede pasar la sesión principal con normalidad.
- Valen también en local: las bases sueltas de `tests/db/` se llaman `pizarro_test_<hex>`; tras borrar una página,
  `rm -rf .next/types` antes de `tsc`; `tests/report-render.test.ts` puede fallar con la CPU cargada (sola, pasa).

**Chromium para e2e:** `npx playwright-core install chromium` (las suites usan el de `playwright-core` si no hay otro),
o `CHROME=` a un Chrome instalado (Windows: `CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"` en Git
Bash; macOS: `CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`). Para los PDF del manual,
`CHROME_PATH` con la misma ruta. Las suites corren en su propio Chromium sin interfaz, no en el Chrome del propietario.

**Recursos:** en un portátil, **no más de 2–3 agentes a la vez**, y que no compilen ni pasen e2e salvo encargo (la
build de producción y las suites las pasa la sesión principal al final, una cada vez). Cada agente con su base
(`pz_<agente>`), su puerto y `OUT=` propio. En Windows y macOS `cp -al` puede no existir: el agente hace `npm ci` en su
propio worktree (más lento, pero nunca toca el `node_modules` del repositorio principal).

**Ramas y publicación desde local:**

- `git push` normal a la rama de trabajo; **nunca forzar** (`--force`) desde el PC. Tras la fusión aplastada, la
  ronda siguiente empieza en una rama recién sacada de `origin/main` (o con `git merge origin/main` sobre la anterior
  y push normal).
- PR con `gh pr create --base main` (o la web), esperar sus dos comprobaciones (`gh pr checks --watch`: tipos/lint/pruebas
  y «Caddyfile») y fusionar aplastando (`gh pr merge --squash` o el botón *Squash and merge*).
- Publicar: en GitHub, **Actions → Release → Run workflow** sobre `main` (o `gh workflow run release.yml --ref main`);
  después `git fetch origin --tags` y comprobar que `origin/stable` y `vX.Y.Z` apuntan al commit fusionado. Detalle en
  `docs/handoff/PUBLICAR.md`.
- Minutos de Actions solo al final (la PR y la Release): las comprobaciones de §4 se pasan en local antes.

**Claude in Chrome.** La propia sesión de Claude Code puede ejecutar los prompts de `docs/PRUEBAS-CHROME.md` en el
Chrome del propietario (instalación de prueba de Railway, Cloudflare, GitHub). Reglas:

- Siempre en una **pestaña nueva**; no tocar las pestañas que el propietario tenga abiertas.
- En Railway, **comprobar el nombre del proyecto antes de tocar nada** (el de prueba y el real se llaman parecido).
- **Nunca la instalación real** salvo que el propietario lo pida expresamente en esa ronda.
- **Nunca copiar claves, tokens ni datos personales** (emails, dominios, nombres) a ficheros, briefs ni commits.
- Si hace falta una contraseña o un segundo factor, **pedir al propietario que inicie sesión él**; no escribirla.
- Capturas y descargas solo en una **carpeta temporal fuera del repositorio**.
- Lo aprendido en `PRUEBAS-CHROME.md` («Lo aprendido en las pruebas») sigue valiendo: sin incógnito ni 390 px ni
  arrastres, PDF por captura, tooltips con read_page, etc.

**Privacidad:** antes de cada fusión en `main`, el grep de los términos personales en el diff, los PDF y los mensajes
de commit (los términos los da el propietario; no se apuntan en el repositorio).

## 1. Qué es Pizarro

Kanban ligero con generador de release notes, documentación del proyecto, calendario, columnas especiales,
exportar/importar proyectos y copias de seguridad cifradas. Se instala en un servidor propio (Docker Compose) o en
Railway. Se está preparando para venderse como producto.

- **Stack:** Next.js 16 (App Router, acciones de servidor con `runAction` en `src/lib/action.ts`), Prisma 7 con
  adapter-pg, PostgreSQL 16, Tailwind 4, TipTap 3, @dnd-kit.
- **Repositorio:** `github.com/pla87/pizarro` (antes se llamaba `tablon`; algunas herramientas siguen usando ese
  nombre). Rama principal `main`.
- **Producción:** la instalación del propietario en Railway despliega desde la rama `stable` (solo versiones
  publicadas; la mueve el workflow Release al publicar). Fusionar en `main` no despliega nada: hay que publicar la
  versión (sección 5). Si un despliegue no llega, en Railway ⌘K → «Deploy Latest Commit». Dominio propio en `APP_URL`.
- **Versión actual:** la de `package.json` y el primer bloque de `changelog.json`.
- **Cómo funciona todo:** `docs/MANUAL.md`. Su PDF, `MANUAL.pdf`, no está en el repositorio: el workflow Release lo
  genera y lo adjunta a cada GitHub Release (la web enlaza a
  `https://github.com/pla87/pizarro/releases/latest/download/MANUAL.pdf`). Instalación: `docs/INSTALL.md`. Prueba en un
  VPS: `docs/PRUEBA-VPS.md`.
- **Pruebas que el dueño hace en real** (Google, WhatsApp, Telegram, email, Stripe, Railway, móvil): `docs/PRUEBAS.md`;
  su PDF, `PRUEBAS.pdf`, también va adjunto a cada release (en local: `node scripts/build-manual-pdf.mjs pruebas`, con
  `CHROME_PATH` si hace falta). Los dos PDF están en `.gitignore`.

## 2. Cómo trabaja el propietario (protocolo de cada ronda)

El propietario envía rondas de tareas en español con códigos (`RxxF1` funcionalidad, `RxxC1` corrección, `RxxM1`
mejora, `RxxR1` respuestas a preguntas anteriores), a veces con un ZIP de capturas. Las capturas pueden contener
datos personales: **nunca se suben al repositorio**. Extrae cada ZIP en una carpeta nueva y temporal.

Cada ronda empieza con «Revisa todo antes de empezar y organiza el orden idóneo» y una indicación de qué modelo usar
para los agentes (p. ej. «Usa <modelo>», o «usa agentes con modelos más sencillos cuando sea posible y revisa siempre
con el modelo principal lo que han hecho»: entonces revisa tú cada entrega antes de fusionar) y termina con «merge a main y
commit, actualiza el pdf de cómo funciona todo, prepara un resumen de los cambios y después un listado de lo que
necesitas que decida junto con próximos pasos sugeridos». Suele incluir «Revisa el código» (arreglar lo evidente y
preguntar lo opcional) y «Bug hunt».

Método que ha funcionado:

1. Rama de trabajo: la que indique la sesión. Al empezar, ponla igual que `main`
   (`git fetch origin main && git checkout -B <rama> origin/main`).
2. Reparte el trabajo en agentes en paralelo (aislados en worktrees), uno por bloque que no toque los mismos
   ficheros. Dales un brief común (sección 3) y una tarea concreta con los ficheros a mirar.
3. Para «Revisa el código» y «Bug hunt»: dos agentes de **solo lectura** sobre el diff de la ronda; luego un agente
   que arregla lo verificado. Lo opcional se le pregunta al propietario en lenguaje sencillo.
4. Revisa tú cada entrega antes de fusionarla (diff, riesgos, trailers de commit), fusiona en la rama, resuelve
   conflictos y pasa todas las comprobaciones (sección 4).
5. Cierra la versión (sección 5), abre la PR, fusiónala en `main` y entrega el informe final en español:
   resumen de cambios, decisiones que necesitas y próximos pasos.

Preferencias del propietario: respuestas en español, claras y sin tecnicismos innecesarios; le gusta que se le
expliquen las opciones con su coste y beneficio y una recomendación.

Lo que ha funcionado en las rondas 58 y 59 para «Revisa el código» y «Bug hunt» (con «10 vueltas o hasta que no salgan»):

- Un brief común en un fichero temporal para los revisores (solo lectura; cuatro miradas: persona usuaria,
  administración, programación y atacante, más coste; cada hallazgo con `fichero:línea`, gravedad, escenario, arreglo y
  la marca **evidente** u **opcional**; y una lista aparte de «candidatos a retirar» con la prueba de que no se usan) y
  otro para los agentes que implementan (§3 más: no compilar ni pasar e2e salvo encargo, verificar antes de cambiar,
  pruebas en el fichero del tema, informe con lo que debe decir el manual).
- Cada vuelta, revisores por **áreas distintas** (acceso y permisos, ficheros, tablero, tareas de fondo, importar y
  exportar, releases y PDF, navegador, experiencia de uso y código sin uso, calendario, instalación; en la 59:
  administración, emails y mensajes, varias instancias, cuentas nuevas, rendimiento medido con datos grandes). Después,
  vueltas sobre el **diff de la propia ronda** (servidor y cliente, este probado en navegador) hasta que solo salgan
  detalles. Los hallazgos se guardan en ficheros temporales y se reparten entre arregladores sin ficheros en común.
- Lo evidente se arregla; lo opcional y lo de retirar va a la lista numerada de decisiones del informe final, con una
  recomendación entre paréntesis para que el propietario conteste «sí/no» por número.

## 3. Brief común para los agentes

- Su worktree puede nacer en un commit antiguo (el de `main`): al empezar, si `git log --oneline -1` no es el de la rama
  de trabajo, `git reset --hard <rama de trabajo>` (todavía sin commits propios). Nunca `npm install` (ver §4 y `docs/handoff/GUARDAS.md`, «Entorno»).
- Trabajan en su propio worktree. Dependencias: **solo dentro de su worktree** (comprobar `pwd`):
  `[ -e node_modules ] || cp -al <repo>/node_modules node_modules`. Nunca tocar el `node_modules` del repositorio
  principal (un agente lo sustituyó una vez por un enlace a sí mismo).
- Copian el `.env` y apuntan `DATABASE_URL` a una base propia (`pz_<agente>`), puerto propio. Si PostgreSQL no
  arranca: `pg_ctlcluster 16 main start`. Solo borran las bases que crearon.
- i18n: el texto en español es la clave (`t("...")`); cada texto nuevo necesita su entrada en `src/i18n/en/*.ts`.
  `npm run i18n:check` debe pasar. **Diccionarios por tema**: cada texto va al fichero de su tema (`mensajeria.ts`,
  `detalle.ts`, `web.ts`, `licencia.ts`, `releases.ts`…) o, si no hay ninguno que encaje, a uno nuevo con el nombre del
  tema, registrado en `src/i18n/en/index.ts`; nunca a uno con el nombre de la ronda o de la tarea (`bh48a.ts`,
  `rev2.ts`). Para no chocar entre agentes basta con añadir al final del objeto, bajo un comentario propio. Sin claves
  repetidas entre ficheros (`npm run i18n:unused` las cuenta).
- Migraciones nuevas: carpeta `prisma/migrations/<timestamp>_<nombre>` con un timestamp posterior al último. Las ya
  publicadas no se editan nunca (cambia su checksum y `prisma migrate deploy` falla en las instalaciones que la aplicaron).
  El SQL de cada migración nueva va **entre `BEGIN;` y `COMMIT;`** (solo comentarios antes y después): si una sentencia
  falla, no queda la base con media migración aplicada. Lo comprueba `tests/migrations.test.ts` para las posteriores a
  la última de la v1.62.0 (`20261126100000`); las anteriores no se tocan. Nada que no pueda ir en una transacción
  (`CREATE INDEX CONCURRENTLY`), ni usar en la misma migración un valor de enum recién añadido.
- Migraciones: **expandir y luego contraer**. No se borra ni se renombra una columna (o tabla, o valor de un enum) en
  la misma versión que deja de usarla: primero sale la versión que ya no la lee ni la escribe (con una migración que
  solo añade, si hace falta) y la columna se quita en una migración de la versión siguiente. Con volumen, Railway no
  solapa versiones (hay unos segundos sin servicio), pero la versión anterior vuelve a servir sobre la base ya migrada si
  el despliegue nuevo falla después de migrar (Railway mantiene la anterior) o si se vuelve atrás a mano (redesplegar
  uno viejo, fijar una versión anterior en compose): si la migración quitó algo que esa versión usa, falla. Igual para cambiar un tipo o volver
  obligatoria una columna: columna nueva, copiar los datos, usarla, y quitar la vieja una versión después.
- No tocan `changelog.json`, `CHANGELOG.md`, la versión de `package.json`, `docs/MANUAL.md` ni `MANUAL.pdf`: los
  actualiza la sesión principal al cerrar la versión. Terminan su informe con lo que debería decir el manual.
- Commits con el mensaje terminado en la línea de coautoría que haya fijado el propietario. Nada de enlaces de
  sesión ni nombres de modelos en commits, PR ni ficheros.
- Privacidad: el repositorio es público. Nada de nombres, emails, dominios ni capturas del propietario; en pruebas,
  direcciones `example.com`.


## 4. Comprobaciones antes de fusionar

```sh
npx prisma generate
npx tsc --noEmit
npm run lint
npm test                 # unitarias
npm run i18n:check
npm run i18n:unused      # solo informa (ver abajo)
npm run test:db          # con base de datos (crea y borra pizarro_test_*)
npx next build --webpack && node scripts/postbuild.mjs && npm run build:boot
```

`npm run build` (el que usan el `Dockerfile` y Railway) también compila con `--webpack`, el mismo empaquetador que
prueban las suites. Con Turbopack (el de Next 16 por defecto) el standalone arrastraba todo el proyecto (`src/`,
`tests/`, `docs/`…) por un `stat()` dinámico y el JS de cada página pesaba 7–18 KB más; no lo cambies sin probarlo todo.

Pruebas en navegador (suites de `e2e/`, nombradas por tema: `tablero-*`, `importar-*`, `plantillas-*`…), contra la
build de producción con `scripts/e2e-all.sh` (cada suite con su servidor recién arrancado; base `pz_qa` o `E2E_DB`,
puerto 3231 o `E2E_PORT`; instrucciones en su cabecera):

- **En cada ronda, antes de fusionar:** las afectadas, `AFFECTED=1 scripts/e2e-all.sh` (la QA siempre, y las que
  cubren los ficheros cambiados respecto a `origin/main` según `e2e/suites.json`; `DRY_RUN=1` dice cuáles y por qué).
- **Antes de publicar una versión:** todas, `scripts/e2e-all.sh` (la de instalación incluida, al final).
- `SUITES="tablero-e2e importar-json-detalle-e2e" scripts/e2e-all.sh` lanza solo esas.

Termina con `Total: N/M comprobaciones OK`. Una suite nueva va con el prefijo de su tema y con su entrada en
`e2e/suites.json` (lo comprueba `tests/e2e-affected.test.ts`); si una pieza nueva de la app la prueba una suite, añade
su ruta a esa entrada. Cuántas comprobaciones tiene cada una: `e2e/README.md` (las cifras solo se
apuntan allí); qué prueba y cómo se lanza sola: `e2e/SUITES.md`. Si cambias el rol o la
etiqueta de un elemento que una suite usa, actualiza el script correspondiente. Para esperar al canal en vivo del
tablero, `L.liveOpen(page)` (la raíz del tablero lleva `data-live="open"`), no una pausa fija. Las suites declaran la
instalación de uso personal en `prepareUsers` (`e2e/qa/lib.mjs`) para que no salga el recordatorio de licencia.
Chromium: `CHROME` o, si no, el más reciente de `/opt/pw-browsers`.

Las guardas técnicas (qué no romper en cada parte de la app) están en `docs/handoff/GUARDAS.md`, agrupadas por tema
con un índice. Léelas cuando la ronda toque ese tema. Las imprescindibles, en una línea:

- Migraciones: `BEGIN;`/`COMMIT;`, expandir y luego contraer, nunca editar una publicada (§3); un valor de enum nuevo que
  la app escribe se añade en una versión y se escribe en la siguiente (GUARDAS, «Migraciones y enums»).
- Logs: todo `logEvent` lleva `label` (plantilla `{k, p}`), sin `message` (GUARDAS, «Logs»).
- Tablero en vivo: una acción nueva solo entra en `PATCHABLE_ACTIONS` si anota cada tarjeta (`noteTask`) y llama a
  `needOwnRefresh()` si toca algo más; un campo nuevo de `BoardTask` necesita su valor en `BOARD_TASK_DEFAULTS`
  (GUARDAS, «Tablero»).
- Toda vía nueva por la que una tarea entre en una columna pasa por `assertColumnRoom` + `columnAssignment` (GUARDAS, «Tablero»).
- Diálogos: un botón portado que deba usarse encima de un `Modal` lleva `data-pz-layer=""` (GUARDAS, «Navegador e interfaz»).
- Un secreto nuevo que se muestre en pantalla lleva `data-pz-no-capture` (GUARDAS, «Seguridad y límites»).
- Los topes de lo que cuesta dinero o molesta a terceros van en el mapa de seguridad del limitador (GUARDAS, «Seguridad y límites»).
- Una ruta nueva con token en la URL va en `SECRET_PATH_PREFIXES` y `redactPath` (GUARDAS, «Emails y mensajería»).
- Ids de la URL con `isRowId` antes de tocar la base (GUARDAS, «Servidor, arranque y red»).
- `APP_URL` siempre con `resolveAppUrl()`, nunca `process.env.APP_URL` (GUARDAS, «Servidor, arranque y red»).
- Ningún `route.ts` importa `src/actions` (GUARDAS, «Importar y exportar»).
- Una ruta de subida nueva usa `acquireUploadSlot` y `withUploadCapHeader` (GUARDAS, «Subidas y Compartir»).
- Un PDF de columna nuevo se descarga con `columnDownload.ts` y responde `attachment` (GUARDAS, «PDF y descargas»).
- Nada que llegue al navegador importa `zod`; acciones en transición con `useActionTransition()`; URL sin recargar con
  `replaceUrlKeepingState` (GUARDAS, «Navegador e interfaz»).
- SQL propio sin `NOW()` sobre `timestamp(3)`; consultas de un `pg.Client` propio, en fila (GUARDAS, «Base de datos»).
- Nunca `--max-old-space-size` en `NODE_OPTIONS` (anula el tope del worker de PDF) (GUARDAS, «PDF y descargas»).
- Nunca `npm install` (reescribe el lock sin `libc`): `npm ci`, y las dependencias se añaden a mano (GUARDAS, «Entorno»).
- Guardas de tiempo con `assertFast`/`bestTime`, nunca un tope fijo; sin `--test-force-exit` (GUARDAS, «Pruebas y código sin uso»).
- Un `export` que nadie importa fuera de su módulo no se deja (knip); pruebas en el fichero de su tema (GUARDAS, «Pruebas y código sin uso»).
- Antes de borrar una traducción sin uso, mira el historial, el deshacer y los errores de importar (GUARDAS, «i18n»).

Antes de cada fusión en `main`, comprueba que no se cuela ningún dato personal del propietario en el diff ni en el
PDF del manual (busca su nombre, email y dominios; pídeselos si no los sabes) y que los mensajes de commit no
llevan enlaces de sesión ni nombres de modelos.

## 5. Cerrar una versión

Resumen (el detalle, `STABLE_PUSH_TOKEN`, mover `stable` y Dependabot: `docs/handoff/PUBLICAR.md`):

1. `TZ=Europe/Madrid npm run version:bump -- minor --summary "…"` (o `patch`); rellenar el bloque nuevo de
   `changelog.json` (`changes` y `en`) y `npm run version:bump -- --render`.
2. Actualizar `docs/MANUAL.md` (las dos líneas de versión y las secciones afectadas), `docs/PRUEBAS.md` y
   `docs/PRUEBAS-CHROME.md`. Los PDF se revisan en local (`node scripts/build-manual-pdf.mjs`) y **no se suben**.
3. Commit «vX.Y.Z: …», PR a `main` (esperar sus dos comprobaciones), fusionar aplastando.
4. **Actions → Release → Run workflow** sobre `main` (desde otra rama no hace nada) y comprobar que `origin/stable` y
   la etiqueta `vX.Y.Z` apuntan al commit fusionado (unos 6 min).
5. Una actualización de Dependabot se aprueba solo si pasan **todas** las comprobaciones (PUBLICAR, «Dependabot»).

## 6. Estado y pendientes

**Paquetización (paso a paso, a petición del propietario):**

- Lo hecho de la paquetización (instalación, web, guías, recordatorio y modelo de venta, publicación):
  `docs/handoff/HISTORIA.md`, «Paquetización: lo hecho».
- Pendiente de confirmar por el propietario: prueba real en un VPS siguiendo `docs/PRUEBA-VPS.md`; plantilla de
  Railway (pasos en `docs/INSTALL.md`; la sintaxis de variables generadas debe verificarse en Railway); las pruebas en
  real de `PRUEBAS.pdf` (Google, WhatsApp, Telegram, email, Stripe).
- Siguientes pasos: revisión de la licencia por un abogado (en especial las definiciones de «centro educativo» y
  «uso educativo» de §2: academias privadas, gestión del centro, administraciones educativas y formadores autónomos), vídeo para la presentación (sustituye a la demo),
  capturas reales sin datos personales, poner en marcha getpizarro.com (`docs/VENTA.md` §8) y el Payment Link.
- Telegram y WhatsApp: implementados; la única decisión pendiente del propietario es de coste (si activa WhatsApp en
  su instalación). Detalle: `docs/handoff/GUARDAS.md`, «Emails y mensajería».

**Estado al cerrar la ronda 64:** v1.68.0 fusionada en `main` y publicada con *Actions → Release* (rama `stable` movida).
Hecho por el propietario con Claude in Chrome en la ronda 64: pruebas en real de la v1.67.0 (bien; no se pudieron las
plantillas propias como miembro ni el plan para IA), auditoría como usuario nuevo de la v1.67.0 (sus fallos y lo evidente,
arreglados en la v1.68.0) y registro DMARC `_dmarc` con `p=none` en getpizarro.com. Pendiente: los prompts de
`PRUEBAS-CHROME.md` (pruebas en real de la v1.68.0, `rua` del DMARC si lo aprueba, auditoría).
La ronda 64 dio 8 vueltas de revisión (servidor y seguridad, navegador y ficheros, acceso y emails, tablero y plantillas,
instalación y CI, y tres sobre el diff de la ronda); la última no encontró nada.

**Preguntas abiertas al propietario (tras la v1.68.0)**, con la numeración del informe final de la ronda 64 (entre
paréntesis, la recomendación que se le dio):

1. Historial de versiones: pintar solo las 10 últimas con «Ver más» (la página pesa ~450 KB; −78 %). (SÍ)
2. Mis tareas: cambiar los filtros por una línea de resumen con enlaces a cada grupo. (SÍ)
3. Logs en inglés: guardar también el mensaje en inglés (`messageEn`) para poder buscar en inglés. (SÍ)
4. Filtrar también en `client.window` los errores que vienen de extensiones. (SÍ)
5. Avisar por email a quien configuró el informe semanal cuando el destinatario se rechaza para siempre. (SÍ)
6. Cambiar de tipo en el detalle: sustituir las subtareas del tipo anterior que sigan sin marcar ni editar, con deshacer. (SÍ)
7. Atenuar en escritorio los botones «+» y «Varias tareas» junto al diálogo (enteros al pasar el ratón). (SÍ)
8. Recalcular la fecha al mover una tarjeta entre dos columnas de persona. (NO)
9. «Tipo por defecto» también en plantillas y en «Varias tareas». (Solo si se echa de menos)
10. Plan para IA: decir el tipo una sola vez si todas las tareas son del mismo tipo. (SÍ, pequeño)
11. Administración → Proyectos: «asignados» → «miembros», como en Ajustes del proyecto. (SÍ)
12. Invitación pendiente en Ajustes del proyecto: «Reenviar invitación» por email si hay email. (SÍ)
13. Retirar código que solo usan las pruebas: `reencryptIfStale` (`keyring.ts`), `parseTaskLines` (`bulk.ts`) y el
    `describeAction` «Abrió la tarea…» de `getTaskDetail` (nunca se registra). (SÍ)
14. Avisos: «Ver más» por páginas en lugar de volver a leer todo. (NO por ahora)
15. CI: no repetir la pasada de comprobaciones al fusionar en `main` (ya pasó en la PR). (SÍ)
16. `npm run test:db` repartido en 3 bases en paralelo. (Más adelante)
17. Documentación más corta para cada sesión nueva: HANDOFF con anexos aparte, detalle de las suites en `e2e/SUITES.md`
    y leer solo el índice del manual al empezar (de ~130.000 a ~45.000 tokens de lectura inicial). (SÍ)
18. DMARC con informes (`rua`), prompt 2 de `PRUEBAS-CHROME.md`. (Opcional)
19. Ideas de la auditoría: «Organizar por personas» en *Casa y familia*, roles de columna filtrados por plantilla,
    arrastrar cabeceras de columna. (Más adelante)
20. Fase 2 de Agenda y Entrega al cliente (ver `docs/handoff/GUARDAS.md`, «Migraciones y enums», Ronda 64). (SÍ, en la v1.69)

Decisiones ya aplicadas de cada ronda, ideas pospuestas, límites conocidos y menores sin numerar:
`docs/handoff/HISTORIA.md`.

## 7. Anexos: cuándo leer cada uno

| Anexo | Qué tiene | Cuándo leerlo |
|---|---|---|
| `docs/handoff/GUARDAS.md` | Las guardas técnicas de §4 (y las de cada ronda) por tema: tablero, navegador, logs, migraciones, base de datos, PDF, subidas, importar, i18n, fechas, servidor, seguridad, emails, tareas de fondo, plantillas, deshacer, pruebas, e2e, entorno | Al repartir una ronda, la sección del tema de cada agente (cópiala a su brief); al revisar una entrega de ese tema |
| `docs/handoff/HISTORIA.md` | Decisiones de cada ronda ya aplicadas, lo hecho de la paquetización, ideas pospuestas, límites conocidos y menores sin numerar | Cuando el propietario pregunte por algo ya decidido, antes de proponer algo que pudo descartarse, y al cerrar la ronda (para añadir sus decisiones) |
| `docs/handoff/PUBLICAR.md` | Cerrar y publicar una versión paso a paso, `STABLE_PUSH_TOKEN`, mover `stable`, publicar desde la sesión, Dependabot | Al cerrar una versión o si falla el workflow Release; al revisar un PR de Dependabot |
| `e2e/SUITES.md` | Qué prueba cada suite e2e y cómo se lanza sola (las cifras, en `e2e/README.md`) | Al tocar o lanzar una suite concreta |
| `docs/MANUAL.md` | Cómo funciona todo (para el usuario y el administrador) | Su índice al empezar; las secciones del tema de la ronda |

Al cerrar una ronda: las decisiones nuevas van a `HISTORIA.md` (arriba, la más reciente), las guardas nuevas a su tema
de `GUARDAS.md` (con «(Ronda N)») y aquí solo el estado y las preguntas abiertas de la última ronda.
