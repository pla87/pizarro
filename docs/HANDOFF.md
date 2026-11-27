# Traspaso para una sesión nueva

Documento para retomar el desarrollo de Pizarro en una sesión nueva sin perder el método de trabajo. Este es el
**núcleo**: léelo entero antes de empezar. El detalle técnico, la historia de decisiones y la publicación paso a paso
están en anexos que se leen solo cuando hacen falta (índice en la sección 7). No contiene datos personales: el
repositorio es público y debe seguir sin ellos.

## 0. Arranque de una sesión nueva

1. Lee este núcleo entero, el índice del manual (`grep -n '^#' docs/MANUAL.md`) y solo las secciones del tema de la
   ronda, y `e2e/README.md`. Los anexos (§7) y `docs/PRUEBAS-CHROME.md`, solo cuando toque su tema (este último, si la
   ronda trae informes de Claude in Chrome o al cerrarla, para actualizar sus prompts).
2. Rama de trabajo: la que indique la sesión, igual que `main` (`git fetch origin main && git checkout -B <rama> origin/main`).
3. Entorno. **En el PC del propietario:** `docs/handoff/LOCAL.md`. **En la nube** (si no está hecho): `pg_ctlcluster 16 main start`;
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

## 0b. Sesión local en el PC del propietario

Desde la ronda 65 el propietario puede trabajar con Claude Code en el terminal de su PC y Claude in Chrome. El método
(§2–§5) es el mismo; cambian el entorno, los recursos y la publicación: **`docs/handoff/LOCAL.md`** (léelo solo en esa
sesión).

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
npm run test:db          # con base de datos: 3 copias en paralelo (-- tests/db/x.test.ts, --jobs 1, --verbose)
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
3. Commit «vX.Y.Z: …», PR a `main` (esperar sus tres comprobaciones), fusionar aplastando.
4. **Actions → Release → Run workflow** sobre `main` (desde otra rama no hace nada; pasan antes los jobs `checks` (tipos,
   lint, pruebas y traducciones) y `db` (pruebas con base de datos, en orden al azar), y si falla alguno no publica) y comprobar que `origin/stable` y la etiqueta `vX.Y.Z` apuntan
   al commit fusionado (unos 7 min). «Comprobaciones» (`ci.yml`) solo corre en las PR y a mano.
5. Una actualización de Dependabot se aprueba solo si pasan **todas** las comprobaciones (PUBLICAR, «Dependabot»).

## 6. Estado y pendientes

**Paquetización (paso a paso, a petición del propietario):**

- Lo hecho de la paquetización (instalación, web, guías, recordatorio y modelo de venta, publicación):
  `docs/handoff/HISTORIA.md`, «Paquetización: lo hecho».
- Pendiente de confirmar por el propietario: prueba real en un VPS siguiendo `docs/PRUEBA-VPS.md`; plantilla de
  Railway (pasos en `docs/handoff/PUBLICAR.md`, «Plantilla de Railway»; la sintaxis de variables generadas debe
  verificarse en Railway); las pruebas en real de `PRUEBAS.pdf` (Google, WhatsApp, Telegram, email, Stripe).
- Siguientes pasos: revisión de la licencia por un abogado (en especial las definiciones de «centro educativo» y
  «uso educativo» de §2: academias privadas, gestión del centro, administraciones educativas y formadores autónomos), vídeo para la presentación (sustituye a la demo),
  capturas reales sin datos personales, poner en marcha getpizarro.com (`docs/VENTA.md` §8) y el Payment Link.
- Telegram y WhatsApp: implementados; la única decisión pendiente del propietario es de coste (si activa WhatsApp en
  su instalación). Detalle: `docs/handoff/GUARDAS.md`, «Emails y mensajería».

