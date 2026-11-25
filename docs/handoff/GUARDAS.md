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
- (Ronda 66) Arrastre de cabeceras: ids `colmove:<id>` (`COLUMN_DRAG_PREFIX`), colisión propia (`columnDragCollision`) y
  `placeColumn(columnId, overColumnId)`: se manda la columna de destino, nunca un índice (con cambios simultáneos acaba
  junto a la que se veía), y su deshacer guarda solo las columnas que cambian. Durante un arrastre de tarjetas, leer
  `dragItemsNow` (ref), no el estado del dibujo anterior (una tarjeta rápida se quedaba en una columna intermedia).
- (Ronda 66) Lo que entra en una columna «Asignación a persona» enseña `showAssignedNotice` (assignNotice.ts) con
  «Deshacer»: `moveTask`/`moveTasks` devuelven `undo`. Una vía nueva de mover tarjetas, igual.
- (Ronda 67) «Organizar por personas»: las personas son `projectPeopleWhere` (`access.ts`; miembros y, en uno de equipo, los
  administradores con `AdminProjectPick`), no `projectUsersWhere` (que sigue dando a todos los administradores para el
  selector de responsable y lo demás). El diálogo cuenta con `project.peopleIds`, que la página del tablero calcula con
  la misma función (una consulta, solo en proyectos de equipo de «Casa y familia»): lo que ve y lo que crea
  `createPersonColumns` deben coincidir.

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
- (Ronda 67) Precarga y esqueletos: una página de proyecto solo enseña SU `loading.tsx` si se precargó antes de pulsar;
  si no, Next enseña el de más arriba (el del tablero, en `p/[projectId]/loading.tsx`). `HoverPrefetchLink` precarga
  también cuando cambia su `href` con el ratón ya encima o con el foco (al cambiar de proyecto en el selector, el
  puntero puede quedar sobre «Releases» de la barra lateral sin otro `mouseenter`). Prueba: `e2e/interfaz-carga-e2e.mjs`.
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
  lee como `NONE`. **Fase 2 (hecha en la v1.69, `20261130100000`):** los valores ya no están en el
  enum; `INPUT_COLUMN_ROLES` + `liveColumnRole` convierten el texto que entra (ZIP/JSON de la v1.67, plantillas,
  deshacer y su instantánea). La v1.68 funciona sobre esta base; con la v1.67 fallan elegir esos roles y crear proyectos
  con «Casa y familia» o «Eventos y viajes».
- (Ronda 67) Arranque: `scripts/migrate.mjs` no lanza `prisma migrate deploy` si `_prisma_migrations` tiene todas las
  migraciones de la carpeta terminadas, sin revertir y con el mismo checksum (sha256 del `migration.sql`), y ninguna a
  medias (`migrationsUpToDate`). Ante cualquier duda (pendiente, fallida, otro checksum, tabla ausente, error al leer,
  `?schema=` distinto de `public`) se lanza Prisma como antes. Si Prisma cambia cómo calcula el checksum, lo detecta
  `tests/db/start-migrate.test.ts`.

## Base de datos

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
- Pool de PostgreSQL (`src/lib/db.ts`): tope de 20 s para conseguir una conexión (`DATABASE_CONNECT_TIMEOUT_MS`; antes
  esperaba sin límite) y `DATABASE_POOL_SIZE` validado (`src/lib/db-pool.ts`: un valor raro avisa y usa 10). El pool
  (`LoggedPool`, subclase de `pg.Pool` que se pasa a `PrismaPg` con `disposeExternalPool`) anota «[db] No se puede
  conectar con PostgreSQL (servidor, base): motivo» como mucho cada 30 s.
- Otra copia en la misma base (`src/lib/instance-lock*.ts`): `pg_try_advisory_lock(LOCK_INSTANCE)` en una conexión propia
  (`application_name` `pizarro-instance:<id>`), aviso tras 2 min; con PgBouncer no se comprueba.
- Releases: la búsqueda usa `search_fold()` (función SQL IMMUTABLE de la migración `20261127103000`, mismas letras que
  `search-accents.ts`) con índices trigram si `pg_trgm` se pudo crear; `wipeDatabase` la borra y la migración la recrea.
