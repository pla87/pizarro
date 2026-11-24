# Guardas técnicas (anexo del traspaso)

Anexo de `docs/HANDOFF.md` §4: lo que no hay que romper en cada parte de la app, con las guardas añadidas en cada ronda
(marcadas «(Ronda N)»). Se lee la sección del tema que toque la ronda, no entero; al repartir trabajo, copia al brief del
agente la sección de su tema. Las comprobaciones (comandos) y las reglas imprescindibles en una línea siguen en el núcleo.
Una guarda nueva va a su tema, con «(Ronda N)».

## Índice

1. [Tablero](#tablero)
2. [Navegador e interfaz](#navegador-e-interfaz)
3. [Logs](#logs)
4. [Migraciones y enums](#migraciones-y-enums)
5. [Base de datos](#base-de-datos)
6. [PDF y descargas](#pdf-y-descargas)
7. [Subidas y Compartir](#subidas-y-compartir)
8. [Importar y exportar](#importar-y-exportar)
9. [i18n](#i18n)
10. [Fechas y zona horaria](#fechas-y-zona-horaria)
11. [Servidor, arranque y red](#servidor-arranque-y-red)
12. [Seguridad y límites](#seguridad-y-límites)
13. [Emails y mensajería](#emails-y-mensajería)
14. [Tareas de fondo y copias](#tareas-de-fondo-y-copias)
15. [Plantillas y tipos](#plantillas-y-tipos)
16. [Deshacer](#deshacer)
17. [Pruebas y código sin uso](#pruebas-y-código-sin-uso)
18. [e2e](#e2e)
19. [Entorno](#entorno)

## Tablero

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
- Copia provisional del tablero (Ctrl al soltar): id con `PENDING_COPY_PREFIX` (`groupDrag.ts`). Nunca debe llegar al
  servidor: las vecinas se calculan con `withoutPendingCopies`/`realPlacement`, y TaskCard, `cardActions` y la fila del
  panel de fijas la ignoran. Una acción nueva sobre tarjetas debe saltarla.
- Tarjetas del tablero: las 15 primeras de cada columna no llevan `content-visibility` (evita el salto al cargar) y el asa
  táctil se pinta siempre y se muestra con `pointer-coarse:`; la casilla, el asa y el enlace externo son `<span>` (la
  tarjeta es un `role=button` con `aria-pressed`).
- Presencia (ronda 56): `src/lib/presence.ts`, en memoria y por proceso. El canal en vivo manda `event: ping` cada 25 s
  y `presence` (JSON calculado una vez por proyecto) al cambiar; el detalle anuncia la tarea con
  `/api/tasks/[id]/viewers?stream=…&open=…` (con `stream`, `open` es obligatorio: sin él, 400; sin canal va sin
  parámetros y cada aviso vale 150 s). Sin canal sano (más de 60 s sin mensajes) se vuelve al sondeo de respaldo y
  se reabre el canal. Las revocaciones cortan el canal en el mismo proceso; la comprobación de acceso del canal es cada
  5 min. Una ruta de larga duración nueva debe comprobar `req.signal.aborted` antes de registrar nada.
- Tablero en vivo por tarjeta (ronda 60, `src/components/board/livePatch.ts`): el canal manda `taskIds` (hasta 50) y
  `full`; para las acciones de `PATCHABLE_ACTIONS` el navegador pide solo esas tarjetas a `GET
  /api/projects/<id>/board-tasks?ids=…` (mismo permiso que el tablero, 15 s de tiempo máximo) y las aplica
  (`applyTaskPatch`; si algo no cuadra, recarga entera). **Una acción nueva solo entra en `PATCHABLE_ACTIONS` si anota cada
  tarjeta que toca (`noteTask`/`noteTasks`) y llama a `needOwnRefresh()` si toca algo más** (columnas, etiquetas,
  posiciones de otras). Una recarga entera que llega tras un parche conserva las tarjetas parcheadas después de pedirla
  (`withPatchedTasks`, `patchedSince`); deshacer recarga por la del tablero (`boardRefreshFor`, `undo-context.ts`).
- Datos del tablero: `packBoardTask`/`unpackBoardTask` (`src/lib/board-task-wire.ts`) omiten y restauran los campos por
  defecto (`BOARD_TASK_DEFAULTS`); un campo nuevo de `BoardTask` necesita su valor por defecto ahí. El servidor pinta 50
  tarjetas por columna (`deferredCards.ts`) y el resto llega en tandas de 200 con el hueco reservado; búsqueda, filtros,
  recuentos y teclado trabajan con las listas de ids, no con lo pintado.
- (Ronda 63) Columna «Asignación a persona» (`src/lib/column-assign*.ts`): una columna con `assigneeId` (o `assignDueDays`) y rol
  `NONE`. La regla al entrar una tarjeta está en un solo sitio (`columnAssignment`/`assignOnEnter`/`finishAssignOnEnter`)
  y usa la columna que devuelve `assertColumnRoom` (`column-capacity.ts`), leída con el candado: **una vía nueva por la
  que una tarea entre en una columna debe pasar por ahí** (crear, mover, importar, duplicar, recuperar, repeticiones,
  aplicar plantilla). Con columnas normales no gasta consultas (`tests/db/assign-column.test.ts` lo cuenta).
- (Ronda 64) Orden de columnas: siempre con `COLUMN_ORDER` (`[{position},{id}]`, `task-positions.ts`); tras deshacer una columna,
  `resolveColumnPositionTies` renumera si hay empate. Mover, crear, borrar y aplicar plantilla toman `columnsLockName`.

## Navegador e interfaz

- Lo que llega al navegador no debe importar `zod` (unos 85 KB): las constantes y tipos que usa un componente de cliente
  van en un módulo `*-core.ts` sin zod (`changelog-core.ts`, `project-templates-core.ts`); los tipos derivados de un
  esquema se importan con `import type`.
- Acciones de servidor dentro de una transición: `useActionTransition()` (`src/components/useActionTransition.ts`) en
  lugar de `useTransition()`. Si la acción lanza (sin red, servidor caído, versión nueva) muestra «Sin conexión: no se ha
  guardado» o el aviso que toque (en un aviso emergente o, con `onError`, en el formulario) en vez de la pantalla «Algo ha
  fallado». Una llamada suelta (`await accion()` fuera de una transición) lleva `.catch((e) => actionThrowResult(e, t))`;
  `actionThrowMessage` ya activa el aviso fijo de sin conexión. Prueba: `e2e/red-formularios-e2e.mjs`.
- Capas sobre un diálogo (ronda 56): con un `Modal` abierto, `inertBackground` deja `inert` todo lo que cuelga de
  `<body>` salvo las regiones `aria-live`, lo marcado con `data-pz-layer` y los otros modales de la pareja. Un botón
  portado que deba seguir usable encima del diálogo (Deshacer/Rehacer, la copia flotante de «Nueva tarea», la del botón
  de informar del pie del menú —ronda 65, con `useAnyModalOpen` de `Modal.tsx` y `data-pz-no-capture`—, el
  `<input type=file>` de importar) lleva `data-pz-layer=""`; si no, el clic lo atraviesa y cierra el diálogo.
- Ahorro de datos: con `navigator.connection.saveData` (`saveDataOn()`, `src/lib/connection.ts`) no se precarga nada por
  adelantado (diálogos del tablero en reposo, `HoverPrefetchLink`, el detalle adelantado al hacer clic). Una precarga
  nueva debe mirarlo. Los `Link` de Next con su precarga normal no lo miran (Next solo lo hace en el router de `pages/`).
- Emails en el HTML: con `EmailSafe` (y `rehypeEmailSafe` en Markdown), para que un proxy que reescribe emails no provoque
  errores de hidratación.
- Administración (ronda 57): *Ajustes* (`/admin/settings`) e *Integraciones* (`/admin/integrations`: email, Google,
  Telegram y WhatsApp). Las anclas antiguas (`#avisos-email`, `#acceso-google`, `#mensajeria`) redirigen. Las guías de
  `docs/guias/` y los textos de la app dicen «Administración → Integraciones».
- Menús: `MenuSub` (`src/components/ui/Menu.tsx`) es el submenú accesible (se abre dentro del mismo panel; → o Intro,
  ← o Escape). Lo usa el rol de la columna.
- Aviso de cambio simultáneo (`src/lib/edit-conflict*.ts`, `EditConflictNotice.tsx`): versión por valor de las claves de
  `AppState` y `updatedAt` en plantillas; `runAction` devuelve el `code` del `AppError`.
- (Ronda 62) URL sin recargar: `replaceUrlKeepingState` (`src/lib/replace-url.ts`), nunca `history.replaceState(window.history.state…)`
  (Next vuelve a escribir la dirección vieja en el siguiente refresco).
- (Ronda 62) Modales que se abren al cerrarse otro: `useBackToClose` espera a que no haya «atrás» silenciosos pendientes
  (`whenNoSilentPops`) antes de apilar su entrada; si no, Atrás salía de la página.

## Logs

- (Ronda 62) Mensajes de Logs traducibles: `logEvent({ label })` guarda la plantilla `{k, p}` en `details.$msg` (`LOG_LABEL_KEY`,
  `src/lib/log-message.ts`) y el mensaje en español para buscar. Todo `logEvent` nuevo va con `label` (sin `message`):
  los datos en `p`, los motivos y errores como plantilla anidada (`logText`/`logError` de `log.ts`, que se traducen si
  están en el diccionario) y las listas con `andList` («título y tipo»). `tests/log-message.test.ts` falla con un
  `logEvent` sin plantilla (excepción: comentario `// log-sin-plantilla: motivo`) o con un texto sin traducción.
- (Ronda 63) Logs: **todo `logEvent` lleva `label`** (plantilla `{k, p}` traducible; `logText`/`logError` para motivos y errores) y
  las filas escritas a mano llevan `LOG_LABEL_KEY`; `tests/log-message.test.ts` falla si no (excepción con el comentario
  `// log-sin-plantilla: motivo`). Listas con `andList` (`undo-label.ts`).
- (Ronda 64) Logs: `log-legacy.ts` traduce al leer las filas antiguas sin plantilla; `es-text.ts` (`esText`) monta los errores
  con datos que luego se traducen; `client-error-origin.ts` descarta rechazos de promesas sin pila de `/_next/`.
- Calendario suscrito (`/api/calendar/<token>.ics`): el registro está muestreado (`feedLogDue`,
  `src/lib/calendar-feed-core.ts`): la primera consulta de cada enlace e IP y luego una cada 6 h; los enlaces no válidos,
  una por IP cada 6 h; el exceso de ritmo, uno por hora; los errores, siempre.

## Migraciones y enums

- **Enums nuevos (ronda 61):** Prisma 7 falla al leer una fila con un valor de enum que no conoce (`Value 'X' not found
  in enum`). Un valor nuevo que la app ESCRIBE (p. ej. `NotificationType.REPORT_UNSUBSCRIBED`) rompe la lectura en la
  versión anterior si se vuelve atrás: añádelo en una versión y empieza a escribirlo en la siguiente (expandir y contraer).
- Migraciones y P3009 (`scripts/migrate.mjs`): una migración posterior a `20261126100000` que falla se marca como
  revertida y se reintenta una vez solo si `transactionProblem` la da por buena (entera entre `BEGIN;`/`COMMIT;`, sin otra
  sentencia de control de transacción ni `CONCURRENTLY` en medio).
- Migrador de la imagen Docker (`scripts/migrator-deps.mjs`, etapa `migrator` del `Dockerfile`): el `package-lock.json`
  del migrador sale del del proyecto (solo `prisma` y lo que necesita) y se instala con `npm ci`; después se poda lo que
  `migrate deploy` no lee (Studio, `prisma dev`/PGlite, compiladores de consultas…; lista `UNUSED`, medida con un gancho
  de módulos y `strace`). El `Dockerfile` comprueba tras podar que `prisma --version` y `prisma migrate diff` funcionan:
  si una versión nueva de Prisma necesita algo podado, falla la construcción, no el arranque. 257 → 109 MB sin comprimir.
- (Ronda 64) Roles de columna retirados (`RETIRED_COLUMN_ROLES`, `SELECTABLE_COLUMN_ROLES`, `liveColumnRole` en `constants.ts`):
  *Agenda* y *Entrega al cliente* ya no se ofrecen y todo lo que entra (validación, importar, plantillas, deshacer) los
  lee como `NONE`. **Fase 2 (hecha en la v1.69, `20261130100000`):** los valores ya no están en el enum; `INPUT_COLUMN_ROLES` + `liveColumnRole` convierten el texto que entra (ZIP/JSON de la v1.67, plantillas, deshacer y su instantánea). La v1.68 funciona sobre esta base; con la v1.67 fallan elegir esos roles y crear proyectos con «Casa y familia» o «Eventos y viajes».
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

## Tareas de fondo y copias

- (Ronda 62) Tareas de fondo que no hacen nada: devuelven `{ skipped: "<motivo>" }` y `runJob` lo guarda en `JobRun.lastError` con el
  prefijo `skip:` y `lastOk = true` (`src/lib/job-run.ts`, `jobRunView`, que usan la pantalla y el diagnóstico). Un
  motivo nuevo necesita su texto en `BackupsAdmin.tsx`.
- (Ronda 63) Copia diaria: `estimateDumpBytes` + `assertDiskRoom` antes de volcar; nombres únicos con `freshBackupName`; `S3Destination.put`
  da por subido un objeto que ya existe con su tamaño cuando el bloqueo de R2 rechaza el reintento.
- Las copias de seguridad cifradas suben a un almacenamiento S3 compatible configurado por el propietario.

## Plantillas y tipos

- Plantillas de serie retiradas (`RETIRED_BUILTINS`, `retireBuiltinTemplates` en `template-store.ts`, llamada desde
  `scripts/boot.ts`): sin modificar se borran, modificadas pasan a propias; sus filas de `BuiltinTemplateSeeded` se quedan
  como lápida (si no, una versión anterior las volvería a sembrar). Las claves retiradas no se reutilizan nunca.
- (Ronda 62) Cambiar de tipo: `switchKindDescription` (`kinds-special.ts`) lee el formulario por apartados (`formBlocks`): solo las
  etiquetas en negrita son anclas. `tests/kinds-special.test.ts` fija los casos raros.
- (Ronda 64) Prefijos de tipo (`switchKindTitle` con `known`): de otros tipos solo se quitan los que acaban en signo; los que acaban
  en palabra, solo si son del tipo anterior (no borrar lo que escribió la persona).

## Deshacer

- (Ronda 65) `npm run test:db` (`scripts/test-db.mjs`) migra una base plantilla una vez y pasa los ficheros en 3 copias
  a la vez (`CREATE DATABASE … TEMPLATE …`), cada uno en su proceso, los más grandes primero; ficheros sueltos con
  `npm run test:db -- tests/db/x.test.ts`, en serie con `--jobs 1`, salida completa con `--verbose`; con Ctrl+C borra
  las bases y enseña lo que estaba en marcha. Una prueba de BD no puede depender de lo que dejaron otros ficheros (el
  orden cambia): si empareja por nombre, `freeUserNames()`; si de verdad no puede ir a la vez, en `SERIAL`. Las que
  miran `pg_locks` o `pg_stat_activity` filtran por `current_database()`.
- `tests/db/undo-perf.test.ts` (dentro de `npm run test:db`): guarda de rendimiento del deshacer. Mide las
  consultas y los bytes leídos al deshacer y rehacer «Mover a…» de cientos de tarjetas; si falla, algo ha vuelto a
  leer las descripciones completas o a hacer consultas entrada a entrada. También mide recortar la pila con 500
  adjuntos huérfanos y 4.000 entradas guardadas (una sola pasada por `UndoEntry` en `stillRetained`, `src/lib/undo.ts`).
- Huellas de deshacer (`fingerprintOps`, `src/lib/undo.ts`): solo existe el formato con prefijo `v2:b:` (`FP_CURRENT`:
  la descripción por su hash y también el bloqueo de cada tarea, `blockedById`). Los anteriores (sin prefijo, y `v2:`
  sin «b:», que no cubría el bloqueo) se quitaron con su compatibilidad (la de `v2:` en la ronda 59); una entrada que aún
  traiga uno (copia de seguridad antigua restaurada) se descarta al intentar aplicarla con «ya no se puede deshacer»,
  también si se confirma, y no se pone al día al aplicar otra (`isObsoleteFingerprint`, «no empieza por `v2:b:`»;
  `applyEntry` en `src/actions/undo.ts`). Sin migración: esas entradas caducan solas a los 7 días. Si algún día cambia
  el formato, prefijo nuevo y el mismo trato para el anterior. Al quitar una tarea al deshacer o rehacer (`task.remove` en `mirrorOps`) y al
  borrarla, `dependentLinkOps` guarda las que dependían de ella como `task.set` con `relink`: al volver, recuperan la
  dependencia solo si siguen sin bloqueo y no cierra un ciclo (`blockProblem`).

## Pruebas y código sin uso

- Guardas de tiempo en las pruebas: con `assertFast`/`bestTime` de `tests/timing.ts` (la mejor de tres medidas, o una
  cota proporcional a una medida de referencia), nunca una sola medida contra un tope fijo; deben pasar con la CPU
  cargada. Las esperas a otra transacción, con `waitForLockWaiter()` (`tests/db/helpers.ts`), no con pausas. `npm test`
  corta cada fichero de pruebas a los 120 s (`--test-timeout` cuenta por fichero; `test:db`, a los 10 min); un intervalo o un temporizador que siga vivo al terminar deja el
  proceso colgado, así que se paran en un `finally`. No uses `--test-force-exit` en `npm test`: con la CPU cargada se
  pierden pruebas en silencio (se vio 891 → 862, sin ningún fallo).
- Código sin uso (solo informa, no está en las dependencias): `npx --yes knip@5`. La configuración está en `knip.json`
  (entradas que Next no declara: pruebas, `e2e/`, `scripts/`, `public/sw.js`, el worker de los PDF…). No hay ficheros
  ni dependencias sin uso, y desde la ronda 56 tampoco `export` ni tipos sin uso (se quitó el `export` de los ~45
  valores y 29 tipos que solo usaba su propio módulo, y los re-exports que nadie importaba por esa ruta): `npx --yes
  knip@5` no lista nada. Un `export` nuevo que nadie importa fuera de su módulo no debe volver a aparecer
  (quítale el `export`). Lo que `scripts/build-site.mjs` carga con `import()` de una
  ruta knip no lo ve: márcalo con `@public` en su comentario. Antes de quitar un `export`, busca el nombre en `src`,
  `tests`, `scripts` y `e2e`. Los nombres de las pruebas van por tema (`tests/db/comment-notices.test.ts`, no
  `review-fixes-…`): una prueba nueva va al fichero del tema que prueba.

## e2e

- e2e: `page.accessibility` ya no existe en playwright-core 1.65: usa `L.axSnapshot(page, locator, { interestingOnly })`
  (`e2e/qa/lib.mjs`, árbol de Chromium por CDP con la misma forma).
- Agentes en paralelo: cada uno con su base (`pz_<nombre>`), su puerto y su carpeta de logs (`OUT=` en
  `scripts/e2e-all.sh`; por defecto todas escriben en `/tmp/pizarro-e2e`). `npm run test:db` necesita
  `APP_URL="http://localhost:3000"` en el `.env` (dos pruebas comprueban esa URL) y sus bases se llaman `pizarro_test_*`.

## Entorno

- Entorno de la nube: `NODE_OPTIONS` trae `--max-old-space-size=8192`, que anula el tope de memoria del worker de PDF
  (`resourceLimits`): `tests/report-render.test.ts` se cuelga o falla. Lanza `npm test` (y las pruebas de PDF) con
  `NODE_OPTIONS=--use-openssl-ca`. Los agentes no pueden lanzar `npx --yes knip@5` (lo bloquea el permiso): lo pasa la
  sesión principal.
- `npm install` en este entorno reescribe el `package-lock.json` quitando los campos `libc`: para añadir una dependencia,
  edita a mano `package.json` y su entrada del lock (o usa `npm ci` para instalar, que no lo toca).
- Entorno de la nube: `npm ci` instala solo el binario SWC musl; para `next build` hace falta
  `@next/swc-linux-x64-gnu` (misma versión que `next`) extraído en `node_modules/@next/`. La suite QA necesita
  `SEED_ADMIN_EMAIL="admin@example.com"`, `SEED_ADMIN_PASSWORD="cambia-esta-clave"` y `SEED_ADMIN_NAME="Administrador"` en el `.env` local, y
  `tests/db/task-json-paste.test.ts` espera `APP_URL="http://localhost:3000"` en el `.env` (los servidores de prueba en
  otro puerto, con `PORT` y `APP_URL` en la línea de comandos). Si PostgreSQL no arranca tras reiniciarse el contenedor:
  `pg_ctlcluster 16 main start` (usuario `postgres`, contraseña `postgres`). Los worktrees de los agentes quedan en
  `.claude/worktrees/` (añade `.claude/` a `.git/info/exclude` para que no salgan como ficheros sin seguir). Tras
  fusionar el PR de la rama de trabajo en `main`, no se puede forzar la subida de la rama: ponla igual que `main` con
  `git merge origin/<rama>` (sin cambios de contenido) y súbela normal.

Trampas del entorno de la nube vistas en las rondas 58 y 59 (antes en §0 del núcleo). En el PC del propietario no hacen
falta las de `PGPASSWORD`, `NODE_OPTIONS`, memoria, permisos y reinicios del contenedor (ver `docs/HANDOFF.md` §0b); las de
las bases `pizarro_test_<hex>`, `rm -rf .next/types` y la prueba de PDF con la CPU cargada valen también en local:

- `createdb`/`dropdb` con `PGPASSWORD=postgres … -h localhost … </dev/null` (sin eso se quedan esperando la contraseña).
- `NODE_OPTIONS` trae `--max-old-space-size=8192`: lanza `npm test` y las pruebas de PDF con
  `NODE_OPTIONS=--use-openssl-ca` (si no, `tests/report-render.test.ts` se cuelga o falla).
- Las bases de `tests/db/` sueltas deben llamarse `pizarro_test_<hex>` (lo exige `tests/db/helpers.ts`).
- Tras borrar una página, `rm -rf .next/types` antes de `tsc` (los tipos viejos de la build la siguen citando).
- Los agentes no pueden lanzar `npx --yes knip@5` ni instalar paquetes del sistema (p. ej. Caddy): lo hace la sesión
  principal o se deja para el VPS.
- Las rondas grandes llenan la memoria (15 GB, 4 CPU): no más de 4–5 agentes a la vez y, salvo encargo expreso, que no
  compilen ni pasen e2e (lo hace la sesión principal al final, con la build de producción).
- Rondas 62 y 63: el contenedor puede reiniciarse a mitad de ronda (se pierden los procesos, no los ficheros): al
  volver, `pg_ctlcluster 16 main start` y recoger el informe final de los agentes que terminaron de sus ficheros de
  salida. Los agentes tampoco pueden descargar binarios (Caddy): el `Caddyfile` lo valida el job «Caddyfile» de CI.
- `tests/report-render.test.ts` («sin memoria…») falla a veces con la CPU cargada por varios agentes; sola, y con
  `NODE_OPTIONS=--use-openssl-ca`, pasa.