**Estado tras la ronda 73 (primera parte):** la v1.75.1 está publicada (`stable` y la etiqueta `v1.75.1`): 3 vueltas de
revisión y caza de bugs (R70M1/R70M2) con lo evidente arreglado y las decisiones 1-8 del propietario aplicadas (tope
diario de WhatsApp, ping del canal en vivo con la posición y recarga de seguridad cada hora, sesiones cerradas al restaurar,
repetidas que no renacen al archivar, 2 PDF a la vez por persona, apagado del contenedor sin cortar migraciones, aviso de
migraciones pendientes en `npm start`, búsqueda corta de releases solo en el título). Ver `HISTORIA.md`, ronda 73, y las
guardas «(Ronda 73)» de `GUARDAS.md`.

**Siguiente (ronda 73, segunda parte, v1.76.0):** R69F1, notas generales con la opción **A** («Nueva nota» dentro de
Documentación); «¿Descartar el texto?» al importar un texto ilegible (respuesta 3 de la v1.75.0); decir en el diálogo de
pasar a privado que quien lo creó conserva el acceso (4); subtareas con tope en el PDF del plan por persona (5). Después,
rondas propias ya aprobadas: una URL por tarea y el migrador sin Prisma. La prueba real del prompt para que una IA agéntica
instale en Railway (crea un proyecto de pago), solo con el propietario delante.

**Preguntas abiertas al propietario:** sin contestar de la ronda 73: renombrar `tests/db/bh48a.test.ts` a
`name-spaces.test.ts` (SÍ) y borrar `docs/handoff/CHROME-R69.md` pasando antes sus 4 pendientes aquí (SÍ). Dijo NO a:
«Persona: yo» del calendario con todos los proyectos visibles de un admin, y ayuda de atajos en una columna.

Decisiones ya aplicadas de cada ronda, ideas pospuestas, límites conocidos y menores sin numerar:
`docs/handoff/HISTORIA.md`.

## 7. Anexos: cuándo leer cada uno

| Anexo | Qué tiene | Cuándo leerlo |
|---|---|---|
| `docs/handoff/GUARDAS.md` | Las guardas técnicas de §4 (y las de cada ronda) por tema: tablero, navegador, logs, migraciones, base de datos, PDF, subidas, importar, i18n, fechas, servidor, seguridad, emails, tareas de fondo, plantillas, deshacer, pruebas, e2e, entorno | Al repartir una ronda, la sección del tema de cada agente (cópiala a su brief); al revisar una entrega de ese tema |
| `docs/handoff/HISTORIA.md` | Decisiones de cada ronda ya aplicadas, lo hecho de la paquetización, ideas pospuestas, límites conocidos y menores sin numerar | Cuando el propietario pregunte por algo ya decidido, antes de proponer algo que pudo descartarse, y al cerrar la ronda (para añadir sus decisiones) |
| `docs/handoff/LOCAL.md` | Sesión en el PC del propietario: requisitos, puesta en marcha, trampas de Windows, recursos, publicar desde local y reglas de Claude in Chrome | Solo si la sesión corre en el PC del propietario |
| `docs/handoff/CHROME-R69.md` | Informes de Claude in Chrome sobre la v1.72.0 (prompts 1–3) y la propuesta que se aplicó en la ronda 69 (historia) | Solo si hace falta saber qué se encontró y por qué |
| `docs/PRUEBAS-CHROME.md` | Prompts para Claude in Chrome pendientes y lo aprendido al usarlos | Si la ronda trae informes de Claude in Chrome y al cerrarla (para actualizar los prompts) |
| `docs/handoff/PUBLICAR.md` | Cerrar y publicar una versión paso a paso, `STABLE_PUSH_TOKEN`, mover `stable`, publicar desde la sesión, Dependabot | Al cerrar una versión o si falla el workflow Release; al revisar un PR de Dependabot |
| `e2e/SUITES.md` | Qué prueba cada suite e2e y cómo se lanza sola (las cifras, en `e2e/README.md`) | Al tocar o lanzar una suite concreta |
| `docs/MANUAL.md` | Cómo funciona todo (para el usuario y el administrador) | Su índice al empezar; las secciones del tema de la ronda |

Al cerrar una ronda: las decisiones nuevas van a `HISTORIA.md` (arriba, la más reciente), las guardas nuevas a su tema
de `GUARDAS.md` (con «(Ronda N)») y aquí solo el estado y las preguntas abiertas de la última ronda.