- Fechas en SQL propio: nada de `NOW()`/`CURRENT_TIMESTAMP` sobre columnas `timestamp(3)` (quedan en la hora de la
  sesión); pasa `${new Date()}` o usa `CURRENT_TIMESTAMP AT TIME ZONE 'UTC'` (`tests/db/db-timezone.test.ts`).

## PDF y descargas

- PDF largos (ronda 58, `src/lib/pdf-chunks.ts`): más de ~20 páginas se maquetan en tramos de varios `<Page>` cortados donde
  el documento entero saltaría de página (lee `_INTERNAL__LAYOUT__DATA_` de `onRender`, interno de @react-pdf 4.9.0; sin
  él, se trocea por estimación). El worker usa una sola raíz de React (`renderDoc`), de uno en uno. Si cambias la versión
  de @react-pdf, pasa `tests/report-pages.test.ts` y `tests/report-pages-iguales.test.ts`.
- (Ronda 64) PDF de columna (plan por persona, semana, lista consolidada): se descargan con `columnDownload.ts` (un clic a la vez,
  `busy` en `ColumnActionButton` sin `aria-disabled`) y sus rutas responden `attachment`. Un PDF de columna nuevo, igual.
- Descargas ZIP (ronda 56): las envía el propio navegador. El histórico usa `?part=&v=`; «Generar release» y el plan piden
  un vale (`POST …/release-attachments?plan=1`; `src/lib/zip-ticket.ts`, en memoria, por persona y proyecto), cada
  paquete se baja con `GET ?ticket=&part=&v=` y la página consulta su estado. Un POST sin `?plan=1` responde 400 (el
  envío del ZIP en la respuesta del POST, de antes de la v1.60, ya no existe), y un paquete sin `?part=` o sin `?v=`
  también (`zipPartRequired`; desde la ronda 59 no hay «primer paquete sin número» ni enlaces sin token). El `Content-Length` lo pone
  `src/lib/response-length.ts` (instalado en `instrumentation.ts`) a partir de la cabecera interna
  `x-pz-content-length`, porque Next lo quita. Un paquete solo cuenta como descargado si llega entero.
- (Ronda 63) Memoria: nunca `--max-old-space-size` en `NODE_OPTIONS` (anula el `resourceLimits` del worker de PDF): ni en Compose ni
  en `render.yaml`; Node ajusta su montón al límite del contenedor.

## Subidas y Compartir

- Subidas (ronda 55): `acquireUploadSlot(userId, waitMs, { declaredBytes })` reparte los 3 huecos del servidor; con más
  de una persona activa (`user-activity.ts`, en memoria, la anota `querySessionUser`) cada una tiene uno. Las rutas de
  subida envuelven su `POST` con `withUploadCapHeader` (cabecera `X-Pizarro-Upload-Per-User`) y el navegador ajusta la cola
  (`uploadCap`, `uploadGate` y `runQueue({ limit })` en `upload-queue.ts`). Una ruta de subida nueva debe hacer lo mismo.
- «Compartir → Pizarro» (ronda 57): el manifiesto declara `share_target` (POST multipart a `/api/share`, fuera del proxy
  como las demás subidas). La ruta solo guarda lo compartido en `UPLOAD_DIR/shared/<usuario>/<envío>/`
  (`src/lib/share-inbox.ts`: 30 min, 3 envíos por persona, fuera de las copias, limpieza en el mantenimiento
  `sharedFiles`) y redirige a `/share`, que abre «Nueva tarea» (`ShareTarget.tsx`, con `stubBoard`). CSRF: el navegador
  manda el envío como navegación suya (`Sec-Fetch-Site: none`, sin `Origin`); `shareRequestAllowed` rechaza `cross-site`,
  `same-site`, un `Origin` ajeno y la ausencia de ambas cabeceras, y guardar no tiene efectos: la tarea y sus adjuntos solo
  se crean al pulsar «Crear tarea», por las rutas de siempre. Sin sesión no se guarda ningún archivo (solo los textos, en
  la dirección de vuelta del acceso).

## Importar y exportar

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
- Exportar un proyecto (`project-export/export.ts`): `readSnapshot` lee en una transacción corta y `assembleExport` hace
  huellas, ficheros y ZIP fuera. No vuelvas a leer ficheros dentro de la transacción
  (`tests/db/project-export.test.ts` lo comprueba con `LOCK TABLE "Task"`).

