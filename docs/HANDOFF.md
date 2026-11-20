# Traspaso para una sesión nueva

Documento para retomar el desarrollo de Pizarro en una sesión nueva sin perder el método de trabajo. Léelo entero
antes de empezar. No contiene datos personales: el repositorio es público y debe seguir sin ellos.

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
- **Cómo funciona todo:** `docs/MANUAL.md` (y `MANUAL.pdf`, generado). Instalación: `docs/INSTALL.md`. Prueba en un
  VPS: `docs/PRUEBA-VPS.md`.
- **Pruebas que el dueño hace en real** (Google, WhatsApp, Telegram, email, Stripe, Railway, móvil): `PRUEBAS.pdf`, en la
  raíz, generado desde `docs/PRUEBAS.md` con `node scripts/build-manual-pdf.mjs pruebas` (con `CHROME_PATH` si hace falta).

## 2. Cómo trabaja el propietario (protocolo de cada ronda)

El propietario envía rondas de tareas en español con códigos (`RxxF1` funcionalidad, `RxxC1` corrección, `RxxM1`
mejora, `RxxR1` respuestas a preguntas anteriores), a veces con un ZIP de capturas. Las capturas pueden contener
datos personales: **nunca se suben al repositorio**. Extrae cada ZIP en una carpeta nueva y temporal.

