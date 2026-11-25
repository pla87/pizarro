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

Qué prueba cada suite y cómo se lanza por separado: [`e2e/SUITES.md`](SUITES.md), con los mismos grupos y títulos que
esta tabla (cada grupo de la tabla enlaza a su sección). Las cifras solo se apuntan en esta tabla.

| Suite | Script | Comprobaciones | Tiempo |
|---|---|---|---|
| [**Generales**](SUITES.md#generales) | | **449** | |
| QA (9 escenarios) | `e2e/qa/run-all.mjs` | 394 | ~5 min |
| Instalación desde cero con `npm start` | `e2e/install-e2e.mjs` | 55 | ~1 min |
| [**Tablero**](SUITES.md#tablero) | | **925** | |
| Tablero | `e2e/tablero-e2e.mjs` | 374 | ~4 min |
| Cabecera y atajos (caza de bugs 48a; ronda 57: un selector de proyecto, botones agrupados, último tipo con su automatización) | `e2e/tablero-cabecera-e2e.mjs` | 132 | ~1,5 min |
| Mover con el teclado varias veces seguidas (caza de bugs 51b) | `e2e/tablero-teclado-e2e.mjs` | 34 | ~20 s |
| Arrastrar una selección (montón, teclado, dedo, tiempo real) | `e2e/tablero-seleccion-e2e.mjs` | 76 | ~1 min |
| Panel de tareas fijas: sin scroll de más al abrirlo, copia con Ctrl que nace fija en el panel (release y plan), arrastres con Ctrl entre la lista llena y el panel sin «Algo ha fallado», foco con el teclado, copia provisional con la red lenta (ronda 55) y fija arrastrada del panel de un plan al de otro (caza de bugs 51a) | `e2e/tablero-fijas-e2e.mjs` | 84 | ~1,5 min |
| Canal en vivo con `ping` y presencia sin sondeos (dos personas), panel de filtros estable, «Ninguna tarjeta coincide» y release con filtro, lupa, columnas y pestañas en el móvil, botones flotantes y diálogos (ronda 65: copia del botón de informar y «Nueva tarea» entera con la pareja), CLS, Alt+P y rueda sobre el detalle (ronda 56) | `e2e/tablero-vivo-e2e.mjs` | 119 (123 con build oficial) | ~1,5 min |
| «Compartir → Pizarro»: share_target del manifiesto, POST del navegador con texto, enlace y archivos → «Nueva tarea» en el último proyecto, formulario de otra web rechazado, sin sesión y otro proyecto elegido en el selector (ronda 57) | `e2e/tablero-compartir-e2e.mjs` | 19 | ~30 s |
| Columna «Asignación a persona»: rol y persona con plazo, lo que entra (crear, detalle, «Mover a…», Alt+→, Ctrl+Z), cambiar plazo o persona, «Descargar plan (PDF)» (PDF descargado con su aviso, ocupado, 429 y contenido), tipo por defecto, «Sin rol», 390 px e inglés (ronda 64) | `e2e/tablero-asignacion-e2e.mjs` | 85 | ~1 min |
| [**Detalle de la tarea**](SUITES.md#detalle-de-la-tarea) | | **56** | |
| Comentarios a la vez, editar el propio comentario y red lenta (caza de bugs 48c, ronda 57) | `e2e/detalle-comentarios-e2e.mjs` | 56 | ~1 min |
| [**Copias de tareas**](SUITES.md#copias-de-tareas) | | **120** | |
| Copias con adjuntos y release con barra de formato | `e2e/copias-adjuntos-e2e.mjs` | 93 | ~2 min |
| Copia con imagen en la descripción, sin red en calendario, borradores y releases (caza de bugs 49) | `e2e/copias-imagen-sin-red-e2e.mjs` | 27 | ~1 min |
| [**Pegar, importar y exportar**](SUITES.md#pegar-importar-y-exportar) | | **352** | |
| Pegar | `e2e/pegar-e2e.mjs` | 72 | ~1 min |
| Copiar y pegar una tarea como JSON desde el detalle: Ctrl+C sin selección y con texto seleccionado, Ctrl+V estricto fuera y dentro de un campo, deshacer, «Importar tarea» (portapapeles tolerante, fichero, a mano), JSON de una IA, móvil (copiar e importar juntos en «⋯») e inglés (rondas 53 y 54) | `e2e/importar-json-detalle-e2e.mjs` | 100 | ~1,5 min |
| Importar y exportar tareas en JSON: botón de la cabecera, vista previa y columna de destino, fichero, arrastrar, Ctrl+V en el tablero, «Exportar (N)» y volver a importar, más de 2 MB (sin red, sesión caducada, 413), «Nueva tarea» (Ctrl+V de una tarea copiada con el foco en el título vacío, en un selector, un botón, la fecha, una zona vacía o una caja sin tocar; desde el «+» de una columna; etiquetas, color y enlace al crear, importar y copiar; cambiar de proyecto; editor visual y de Markdown), móvil a 390 px, inglés, oscuro y de otros Kanban: Trello y CSV de Jira (ronda 54) | `e2e/importar-exportar-e2e.mjs` | 155 | ~3 min |
| Pegar la tarea con el foco en una casilla o en la fecha, Ctrl+C con solo una imagen seleccionada, título pegado en una línea, bloqueo entre tareas borradas tras deshacer-rehacer-deshacer y `?doc=…#apartado` mientras se lee el marco (caza de bugs 53) | `e2e/importar-pegar-foco-e2e.mjs` | 25 | ~1 min |
| [**Calendario**](SUITES.md#calendario) | | **42** | |
| Tareas que se repiten (calendario, .ics —una descarga por columna a la vez— y «Nueva tarea») | `e2e/calendario-repetir-e2e.mjs` | 42 | ~1 min |
| [**Releases**](SUITES.md#releases) | | **55** | |
| Release de más de 500 tareas (o 200 con adjuntos), «+» flotante con el programa lleno y panel de fijas en el móvil (caza de bugs 51c) | `e2e/releases-grandes-e2e.mjs` | 55 | ~35 s |
| [**Plan de trabajo para IA**](SUITES.md#plan-de-trabajo-para-ia) | | **257** | |
| Plan de trabajo para IA y botones de las columnas especiales (ronda 51; submenú «Rol de la columna», ronda 57) | `e2e/plan-ia-e2e.mjs` | 146 | ~1 min |
| Plan de trabajo: ZIP de adjuntos (también en inglés, «attachments/»), ritmo por columna, botones con la columna vacía (motivo a la vista, ronda 68) y salir por los enlaces del pie (ronda 52) | `e2e/plan-ia-zip-e2e.mjs` | 105 | ~1 min |
| Plan de trabajo para IA: Markdown con descripciones raras, título a 390 px y más de 500 tareas (caza de bugs 51a) | `e2e/plan-ia-markdown-e2e.mjs` | 18 | ~30 s |
| [**Plantillas y programa del curso**](SUITES.md#plantillas-y-programa-del-curso) | | **185** | |
| Aplicar plantilla a un proyecto existente (ronda 50); opción elegida en oscuro, tareas fijas, generales ocultos y límite (ronda 51); paso 2 y archivadas de columnas unidas (caza de bugs 50a) | `e2e/plantillas-aplicar-e2e.mjs` | 88 | ~1 min |
| Plantilla «Curso o charla» y «Publicar programa (PDF)» | `e2e/plantillas-curso-e2e.mjs` | 59 | ~40 s |
| «Programa del curso»: versiones del PDF y tope de 100 sesiones (ronda 51) | `e2e/plantillas-programa-e2e.mjs` | 38 | ~1 min |
| [**Documentación y formatos del material**](SUITES.md#documentación-y-formatos-del-material) | | **197** | |
| Formatos del material: cerrar la release, párrafos vacíos, Google Slides y HTML aislado (ronda 50) | `e2e/documentacion-formatos-e2e.mjs` | 107 | ~1 min |
| Enlaces dentro de los HTML de Documentación: entre documentos (ida, vuelta, #apartado, inexistente, otro proyecto), al propio documento y con nombres arreglados, e índice (#apartado, también en SVG, sin `ping`); HTML/texto/Markdown en Latin-1, Windows-1252 y UTF-16, UTF-8 con un `<meta>` de 8 bits mal puesto y binarios con BOM de UTF-16 (ronda 52, cazas de bugs 50b y 52) | `e2e/documentacion-enlaces-e2e.mjs` | 90 | ~1,5 min |
| [**Cuentas**](SUITES.md#cuentas) | | **199** | |
| Borrar mi cuenta (escritorio, móvil, Google y Administración) | `e2e/cuentas-borrar-e2e.mjs` | 61 | ~1 min |
| Lo que queda al borrar una cuenta: Google pide la contraseña, aviso a los administradores y proyecto fuera de la lista (ronda 51), y baja con Google en un servidor sin email (caza de bugs 50b) | `e2e/cuentas-borrar-restos-e2e.mjs` | 100 | ~1 min |
| Miembros de un proyecto: asignar administradores, «Invitar por email» y «Copiar enlace» (ronda 59) | `e2e/cuentas-invitar-e2e.mjs` | 38 | ~40 s |
| [**Interfaz y textos**](SUITES.md#interfaz-y-textos) | | **330** | |
| Carga de proyecto y «Adjuntos y límites» (ronda 49) | `e2e/interfaz-carga-e2e.mjs` | 38 | ~1 min |
| Esqueletos de carga, icono de la app, HTML sin `<link>` y copias con segundos (ronda 51) | `e2e/interfaz-esqueletos-e2e.mjs` | 53 | ~1,5 min |
| Archivar/borrar al instante desde el detalle, cambio de columna seguido, flechas en grupos de opciones (y el color pendiente al recargar, con sendBeacon), iconos de la raíz (con ETag y 304) y nombre corto (ronda 52) | `e2e/interfaz-detalle-iconos-e2e.mjs` | 109 | ~1,5 min |
| Textos breves, notas «i» y botones sin efecto (ronda 49) | `e2e/interfaz-textos-e2e.mjs` | 39 | ~1 min |
| Auditoría de escritorio y móvil: sin errores de hidratación (otra zona horaria e idioma, y tras un proxy que reescribe los emails), pestañas con alias y aviso, destinatario del informe por nombre, vencidas del calendario y de «Mis tareas» (línea de resumen con enlaces a cada grupo y `?filter=` antiguo, ronda 65), Historial de versiones con las 10 últimas, «Ver más», buscador y `#vX.Y.Z` (ronda 65), Usuarios a 393 px, indicador de las pestañas, pie del menú, theme-color del tema elegido y accesibilidad (aria-pressed, aria-expanded, fondo inert con un modal, axe) (ronda 56) | `e2e/interfaz-auditoria-e2e.mjs` | 91 | ~3 min |
| [**Accesibilidad**](SUITES.md#accesibilidad) | | **108** | |
| Reintentar el ZIP del plan, aviso de `?doc=` a un documento que ya no está, botones de columna con aria-disabled y opciones de correo accesibles (caza de bugs 52, segunda tanda) | `e2e/accesibilidad-columnas-e2e.mjs` | 36 | ~40 s |
| Descripción debajo de su punto en el histórico de releases, `<h2>` con el botón dentro y error al copiar, «Archivadas» del menú móvil, nombre accesible de los filtros del calendario y foco al cerrar «+N más», rol en «Aplicar plantilla», `otro.md#apartado` (caza de bugs 54) y borrar en un menú «⋯» (releases y Documentación) | `e2e/accesibilidad-releases-e2e.mjs` | 74 | ~30 s |
| [**Red, sin conexión y formularios**](SUITES.md#red-sin-conexión-y-formularios) | | **157** | |
| Formularios sin red, IP del cliente y páginas legales (ronda 49) | `e2e/red-formularios-e2e.mjs` | 26 | ~1 min |
| Sin conexión y pestañas (caza de bugs 48b) y borrador al archivar o borrar sin red (caza de bugs 52) | `e2e/red-sin-conexion-e2e.mjs` | 131 | ~3 min |
| **Total** | | **3430** | |

Las cifras son las de la última pasada completa; si añades comprobaciones, actualízalas aquí (es el único sitio donde
se apuntan). Todas, menos la QA y la de instalación, usan la base que deja preparada la QA y un servidor ya arrancado; se pueden lanzar en
cualquier orden. Cada una hace varios inicios de sesión: si una falla al entrar (tiempo agotado en el acceso) tras
otras suites, reinicia el servidor (salta el límite de intentos) y vuelve a lanzarla. La base no se borra al terminar:
la siguiente pasada de la QA la vacía; bórrala a mano cuando ya no la necesites. Capturas en `SHOTS_DIR` (por defecto
la carpeta temporal del sistema).

Los ficheros se nombran por tema (`tablero-*`, `importar-*`, `plantillas-*`, `documentacion-*`…), no por la ronda en
que se escribieron; una suite nueva va con el prefijo de su tema, en su grupo de la tabla y de las secciones de `e2e/SUITES.md`, y
con su entrada en `e2e/suites.json`.

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
SUITES="tablero-e2e tablero-fijas-e2e" scripts/e2e-all.sh # unas concretas
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
