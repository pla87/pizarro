# Pruebas en navegador (end-to-end)

Suites con Playwright (`playwright-core`, ya en las dependencias) contra una build de producción y una base de datos
propia. No forman parte de `npm test`: en cada ronda se pasan las afectadas por los cambios y, antes de publicar una
versión, todas (`scripts/e2e-all.sh`, ver «Todas seguidas o solo las afectadas»).

## Requisitos

- PostgreSQL accesible con el `DATABASE_URL` del `.env` (el usuario debe poder crear bases).
- Chromium: el de `CHROME=/ruta/chrome` si se indica. Si no, se busca el más reciente instalado por Playwright en
  `PLAYWRIGHT_BROWSERS_PATH` (por defecto `/opt/pw-browsers`): `chromium-<revisión>/chrome-linux*/chrome`. Si no hay
  ninguno, se usa el de `playwright-core` (instálalo con `npx playwright-core install chromium`).
- Una build: `npx next build --webpack && node scripts/postbuild.mjs && npm run build:boot`.
- Sin `DATABASE_URL`, las suites usan `postgresql://postgres:postgres@localhost:5432/pz_qa`. Por seguridad, la suite QA
  solo vacía bases cuyo nombre empieza por `pz_`.

## Suites

| Suite | Script | Comprobaciones | Tiempo |
|---|---|---|---|
| **Generales** | | **439** | |
| QA (9 escenarios) | `e2e/qa/run-all.mjs` | 390 | ~5 min |
| Instalación desde cero con `npm start` | `e2e/install-e2e.mjs` | 49 | ~1 min |
| **Tablero** | | **677** | |
| Tablero | `e2e/board-e2e.mjs` | 364 | ~4 min |
| Cabecera y atajos (caza de bugs 48a) | `e2e/tablero-cabecera-e2e.mjs` | 42 | ~1 min |
| Mover con el teclado varias veces seguidas (caza de bugs 51b) | `e2e/tablero-teclado-e2e.mjs` | 34 | ~20 s |
| Arrastrar una selección (montón, teclado, dedo, tiempo real) | `e2e/tablero-seleccion-e2e.mjs` | 76 | ~1 min |
| Panel de tareas fijas: sin scroll de más al abrirlo, copia con Ctrl que nace fija en el panel (release y plan), arrastres con Ctrl entre la lista llena y el panel sin «Algo ha fallado», foco con el teclado y copia provisional con la red lenta (ronda 55) | `e2e/tablero-fijas-e2e.mjs` | 75 | ~1 min |
| Canal en vivo con `ping` y presencia sin sondeos (dos personas), panel de filtros estable, «Ninguna tarjeta coincide» y release con filtro, lupa, columnas y pestañas en el móvil, botones flotantes y diálogos, CLS, Alt+P y rueda sobre el detalle (ronda 56) | `e2e/tablero-vivo-e2e.mjs` | 86 | ~1,5 min |
| «Compartir → Pizarro»: share_target del manifiesto, POST del navegador con texto, enlace y archivos → «Nueva tarea» en el último proyecto, formulario de otra web rechazado y sin sesión (ronda 57) | `e2e/tablero-compartir-e2e.mjs` | 15 | ~30 s |
| **Detalle de la tarea** | | **44** | |
| Comentarios a la vez y red lenta (caza de bugs 48c) | `e2e/detalle-comentarios-e2e.mjs` | 44 | ~1 min |
| **Copias de tareas** | | **120** | |
| Copias con adjuntos y release con barra de formato | `e2e/copias-adjuntos-e2e.mjs` | 93 | ~2 min |
| Copia con imagen en la descripción, sin red en calendario, borradores y releases (caza de bugs 49) | `e2e/copias-imagen-sin-red-e2e.mjs` | 27 | ~1 min |
| **Pegar, importar y exportar** | | **350** | |
| Pegar | `e2e/paste-e2e.mjs` | 72 | ~1 min |
| Copiar y pegar una tarea como JSON desde el detalle: Ctrl+C sin selección y con texto seleccionado, Ctrl+V estricto fuera y dentro de un campo, deshacer, «Importar tarea» (portapapeles tolerante, fichero, a mano), JSON de una IA, móvil (copiar e importar juntos en «⋯») e inglés (rondas 53 y 54) | `e2e/importar-json-detalle-e2e.mjs` | 98 | ~1,5 min |
| Importar y exportar tareas en JSON: botón de la cabecera, vista previa y columna de destino, fichero, arrastrar, Ctrl+V en el tablero, «Exportar (N)» y volver a importar, más de 2 MB (sin red, sesión caducada, 413), «Nueva tarea» (Ctrl+V de una tarea copiada con el foco en el título vacío, en un selector, un botón, la fecha, una zona vacía o una caja sin tocar; desde el «+» de una columna; etiquetas, color y enlace al crear, importar y copiar; cambiar de proyecto; editor visual y de Markdown), móvil a 390 px, inglés, oscuro y de otros Kanban: Trello y CSV de Jira (ronda 54) | `e2e/importar-exportar-e2e.mjs` | 155 | ~3 min |
| Pegar la tarea con el foco en una casilla o en la fecha, Ctrl+C con solo una imagen seleccionada, título pegado en una línea, bloqueo entre tareas borradas tras deshacer-rehacer-deshacer y `?doc=…#apartado` mientras se lee el marco (caza de bugs 53) | `e2e/importar-pegar-foco-e2e.mjs` | 25 | ~1 min |
| **Calendario** | | **44** | |
| Tareas que se repiten (calendario, .ics y «Nueva tarea») | `e2e/calendario-repetir-e2e.mjs` | 44 | ~1 min |
| **Releases** | | **55** | |
| Release de más de 500 tareas (o 200 con adjuntos), «+» flotante con el programa lleno y panel de fijas en el móvil (caza de bugs 51c) | `e2e/releases-grandes-e2e.mjs` | 55 | ~35 s |
| **Plan de trabajo para IA** | | **275** | |
| Plan de trabajo para IA y botones de las columnas especiales (ronda 51) | `e2e/plan-ia-e2e.mjs` | 147 | ~1 min |
| Plan de trabajo: ZIP de adjuntos (también en inglés, «attachments/»), ritmo por columna, botones con la columna vacía y salir por los enlaces del pie (ronda 52) | `e2e/plan-ia-zip-e2e.mjs` | 101 | ~1 min |
| Plan de trabajo para IA: Markdown con descripciones raras, fijas entre paneles, título a 390 px y más de 500 tareas (caza de bugs 51a) | `e2e/plan-ia-markdown-e2e.mjs` | 27 | ~40 s |
| **Plantillas y programa del curso** | | **182** | |
| Aplicar plantilla a un proyecto existente (ronda 50) | `e2e/plantillas-aplicar-e2e.mjs` | 39 | ~1 min |
| Aplicar plantilla: opción elegida en oscuro, tareas fijas, generales ocultos y límite (ronda 51) | `e2e/plantillas-aplicar-opciones-e2e.mjs` | 26 | ~40 s |
| Aplicar plantilla: paso 2 y archivadas de columnas unidas (caza de bugs 50a) | `e2e/plantillas-aplicar-columnas-e2e.mjs` | 22 | ~20 s |
| Plantilla «Curso o máster» y «Publicar programa (PDF)» | `e2e/plantillas-curso-e2e.mjs` | 57 | ~40 s |
| «Programa del curso»: versiones del PDF y tope de 100 sesiones (ronda 51) | `e2e/plantillas-programa-e2e.mjs` | 38 | ~1 min |
| **Documentación y formatos del material** | | **235** | |
| Formatos del material: cerrar la release, párrafos vacíos, Google Slides y HTML aislado (ronda 50) | `e2e/documentacion-formatos-e2e.mjs` | 107 | ~1 min |
| Enlaces entre HTML de la misma Documentación (ida, vuelta, #apartado, inexistente, otro proyecto) y HTML/texto/Markdown en Latin-1, Windows-1252 y UTF-16, y UTF-8 con un `<meta>` de 8 bits mal puesto (ronda 52) | `e2e/documentacion-enlaces-e2e.mjs` | 52 | ~1 min |
| Enlaces de un HTML a sí mismo y nombres arreglados, binarios con BOM de UTF-16 y borrador al archivar o borrar sin red (caza de bugs 52) | `e2e/documentacion-enlaces-bom-e2e.mjs` | 37 | ~30 s |
| Índice de un HTML en Documentación y baja con Google sin email (caza de bugs 50b) | `e2e/documentacion-indice-e2e.mjs` | 39 | ~30 s |
| **Cuentas** | | **133** | |
| Borrar mi cuenta (escritorio, móvil, Google y Administración) | `e2e/cuentas-borrar-e2e.mjs` | 61 | ~1 min |
| Lo que queda al borrar una cuenta: Google pide la contraseña, aviso a los administradores y proyecto fuera de la lista (ronda 51) | `e2e/cuentas-borrar-restos-e2e.mjs` | 72 | ~45 s |
| **Interfaz y textos** | | **296** | |
| Carga de proyecto y «Adjuntos y límites» (ronda 49) | `e2e/interfaz-carga-e2e.mjs` | 38 | ~1 min |
| Esqueletos de carga, icono de la app, HTML sin `<link>` y copias con segundos (ronda 51) | `e2e/interfaz-esqueletos-e2e.mjs` | 53 | ~1,5 min |
| Archivar/borrar al instante desde el detalle, cambio de columna seguido, flechas en grupos de opciones (y el color pendiente al recargar, con sendBeacon), iconos de la raíz (con ETag y 304) y nombre corto (ronda 52) | `e2e/interfaz-detalle-iconos-e2e.mjs` | 109 | ~1,5 min |
| Textos breves, notas «i» y botones sin efecto (ronda 49) | `e2e/interfaz-textos-e2e.mjs` | 29 | ~1 min |
| Auditoría de escritorio y móvil: sin errores de hidratación (otra zona horaria e idioma, y tras un proxy que reescribe los emails), pestañas con alias y aviso, destinatario del informe por nombre, vencidas del calendario y de «Mis tareas», Usuarios a 393 px, indicador de las pestañas, pie del menú, theme-color del tema elegido y accesibilidad (aria-pressed, aria-expanded, fondo inert con un modal, axe) (ronda 56) | `e2e/interfaz-auditoria-e2e.mjs` | 67 | ~3 min |
| **Accesibilidad** | | **68** | |
| Reintentar el ZIP del plan, aviso de `?doc=` a un documento que ya no está, botones de columna con aria-disabled y opciones de correo accesibles (caza de bugs 52, segunda tanda) | `e2e/accesibilidad-columnas-e2e.mjs` | 36 | ~40 s |
| Descripción debajo de su punto en el histórico de releases, `<h2>` con el botón dentro y error al copiar, «Archivadas» del menú móvil, nombre accesible de los filtros del calendario y foco al cerrar «+N más», rol en «Aplicar plantilla» y `otro.md#apartado` (caza de bugs 54) | `e2e/accesibilidad-releases-e2e.mjs` | 32 | ~30 s |
| **Red, sin conexión y formularios** | | **147** | |
| Formularios sin red, IP del cliente y páginas legales (ronda 49) | `e2e/red-formularios-e2e.mjs` | 26 | ~1 min |
| Sin conexión y pestañas (caza de bugs 48b) | `e2e/red-sin-conexion-e2e.mjs` | 121 | ~3 min |
| **Total** | | **3065** | |

Las cifras son las de la última pasada completa; si añades comprobaciones, actualízalas aquí (es el único sitio donde
se apuntan). Todas, menos la QA y la de instalación, usan la base que deja preparada la QA y un servidor ya arrancado; se pueden lanzar en
cualquier orden. Cada una hace varios inicios de sesión: si una falla al entrar (tiempo agotado en el acceso) tras
otras suites, reinicia el servidor (salta el límite de intentos) y vuelve a lanzarla. La base no se borra al terminar:
la siguiente pasada de la QA la vacía; bórrala a mano cuando ya no la necesites. Capturas en `SHOTS_DIR` (por defecto
la carpeta temporal del sistema).

Los ficheros se nombran por tema (`tablero-*`, `importar-*`, `plantillas-*`, `documentacion-*`…), no por la ronda en
que se escribieron; una suite nueva va con el prefijo de su tema, en su grupo de la tabla y de las secciones de abajo, y
con su entrada en `e2e/suites.json`. Los nombres antiguos (`bhNN*`, `rNN-*`) están al final.

## Todas seguidas o solo las afectadas

`scripts/e2e-all.sh` lanza las suites una tras otra contra la build, cada una con su servidor recién arrancado, y
termina con una línea por suite y el total de comprobaciones (`Total: N/M comprobaciones OK`); el log de cada una queda
en `$OUT/<suite>.log`. La base es la del `.env` con el nombre cambiado a `E2E_DB` (por defecto `pz_qa`) y el puerto,
`E2E_PORT` (por defecto 3231); la instalación va al final con su propia base, `<E2E_DB>_install`.

```sh
scripts/e2e-all.sh                                      # todas: antes de publicar una versión
AFFECTED=1 scripts/e2e-all.sh                           # en cada ronda: la QA y las afectadas por los cambios
AFFECTED=1 DRY_RUN=1 scripts/e2e-all.sh                 # solo dice cuáles lanzaría y por qué
AFFECTED=1 BASE_REF=HEAD~3 scripts/e2e-all.sh           # afectadas respecto a otro commit (por defecto origin/main)
SUITES="board-e2e tablero-fijas-e2e" scripts/e2e-all.sh # unas concretas
E2E_DB=pz_mio E2E_PORT=3305 scripts/e2e-all.sh          # otra base y otro puerto (varias sesiones a la vez)
```

Las afectadas salen de `scripts/e2e-affected.mjs` (también se puede lanzar solo: `node scripts/e2e-affected.mjs --why`):
toma los ficheros cambiados desde que la rama salió de la base (`git diff --name-only $(git merge-base origin/main
HEAD)`, más lo que no está en un commit y los ficheros nuevos) y los cruza con el mapa `e2e/suites.json`:

- `always`: la QA, siempre.
- `all`: lo que puede romperlas todas (dependencias, `next.config.ts`, el arnés `e2e/qa/lib.mjs` y `ui.mjs`, el arranque
  del servidor, el propio mapa…): lanza todas.
- `common.files` (`globals.css`, los layouts, `src/i18n/`, `lib/action.ts`, `components/ui/`, migraciones…): lanza
  `common.suites` (el tablero, además de la QA). Un fichero de `src/`, `prisma/` o `public/` que no aparece en ningún
  patrón cuenta también como común.
- `suites`: cada suite con los patrones de los ficheros que cubre; también se lanza si cambia su propio fichero.
- Fuera de la app (`docs/`, `tests/`, `.github/`…): solo la QA.

Patrones: `**` cualquier ruta, `*` dentro de una carpeta, `{a,b}`; los corchetes y paréntesis de las rutas de Next
(`[projectId]`, `(app)`) son literales. Si una pieza nueva de la app la prueba una suite, añade su ruta a la entrada de
esa suite. `tests/e2e-affected.test.ts` (en `npm test`) falla si una suite no tiene entrada, si una entrada no tiene
fichero o si un patrón no coincide con ningún fichero del repositorio.

## Generales

### QA (9 escenarios)

```sh
DBURL=$(grep ^DATABASE_URL .env | cut -d'"' -f2 | sed 's#/[^/]*$#/pz_qa#')
cd e2e/qa && BASE=http://localhost:3231 DATABASE_URL=$DBURL APP_DIR=$PWD/../.. node run-all.mjs
# solo algunos escenarios: --only=1,4,7   ·   sin reiniciar la base: --no-reset
```

`run-all.mjs` crea (o vacía) la base de `DATABASE_URL` (aquí `pz_qa`), aplica migraciones y arranca su propio servidor
en el puerto de `BASE`, que para al terminar: no debe haber otro servidor escuchando ahí.

Con la máquina cargada: `QA_CPU_THROTTLE=4` (o 6) frena la CPU de las páginas que abren las suites
(`Emulation.setCPUThrottlingRate` de CDP; vale para todas las que usan `L.session`). Así salen las comprobaciones que no
esperan al estado que miran. Reglas de las suites: lo que la app pinta al responder el servidor (el tablero tras deshacer,
el diálogo que se cierra al archivar, la copia de un duplicado) y lo que escribe al final de la acción (el historial de la
tarea, `TaskEvent`) se comprueban con `L.eqEventually` / `L.checkEventually`, no justo después de ver el cambio en la BD;
lo optimista (arrastrar, Alt+flechas) puede comprobarse al momento. Recargar y navegar con `L.reload` / `L.goto`: si la
respuesta de una acción llega justo al empezar la recarga, Chromium la cancela (`net::ERR_ABORTED; maybe frame was
detached?`) y se repite.

### Instalación desde cero

Base vacía (la borra y la crea: solo nombres `pz_*`, distinta de la de la QA) y su propio `npm start` sin `SEED_ADMIN_*`,
con el buzón de pruebas, en el puerto de `BASE` (debe estar libre). Comprueba que `npm start` hace las tareas de arranque
(código de `/setup` en la terminal, `system.boot`, plantillas, historial de versiones), el asistente (cambiar de idioma
en el paso 2 no lo reinicia; el acceso sale en el idioma elegido), el segundo paso obligatorio del admin con un solo
«Atrás», *Administración → Ajustes → Instalación*, el email de prueba, invitar en otro idioma y «Reenviar invitación»,
el idioma al pasar de `/reset` al acceso, cambiar de idioma en «Mi perfil» sin desmontar la página y el detalle de una
tarea sin Google. Anota los avisos de Node del servidor con `e2e/warn-hook.mjs` y falla si aparece el de pg
«client is already executing a query».

```sh
cd e2e && BASE=http://localhost:3232 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pz_install APP_DIR=$PWD/.. node install-e2e.mjs
```

## Tablero

### Tablero

Con la base `pz_qa` preparada por la suite y un servidor arrancado (`DATABASE_URL=$DBURL PORT=3231 npm start`):

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node board-e2e.mjs
```

### Cabecera y atajos (caza de bugs 48a)

La cabecera del tablero no se sale de la pantalla con nombres cortos y largos (1920 a 390 px), Alt+Mayús+N con un
diálogo abierto, Alt+N antes de hidratar, presencia al abrir el tablero, contador del título en caracteres visibles,
aviso 99+ en móvil, ayuda de atajos y borrar un proyecto con espacios dobles. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node tablero-cabecera-e2e.mjs
```

### Mover con el teclado varias veces seguidas (caza de bugs 51b)

En un tablero con 250 tarjetas: dos Alt+↑ seguidos suben la tarjeta dos puestos, y con las acciones del servidor medio
segundo más lentas (red lenta, `page.route`), Alt+→ y Alt+← seguidos la dejan al final de su columna y ahí sigue cuando
llega la respuesta del primero (antes esa respuesta le ponía la posición de la otra columna y el Alt+↑ siguiente la subía
dos puestos o no hacía nada); el foco sigue en la tarjeta. Tres rondas (`ROUNDS`). Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node tablero-teclado-e2e.mjs   # PART=atajos · QA_CPU_THROTTLE=4
```

### Arrastrar una selección

Con varias tarjetas seleccionadas, arrastrar una de ellas lleva todas: el montón con la insignia del número, las demás
atenuadas en su sitio, el hueco de destino «N tarjetas irán aquí» y los avisos del lector de pantalla («Has cogido 3
tarjetas…», «Has soltado 3 tarjetas en…»). Al soltar van seguidas y en orden de tablero, con un solo paso de deshacer, y
la selección se mantiene. Escape cancela; una sin seleccionar se mueve sola; Ctrl al soltar copia solo la cogida;
dentro de su columna y entre dos tarjetas de otra; Alt+flechas sobre una seleccionada mueve todas; la otra persona lo ve
por el canal en vivo; la columna de revisión pide confirmación; con el dedo (asa, 390 px) y en modo oscuro. Misma base y
servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node tablero-seleccion-e2e.mjs   # PART=drag,cancel,single,copy,same,keys,live,review,touch,dark
```

### Panel de tareas fijas: scroll, copias con Ctrl y arrastres de ida y vuelta (ronda 55)

Con cinco tarjetas en la columna de la release, abrir «Siempre en la release» ya no hace aparecer la barra de scroll en
la lista (a 1280 × 720 y 1500 × 900: antes el hueco del final, que no hace falta con el panel debajo, era lo único que no
cabía). En el móvil a 390 px el hueco se queda aunque las tarjetas quepan (la barra de selección y los botones flotantes
tapan el final de la lista): con una tarjeta seleccionada, plegado y abierto, al bajar del todo la última queda por encima
de la barra de selección. Con 30 tarjetas sí hay scroll y la última queda entera por encima del panel. Arrastrar con
Ctrl una tarjeta y soltarla en el panel crea la copia fija en ese panel (no al final de la lista), al momento (optimista) y
con una sola entrada de deshacer; igual en «Siempre en el plan» de una columna de plan para IA, y una fija «cada dos»
copiada en su propio panel da otra fija «cada dos»; sin Ctrl la tarea se mueve como siempre, y Ctrl+Z deshace los dos
pasos. Por último, seis arrastres con Ctrl de ida y vuelta por la frontera entre la lista (120 tarjetas, con scroll
automático) y el panel abierto, soltando Ctrl a mitad, con tarjetas de otra columna y con fijas del propio panel: ni
«Algo ha fallado» (error #185 de React) ni errores, los dibujos de React encadenados (contados con el gancho de las
herramientas de desarrollo) se quedan lejos del corte de 50, todas las copias son fijas, y una fija que ya pasó por la
lista se puede volver a arrastrar (antes dnd-kit perdía su registro). Con el teclado, Espacio coge una fija del panel y
Escape, o Espacio sobre su panel, la deja con el foco en su fila (también después de pasar con el ratón por la lista y
volver, cuando la fila se vuelve a montar). Con las acciones de servidor retrasadas 2,5 s, la copia provisional de un
arrastre con Ctrl va marcada (aria-busy) y ni los atajos (Alt+M, F2, Alt+↑, Espacio, Alt+Mayús+D) ni otra tarjeta soltada
encima mandan su id al servidor; al responder no quedan tarjetas fantasma. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node tablero-fijas-e2e.mjs   # PART=scroll,copia,vaiven,foco,provisional
```

### Canal en vivo, presencia, filtros, móvil y capas (ronda 56)

El canal en vivo del tablero manda un evento `ping` con nombre (antes un comentario que el navegador no ve) en menos de
30 s, el saludo lleva el id del canal y el estado completo de la presencia llega al conectar; con el canal abierto el
tablero no pide `/presence` ni repite el aviso de la tarea abierta (las reglas de la recarga de respaldo, 15 min con el
canal sano y 2 sin él, están en `tests/focus-refresh.test.ts`). Con dos personas: B aparece en la cabecera de A en unos
segundos, la tarjeta de A muestra que B tiene abierta la tarea, los dos detalles se avisan y al cerrar B el aviso de A
desaparece al momento; sin acceso al proyecto el canal responde 404. El panel de filtros no se mueve al marcar un tipo
(1500 y 1100 px) y el segundo clic cae dentro. Con una búsqueda sin resultados las columnas dicen «Ninguna tarjeta
coincide», el tablero avisa con «Limpiar filtros» (que la quita) y «Generar Release» con un filtro avisa de cuántas tareas
ocultas incluye. A 390 px: la lupa da el foco al campo al primer toque, la búsqueda salta a la columna con resultados
(elegida a mano una sin resultados, se queda), sin columna recordada se abre la primera con tarjetas, las pestañas llevan
degradado por el lado en que quedan más, la columna nueva se muestra al crearla y al volver se abre la última vista.
Con el detalle de una tarea abierto no hay botones flotantes del tablero ni nada tapa los del diálogo (390 y 900 px); en
escritorio, las copias flotantes de «Deshacer» y «Nueva tarea» (fuera del `inert` del modal) deshacen sin cerrar la tarea
y abren la segunda al lado; y en *Documentación*, en el móvil, «Nueva tarea» y «Varias
tareas» van en el pie de la hoja. CLS al cargar el tablero en el móvil táctil por debajo de 0,02 (con el asa a la vista;
en escritorio no se ve). Alt+P abre el selector de proyectos con el foco en el buscador sin escribir la letra, y la rueda
sobre el detalle no desplaza la columna de detrás. Con axe (escritorio y 390 px, una tarjeta seleccionada y el panel de
fijas abierto): sin controles anidados (la casilla «Seleccionar», el asa y el enlace externo de la tarjeta ya no son
botones ni enlaces; la cadencia de una fija va fuera de la parte con rol de botón), sin `aria-hidden` enfocables ni
botones sin nombre, el nombre de la cadencia empieza por su texto visible y el recuento de tarjetas se anuncia en un solo
sitio. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node tablero-vivo-e2e.mjs   # PART=ping,presencia,filtros,vacio,lupa,movil,capas,cls,altp,rueda,axe
```

### Compartir con Pizarro (ronda 57)

El manifiesto declara `share_target` (POST multipart a `/api/share`). El envío tal como lo manda el navegador al
compartir desde otra app (`Sec-Fetch-Site: none`, con título, texto, enlace y un archivo) responde 303 a `/share?id=…`,
que abre «Nueva tarea» en el último proyecto usado con el título, el texto y el enlace en la descripción y el archivo;
un formulario de la propia app con una imagen también llega, y descartar vuelve al tablero. «Crear tarea» crea la tarea
con su adjunto, vuelve al tablero y lo compartido deja de estar en el servidor (404). Un formulario de otra web
(cross-site, servido con `page.route`) recibe 403 sin crear nada. Sin sesión, el envío va al acceso y, al entrar, «Nueva
tarea» trae el título y avisa de que el archivo no se guardó. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node tablero-compartir-e2e.mjs
```

## Detalle de la tarea

### Comentarios a la vez, red lenta, dos pestañas y release renombrada (caza de bugs 48c)

Tres personas comentan a la vez la misma tarea en varias rondas (todas ven todos los comentarios, en orden y sin «Ver
anteriores»), editar el propio comentario en el móvil (el botón dice «Editar»; un admin no edita el ajeno pero sí lo
borra; la mención nueva avisa una sola vez, la otra persona ve «(editado)» en vivo, queda en el historial y se deshace;
ronda 57), el editor de la descripción con red lenta (CDP, y el trozo del editor retrasado 6 s: lo tecleado antes y
durante su llegada no se pierde), dos pestañas de la misma persona guardando la descripción (la segunda, que la escribía a
la vez, recibe el aviso; una sola pestaña guardando seguido no) y una release cuyo texto se generó antes de renombrar una tarea. Misma base y
servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node detalle-comentarios-e2e.mjs   # PART=comments,edit,desc,tabs,rel
```


## Copias de tareas

### Copias con adjuntos y release con barra de formato

Duplicar una tarea con una imagen y un archivo (botón del detalle, Ctrl al soltar en otra columna, Alt+Mayús+D y en el
móvil a 390 px): la copia tiene sus propios adjuntos (ids nuevos, mismo contenido y miniatura), el documento de Google
enlazado y las subtareas sin marcar; borrar el adjunto de la original no toca el de la copia; deshacer y rehacer la
copia; con la cuota del proyecto justa se copian los que caben y se avisa del resto. Duplicar una tarea que se repite
(Ctrl al soltar, Alt+Mayús+D y el botón del detalle): la copia nace sin repetición y el aviso lo dice. Release con la preferencia «Con
barra de formato»: editor con barra sin Editar / Vista previa; sin tocar nada, Copiar todo, .md y .txt dan lo mismo que
con Markdown; al editar solo cambia lo editado; cambiar el pie o quitar la cabecera con el texto ya editado; negrita de
la barra; desplegar guarda lo editado; release de 300 tareas (tiempo de carga, por tecla frente a un campo de texto y
Copiar todo) y el móvil a 390 px. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node copias-adjuntos-e2e.mjs   # PART=dup,drag,keys,quota,mdup,rel,big,mrel
```

### Copia con imagen, sin red y «Repetir» en un borrador (caza de bugs 49)

La copia de una tarea (Ctrl al soltar en otra columna) con una imagen en la descripción (`![…](/api/attachments/…)`)
apunta a su propio adjunto y se sigue viendo tras borrar el de la original; mover una tarea en el calendario sin red
vuelve a su día con «Sin conexión: no se ha guardado» y con red se guarda; sin red, el interruptor «Borrar los borradores
al cerrar sesión» de *Mi perfil* vuelve a como estaba y «Borrar release» no se queda ocupado; en *Nueva tarea* recuperada
de un borrador, el día de «Repetir» sigue a la fecha límite si no se eligió a mano. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node copias-imagen-sin-red-e2e.mjs   # PART=dupimg,cal,drafts,reldel,repdraft
```

## Pegar, importar y exportar

### Pegar

Imágenes pegadas en *Nueva tarea*, en el detalle y en el tablero (una sola vez, sin avisos, con el foco en cualquier
sitio), y tablas pegadas desde Word, Google Docs, una web o una hoja de cálculo. Misma base y servidor que el tablero:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node paste-e2e.mjs
```

### Copiar y pegar una tarea como JSON (rondas 53 y 54)

Con el detalle de una tarea abierto, Ctrl+C sin texto seleccionado copia la tarea entera como JSON (formato
«pizarro.task», `src/lib/task-json.ts`; del responsable van su id y su nombre, nunca el email; la suite lee el
portapapeles con los permisos `clipboard-read` y `clipboard-write` de Playwright) y el indicador de la cabecera dice
«Tarea copiada»; con texto seleccionado (en el título o en la página) copia ese texto. Ctrl+V fuera de un campo de texto
escribe en la tarea abierta la del portapapeles (título, descripción, fecha, responsable, campos opcionales, enlace,
columna, etiquetas, subtareas y dependencia), con una sola entrada de deshacer: Ctrl+Z la devuelve entera (y borra la
etiqueta que creó), Ctrl+Mayús+Z la vuelve a pegar y «Cancelar» también la descarta. Ctrl+V es estricto: solo con
exactamente un JSON de tarea con su marcador; un JSON roto, sin marcador, en un bloque ```json, con texto alrededor, en
una lista o dos seguidas no hacen nada. Dentro de un campo el JSON se pega como texto y, con la descripción sin guardar,
pegar la tarea pregunta antes. Los botones «Copiar tarea» e «Importar tarea» (desde el portapapeles, tolerante con lo
que escribe una IA, con aviso si hay varias tareas o ninguna; desde un fichero .txt; con el teclado; sin permiso para
leer el portapapeles, cuadro para pegarlo a mano; en el móvil, juntos en un botón «⋯» «Más opciones de la tarea» que cabe en la
cabecera y deja sitio al título, también con el teclado), la barra de progreso de las subtareas solo con alguna y los
textos en inglés. Misma
base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node importar-json-detalle-e2e.mjs   # PART=copiar,pegar,texto,invalido,menu,ingles
```

### Importar y exportar tareas en JSON (ronda 54)

En la cabecera del tablero, junto a «Varias tareas», «Importar» abre el diálogo de importar (cargado aparte): pegar en el
cuadro, «Desde el portapapeles», «Desde un fichero» (.json, .csv, .txt) o arrastrar el fichero encima; vista previa con la
columna a la que irá cada tarea y sus avisos, las que no se pueden leer y «Columna de destino» (la de cada tarea o una
para todas). Se importan con un solo deshacer (que borra también las etiquetas creadas), historial en cada tarea,
dependencias por título dentro del lote y hacia las que ya había, y responsable por id. Ctrl+V en el tablero con un JSON
de tareas exacto abre el diálogo con el texto (con texto alrededor, no). Un fichero de más de 2 MB (300 tareas con eñes,
€ y emojis) se importa por la ruta `/api/projects/[id]/import-tasks` (las acciones admiten 1 MB); sin red, con la sesión
caducada o con un 413 de un proxy por delante, el aviso de siempre. Con tarjetas marcadas el botón pasa a
«Exportar (N)»: «Descargar .json» (nombre `tareas-<proyecto>-<fecha>.json`, sin emails) y «Copiar»; lo descargado se
vuelve a importar con la dependencia hacia la copia nueva. «Nueva tarea»: «Copiar tarea» e «Importar tarea» van en la
cabecera junto a la X, como en el detalle (en el móvil, juntos en «⋯»); «Copiar tarea» copia lo escrito, «Importar
tarea» rellena el formulario (pregunta antes de sustituir y avisa de lo que no admite), desde un fichero y con Ctrl+V
estricto fuera de un campo. Ctrl+V de una tarea copiada (de otra instalación, con Markdown largo, tipo «Respuesta» y
columna del proyecto) la importa entera con el foco en el título vacío, en cada selector, en un tipo, en un botón, en la
fecha, en una zona vacía o en una caja con el formulario sin tocar; con algo escrito pregunta, y en otra caja se pega como
texto; varias tareas avisan; desde el «+» de una columna manda la del JSON si existe (si no, la de la columna). Etiquetas
(solo las del proyecto), color y enlace al crear, al importar (aviso de las etiquetas que no existen) y al copiar; con el
selector de proyecto se quedan las etiquetas que existen en el otro. En el móvil (390 px): «Crear varias tareas» con JSON pegado ofrece importarlas, el diálogo
cabe, la barra de selección tiene «Exportar»; en «Nueva tarea», zona de toque de 40 px en los chips de tipo, el «+» de
subtareas y las muestras de color, y la flecha propia de los desplegables a 6 px del borde. En inglés y en modo oscuro. De otros Kanban (`PART=otros`): un tablero de
Trello por «Desde un fichero» («Formato detectado: Trello (tablero)», avisos de la archivada y del comentario, lista →
columna por nombre o la primera, checklist → subtareas, etiqueta nueva, responsable por nombre), un CSV de Jira guardado
en Windows-1252 (eñes bien leídas, dos columnas «Labels» juntas, referencia en la descripción) y una tarjeta de Trello
pegada en «Nueva tarea». Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node importar-exportar-e2e.mjs   # PART=importar,exportar,nueva,pegar,extras,movil,ingles,oscuro,otros
```

## Calendario

### Tareas que se repiten

«Repetir» en *Nueva tarea* (junto a la fecha límite; el día sigue a la fecha mientras no se elija a mano; se guarda al
crear), las apariciones futuras previstas en el calendario (tenues, con borde discontinuo e icono de repetir, abren la
tarea original; ninguna hoy ni antes, ni de una tarea repetida sin fecha límite; un mes dos años después), la serie con
`RRULE` en la suscripción `.ics` y en el `.ics` de una columna Agenda, y lo mismo a 390 px. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node calendario-repetir-e2e.mjs   # PART=new,cal,ics,mobile
```

## Releases

### Release grande, «+» flotante con el programa lleno y panel de fijas en el móvil (caza de bugs 51c)

Con más de 500 tareas marcadas, «Generar release» se desactiva con su motivo, también en inglés (antes salía el error de
zod en inglés, «Too big: expected array…»); con más de 200 tareas con adjuntos lo hacen «Marcar como desplegado» y
«Descargar adjuntos», y al quitar una se puede seguir. En el móvil, con la columna «Programa del curso» a 100 sesiones el
«+» flotante se ve desactivado, como el de la cabecera, y al tocarlo dice por qué sin abrir «Nueva tarea»; en otra columna
o al bajar de 100 vuelve a abrirla. Y el «+» flotante y «Crear varias tareas» ya no tapan la barra «Siempre en la release»
/ «Siempre en el plan» ni las filas del panel abierto (a 390 y 360 px), mientras que una columna sin panel sigue llegando
hasta abajo y en tableta las columnas miden lo mismo. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node releases-grandes-e2e.mjs   # PART=release,adjuntos,flotante,panel
```

## Plan de trabajo para IA

### Plan de trabajo para IA y botones de las columnas especiales (ronda 51)

Un proyecto propio con una columna de cada rol especial: todas muestran su botón de acción (*Generar Release*, *Generar
plan de trabajo*, *Publicar programa (PDF)*, *PDF de la semana*, *Ver lista*…) con el mismo aspecto en claro, en oscuro y
en el móvil. En la columna «Plan de trabajo para IA»: el panel «Siempre en el plan», el diálogo en dos pasos (las fijas
con su cadencia, cabecera y pie de serie para Claude Code), el texto generado (contexto, tareas en orden con tipo,
prioridad, etiquetas, fechas, dependencia, subtareas, enlaces y adjuntos), *Copiar todo*, `.md` y `.txt` con su nombre,
quitar el pie, cerrar con cambios, *Guardar en Documentación* («Plan de trabajo – fecha_v1.md», con el texto editado y
*Abrir Documentación*), la versión siguiente moviendo las tareas a otra columna (las fijas no), las plantillas de la
persona y del proyecto, el editor con barra, añadir y quitar fijas, el rol en el menú (se repite y, al quitarlo, sus fijas
pasan a normales), las plantillas en *Mi perfil* y en los ajustes del proyecto, el ejemplo «Preparación de un curso» y
todo en inglés a 390 px en modo oscuro (versión siguiente a una importada). Borra su proyecto al terminar. Misma base y
servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node plan-ia-e2e.mjs   # PART=buttons,plan,move,tpl,rich,fixed,role,settings,curso,en
```

### Plan de trabajo: adjuntos, ritmo por columna, columnas vacías y enlaces del pie (ronda 52)

El paso 2 del plan ofrece «Descargar adjuntos (n)»: un ZIP con los adjuntos de las tareas del plan, en una carpeta por tarea
(`adjuntos/03-titulo-de-la-tarea/plano.webp`; con la app en inglés, `attachments/03-task-title/…`, parte `en`), por la misma ruta, con los mismos topes y permisos que el de la release; el
texto cita cada adjunto por su ruta en el ZIP (también la imagen pegada en la descripción) y por su enlace a Pizarro, y a
Documentación solo va el .md. Las tareas fijas «cada dos» o «cada tres» cuentan los planes guardados en su columna (no los
del proyecto), mientras el `_vN` del documento sigue siendo del proyecto. «Publicar programa», «Exportar a calendario»,
«Resumen para el cliente», «Ver lista», «Resumen de presupuesto» y «PDF de la semana» se desactivan sin tarjetas (en el botón
y en el menú de la columna; el .ics, sin fechas límite, y la lista, sin subtareas, también). Con el texto del paso 2 cambiado,
un enlace del pie («tus plantillas») pide confirmar como cerrar. Necesita que el servidor y el script compartan `UPLOAD_DIR`
(por defecto `../uploads`, donde escribe los ficheros de los adjuntos). Borra su proyecto al terminar. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node plan-ia-zip-e2e.mjs   # PART=zip,en,ritmo,vacias,salir
```

### Plan de trabajo para IA: Markdown, fijas entre paneles, título y límite (caza de bugs 51a)

El plan generado con descripciones raras: un bloque de código sin cerrar se cierra tras su última línea (antes se tragaba
las tareas siguientes y el pie), ``` dentro de un bloque de ```` queda tal cual, un título setext («Notas» subrayado con
---) pasa a ##### y se conservan los saltos de línea forzados y las tablas; una tarea fija arrastrada del panel «Siempre
en el plan» de una columna al de otra (o desde «Siempre en la release») pasa allí como fija y se deshace con Ctrl+Z; a
390 px el título de «Generar plan de trabajo» y de «Generar release» conserva el icono y recorta el paso con «…»; y con
más de 500 tareas marcadas «Generar» se desactiva con su motivo. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node plan-ia-markdown-e2e.mjs   # PART=markdown,fijas,titulo,limite
```

## Plantillas y programa del curso

### Aplicar plantilla a un proyecto existente (ronda 50)

En un proyecto privado propio (lo crea y lo borra la suite), *Ajustes del proyecto → Tablero → Aplicar plantilla*:
«Añadir lo que falte» enseña antes qué columnas, tipos y etiquetas se añadirán, no toca lo que hay y «Deshacer el cambio
de plantilla» lo quita; «Cambiar a esta plantilla» propone el emparejamiento (por nombre y rol; una columna con tareas
sin pareja se conserva, una vacía se propone quitar; una con tareas no tiene «Quitar»), el resumen cuenta las tareas que
se mueven y lo que se añade o se quita, al aplicar no se pierde ninguna tarea y otra persona con el tablero abierto ve
las columnas nuevas sin recargar (y el deshacer, igual); en un proyecto de equipo un miembro sin rol de admin no ve la
sección; a 390 px el asistente cabe. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node plantillas-aplicar-e2e.mjs   # PART=add,replace,perm,mobile
```

Segunda vuelta: en el paso 1, el nombre de cada plantilla elegida (generales y de la instalación, con «Curso o máster»)
tiene contraste suficiente (≥ 4,5) sobre su fondo en modo oscuro y en claro, con un control que comprueba que el estilo
antiguo sí fallaba; las tarjetas de opción elegidas de *Mi perfil → Preferencias* también se leen en oscuro; el resumen
de «Cambiar a esta plantilla» dice «3 tareas fijas pasarán a ser normales» (con sus títulos) solo si su columna deja de
ser la de release; «Añadir lo que falte» dice antes y en el resumen que vuelve a mostrar el tipo general oculto que usa la
plantilla, lo muestra y el deshacer lo vuelve a ocultar; y tras 5 cambios de plantilla en un proyecto en 10 minutos, el
sexto avisa («Este proyecto ya ha cambiado de plantilla 5 veces…») y no cambia nada. La sesión de administrador se abre
como miembro y pasa a admin (como en el tablero). Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node plantillas-aplicar-opciones-e2e.mjs   # PART=estilo,fijas,generales,limite
```

Límite de «Aplicar plantilla» (en la memoria del servidor): 5 cambios (aplicar o deshacer) por proyecto cada 10 minutos
y 20 por persona y hora. Las tres suites de plantillas crean un proyecto con id nuevo en cada escenario, así que se
pueden repetir seguidas; el administrador gasta unos 8 cambios por pasada de las tres (`plantillas-aplicar`: 4,
`plantillas-aplicar-columnas`: 2, `plantillas-aplicar-opciones`: 2; el límite de esta última lo gasta la segunda persona). Si tras más de dos pasadas en una hora una falla con «Ya has aplicado o
deshecho 20 plantillas…», reinicia el servidor.

### Aplicar plantilla: paso 2 y archivadas de columnas unidas (caza de bugs 50a)

En el paso 2 de «Cambiar a esta plantilla», un tipo general sin tareas que la plantilla oculta dice «Ocultar (la
plantilla no lo usa)» y uno oculto con tareas, «Conservar (volverá a verse)», igual que el resumen del paso 3 (en español
y en inglés, a 390 px y en modo oscuro); y una tarea archivada de una columna que el cambio une a otra sale en
«Archivadas» como de esa columna y vuelve a ella al recuperarla. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node plantillas-aplicar-columnas-e2e.mjs   # PART=paso2,en,archivada
```

### Plantilla «Curso o máster» y «Publicar programa (PDF)»

Crea un proyecto con la plantilla desde *Nuevo proyecto* (la sesión se abre como miembro y pasa a admin, como en el
tablero), comprueba sus columnas (con «Programa», rol *Programa del curso*), tipos y campo *Fecha de inicio*; crea dos
sesiones con el tipo «Sesión» (título y descripción automáticos, fecha y responsable) y otra de varios días con Markdown;
publica el programa con el responsable, lo descarga y comprueba su texto con `pdftotext` (orden, fechas, rango, Markdown
pintado, sin la archivada), la copia «Programa – fecha_v1.pdf» (versión 1) en Documentación y «Abrir Documentación»; la vista previa no
guarda; el PDF en inglés sin guardar; con la Documentación llena (200 documentos) se descarga igual y avisa; y el rol en el
menú de la columna con su icono y su explicación (se puede repetir y quitar). Borra su proyecto al terminar. Necesita
`pdftotext` (poppler-utils). Genera cuatro PDF con la misma persona: el límite es de cinco por minuto, así que entre dos
pasadas seguidas espera un minuto. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node plantillas-curso-e2e.mjs   # PART=tpl,pdf,en,full,role
```

### «Programa del curso»: versiones del PDF y tope de 100 sesiones (ronda 51)

Versiones: cada «Publicar» con la casilla de Documentación marcada guarda «Programa – fecha_vN.pdf» como documento nuevo
(no sustituye al anterior); el diálogo dice «(versión N del programa)»; borrada para siempre la 2, la siguiente es la 3;
sin guardar no gasta número. Tope: el contador de la columna dice «99/100»; se crea la 100 con «+», que queda desactivado
con su motivo; arrastrar una tarjeta de otra columna y «Mover a…» a la columna llena avisan («La columna «Programa» admite
como mucho 100 sesiones.») y no mueven nada; con 103 por datos antiguos, el diálogo avisa antes y después de publicar y la
vista previa lleva `X-Pizarro-Program-Omitted: 3`; el rol no se da a una columna con 101 tarjetas; y los textos en inglés a
390 px. Crea y borra su propio proyecto privado. Genera cuatro PDF con el admin y tres con la segunda persona (límite: cinco
por minuto y persona): después de `plantillas-curso-e2e.mjs` (cuatro con el admin), espera un minuto. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node plantillas-programa-e2e.mjs   # PART=version,limite,pdf,rol,en
```

## Documentación y formatos del material

### Formatos del material de un curso (ronda 50)

«Generar release» con el texto del paso 2 cambiado pide confirmación al cerrar con Escape, la X o el clic fuera
(«Seguir editando» conserva lo escrito; varias pulsaciones no apilan preguntas; «Descartar cambios» cierra), en los dos
modos del editor; sin cambios, o tras cambiar solo el pie, cierra directo, igual que «Cancelar» en el paso 1. Con la
barra de formato, los párrafos vacíos salen como una línea en blanco (sin `&nbsp;` ni líneas en blanco repetidas) en
Copiar todo, .md, .txt y lo guardado al desplegar; lo no tocado, idéntico. El historial copia y descarga sin `&nbsp;`
una release antigua que lo traía, y «Copiar descripción» tampoco lo deja. Google Slides en la tarjeta (enlace con su
icono, «Nuevo Slides», aviso sin cuenta conectada, `@slides` y `@google` en los dos editores, móvil a 390 px y «Mi
perfil»). Documentación y adjuntos con `.md`, `.pdf`, `.html`, `.docx` y `.pptx`: el HTML se ve en un marco aislado
(sin scripts, origen opaco, sin red ni acceso a la página o al almacenamiento de la app), su dirección lo sirve como
texto plano y como adjunto al descargarlo; un `.html` con `<script>` (y `onerror`, `javascript:`, `<iframe>`, meta
refresh) no ejecuta nada en el origen de la app. La parte `slides` necesita el servidor con Google configurado (valores
de prueba, no llama a Google): arráncalo con `GOOGLE_CLIENT_ID=r50 GOOGLE_CLIENT_SECRET=r50`. Misma base:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node documentacion-formatos-e2e.mjs   # PART=relclose,nbsp,slides,html
```

### Enlaces entre HTML y codificaciones en Documentación (ronda 52)

Dos HTML de la misma Documentación enlazados entre sí (`./Tema2.HTML#apartado`, `tema%20tres.html`): el enlace abre el otro
documento en el visor de la app (pestaña nueva, el marco sigue sin permisos) y lleva al apartado; la vuelta funciona igual;
un enlace a un fichero que no está, o que solo existe en otro proyecto (aunque se llame igual), queda desactivado con su
title y no abre nada; un documento en la papelera no se enlaza. Y ficheros HTML, texto y Markdown en Latin-1, Windows-1252
(con o sin `<meta charset>`), UTF-16 LE/BE y UTF-8 con BOM que se ven con tildes y ñ, con la descarga tal cual. Misma base
y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node documentacion-enlaces-e2e.mjs   # PART=enlaces,codificacion
```

### Enlaces de un HTML a sí mismo, binarios con BOM y borrador sin red (caza de bugs 52)

En un HTML de Documentación, un enlace al propio documento por su nombre («indice.html#abajo» dentro de indice.html, o
«./INDICE.HTML») se desplaza dentro del marco (antes abría una pestaña nueva con el mismo documento en cada clic); un enlace
sin ruta («», «?v=2#abajo») es el propio documento y no sale desactivado; «a%20%20b.html» encuentra «a b.html» (los espacios
seguidos se juntan al subir) y un nombre con tildes descompuestas (NFD, el de macOS) encuentra el suyo. Un binario que
empieza por FF FE o FE FF (el BOM de UTF-16) se sube como fichero para descargar y no como texto, el UTF-16 de verdad se
sigue viendo y un HTML con `<meta charset="unicode">` sin BOM se ve con sus tildes. Y archivar o borrar desde el detalle
sin red con la descripción a medio escribir: la tarjeta vuelve y, al abrirla otra vez, lo escrito sigue ahí y se puede
guardar (antes se perdía). Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node documentacion-enlaces-bom-e2e.mjs   # PART=enlaces,binario,borrador
```

### Índice de un HTML y baja con Google sin email (caza de bugs 50b)

Un documento HTML de *Documentación* con índice: «Ir al tema 2» (`#tema-2`), «#» y un enlace interno dentro de un SVG
se desplazan dentro del marco aislado, que sigue en el documento (antes cargaba en el marco la página de la app y quedaba
un error), y lo que se pinta no lleva `ping`. *Borrar mi cuenta* de quien entra con Google en un servidor sin envío de
emails: «Entro con Google y no conozco mi contraseña» explica solo «Confírmalo volviendo a entrar con Google.» (sin
hablar de un código por email ni pedirlo), en español y en inglés a 390 px en modo oscuro; el enlace lleva a Google con la
marca de la baja (sin seguir la redirección); la vuelta de Google se simula en la base, como en test:db; se borra la
cuenta y su proyecto privado pasa a ser de equipo, y un administrador lo ve en *Proyectos* y *Administración → Proyectos*
y lo abre. Misma base; servidor con Google configurado (valores de prueba, no llama a Google) y **sin** email:
`GOOGLE_CLIENT_ID=r50 GOOGLE_CLIENT_SECRET=r50`, sin `MAIL_OUTBOX_DIR` ni SMTP.

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node documentacion-indice-e2e.mjs   # PART=anchor,googleonly
```

## Cuentas

### Borrar mi cuenta

*Mi perfil → Cuenta → Borrar mi cuenta*: el único administrador ve el botón desactivado y el motivo; el diálogo pide
contraseña y la palabra BORRAR y avisa, con su lista, de que el proyecto privado propio pasa a ser de equipo (casilla
«Borrar también…» sin marcar); con la contraseña incorrecta no se borra; al borrar se va al acceso con el aviso, se
cierran sus dos sesiones, el proyecto queda de equipo y sin miembros (anotado en el registro) y lo que creó queda como
«Usuario eliminado». En móvil (390 px) activa la verificación en dos pasos desde el perfil y borra con el código de la
app (el diálogo cabe en la pantalla). Quien entra con Google sin contraseña conocida pulsa «Entro con Google y no conozco
mi contraseña», confirma solo con el código de su app y borra también sus dos proyectos privados. *Administración →
Usuarios → Borrar*: el aviso (sin el nombre del proyecto), sin marcar pasa a ser de equipo y marcando se borra. Crea sus
propias personas (`r49_*`). Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node cuentas-borrar-e2e.mjs   # PART=block,desk,mobile,google,admin
```

### Lo que queda al borrar una cuenta (ronda 51)

*Volver a entrar con Google* para borrar la cuenta (en español y en inglés a 390 px): el diálogo avisa de que Google
pedirá la contraseña; el enlace lleva a Google con `prompt=login` y `max_age=0` (sin seguir la redirección) y la cookie del
acceso lleva la hora de inicio y la marca de la baja; la vuelta sin contraseña nueva se simula con `?delete=google_stale`
(la comprobación de `auth_time` con un id_token firmado está en test:db): «Google no te ha pedido la contraseña…», sin
quedar confirmada. *Iniciar sesión con Google* sigue con `prompt=select_account`. Al borrarse una cuenta con un proyecto
privado, los dos administradores activos reciben un aviso cada uno (el proyecto borrado con la casilla, ninguno): en la
campana, en español y en inglés, y al pulsarlo se abre el proyecto con su selector, su navegación y su título; en el
móvil, el menú del título lo marca «Not in your projects» y lo añade a su lista. Un administrador que abre un proyecto de
equipo que no está en su lista por enlace (ya en el HTML) o desde *Proyectos existentes* (navegación de la app) lo ve en
el selector marcado «No está en tus proyectos», con la navegación del proyecto; «Añadir a mis proyectos» lo añade (y
solo ese); en el calendario deja de mostrarse. Un miembro sin acceso recibe 404 y no lo ve. Crea sus propias personas y
proyectos (`r51c_*`). Misma base; servidor como el de `documentacion-indice` (Google con valores de prueba, sin email):

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node cuentas-borrar-restos-e2e.mjs   # PART=google,notice,outside,member
```

## Interfaz y textos

### Carga de proyecto y «Adjuntos y límites» (ronda 49)

El indicador de carga de las páginas de proyecto (respuestas lentas simuladas: desde la ronda 51, el esqueleto del
tablero, con cuatro columnas con su cabecera, aparece pasados ~200 ms, la región viva dice «Cargando…», ocupa el hueco de
la página sin mover la barra lateral, Releases y Documentación tienen el suyo, y con movimiento reducido no brilla) y los botones de limpieza de *Ajustes del proyecto → Adjuntos y límites*: desactivados y
con la tarjeta atenuada sin nada que borrar (también según el filtro de antigüedad), activos con ficheros, y la nota «i».
Crea y borra su propio proyecto privado. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node interfaz-carga-e2e.mjs   # PART=load,storage
```

### Esqueletos de carga, icono de la app, HTML sin `<link>` y copias con segundos (ronda 51)

- `skeleton`: al ir al tablero con la respuesta lenta, su esqueleto (cuatro columnas con la forma de su cabecera, la
  cabecera del tablero, brillo; huesos claros en claro y oscuros en oscuro); Releases, Documentación y Ajustes con el
  suyo; en una carga rápida no llega a verse; en móvil, una sola columna, la barra de pestañas y nada se sale.
- `icon`: *Administración → Ajustes → Icono de la app*: el color elegido llega al manifiesto (pedido sin sesión), al
  favicon, al apple-touch-icon y a la pantalla de acceso; los PNG miden lo que dicen y son del color del tema; el nombre
  bajo el icono es el de la organización. Deja la instalación como estaba.
- `html`: un HTML con `dns-prefetch`, `preconnect`, `prefetch`, `prerender`, `modulepreload`, `preload`, hoja de estilo e
  icono (también en mayúsculas, en el cuerpo y dentro de un SVG) se ve sin ningún `<link>` y sin pedir nada a esas
  direcciones.
- `backups`: con un `status.json` de prueba, el aviso de reducción dice la hora de las copias con segundos y sus nombres;
  si llega otra copia (del mismo minuto) antes de confirmar, dice cuál era y cuál es. Necesita el servidor con
  `BACKUP_KEY` (y `BACKUP_PAUSE=1`); sin ella se salta con una nota. Deja el `status.json` que hubiera.

Crea y borra su propio proyecto privado. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node interfaz-esqueletos-e2e.mjs   # PART=skeleton,icon,html,backups
```

### Detalle de tarea al instante, flechas en opciones e iconos de la raíz (ronda 52)

- `optimista`: con las acciones del servidor 3 s más lentas, archivar y borrar desde el detalle cierran el diálogo y quitan
  la tarjeta al momento (el servidor termina después; Deshacer la devuelve); sin red (`setOffline`) la tarjeta vuelve a su
  sitio, sale «Sin conexión» y nada se guarda.
- `columna`: dos cambios de columna seguidos desde el detalle con respuestas lentas: la tarjeta queda en la última (turnos por
  tarjeta, como Alt+flechas).
- `flechas`: «Icono de la app» (Administración) y «Tema de color» (Mi perfil): una sola parada de Tab, flechas en las cuatro
  direcciones (eligen y guardan), vuelta de extremo a extremo, Inicio y Fin; también el selector de idioma. En el icono, con
  las flechas se guarda una sola vez al parar (~300 ms), o antes si el foco sale del grupo o se navega a otra pantalla; un
  clic guarda en el acto (se cuenta por las líneas `settings.saveAppIcon` del registro, que tarda unos segundos en escribirse).
- `iconos`: `/favicon.ico`, `/apple-touch-icon.png`, `/icon.png` y `/icon.svg` en el color de la instalación (azul sin
  ajuste), con caché corta, ETag y 304 con `If-None-Match`; nombre corto del manifiesto y título de iPhone de 12 caracteres como mucho. La caché de ajustes
  del servidor dura 30 s, así que esta parte puede tardar unos segundos en cada cambio.

Restaura lo que toca (rol, tema, icono y nombre de la organización). Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node interfaz-detalle-iconos-e2e.mjs   # PART=optimista,columna,flechas,iconos
```

### Textos breves, notas «i» y botones sin efecto (ronda 49)

Fuera de *Ajustes del proyecto*: en *Administración → Usuarios* la descripción es de una línea y el «por qué» sale en la
nota «i» (se abre al pulsar y se cierra con Escape); una nota dentro de un diálogo (borrar un usuario) se cierra con Escape
sin cerrar el diálogo. Botones desactivados cuando no harían nada: «Limpiar» en *Logs* sin filtros, «Guardar» las cuotas
de *Ajustes → Almacenamiento*, «Guardar» el nombre y «Guardar avisos» de *Mi perfil* sin cambios, «Cambiar contraseña» sin
rellenar, «Partir del texto por defecto» con ese texto ya puesto y «Todas»/«Ninguna» al generar una release. La nota cabe
a 390 px. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node interfaz-textos-e2e.mjs   # PART=admin,profile,release
```

### Auditoría de escritorio y móvil (ronda 56)

`interfaz-auditoria-e2e.mjs`. **hyd**: recorre las páginas principales (tablero, detalle con `?task=`, releases, documentación, las
pestañas de Ajustes del proyecto y de Mi perfil, Mis tareas, calendario, avisos, historial y todas las de Administración)
como administrador, en escritorio y a 393 px, con el navegador en Europe/Madrid y es-ES o en America/New_York y en-US (el
servidor, en UTC), y con un proxy delante que cambia cada email del HTML por un enlace «[email protected]» (lo que hace la
«Email Address Obfuscation» de Cloudflare): falla con cualquier error de hidratación de React (#418 y compañía). También
el acceso y las páginas legales sin sesión. **tabs**: `?tab=plantillas` y `?tab=Board` llevan a su pestaña (la dirección
pasa al id en el cliente, y `?tab=board#labels` conserva el ancla), una desconocida abre la primera con un aviso y una de gestión, para quien no gestiona, dice por qué; igual
en Mi perfil. **informe**: un miembro ve las personas por su nombre, ni el email de otra ni el externo entero (sale
enmascarado) y sin «Otra dirección…»; guarda eligiendo a otra persona y un administrador pone una dirección externa.
**cal**: «1 vencida de antes de este mes» con su enlace; una vencida del mes lleva el mismo rojo que «Mis tareas»; a
393 px, con vencidas de antes el aviso queda a la vista y «Ir a hoy» deja hoy arriba; sin ellas, el mes actual se abre
con hoy arriba. **mis**: «1 tarea»/«2 tareas en todos tus proyectos.», una tarea roja de
«Más adelante» sin marca de vencida (su color, en un punto) y la vencida con el borde rojo. **movil**: en Usuarios a
393 px el nombre y el email tienen sitio, las acciones están en «⋯» (y abren su diálogo) y en el escritorio siguen los
iconos; en las pestañas de Administración, el indicador de que hay más a la derecha (y a la izquierda al final); el pie
del menú lateral se ve entero. **tema**: con el sistema claro y Pizarro oscuro, theme-color oscuro, y cambia al momento
al elegir otro tema. **a11y**: «Ver como lista» con aria-pressed y el mismo nombre; «Avisos» dice cuántos hay sin leer;
con «Nueva tarea» abierta el resto queda inert (fuera del árbol de accesibilidad de Chromium) salvo los avisos
emergentes, con la confirmación de descartar encima también «Nueva tarea», y al cerrarla vuelve con el foco dentro; axe
sin botones ni enlaces sin nombre; «Abrir menú» con aria-expanded.

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node interfaz-auditoria-e2e.mjs   # PART=hyd,tabs,informe,cal,mis,movil,tema,a11y
```

## Accesibilidad

### Arreglos pequeños de la caza 52 (segunda tanda)

«Reintentar» tras un ZIP de adjuntos cambiado a mitad de descarga vuelve a poner «Descargar adjuntos» desactivado y con el
indicador de carga. Un enlace `?doc=` a un documento de la papelera avisa «Ese documento está en la papelera» y uno
inexistente (o de otro proyecto, sin revelar nada) «Ese documento ya no está en la Documentación». Los botones de las
columnas especiales sin tarjetas (y sus opciones de menú) usan `aria-disabled` y, al tocarlos, muestran su motivo como
aviso. Cada opción de «Cómo se envían los emails» se nombra por su título (`aria-labelledby`) y su descripción va en
`aria-describedby`. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3276 DATABASE_URL=$DBURL node accesibilidad-columnas-e2e.mjs   # PART=zip,doc,columnas,mail
```

### Arreglos de la caza 54

En el histórico de releases, la descripción de cada tarea (y la línea de adjuntos) va en su párrafo debajo del punto, y
una release guardada con el texto antiguo se sigue viendo; el título es un `<h2>` con el botón dentro (la cabecera entera
sigue abriéndola) y, sin portapapeles, «No se pudo copiar» sale como error. En el móvil, «Archivadas» del menú lateral lo
cierra. En el calendario, «Proyectos» y «Persona» se llaman «Proyectos: <lo elegido>» (axe sin
`label-content-name-mismatch`) y al cerrar «+N más» con Escape o «Cerrar» el foco vuelve al botón que lo abrió (con clic
fuera, no). En «Aplicar plantilla», el rol de la columna de destino va tras « · ». Un enlace de un HTML a
`guia.md#instalacion-rapida` (o con tildes) abre el Markdown en ese apartado. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node accesibilidad-releases-e2e.mjs   # PART=release,menu,cal,plantilla,md
```

## Red, sin conexión y formularios

### Formularios sin red, IP del cliente y páginas legales (ronda 49)

Crear un usuario en *Administración → Usuarios* y guardar *Mi perfil* sin red (`context.setOffline`): sale «Sin conexión:
no se ha guardado» y el aviso fijo, nunca «Algo ha fallado», y lo escrito sigue en el formulario; al volver la red se
guarda. Deshacer «Enviar a la papelera» de un documento sin red. Con el servidor sin `TRUST_PROXY` (`npm start` o `next
start`), unas cabeceras `X-Real-IP` / `X-Forwarded-For` inventadas no llegan a la sesión ni al registro. Privacidad,
condiciones y licencia llegan pintadas sin JavaScript. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node red-formularios-e2e.mjs   # PART=admin,profile,docs,ip,legal
```

### Sin conexión, pestañas y tareas que desaparecen (caza de bugs 48b)

Sin red y con el servidor caído la página no se cambia por la de error del navegador y lo escrito se conserva (avisos
«Sin conexión» y «Conexión recuperada»); 8 pestañas por HTTP/1.1 (se simula cuál está delante: las ocultas cierran su
canal en vivo); la tarea abierta que otra persona borra o archiva (aviso con su nombre, «Copiar tu texto», no se reabre
al deshacer); cerrar el detalle tras un guardado fallido del título; «Nueva tarea» con la columna borrada; `?task=` al
cerrar y enlaces a tareas que no están; sin red, los diálogos cargados aparte (Archivadas, Varias tareas, Generar
release) esperan a la red sin recargar la página y, ya precargados, se abren sin red; el detalle, su historial y
Archivadas abiertos sin red se cargan al volver; conflictos del texto campo a campo (otra persona cambia la descripción:
el título se guarda y el detalle muestra la descripción nueva; el mismo campo sí es un conflicto); el foco tras Escape
en la descripción y el nombre accesible de los campos del detalle. Partes sueltas con `PART=lazy,detail,…` (ver la
cabecera del script). Misma base y servidor (por HTTP, sin TLS). Es la que más inicios de sesión hace: lánzala con el
servidor recién arrancado.

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node red-sin-conexion-e2e.mjs
```

## Nombres antiguos

Hasta la v1.59.0 las suites se nombraban por la ronda o la caza de bugs en que se escribieron. Se renombraron sin
tocar sus comprobaciones (`git log --follow e2e/<nuevo>.mjs` sigue su historia):

| Antes | Ahora |
|---|---|
| `bh48a-e2e.mjs` | `tablero-cabecera-e2e.mjs` |
| `bh48b-e2e.mjs` | `red-sin-conexion-e2e.mjs` |
| `bh48c-e2e.mjs` | `detalle-comentarios-e2e.mjs` |
| `bh49-e2e.mjs` | `copias-imagen-sin-red-e2e.mjs` |
| `bh50a-e2e.mjs` | `plantillas-aplicar-columnas-e2e.mjs` |
| `bh50b-e2e.mjs` | `documentacion-indice-e2e.mjs` |
| `bh51a-e2e.mjs` | `plan-ia-markdown-e2e.mjs` |
| `bh51b-e2e.mjs` | `tablero-teclado-e2e.mjs` |
| `bh51c-e2e.mjs` | `releases-grandes-e2e.mjs` |
| `bh52-e2e.mjs` | `documentacion-enlaces-bom-e2e.mjs` |
| `bh52b-e2e.mjs` | `accesibilidad-columnas-e2e.mjs` |
| `bh53-e2e.mjs` | `importar-pegar-foco-e2e.mjs` |
| `bh54-e2e.mjs` | `accesibilidad-releases-e2e.mjs` |
| `r49-account-e2e.mjs` | `cuentas-borrar-e2e.mjs` |
| `r49-copy-e2e.mjs` | `copias-adjuntos-e2e.mjs` |
| `r49-infra-e2e.mjs` | `red-formularios-e2e.mjs` |
| `r49-repeat-e2e.mjs` | `calendario-repetir-e2e.mjs` |
| `r49-textos-e2e.mjs` | `interfaz-textos-e2e.mjs` |
| `r49-ui-e2e.mjs` | `interfaz-carga-e2e.mjs` |
| `r50-curso-e2e.mjs` | `plantillas-curso-e2e.mjs` |
| `r50-formatos-e2e.mjs` | `documentacion-formatos-e2e.mjs` |
| `r50-plantilla-e2e.mjs` | `plantillas-aplicar-e2e.mjs` |
| `r50-seleccion-e2e.mjs` | `tablero-seleccion-e2e.mjs` |
| `r51-cuenta-e2e.mjs` | `cuentas-borrar-restos-e2e.mjs` |
| `r51-plan-e2e.mjs` | `plan-ia-e2e.mjs` |
| `r51-plantilla-e2e.mjs` | `plantillas-aplicar-opciones-e2e.mjs` |
| `r51-programa-e2e.mjs` | `plantillas-programa-e2e.mjs` |
| `r51-ui-e2e.mjs` | `interfaz-esqueletos-e2e.mjs` |
| `r52-html-e2e.mjs` | `documentacion-enlaces-e2e.mjs` |
| `r52-plan-e2e.mjs` | `plan-ia-zip-e2e.mjs` |
| `r52-ui-e2e.mjs` | `interfaz-detalle-iconos-e2e.mjs` |
| `r53-json-e2e.mjs` | `importar-json-detalle-e2e.mjs` |
| `r54-import-e2e.mjs` | `importar-exportar-e2e.mjs` |
| `r55-tablero-e2e.mjs` | `tablero-fijas-e2e.mjs` |