Cada ronda empieza con «Revisa todo antes de empezar y organiza el orden idóneo» y una indicación de qué modelo usar
para los agentes (p. ej. «Usa Fable 5.2», o «usa agentes con modelos más sencillos cuando sea posible y revisa siempre
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

## 3. Brief común para los agentes

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
- Migraciones: **expandir y luego contraer**. No se borra ni se renombra una columna (o tabla, o valor de un enum) en
  la misma versión que deja de usarla: primero sale la versión que ya no la lee ni la escribe (con una migración que
  solo añade, si hace falta) y la columna se quita en una migración de la versión siguiente. Durante un despliegue la
  versión anterior sigue sirviendo sobre la base ya migrada, y si el despliegue falla después de migrar, Railway la
  mantiene activa: si la migración quitó algo que esa versión usa, falla. Igual para cambiar un tipo o volver
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

Pruebas en navegador (suites de `e2e/`, nombradas por tema: `tablero-*`, `importar-*`, `plantillas-*`…), contra la
build de producción con `scripts/e2e-all.sh` (cada suite con su servidor recién arrancado; base `pz_qa` o `E2E_DB`,
puerto 3231 o `E2E_PORT`; instrucciones en su cabecera):

- **En cada ronda, antes de fusionar:** las afectadas, `AFFECTED=1 scripts/e2e-all.sh` (la QA siempre, y las que
  cubren los ficheros cambiados respecto a `origin/main` según `e2e/suites.json`; `DRY_RUN=1` dice cuáles y por qué).
- **Antes de publicar una versión:** todas, `scripts/e2e-all.sh` (la de instalación incluida, al final).
- `SUITES="board-e2e importar-json-detalle-e2e" scripts/e2e-all.sh` lanza solo esas.

Termina con `Total: N/M comprobaciones OK`. Una suite nueva va con el prefijo de su tema y con su entrada en
`e2e/suites.json` (lo comprueba `tests/e2e-affected.test.ts`); si una pieza nueva de la app la prueba una suite, añade
su ruta a esa entrada. Cómo se lanza cada una y cuántas comprobaciones tiene: `e2e/README.md` (las cifras solo se
apuntan allí). Si cambias el rol o la
etiqueta de un elemento que una suite usa, actualiza el script correspondiente. Para esperar al canal en vivo del
tablero, `L.liveOpen(page)` (la raíz del tablero lleva `data-live="open"`), no una pausa fija. Las suites declaran la
instalación de uso personal en `prepareUsers` (`e2e/qa/lib.mjs`) para que no salga el recordatorio de licencia.
Chromium: `CHROME` o, si no, el más reciente de `/opt/pw-browsers`.

Guardas que conviene conocer:

- `npm run i18n:unused` (solo informa): traducciones sin uso, repetidas o que solo usan las pruebas. Antes de
  borrar una, comprueba que no puede venir del historial de las tareas (un año), del deshacer (7 días) ni de los
  errores de exportar/importar, que se traducen al leerlos. Las que se conservan por eso van bajo el comentario
  «Textos guardados por versiones anteriores».
- `tests/db/undo-perf.test.ts` (dentro de `npm run test:db`): guarda de rendimiento del deshacer. Mide las
  consultas y los bytes leídos al deshacer y rehacer «Mover a…» de cientos de tarjetas; si falla, algo ha vuelto a
  leer las descripciones completas o a hacer consultas entrada a entrada. También mide recortar la pila con 500
  adjuntos huérfanos y 4.000 entradas guardadas (una sola pasada por `UndoEntry` en `stillRetained`, `src/lib/undo.ts`).
- Código sin uso (solo informa, no está en las dependencias): `npx --yes knip@5`. La configuración está en `knip.json`
  (entradas que Next no declara: pruebas, `e2e/`, `scripts/`, `public/sw.js`, el worker de los PDF…). No hay ficheros
  ni dependencias sin uso, y desde la ronda 56 tampoco `export` ni tipos sin uso (se quitó el `export` de los ~45
  valores y 29 tipos que solo usaba su propio módulo, y los re-exports que nadie importaba por esa ruta): `npx --yes
  knip@5` no lista nada. Un `export` nuevo que nadie importa fuera de su módulo no debe volver a aparecer
  (quítale el `export`). Lo que `scripts/build-site.mjs` carga con `import()` de una
  ruta knip no lo ve: márcalo con `@public` en su comentario. Antes de quitar un `export`, busca el nombre en `src`,
  `tests`, `scripts` y `e2e`. Los nombres de las pruebas van por tema (`tests/db/comment-notices.test.ts`, no
  `review-fixes-…`): una prueba nueva va al fichero del tema que prueba.
- Guardas de tiempo en las pruebas: con `assertFast`/`bestTime` de `tests/timing.ts` (la mejor de tres medidas, o una
  cota proporcional a una medida de referencia), nunca una sola medida contra un tope fijo; deben pasar con la CPU
  cargada. Las esperas a otra transacción, con `waitForLockWaiter()` (`tests/db/helpers.ts`), no con pausas. `npm test`
  corta cada prueba a los 120 s (`--test-timeout`); un intervalo o un temporizador que siga vivo al terminar deja el
  proceso colgado, así que se paran en un `finally`. No uses `--test-force-exit` en `npm test`: con la CPU cargada se
  pierden pruebas en silencio (se vio 891 → 862, sin ningún fallo).
- Lo que llega al navegador no debe importar `zod` (unos 85 KB): las constantes y tipos que usa un componente de cliente
  van en un módulo `*-core.ts` sin zod (`changelog-core.ts`, `project-templates-core.ts`); los tipos derivados de un
  esquema se importan con `import type`.
- Apagado ordenado (`src/lib/shutdown.ts`): al recibir la señal, `/api/health` responde `503` (`shutting_down`),
  se cierran los canales en vivo y se espera hasta 5 s a las peticiones en curso (subidas incluidas) y a los
  emails. Una ruta nueva de larga duración debe contar como petición en curso; lo que no termine queda en
  `system.shutdown`. Con Telegram en modo sondeo, al apagarse confirma a Telegram los mensajes ya procesados.
- `npm start` fuera de Docker (`scripts/start-local.mjs`): carga el `.env` y `scripts/server.env`, convierte en
  absolutas las rutas de datos relativas (`UPLOAD_DIR`, `MAIL_OUTBOX_DIR`, `BACKUP_EXTERNAL_DIR`; lógica en
  `scripts/local-paths.mjs`, probada en `tests/local-paths.test.ts`) y después carga `.next/standalone/server.js`.
  Sin eso, una ruta relativa acababa dentro de `.next/standalone/` y cada compilación la borraba. `postbuild.mjs`
  quita del standalone las subidas, las copias y los `.env` que Next copiaba allí. El contenedor no usa este script
  (`scripts/start.sh`). El script `start` no lleva `exec` (cmd.exe no lo entiende y en Windows `npm start` no
  arrancaba): al parar npm, el `sh -c` de npm muere con el SIGTERM sin pasarlo a node, y `scripts/parent-watch.mjs`
  detecta que ha desaparecido el proceso padre (también si npm muere de golpe) y lanza el apagado ordenado en ~1 s
  (solo si lo arrancó npm). Pruebas: `tests/start-signals.test.ts` (arranca `npm start` de verdad con un servidor de
  prueba, lo para con SIGTERM al pid de npm y comprueba que no queda huérfano).
  Antes de cargar `server.js`, `start-local.mjs` importa `dist/boot.mjs` y espera a `runBoot()`: las mismas tareas de
  arranque que el contenedor (`system.boot`, historial de versiones, seed, código de `/setup` en la terminal y
  plantillas de serie), en el mismo proceso y sin abrir otro servidor. Sin `dist/boot.mjs` o si fallan, no arranca.
  `boot.ts` solo se ejecuta por sí mismo cuando se lanza directamente (`node dist/boot.mjs`); al terminar desconecta su cliente
  de Prisma y lo quita de `globalThis` para que el servidor no herede uno cerrado. `start.sh` y `start-local.mjs` fijan
  `PIZARRO_LAUNCHER` (`docker` / `npm`) para que el paso 1 de `/setup` diga dónde mirar el código
  (`setupCodeSource`, `src/lib/setup-core.ts`; Railway se detecta por sus variables). Recorrido completo desde cero:
  `e2e/install-e2e.mjs`.
- Tablero con cientos o miles de tarjetas (`Board.tsx`, `TaskCard.tsx`, `nearCards.ts`): solo las tarjetas a la vista
  de su columna o a menos de 300 px llevan `useSortable` (`SortableBinding`, que no pinta nada y pone transform,
  transición y `data-dragging` en el nodo); las demás se pintan igual pero no se apuntan a dnd-kit y llevan
  `content-visibility: auto`. Al pulsar una aún no apuntada se apunta en el acto (`flushSync`). El desplazamiento va en
  `translate()` 2D y solo si no es cero (`translate3d` en todas creaba una capa por tarjeta). `DndContext` y las columnas
  van en un `useMemo` (`dndBoard`) con manejadores estables: cada dibujo de `DndContext` hace que React recorra todas
  las tarjetas, así que no debe volver a dibujarse al escribir en el buscador ni al abrir un diálogo. No leas
  `useDndContext` en las tarjetas ni pases a `DndContext` props nuevas en cada dibujo. El texto del buscador de cada
  tarea se normaliza una vez por versión (`taskSearchText`, `filters.ts`). Medida de referencia (Chromium con la CPU
  ×4, 300 tarjetas en una columna): de 1,8 s a 0,3 s en tareas largas por arrastre.
  Arrastrar una tarjeta seleccionada con otras (reglas puras en `groupDrag.ts`) no añade nada a dnd-kit: solo se arrastra
  la cogida; el montón es el overlay, y el atenuado de las demás y el texto del hueco son CSS (`data-group-drag` y
  `--group-drop-label` en la raíz, `globals.css`), sin volver a dibujar ninguna tarjeta. Al soltar, `moveTasks(ids,
  columna, { prevId, nextId })` las coloca seguidas (`placeBlockInColumn`, `task-positions.ts`), un solo deshacer.
- Idioma en el cliente (`src/i18n/client.tsx`): `I18nProvider` pinta siempre el mismo `I18nContext.Provider` y solo
  cambia `value`; el diccionario de inglés llega con `use()` (y `next/dynamic` solo para la precarga en el HTML). No
  vuelvas a envolver los hijos en un componente distinto según el idioma: React desmontaba la página entera al cambiar
  (el asistente volvía al paso 1). El layout raíz no se repinta en la navegación de cliente: un enlace de una pantalla
  sin sesión que puede ir en otro idioma (`/reset`, `/confirm`, `/login/verify`, `/setup` → `/login`) es un `<a href>`
  con recarga completa, no un `Link`.
- Aviso de pg «DeprecationWarning: Calling client.query() when the client is already executing a query»: pg 8.23 lo
  da cuando un mismo `pg.Client` recibe una tercera consulta con otras dos en curso (en pg 9 será un error). Buscado con
  `NODE_OPTIONS=--trace-deprecation` y con `e2e/warn-hook.mjs` (anota cada aviso de Node con su pila en `WARN_LOG`) en:
  `npm start` y `node dist/boot.mjs` sobre una base vacía y sobre una ya instalada, `prisma migrate deploy` con y sin
  migraciones pendientes, la primera pasada de las tareas de fondo (copia cifrada con `BACKUP_KEY` incluida), el asistente
  completo y las suites QA, tablero e instalación. No sale en ningún caso: ni la app ni Prisma (`@prisma/adapter-pg` usa
  el pool, y en las transacciones interactivas no hay `Promise.all` sobre `tx`; `PgSql` de las copias encadena sus
  consultas). El que se veía venía del arnés de las pruebas (`L.q` en paralelo en `e2e/qa/lib.mjs`, ya en fila desde la
  caza de bugs anterior). `e2e/install-e2e.mjs` arranca el servidor con `warn-hook.mjs` y falla si vuelve a aparecer.
  Para localizarlo en otro proceso: `WARN_LOG=/ruta/avisos.log NODE_OPTIONS="--import file://$PWD/e2e/warn-hook.mjs"`.
  Ojo con código nuevo que use un `pg.Client` propio (`pg-connect.ts`): sus consultas, en fila.
  Excepción hallada después: Prisma 7 sí provoca este aviso con relaciones anidadas dentro de `$transaction` (p. ej.
  `buildProjectExport`). No subas `pg` a la 9 sin revisarlo antes: allí será un error.
- IP del cliente: una sola función, `clientIp` / `clientIpOrNull` (`src/lib/request.ts`, regla pura en
  `src/lib/client-ip.ts`), para los límites de intentos, el registro y las sesiones. `X-Real-IP` / `X-Forwarded-For` solo
  cuentan con `TRUST_PROXY` (sin definir: sí en Docker, `PIZARRO_LAUNCHER=docker`, y en Railway; no con `npm start`,
  `next start` ni `node server.js` a mano). Sin proxy de confianza vale la dirección de la conexión: Next no la da a las
  rutas, así que `src/lib/peer-ip.ts` (instalado en `instrumentation.ts`) la escribe en la cabecera interna
  `x-pz-peer-ip` de cada petición, sustituyendo la que mande el cliente. `tests/client-ip.test.ts` falla si otro módulo
  lee esas cabeceras. `npm run test:db` fija `TRUST_PROXY=1` (las pruebas ponen la IP con `X-Real-IP`).
- Pool de PostgreSQL (`src/lib/db.ts`): tope de 20 s para conseguir una conexión (`DATABASE_CONNECT_TIMEOUT_MS`; antes
  esperaba sin límite) y `DATABASE_POOL_SIZE` validado (`src/lib/db-pool.ts`: un valor raro avisa y usa 10). El pool
  (`LoggedPool`, subclase de `pg.Pool` que se pasa a `PrismaPg` con `disposeExternalPool`) anota «[db] No se puede
  conectar con PostgreSQL (servidor, base): motivo» como mucho cada 30 s.
- Migrador de la imagen Docker (`scripts/migrator-deps.mjs`, etapa `migrator` del `Dockerfile`): el `package-lock.json`
  del migrador sale del del proyecto (solo `prisma` y lo que necesita) y se instala con `npm ci`; después se poda lo que
  `migrate deploy` no lee (Studio, `prisma dev`/PGlite, compiladores de consultas…; lista `UNUSED`, medida con un gancho
  de módulos y `strace`). El `Dockerfile` comprueba tras podar que `prisma --version` y `prisma migrate diff` funcionan:
  si una versión nueva de Prisma necesita algo podado, falla la construcción, no el arranque. 257 → 109 MB sin comprimir.
- Acciones de servidor dentro de una transición: `useActionTransition()` (`src/components/useActionTransition.ts`) en
  lugar de `useTransition()`. Si la acción lanza (sin red, servidor caído, versión nueva) muestra «Sin conexión: no se ha
  guardado» o el aviso que toque (en un aviso emergente o, con `onError`, en el formulario) en vez de la pantalla «Algo ha
  fallado». Una llamada suelta (`await accion()` fuera de una transición) lleva `.catch((e) => actionThrowResult(e, t))`;
  `actionThrowMessage` ya activa el aviso fijo de sin conexión. Prueba: `e2e/red-formularios-e2e.mjs`.
- Importar y exportar tareas en JSON: formato y lectura en `src/lib/task-json.ts` (`pizarro.task` / `pizarro.tasks`,
  `parseTasksText` lineal, `strictJsonFormat` para Ctrl+V), resolución de nombres común a pegar e importar en
  `src/lib/task-json-resolve.ts`, importación en `src/lib/task-import.ts` servida por la ruta
  `POST /api/projects/[projectId]/import-tasks` (fuera del proxy, con su propio tope: las acciones de servidor admiten
  1 MB, `next.config.ts`). Ningún `route.ts` importa `src/actions` (`tests/route-handlers.test.ts`): Next reenviaba las
  llamadas a la acción a la ruta. Deshacer usa `label.remove`/`label.restore` para las etiquetas creadas.
- Importar tareas de otros Kanban: `src/lib/foreign-import/tasks.ts` detecta por contenido Trello (tablero, tarjeta,
  lista), Jira (JSON de la API y CSV), GitHub Issues, Asana (JSON y CSV) y CSV genéricos (reutiliza `parseTrello` y
  `parseCsvRows` de la importación de proyectos) y devuelve el mismo `TaskJsonInput` que el JSON propio: tipos, columnas
  por nombre, etiquetas, topes, permisos y deshacer son los de siempre. Lo llama `parseTasksText`.
- Cachés en memoria con tope: `memo` y `boundedMemo` (`src/lib/memo.ts`, en `globalThis`). El calendario suscrito guarda
  60 s el .ics y su ETag por enlace (`cachedFeedIcs`, `FEED_CACHE_MAX` = 200) pero comprueba el token en cada petición;
  `/api/health` guarda 3 s su resultado y el apagado responde 503 antes de mirar la caché.
- Calendario suscrito (`/api/calendar/<token>.ics`): el registro está muestreado (`feedLogDue`,
  `src/lib/calendar-feed-core.ts`): la primera consulta de cada enlace e IP y luego una cada 6 h; los enlaces no válidos,
  una por IP cada 6 h; el exceso de ritmo, uno por hora; los errores, siempre.
- Subidas (ronda 55): `acquireUploadSlot(userId, waitMs, { declaredBytes })` reparte los 3 huecos del servidor; con más
  de una persona activa (`user-activity.ts`, en memoria, la anota `querySessionUser`) cada una tiene uno. Las rutas de
  subida envuelven su `POST` con `withUploadCapHeader` (cabecera `X-Pizarro-Upload-Per-User`) y el navegador ajusta la cola
  (`uploadCap`, `uploadGate` y `runQueue({ limit })` en `upload-queue.ts`). Una ruta de subida nueva debe hacer lo mismo.
- Copia provisional del tablero (Ctrl al soltar): id con `PENDING_COPY_PREFIX` (`groupDrag.ts`). Nunca debe llegar al
  servidor: las vecinas se calculan con `withoutPendingCopies`/`realPlacement`, y TaskCard, `cardActions` y la fila del
  panel de fijas la ignoran. Una acción nueva sobre tarjetas debe saltarla.
- Exportar un proyecto (`project-export/export.ts`): `readSnapshot` lee en una transacción corta y `assembleExport` hace
  huellas, ficheros y ZIP fuera. No vuelvas a leer ficheros dentro de la transacción
  (`tests/db/project-export.test.ts` lo comprueba con `LOCK TABLE "Task"`).
- Capas sobre un diálogo (ronda 56): con un `Modal` abierto, `inertBackground` deja `inert` todo lo que cuelga de
  `<body>` salvo las regiones `aria-live`, lo marcado con `data-pz-layer` y los otros modales de la pareja. Un botón
  portado que deba seguir usable encima del diálogo (Deshacer/Rehacer, la copia flotante de «Nueva tarea», el
  `<input type=file>` de importar) lleva `data-pz-layer=""`; si no, el clic lo atraviesa y cierra el diálogo.
- Presencia (ronda 56): `src/lib/presence.ts`, en memoria y por proceso. El canal en vivo manda `event: ping` cada 25 s
  y `presence` (JSON calculado una vez por proyecto) al cambiar; el detalle anuncia la tarea con
  `/api/tasks/[id]/viewers?stream=…&open=…`. Sin canal sano (más de 60 s sin mensajes) se vuelve al sondeo de respaldo y
  se reabre el canal. Las revocaciones cortan el canal en el mismo proceso; la comprobación de acceso del canal es cada
  5 min. Una ruta de larga duración nueva debe comprobar `req.signal.aborted` antes de registrar nada.
- Tarjetas del tablero: las 15 primeras de cada columna no llevan `content-visibility` (evita el salto al cargar) y el asa
  táctil se pinta siempre y se muestra con `pointer-coarse:`; la casilla, el asa y el enlace externo son `<span>` (la
  tarjeta es un `role=button` con `aria-pressed`).
- Descargas ZIP (ronda 56): las envía el propio navegador. El histórico usa `?part=&v=`; «Generar release» y el plan piden
  un vale (`src/lib/zip-ticket.ts`, en memoria, por persona y proyecto) y la página consulta su estado. El
  `Content-Length` lo pone `src/lib/response-length.ts` (instalado en `instrumentation.ts`) a partir de la cabecera
  interna `x-pz-content-length`, porque Next lo quita. Un paquete solo cuenta como descargado si llega entero.
- Emails en el HTML: con `EmailSafe` (y `rehypeEmailSafe` en Markdown), para que un proxy que reescribe emails no provoque
  errores de hidratación.
- Fechas en SQL propio: nada de `NOW()`/`CURRENT_TIMESTAMP` sobre columnas `timestamp(3)` (quedan en la hora de la
  sesión); pasa `${new Date()}` o usa `CURRENT_TIMESTAMP AT TIME ZONE 'UTC'` (`tests/db/db-timezone.test.ts`).

Antes de cada fusión en `main`, comprueba que no se cuela ningún dato personal del propietario en el diff ni en el
PDF del manual (busca su nombre, email y dominios; pídeselos si no los sabes) y que los mensajes de commit no
llevan enlaces de sesión ni nombres de modelos.

## 5. Cerrar una versión

1. `TZ=Europe/Madrid npm run version:bump -- minor --summary "…"` (o `patch`).
2. Rellenar en `changelog.json` el bloque nuevo: `changes` (`nuevas`, `mejoras`, `correcciones`, `tecnicos`) y
   `en: { summary, changes }`. Después `npm run version:bump -- --render`.
3. Actualizar `docs/MANUAL.md` (las dos líneas de versión, `version: "vX"` y «Versión de la aplicación») y las
   secciones afectadas. Generar el PDF: `node scripts/build-manual-pdf.mjs` (con `CHROME_PATH` si hace falta).
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

### Actualizaciones de dependencias (Dependabot)

`.github/dependabot.yml` abre PR contra `main`:

- **Acciones de GitHub**, un PR semanal con todas juntas. En los workflows cada acción va fijada a un commit exacto
  (`uses: owner/acción@<SHA de 40 caracteres> # vX.Y.Z`): nunca se vuelve a poner una etiqueta móvil como `@v4`.
  Para fijar una acción nueva a mano: `git ls-remote https://github.com/<owner>/<acción> refs/tags/<tag>` (si la
  etiqueta es anotada, el commit es el de la línea `^{}`).
- **npm**, un PR mensual con todas las versiones menores y parches. Las versiones mayores no se proponen (se hacen a
  mano, leyendo sus notas de cambios). Las de seguridad llegan en cuanto hay aviso, en su propio PR (requiere
  *Settings → Code security → Dependabot security updates* activado).
- En los dos, `cooldown: default-days: 7`: solo se proponen versiones publicadas hace al menos 7 días (las de
  seguridad no esperan).
- **`overrides` en `package.json`**: `minimatch` 11 dentro de `@typescript-eslint/typescript-estree` (herramienta de
  lint, no va en la app) por el aviso GHSA-g3hv-75wg-m249; quitarlo cuando `typescript-eslint` traiga una versión
  corregida por sí mismo (`npm ls minimatch` y `npm audit`).

Cómo se revisa cada PR:

1. Leer qué cambia: en las acciones, que el SHA nuevo corresponde a la etiqueta del comentario (enlace «Release
   notes» del PR) y que la acción sigue siendo del mismo propietario; en npm, las notas de los paquetes con cambios
   de comportamiento (Next, Prisma, TipTap, @dnd-kit, sharp…). Prisma: `prisma` y `@prisma/*` deben ir a la misma
   versión; Next y `@next/swc-*`, también.
2. Bajarse la rama y pasar **todas** las comprobaciones de la sección 4 (incluidas `npm run test:db` y el build de
   producción) y, si toca Next, TipTap o @dnd-kit, las suites e2e.
3. **Una actualización de dependencias se aprueba solo si pasan todas las pruebas.** Si algo falla, se cierra el PR
   (o se ignora esa versión con `@dependabot ignore this minor version`) y se anota en la sección 6. Nunca se
   «arregla» una prueba para que pase con la dependencia nueva sin entender por qué fallaba.
4. Se fusiona en `main` como cualquier otro cambio; llega a los usuarios con la siguiente versión publicada (nunca
   antes: las instalaciones siguen las releases o la rama `stable`).

## 6. Estado y pendientes

**Paquetización (paso a paso, a petición del propietario):**

- Hecho: instalación en un paso (`deploy/get.sh`), actualizaciones con versiones e imagen publicada, aviso de
  versión nueva, proyectos de ejemplo al crear un proyecto (`src/lib/project-examples.ts`), página de presentación
  `/presentacion` simplificada (sin demo; la administración no enlaza a ella por decisión del propietario) y licencia
  (`LICENSE.md` + `/licencia`; `npm run license:sync` tras cambiarla).
- Hecho: web estática del producto en `site/` (plantillas y estáticos), generada con `scripts/build-site.mjs` y
  publicada con GitHub Pages por `.github/workflows/site.yml` (workflow «Web») en getpizarro.com. En
  *Settings → Pages → Build and deployment*, **Source debe ser «GitHub Actions»**: con «Deploy from a branch»
  GitHub publica el README del repositorio con Jekyll en lugar de la web. Las capturas de `site/static/img/` y las
  imágenes `og.png`/`og-en.png` se regeneran con `scripts/site-screenshots.mjs` (instrucciones en su cabecera;
  siempre contra una base de pruebas con datos de demostración) cuando cambie el aspecto de la app. Puesta en
  marcha (Pages, DNS, HTTPS, verificación del dominio): `docs/VENTA.md` §8.
- Hecho: guías de conexión en la web (`/guias/`, `/en/guides/`): una página por cada `docs/guias/<nombre>.md` con su
  `docs/guias/en/<nombre>.md` (Google, Google Docs, Sheets y Slides, Telegram, WhatsApp). La cabecera del fichero (`titulo`,
  `descripcion`, `orden`, `icono`) da la tarjeta del índice; `build-site.mjs` las añade solas al índice y al sitemap
  y falla si falta la versión en inglés, el título o la descripción. El workflow «Web» también se lanza al cambiar
  `docs/guias/`. La portada enlaza a cada guía desde «Se conecta con lo que ya usas». El pie lleva una línea de
  autoría: no escribas en ella ni en el manual dominios personales.
- Hecho: recordatorio de licencia para administradores (franja bajo la cabecera, como mucho cada 30 días, nunca en
  los 7 primeros días): lógica en `shouldShowLicenseNudge` (`src/lib/license-core.ts`), interfaz en
  `src/components/LicenseNudge.tsx`. Se oculta con licencia registrada o declarando uso personal o educativo.
- Modelo de venta decidido: gratis para uso personal y para uso educativo (centros de enseñanza públicos o
  privados, también academias, con su profesorado y alumnado; definición en `LICENSE.md` §2); empresas y profesionales, pago único por servidor con
  actualizaciones gratis para siempre y sin soporte. Precio: 100 € + IVA (pago con tarjeta y factura, NIF opcional); botón Comprar con `BUY_URL` en `src/lib/product.ts` (vacía hasta que el propietario cree el Payment Link de Stripe, ver `docs/VENTA.md`); *Administración → Licencia* solo informa. Todo uso que no sea personal ni educativo paga. Listas de funciones candidatas a licencia profesional y de ideas de otros Kanban: `docs/IDEAS.md`.
- Hecho: las versiones se publican con *Actions → Release → Run workflow* sobre `main` (imagen en GHCR, GitHub Release
  y rama `stable`); el secreto `STABLE_PUSH_TOKEN` funciona y la instalación del propietario en Railway sigue `stable`.
- Pendiente de confirmar por el propietario: prueba real en un VPS siguiendo `docs/PRUEBA-VPS.md`; plantilla de
  Railway (pasos en `docs/INSTALL.md`; la sintaxis de variables generadas debe verificarse en Railway); las pruebas en
  real de `PRUEBAS.pdf` (Google, WhatsApp, Telegram, email, Stripe).
- Siguientes pasos: revisión de la licencia por un abogado (en especial las definiciones de «centro educativo» y
  «uso educativo» de §2: academias privadas, gestión del centro, administraciones educativas y formadores autónomos), vídeo para la presentación (sustituye a la demo),
  capturas reales sin datos personales, poner en marcha getpizarro.com (`docs/VENTA.md` §8) y el Payment Link.
- Huellas de deshacer (`fingerprintOps`, `src/lib/undo.ts`): solo existe el formato con prefijo `v2:`. El anterior (sin
  prefijo) se quitó con su compatibilidad; una entrada que aún lo traiga (copia de seguridad antigua restaurada) se
  descarta al intentar aplicarla con «ya no se puede deshacer», también si se confirma (`isObsoleteFingerprint`,
  `applyEntry` en `src/actions/undo.ts`). Sin migración: esas entradas caducan solas a los 7 días. Si algún día cambia
  el formato, prefijo nuevo y el mismo trato para el anterior.
  Ampliación compatible: las huellas `v2:b:` cubren también el bloqueo de cada tarea (`blockedById`). Siguen siendo v2;
  una `v2:` sin «b:» guardada antes se compara calculándola como entonces (parámetro `like` de `fingerprintsOf`) y pasa
  al formato nuevo cuando se reescribe. Al quitar una tarea al deshacer o rehacer (`task.remove` en `mirrorOps`) y al
  borrarla, `dependentLinkOps` guarda las que dependían de ella como `task.set` con `relink`: al volver, recuperan la
  dependencia solo si siguen sin bloqueo y no cierra un ciclo (`blockProblem`).

**Preguntas abiertas al propietario (tras la v1.60.0):**

De las auditorías del propietario (escritorio y móvil, v1.58.0) quedan para decidir:
- Crear tareas: hay muchas entradas (Nueva tarea, flotantes +/✨, «+» de columna, Varias tareas, Importar, Añadir en
  fijas). ¿Juntar «Varias tareas» e «Importar» en un desplegable de «Nueva tarea»?
- Dos selectores de proyecto (barra lateral y cabecera): ¿quitar uno?
- Menú «⋯» de columna con unos 30 elementos: ¿roles en un submenú «Rol de la columna ›»?
- Tipo preseleccionado en una tarea nueva: ¿recordar el último usado o no preseleccionar?
- «Nueva tarea» y el detalle no se parecen (editor, rejilla, color): ¿unificarlos?
- Botones peligrosos junto a los de uso frecuente (Borrar release/adjuntos en Releases, papelera siempre visible en
  Documentación): ¿llevarlos a un menú «⋯»?
- Informe PDF: las tareas fijas cuentan como pendientes y bajan el % de avance: ¿excluirlas o ponerlas aparte?
- *Administración → Ajustes* muy larga: ¿subpestañas? (y ocultar el selector de zona con `APP_TIMEZONE` fijada).
- Copias: los adjuntos solo están en el destino externo si `BACKUP_LOCAL_FILES=0`: ¿segunda copia o versionado del bucket?
- Ctrl+Z solo funciona en el tablero (no en Documentación, Releases ni Ajustes) y el historial guarda 10 acciones: ¿ampliar
  el deshacer a esas pantallas o subir el límite?
- Móvil: avisos arriba tapando la cabecera (¿abajo?), lista sin tipo/subtareas/adjuntos, comentarios no editables,
  archivadas que no se pueden abrir para leer, «Guardar» y «Cancelar» con guardado automático (¿«Revertir cambios»?),
  y «Compartir → Pizarro» desde el móvil (`share_target`) para crear una tarea con una captura.
- Releases y plantillas de *Mi perfil* pintan el Markdown en el navegador (~40 KB): ¿pasarlo al servidor?

De esta ronda:
- Sondeo de respaldo de la presencia (`/api/projects/[id]/presence` y `/viewers` sin `stream`): se mantiene para cuando
  no hay canal en vivo; ¿retirarlo más adelante o espaciarlo a 60 s?
- Número de release retirado (`release-number:<proyecto>` en `AppState`): no viaja al exportar/importar un proyecto.
- Alt+P mientras se renombra una tarjeta (F2) abre el selector y guarda el título al perder el foco: ¿así?
- Detrás de Cloudflare conviene desactivar *Scrape Shield → Email Address Obfuscation* (Pizarro ya protege sus emails
  con `EmailSafe`; era la causa más probable del error de hidratación #418).
- En el móvil, recuperar la columna recordada mueve la vista tras el primer pintado (no medido): ¿leerla en el servidor?
- React #185 («Maximum update depth») visto una vez en la ronda 55: no se ha vuelto a ver; si sale, anotar qué se hacía.

**Decisiones de la ronda 56 (ya aplicadas):** recarga de respaldo a 15 min con el canal sano; presencia por el canal en
vivo; ZIP de release en flujo; tareas de fondo a 60 s; destinatario del informe por nombre y emails ajenos ocultos;
duplicar una repetitiva no copia la repetición pero lo avisa; calendario del móvil en hoy; retiradas aprobadas (hecho);
e2e solo de las suites afectadas en cada ronda y todas al publicar; imagen arm64 en máquinas ARM nativas.

**Decisiones de la ronda 55 (ya aplicadas):** exportar sin transacción abierta mientras se leen los ficheros; una
subida a la vez por persona solo si hay más de una persona activa en los últimos 5 minutos (`user-activity.ts`; cualquier
petición con sesión cuenta como actividad); la zona horaria no se fija en la conexión (un parámetro `options` lo rechazan
poolers como PgBouncer): los `NOW()` propios se pasan desde la app y el disparador convierte a UTC.

**Decisiones de la ronda 54 (ya aplicadas):** importar no avisa a las personas mencionadas, sí al responsable; emails
ajenos al exportar un proyecto solo para administradores; caché de 60 s del calendario suscrito y de 3 s de
`/api/health`; «Nueva tarea» con etiquetas (solo existentes), color y enlace; el cursor de «Nueva tarea» sigue empezando
en el título.

**Ideas pospuestas por decisión del propietario:**

- Limitar las tarjetas visibles en columnas terminadas («ver más») o archivarlas solas tras N días.
- Cargar las plantillas de release solo al abrir «Generar release».
- Guardar la fecha esperada al deshacer el movimiento de un entregable en el calendario.

**Otros:**

- Telegram y WhatsApp: los dos están implementados y se configuran en *Administración → Ajustes → Avisos por
  Telegram y WhatsApp* (las variables `WHATSAPP_*` solo rellenan lo que no se guarde allí; guías en `docs/guias/`;
  manual §3.9, §3.16 y §4.7b). Telegram es gratis. La única decisión pendiente del propietario es de coste: si activa
  WhatsApp en su instalación (Meta cobra cada aviso entregado con plantilla, ver `docs/guias/whatsapp.md`).
  - Código: `src/lib/messaging-core.ts` (lógica pura: textos, topes de 30/h por Telegram y 10/h por WhatsApp por
    persona, clasificación de errores), `src/lib/messaging-config.ts` (Ajustes en `AppState`, tokens cifrados con
    `ENCRYPTION_KEY`; `rotate-keys` los cubre), `src/lib/telegram.ts`, `src/lib/whatsapp.ts`, `src/lib/notify.ts`
    (envío tras responder) y `src/actions/messaging.ts`. Datos: `UserChannel` (canal, dirección, código de WhatsApp,
    qué avisos) y `TelegramLinkCode`; las preferencias de WhatsApp ya no están en `User`.
  - Telegram: webhook `APP_URL/api/telegram/webhook` (fuera del proxy de sesión, con el secreto en
    `X-Telegram-Bot-Api-Secret-Token`) si `APP_URL` es https pública; si no, sondeo con `getUpdates`, que solo vale
    con una instancia. El arranque reintenta con espera creciente (hasta 5 min) si Telegram o la base no responden.
  - WhatsApp: plantilla de utilidad `aviso_pizarro` (3 variables); la antigua `mencion_pizarro` (4 variables) solo
    envía menciones. Guardar la configuración no activa el envío (hay que pulsar *Activar*). Un fallo que Meta pudo
    haber enviado (5xx, corte, tiempo agotado) no se reintenta, para no cobrar dos veces. Cada número se confirma con
    un código de 6 cifras (15 min, 5 intentos; 5 mensajes al día por persona y 3 por número), que va en la plantilla
    de autenticación `codigo_pizarro` (Meta lo exige para códigos de un solo uso; ajustes `whatsapp.codeTemplate*` en
    `AppState`, con traducción inglesa opcional). *Probar* envía las dos plantillas. Si Meta rechaza la de verificación,
    Ajustes lo marca en rojo y nadie puede conectar un número nuevo hasta crearla (guía de WhatsApp, paso 6).
  - Pruebas: `tests/messaging.test.ts`, `tests/db/messaging.test.ts` y `tests/db/messaging-migration.test.ts`.
- Entorno de la nube: `npm ci` instala solo el binario SWC musl; para `next build` hace falta
  `@next/swc-linux-x64-gnu` (misma versión que `next`) extraído en `node_modules/@next/`. La suite QA necesita
  `SEED_ADMIN_EMAIL="admin@example.com"`, `SEED_ADMIN_PASSWORD="cambia-esta-clave"` y `SEED_ADMIN_NAME="Administrador"` en el `.env` local, y
  `tests/db/task-json-paste.test.ts` espera `APP_URL="http://localhost:3000"` en el `.env` (los servidores de prueba en
  otro puerto, con `PORT` y `APP_URL` en la línea de comandos). Si PostgreSQL no arranca tras reiniciarse el contenedor:
  `pg_ctlcluster 16 main start` (usuario `postgres`, contraseña `postgres`). Los worktrees de los agentes quedan en
  `.claude/worktrees/` (añade `.claude/` a `.git/info/exclude` para que no salgan como ficheros sin seguir). Tras
  fusionar el PR de la rama de trabajo en `main`, no se puede forzar la subida de la rama: ponla igual que `main` con
  `git merge origin/<rama>` (sin cambios de contenido) y súbela normal.
- Ideas pospuestas (R36): tablero que recarga solo lo cambiado (a partir de ~10 personas a la vez).
- Las copias de seguridad cifradas suben a un almacenamiento S3 compatible configurado por el propietario.
