# Sesión local en el PC del propietario (Claude Code + Claude in Chrome)

Anexo del núcleo (`docs/HANDOFF.md`): se lee solo cuando la sesión corre en el PC del propietario. En la nube no hace
falta.

Desde la ronda 65 el propietario puede seguir en **Claude Code en el terminal de su PC**, con **Claude in Chrome** (la
extensión del navegador, herramientas `mcp__claude-in-chrome__*`), en lugar de la nube. El método (§2–§5 del núcleo) es el mismo;
cambian el entorno, los recursos y cómo se publica.

**Qué leer al empezar en local:** el núcleo, este anexo, el índice del manual
(`grep -n '^#' docs/MANUAL.md`) y solo las secciones del tema de la ronda, y `e2e/README.md`.
Los anexos (§7 del núcleo) y `docs/PRUEBAS-CHROME.md`, cuando toque su tema (este último, si la ronda tiene pruebas con
Claude in Chrome).

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

En el `.env`, los mismos valores que en §0 del núcleo: `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pizarro"`, un
`SESSION_SECRET` aleatorio (`openssl rand -base64 48`, que trae Git Bash, o
`node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`), `APP_URL="http://localhost:3000"`,
`UPLOAD_DIR="./uploads"`, `SEED_ADMIN_EMAIL="admin@example.com"`, `SEED_ADMIN_PASSWORD="cambia-esta-clave"` y
`SEED_ADMIN_NAME="Administrador"` (valores de ejemplo: nunca los reales del propietario). `createdb` pide la contraseña
(`postgres`) si no tienes `PGPASSWORD`. Añade `.claude/` a `.git/info/exclude` (worktrees de los agentes).

Build de producción, la que prueban las suites e2e y la que hay que mirar antes de fusionar (§4 del núcleo):
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

**Trampas de Windows (ronda 66, PC del propietario):**

- La carpeta real es `D:\Pizarro` (con mayúscula). **Compila, arranca y pasa las e2e desde `D:\Pizarro`**: desde
  `D:\pizarro` webpack ve dos copias de `next`/`react` («multiple modules with names that only differ in casing») y la
  build falla al prerenderizar `/_global-error` («Cannot read properties of null (reading 'useContext')»).
- La `isolation: "worktree"` automática de los agentes falla por esa misma mayúscula: crea los worktrees a mano
  (`git worktree add -b r66-x .claude/worktrees/r66-x <rama>`, copia el `.env` con la base `pz_<agente>`) y dale al
  agente la ruta. Al terminar, `git worktree remove --force` (si un `next dev` del agente sigue vivo, páralo antes).
- Git: en el repositorio, `core.autocrlf=input` y `core.eol=lf` (Git for Windows trae `autocrlf=true`, y varias pruebas
  que leen ficheros con expresiones regulares fallaban con CRLF).
- PostgreSQL local con zona horaria UTC (`ALTER ROLE postgres SET timezone TO 'UTC'`): con la de España, lo que las
  suites crean con `NOW()` quedaba una hora «en el futuro» frente a lo que crea la app y la QA confundía filas.
- `npm test` en Windows: ~16 fallos solo del entorno (get.sh/install.sh, `start-signals`, `migrate.mjs`, symlinks,
  rutas con `\`, worker de PDF); con la CPU cargada, alguna suite da *timeout* de 120 s y sola pasa. `npm run test:db`:
  fallan solo por el entorno `health-shutdown` (ruta `/dev/null`), `start-migrate` y `backup-restore` (spawn de `npx`,
  mensajes de PostgreSQL en español) y, a veces, `notifications` (un email de la prueba anterior llega tarde). En
  GitHub (Linux) pasan todas: el job «Pruebas con base de datos» de la PR es la referencia.
- Las e2e funcionan en Windows desde la ronda 66 (servidor con `node` y parada con `taskkill /T`, Prisma sin `npx`,
  escenarios con `file://`). Chromium: el de `playwright-core` (`npx playwright-core install chromium`).

**Recursos:** en un portátil, **no más de 2–3 agentes a la vez**, y que no compilen ni pasen e2e salvo encargo (la
build de producción y las suites las pasa la sesión principal al final, una cada vez). Cada agente con su base
(`pz_<agente>`), su puerto y `OUT=` propio. En Windows y macOS `cp -al` puede no existir: el agente hace `npm ci` en su
propio worktree (más lento, pero nunca toca el `node_modules` del repositorio principal).

**Ramas y publicación desde local:**

- `git push` normal a la rama de trabajo; **nunca forzar** (`--force`) desde el PC. Tras la fusión aplastada, la
  ronda siguiente empieza en una rama recién sacada de `origin/main` (o con `git merge origin/main` sobre la anterior
  y push normal).
- PR con `gh pr create --base main` (o la web), esperar sus tres comprobaciones (`gh pr checks --watch`: tipos/lint/pruebas,
  pruebas con base de datos y «Caddyfile») y fusionar aplastando (`gh pr merge --squash` o el botón *Squash and merge*).
- Publicar: en GitHub, **Actions → Release → Run workflow** sobre `main` (o `gh workflow run release.yml --ref main`);
  después `git fetch origin --tags` y comprobar que `origin/stable` y `vX.Y.Z` apuntan al commit fusionado. Detalle en
  `docs/handoff/PUBLICAR.md`.
- Minutos de Actions solo al final (la PR y la Release): las comprobaciones de §4 del núcleo se pasan en local antes.

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