## i18n

- `npm run i18n:unused` (solo informa): traducciones sin uso, repetidas o que solo usan las pruebas. Antes de
  borrar una, comprueba que no puede venir del historial de las tareas (un año), del deshacer (7 días) ni de los
  errores de exportar/importar, que se traducen al leerlos. Las que se conservan por eso van bajo el comentario
  «Textos guardados por versiones anteriores».
- Idioma en el cliente (`src/i18n/client.tsx`): `I18nProvider` pinta siempre el mismo `I18nContext.Provider` y solo
  cambia `value`; el diccionario de inglés llega con `use()` (y `next/dynamic` solo para la precarga en el HTML). No
  vuelvas a envolver los hijos en un componente distinto según el idioma: React desmontaba la página entera al cambiar
  (el asistente volvía al paso 1). El layout raíz no se repinta en la navegación de cliente: un enlace de una pantalla
  sin sesión que puede ir en otro idioma (`/reset`, `/confirm`, `/login/verify`, `/setup` → `/login`) es un `<a href>`
  con recarga completa, no un `Link`.

## Fechas y zona horaria

- Zona horaria: `appTimeZone()` (`src/lib/format.ts`) ignora una `APP_TIMEZONE` (o una zona guardada, o `data-tz`) que
  Intl no acepte, con un aviso en el log; `envTimeZone()` es la variable solo si vale (lo que fija la zona en `/setup` y
  Ajustes) y el diagnóstico la marca `invalid`.
- «Hoy» a medianoche fuera del tablero: `useMidnightRefresh(today, refresh)` / `<MidnightRefresh today>`
  (`src/components/useMidnightRefresh.ts`, regla pura `midnightStep` en `dates.ts`), en el Calendario y Mis tareas.

## Servidor, arranque y red

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
- IP del cliente: una sola función, `clientIp` / `clientIpOrNull` (`src/lib/request.ts`, regla pura en
  `src/lib/client-ip.ts`), para los límites de intentos, el registro y las sesiones. `X-Real-IP` / `X-Forwarded-For` solo
  cuentan con `TRUST_PROXY` (sin definir: sí en Docker, `PIZARRO_LAUNCHER=docker`, y en Railway; no con `npm start`,
  `next start` ni `node server.js` a mano). Sin proxy de confianza vale la dirección de la conexión: Next no la da a las
  rutas, así que `src/lib/peer-ip.ts` (instalado en `instrumentation.ts`) la escribe en la cabecera interna
  `x-pz-peer-ip` de cada petición, sustituyendo la que mande el cliente. `tests/client-ip.test.ts` falla si otro módulo
  lee esas cabeceras. `npm run test:db` fija `TRUST_PROXY=1` (las pruebas ponen la IP con `X-Real-IP`).
- (Ronda 62) IP del cliente en Render/Fly.io: `platformIpHeader()` (`CF-Connecting-IP` / `Fly-Client-IP`) solo si existen
  `RENDER`/`RENDER_SERVICE_ID` o `FLY_APP_NAME`/`FLY_MACHINE_ID`; `resolveAppUrl()` deduce `APP_URL` también de
  `RENDER_EXTERNAL_URL` y `FLY_APP_NAME`. `tests/cloud-platforms.test.ts` comprueba `render.yaml` y `deploy/fly.toml`
  contra el Dockerfile y que no vuelva `railway.json`.
- `APP_URL` (ronda 60): siempre con `resolveAppUrl()` (`src/lib/app-url.ts`; sin la variable, `https://` +
  `RAILWAY_PUBLIC_DOMAIN`), también en scripts (`reset-link`, `doctor`, `boot`). No leas `process.env.APP_URL` directamente.
- (Ronda 63) Ids de la URL: `isRowId` (`src/lib/row-id.ts`, sin zod) antes de tocar la base; mal formados → 404.
- Cachés en memoria con tope: `memo` y `boundedMemo` (`src/lib/memo.ts`, en `globalThis`). `boundedMemo` barre lo
  caducado al leer (como mucho una vez por plazo) y admite un tope de bytes (`maxBytes` + `sizeOf`). El calendario suscrito
  guarda 60 s el .ics (en bytes UTF-8) y su ETag por enlace (`cachedFeedIcs`, `FEED_CACHE_MAX` = 200,
  `FEED_CACHE_MAX_BYTES` = 64 MB) pero comprueba el token en cada petición; `revokeProject`/`revokeUser` la vacían
  (`clearBoundedMemo(FEED_CACHE_NAME)`) y la ruta manda `max-age` = lo que le queda en la memoria (≤ 60 s): un cambio se
  ve como mucho al minuto. `/api/health` guarda 3 s su resultado y el apagado responde 503 antes de mirar la caché.
- (Ronda 66) Apagado: `shutdownGraceMs()` solo espera más de 5 s si `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` lo permite
  (nunca más de lo que concede la plataforma). Un envío nuevo en `after()` va con `trackInFlight`. Una reserva de envío
  periódico se devuelve si llega un apagado antes de empezar a enviar (`pendingReports` en periodic-mail.ts).
- (Ronda 66) Orden de los proyectos: `ProjectVisit` se escribe con `after()` y como mucho una vez cada 5 min por persona y
  proyecto (al cambiar de proyecto, enseguida, como mucho cada 30 s); la preferencia viaja en la sesión (`projectOrder`).

## Seguridad y límites

- Informar de un error (`src/lib/feedback*.ts`, `src/components/feedback/`, `POST /api/feedback`): solo en builds oficiales;
  sus límites van en el mapa de seguridad del limitador (`SECURITY_KEY_PREFIXES`); la captura (`modern-screenshot`, cargada
  al pulsar) excluye lo marcado con `data-pz-no-capture`: **un secreto nuevo que se muestre en pantalla (código, enlace con
  token) debe llevar ese atributo**.
- (Ronda 64) Limitador: los topes de lo que cuesta dinero o molesta a terceros (`whatsapp:`, `messaging:`, `mail:test:`,
  `notify:`) van en el mapa de seguridad. Un tope nuevo de ese tipo, igual.
- (Ronda 67) Más prefijos en el mapa de seguridad: `project-invite:`, `resend-invite:`, `project-added-mail:`,
  `report-schedule:`, `telegram:link:`, `telegram:reply:` y `2fa:send-user:` (`reset:` ya lo cubría). Un tope contra el envío
  masivo no debe poder usarse para bloquear a nadie: «¿Olvidaste tu contraseña?» deja salir siempre el primer email del día
  a cada dirección y los pedidos desde un dispositivo conocido (`knownDeviceCheck`, leído en la petición); solo los
  repetidos desde navegadores desconocidos cuentan (5 al día por dirección, 100 al día en total, `reset:repeat-day`). Los
  códigos de 2FA por email, 10/h por persona solo desde navegadores desconocidos, y la pantalla de verificación dice si el
  tope impidió enviarlo (`emailCodeStatus`).

## Emails y mensajería

- Baja de emails (`src/lib/unsubscribe*.ts`, rutas `/unsubscribe/<token>` y `/api/unsubscribe/<token>`): token HMAC con
  `TOKEN_SECRET` (etiqueta propia), el GET nunca da de baja, `List-Unsubscribe` solo con https. `/unsubscribe/` está en
  `SECRET_PATH_PREFIXES` y en `redactPath` (el token no llega a los logs): una ruta nueva con token en la URL, igual.
- (Ronda 62) Correo caído: `periodic-mail.ts` corta la pasada solo por errores del envío (`sending`) y aparta una hora a quien falló
  (`failureMemory`, igual que los informes).
- Telegram y WhatsApp: los dos están implementados y se configuran en *Administración → Integraciones → Avisos por
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
- (Ronda 66) `Project.templateKey`: clave de serie o `custom`; al importar solo `knownTemplateKey()`; las búsquedas en
  mapas por clave con `Object.hasOwn` (una clave «constructor» tiraba el tablero). La huella de «modificada»
  (`comparable()`) cuenta los tipos por defecto solo si alguna columna tiene uno (las demás conservan su huella).

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
- (Ronda 66) `login()` borra las aperturas (`ProjectVisit`) de quien entra: con «Usados recientemente» `/` llevaría al
  último proyecto que abrió otro escenario. El servidor de las suites se arranca con `node` + `START_ARGS` (lo mismo que
  `npm start`) y se para con `stopServerTree` (taskkill en Windows); Prisma con `prismaMigrate()`, nunca `npx`.

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
