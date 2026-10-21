# Changelog

Historial de versiones de Pizarro. Fuente: `changelog.json`.

## v1.13.0 — 2026-10-21 15:44

Temas de color completos y más cuidados, historial de versiones en inglés, menciones con la barra de formato, barra de formato por defecto y optimizaciones.

### Nuevas funcionalidades

- Menciones en el editor con barra de formato: al escribir @ aparece la lista de personas (y @docs / @sheets); la mención se ve como una etiqueta.

### Mejoras

- Temas de color rehechos: cada tema (Verde bosque, Siena, Mostaza, Blanco y negro) cambia toda la app —fondos, columnas, tarjetas, bordes y textos—, no solo los resaltados. Blanco y negro es completamente en grises.
- Subtareas hechas en verde neón (casilla y barra) en el tema azul.
- Historial de versiones también en inglés.
- La edición con barra de formato es la opción por defecto.
- La pantalla de acceso sale siempre en español.
- El tablero carga menos código al abrirse: los diálogos y el editor se cargan al usarlos (con precarga en segundo plano).
- Los refrescos automáticos ya no registran una visita cada vez en los logs.

### Correcciones

- Tonos 200 y 300 del color principal que no estaban definidos (algunos textos y bordes salían sin color).

### Cambios técnicos / DB

- Migración v1_13: AppVersionLog.summaryEn/changesEn y editorMode WYSIWYG por defecto (también para los usuarios existentes). Escala slate-* y color on-brand por tema. Limpieza de código sin uso (exports, helpers obsoletos). @tiptap/extension-mention y @tiptap/suggestion 3.32.0.

## v1.12.0 — 2026-10-20 23:46

Pizarro en inglés, descripciones con formato (Markdown o barra de formato), informe PDF más útil con descarga en móvil, cambios casi al instante entre pestañas, borradores automáticos, colores de acento, releases numeradas y deshacer por tarea.

### Nuevas funcionalidades

- Idioma: español o inglés en «Mi perfil y plantillas» (interfaz, mensajes, fechas, informe PDF y emails de aviso).
- Descripciones con formato: se ven formateadas al no editarlas y se escriben en Markdown o con barra de formato (negrita, cursiva, subrayado, tachado, título, subtítulo, texto normal y listas), a elegir en el perfil. Pegar Markdown lo convierte en formato.
- Colores de acento: Azul, Verde bosque, Siena, Mostaza y Blanco y negro, en claro y oscuro; la barra de subtareas contrasta con cada uno.
- Colores de tarjeta nuevos: blanco, marrón, verde oscuro y azul marino.
- Releases numeradas por proyecto: los códigos llevan el número (R32M4) y el histórico lo muestra.
- Borradores: la tarea que creas o editas se guarda cada 5 s en el navegador y se reabre si cerraste la página sin cancelar ni guardar.
- Móvil: botón Guardar fijo abajo a la derecha (con Archivar y Borrar) que guarda el título y la descripción tal como estén escritos.

### Mejoras

- Informe PDF más corto y útil: resumen con 4 cifras, lo pendiente por columna, plazos, entregables, carga, terminadas recientes y últimas releases (solo las secciones con contenido). En móvil se genera en la app con botones Descargar y Abrir.
- Los cambios de otras pestañas y personas aparecen casi al instante (menos de un segundo).
- Deshacer con contexto: con una tarea abierta deshace solo lo de esa tarea; crear una tarea con sus adjuntos cuenta como una acción; el botón ya no queda borroso detrás del modal y el aviso lleva el icono de deshacer.
- «Respuesta» es un tipo general como los demás y se puede borrar.
- Historial de versiones con la hora de cada lanzamiento.

### Correcciones

- Error de React #418 en la página de releases (y en avisos): las fechas se formatean con la misma zona horaria en servidor y navegador.
- El recuadro de foco de las opciones del menú lateral ya no se corta.
- Espacio a la izquierda del candado de los proyectos privados.

### Cambios técnicos / DB

- Migración v1_12: User.accent/locale/editorMode, Release.number (rellenado por fecha), UndoEntry.taskId y se elimina TaskKind.system. i18n propio (src/i18n, clave = texto en español, npm run i18n:check). Canal SSE /api/projects/[id]/events. Editor TipTap 3 con @tiptap/markdown. changelog.json con releasedAt.

## v1.11.0 — 2026-10-20 19:10

Deshacer las 10 últimas acciones, avisos para trabajar varios a la vez, subtareas al crear y reordenables, indicador «Guardado», candado de privados y recarga automática tras desplegar.

### Nuevas funcionalidades

- Botón Deshacer (flecha de volver) junto al nombre del tablero, también en móvil y con Ctrl/⌘+Z: deshace tus 10 últimas acciones en el tablero, incluidos borrados con adjuntos y despliegues de releases.
- Al crear una tarea se pueden añadir subtareas.
- Subtareas: doble clic para editarlas y arrastre desde el icono de seis puntos para reordenarlas.
- Aviso «Fulano también tiene abierta esta tarea» y protección al editar el título o la descripción a la vez que otra persona.
- Móvil: círculos de quién está activo en el tablero, arriba a la derecha.

### Mejoras

- Indicador «Guardando… / Guardado» en el detalle de la tarea.
- Candado junto al nombre de los proyectos privados.
- Los círculos de actividad te incluyen a ti.
- Tras un despliegue, las pestañas abiertas se recargan solas al volver a ellas (o avisan si estás escribiendo).

### Correcciones

- Dos tareas a la vez: quedan juntas y centradas, con el mismo ancho y un hueco pequeño.
- Tarjetas que a veces volvían un momento a su orden anterior: un refresco pedido antes de un cambio ya no pisa ese cambio.
- Error «Server Action … was not found on the server» al usar una pestaña abierta antes de un despliegue.

### Cambios técnicos / DB

- Migración v1_11: UndoEntry y Task.contentUpdatedAt/contentUpdatedById. Operaciones inversas por acción (src/lib/undo.ts) guardadas por runAction; los ficheros de adjuntos borrados se conservan mientras su entrada exista. buildId propio y /api/version. Presencia por tarea en memoria (/api/tasks/[id]/viewers).

## v1.10.0 — 2026-10-19 22:57

Barra de progreso de subtareas, dos tareas a la vez en escritorio, Ctrl+Enter para crear, quién está activo en el tablero, sacar tareas de la sección de fijas, logs con solo cambios por defecto y borrado de usuarios.

### Nuevas funcionalidades

- Subtareas con barra de progreso verde junto al título, que se llena según la proporción de subtareas hechas. Las subtareas no pasan a las releases.
- Escritorio: con una tarea abierta, el botón «+» de fuera del modal abre una tarea nueva a la derecha (en Backlog) y la abierta pasa a la izquierda.
- Ctrl/⌘+Enter en cualquier campo de «Nueva tarea» la crea.
- Círculos con las iniciales de quién ha hecho algo en el tablero en los últimos 5 minutos, junto a «Informe PDF».
- Borrar usuarios: si tienen proyectos privados se avisa y se pide confirmación, y se borran con ellos.

### Mejoras

- Las tareas de «Siempre en la release» se pueden arrastrar a cualquier columna y posición (dejan de ser fijas).
- Logs: por defecto solo cambios; «Incluir consultas» muestra también páginas vistas, tareas abiertas, informes y descargas.
- Los proyectos privados de un dueño desactivado quedan bloqueados hasta que vuelva; ya no se borran solos a los 30 días.

### Correcciones

- Móvil: sin scroll vertical; las columnas acaban justo encima de la barra de gestos o navegación del sistema.

### Cambios técnicos / DB

- Presencia en memoria alimentada por los logs (GET /api/projects/[id]/presence, sin registro). Pila de modales con Escape y fondo para el de más arriba. purgeProject compartido entre borrar proyecto y borrar usuario.

## v1.9.0 — 2026-10-19 19:55

Arrastrar tareas a la sección de fijas, logs con acciones legibles y privacidad de los proyectos privados, búsqueda en todo el histórico de releases, bloqueo y borrado de privados huérfanos y columnas hasta abajo en móvil.

### Nuevas funcionalidades

- Arrastrar una tarea sobre «Siempre en la release» la convierte en fija; si la sección está cerrada, se abre al pasar por encima.
- Logs con acciones legibles: crear, modificar (qué campos), mover, reordenar, archivar, recuperar, borrar, comentar, desplegar releases, columnas y proyectos.
- Proyectos privados huérfanos: si su dueño se desactiva o deja de ser admin, se bloquean (nadie los ve) y a los 30 días se borran solos.

### Mejoras

- En Logs, la actividad de los proyectos privados ajenos aparece solo con hora y usuario (también en el CSV y en los filtros).
- La búsqueda del histórico de releases cubre todas las releases, sin distinguir mayúsculas ni tildes; sin buscar, se cargan de 50 en 50.
- Las tareas fijas solo se añaden al generar la release desde su columna, no con «Release con selección».
- Las copias de archivos que no son imagen guardadas al desplegar se borran a los 7 días.

### Correcciones

- Móvil: las columnas llegan hasta abajo y la barra de tareas fijas no queda tapada por los botones flotantes.
- Texto de la sección de tipos de tarea de los ajustes del proyecto.

### Cambios técnicos / DB

- Migración v1_9: Project.privateBlockedAt, ReleaseAttachment.isImage y AppLog.privateOwnerId. Tarea de mantenimiento horaria (instrumentation register). Contexto por acción (AsyncLocalStorage) para el texto y el proyecto de cada log.

## v1.8.0 — 2026-10-19 18:25

Proyectos privados, tipos generales por proyecto, plantillas de proyecto, tareas fijas en la release, adjuntos de cualquier tipo con arrastrar y soltar, buscadores, automatización de tipos y cambio de columna deslizando en móvil.

### Nuevas funcionalidades

- Proyectos privados: solo los ve su dueño, ni siquiera el resto de administradores (Ajustes del proyecto → Visibilidad o al crearlo).
- Cada proyecto elige qué tipos generales usa; los desmarcados no aparecen en él (al desmarcar uno con tareas se elige a qué tipo pasan).
- Plantillas de proyecto (Administración → Plantillas): columnas y roles, tipos propios, tipos generales ocultos y etiquetas; se eligen al crear un proyecto.
- Tareas fijas en la columna de release («Siempre en la release»): entran en cada release y no salen de la columna al desplegar.
- Adjuntos de cualquier tipo hasta 10 MB y arrastrar archivos a la tarea abierta (también desde las descargas del navegador).
- Buscadores en el histórico de releases y en el historial de versiones.
- Automatización por tipo de tarea: título y texto inicial de la descripción, con su explicación en la lista de tipos.
- Móvil: deslizar a los lados cambia de columna.

### Mejoras

- «Respuesta» es un tipo del sistema: viene de serie, explica lo que hace y no se puede borrar.
- Los modales tienen un borde claro que los separa del fondo (sobre todo en tema oscuro).

### Correcciones

- Los errores del navegador (pantalla «Algo ha fallado» y excepciones no capturadas) ahora quedan en Administración → Logs.

### Cambios técnicos / DB

- Migración v1_8: Project.privateOwnerId, ProjectHiddenKind, ProjectTemplate, Task.evergreen, TaskKind (titleTemplate, descriptionTemplate, system) y TaskAttachment (mimeType, isImage, medidas opcionales). Los ficheros que no son imagen se guardan tal cual (<id>.bin) y se sirven siempre como descarga con tipo restringido.

## v1.7.0 — 2026-10-19 00:38

Logs de administración, archivadas en un modal con recuperación a su columna, borrado de releases y adjuntos del histórico, tipo «Respuesta» y columnas que llenan la pantalla.

### Nuevas funcionalidades

- Administración → Logs: registro detallado de los últimos 7 días (visitas, inicios de sesión, cada acción con su duración y datos, adjuntos, informes, Google, emails, WhatsApp y errores), con filtros y descarga CSV.
- Tareas archivadas en un modal («Archivadas» en el tablero y en el menú lateral) con filtro, columna de origen y releases por las que pasaron; «Recuperar» las devuelve a su columna o a la primera si ya no existe.
- Archivar varias tareas desde la barra de selección.
- Histórico de releases: «Borrar release» y «Borrar adjuntos», con confirmación.
- Tipo especial «Respuesta»: al elegirlo, el título pasa a «Respuesta» y la descripción empieza por «Respondo a las preguntas y lo que necesitas de mi:».

### Mejoras

- Escritorio: con más de tres columnas, se reparten el ancho de la ventana.
- Cada página tiene su propio indicador de carga (antes Ajustes o Releases mostraban el esqueleto del tablero).
- Con tareas seleccionadas, las columnas dejan hueco para que la barra no tape las últimas tarjetas.

### Correcciones

- Cargas lentas ocasionales: las conexiones a la base de datos ya no se cierran tras 10 s sin uso (se mantienen 10 min).
- El círculo «sin color» ya no se corta en el detalle de la tarea.

### Cambios técnicos / DB

- Migración v1_7: tabla AppLog y Task.archivedFromColumnId. Registro en lote (sin coste por petición) y purga automática (LOG_RETENTION_DAYS).

## v1.6.0 — 2026-10-19 00:08

Tema claro u oscuro por usuario, sección de Administración, marcar una columna entera, releases numeradas por día con adjuntos en el histórico y modal de tarea compacto.

### Nuevas funcionalidades

- Tema por usuario en Mi perfil → Apariencia: Sistema, Claro u Oscuro.
- Marcar o desmarcar todas las tareas de una columna con la casilla junto a su nombre.
- Histórico de releases con adjuntos: al desplegar se guarda una copia reducida (960 px, WebP 55) con los nombres de la release, descargable en ZIP desde Releases.

### Mejoras

- Sección única de Administración (Usuarios y Tipos de tarea) y nuevo orden del menú lateral: Avisos, Mis tareas asignadas, Mi perfil y plantillas, Administración, Historial de versiones, Instalar app.
- Detalle de tarea en escritorio: se ve entero sin scroll, con la columna lateral más ancha y compacta y los botones Archivar y Borrar siempre visibles.
- Releases del mismo día numeradas tras la fecha: «Release 2026-10-18 (2) · Proyecto».
- Barras de scroll con los colores de Pizarro en ambos temas.

### Correcciones

- Barra de selección en escritorio en una sola línea; dice «1 seleccionada» / «N seleccionadas».
- El título de la release ya no aparece en el texto para copiar; se guarda solo en el histórico.

### Cambios técnicos / DB

- Migración v1_6: User.theme (enum Theme) y tabla ReleaseAttachment (copias en UPLOAD_DIR/releases); al borrar un proyecto se borran también esos ficheros.
- Variante dark de Tailwind por atributo data-theme con respaldo prefers-color-scheme.

## v1.5.0 — 2026-10-18 22:47

Pizarro (nuevo nombre), releases con códigos, descripciones y adjuntos en ZIP, visor de imágenes, borrado en grupo, botón atrás y mejoras en móvil.

### Nuevas funcionalidades

- Releases: cada punto lleva un código por tipo (F1, C2…), su descripción y sus adjuntos renombrados `código_nombre.webp`; botón «Descargar adjuntos» con un ZIP de todos ellos.
- Visor de imágenes: al tocar un adjunto se ve a pantalla completa; se cierra con la X, tocando fuera, con Escape o con atrás.
- Borrar en grupo las tareas seleccionadas.
- Botón atrás: cierra el modal abierto y, en móvil, vuelve a la columna anterior (hasta 5 pasos).
- Reordenar tareas arrastrando dentro de su columna también en móvil, con un asa en cada tarjeta.

### Mejoras

- La aplicación pasa a llamarse Pizarro.
- Nueva tarea: Título, Tipo y Descripción primero; en móvil el modal se abre arriba y sigue visible con el teclado.
- El detalle de la tarea cabe entero en pantallas de escritorio.
- Barra de selección en móvil: «Mover a Siguiente salto» y «Mover a…» en la misma línea.

### Correcciones

- Móvil: el scroll vertical de una columna con muchas tareas no funcionaba (el gesto iniciaba un arrastre). Se quita el arrastre entre columnas en móvil.
- Release: el título va antes de la cabecera.
- Release: se incluye la descripción de cada tarea.

### Cambios técnicos / DB

- Ruta POST /api/projects/[id]/release-attachments que genera el ZIP en el servidor (sin dependencias nuevas) y acciones getReleaseTaskDetails y deleteTasks.
- Se mantienen los identificadores técnicos con el nombre anterior (cookies, base de datos y clave de cifrado) para no cerrar sesiones ni invalidar tokens guardados.

## v1.4.0 — 2026-10-18 18:14

Tipos de tarea exclusivos de cada proyecto.

### Nuevas funcionalidades

- Tipos de tarea exclusivos de un proyecto: se gestionan en Ajustes del proyecto (cualquiera con acceso) y se suman a los generales en los selectores, las releases y el informe PDF.

### Mejoras

- La página de admin pasa a llamarse «Tipos de tarea generales»; crear y editar tipos se hace en un modal.

### Cambios técnicos / DB

- Migración v1_4: TaskKind.projectId (opcional, se borra con el proyecto); el nombre deja de ser único global y pasa a serlo entre los generales y dentro de cada proyecto (índices parciales sin distinguir mayúsculas).

## v1.3.1 — 2026-10-18 17:56

Ver la contraseña al escribirla y corrección en «Crear varias tareas».

### Mejoras

- Icono de ojo en los campos de contraseña (inicio de sesión, cambio de contraseña y administración de usuarios) para ver lo que se escribe.

### Correcciones

- Crear varias tareas: «Tipo para todas» cambia ahora todas las líneas, también las que se habían cambiado a mano.

## v1.3.0 — 2026-10-18 17:45

Crear varias tareas pegando una lista, formularios más compactos en móvil y entregables en un modal.

### Nuevas funcionalidades

- Crear varias tareas a la vez: pega una lista (una tarea por línea), elige el tipo para todas o línea a línea y, si quieres, asigna responsable, fecha límite, entregable y etiquetas comunes. Botón «Varias tareas» en escritorio y botón flotante pequeño sobre el «+» en móvil.

### Mejoras

- Nueva tarea: el botón «Crear tarea» queda fijo abajo y siempre visible; «Asignada a» y «Fecha límite» en la misma fila y descripción más baja.
- «Asignada a» se indica como campo opcional.
- Detalle de tarea: textos de ayuda acortados a una línea (y ocultos en móvil cuando hablan de atajos de teclado).
- Entregables: el formulario se abre en un modal al pulsar «Añadir entregable» (y al editar uno).
- En móvil, las pestañas de columnas ya no muestran barra de scroll horizontal.

### Cambios técnicos / DB

- Acción createTasks: alta en bloque en una transacción (createManyAndReturn), máximo 100 tareas.

## v1.2.0 — 2026-10-18 17:11

Tipos de tarea configurables, varias plantillas de release, app instalable en el móvil y mejoras de uso en móvil y escritorio.

### Nuevas funcionalidades

- Tipos de tarea configurables por los administradores (nombre, color y orden); cada tipo es una sección de la release.
- Varias cabeceras y pies de release por usuario, con nombre; se eligen en el diálogo de «Generar release» y se sustituyen en el texto ya editado.
- Instalar Pizarro como app en Android, iPhone y escritorio (pantalla de inicio, pantalla completa).
- Preferencia de apariencia: tarjetas con franja de color o teñidas enteras de su color.
- En móvil, arrastrar una tarjeta sobre la pestaña de otra columna (manteniéndola medio segundo) muestra esa columna para soltarla en su sitio; soltarla sobre la pestaña la deja al final.

### Mejoras

- Cambio rápido de proyecto desde el título del proyecto (desplegable en móvil y escritorio).
- Botón «Cámara» también en el detalle de tareas existentes (móvil).
- Añadir columna: barra vertical estrecha al final del tablero (escritorio) y botón redondo tras las pestañas (móvil).

### Correcciones

- Se añade favicon.ico (evitaba un 404 en cada carga).

### Cambios técnicos / DB

- Migración v1_2: tabla TaskKind (Feature/Chore/Refactor → Funcionalidad; Fix/Hotfix → Corrección), tabla ReleaseTemplate (migra las plantillas existentes) y User.cardStyle.
- Manifiesto web, iconos PNG (incl. maskable y apple-touch-icon) y service worker mínimo sin caché; la imagen Docker incluye public/.

## v1.1.2 — 2026-10-18 14:19

Mensaje claro en los logs si faltan variables de entorno al arrancar.

### Mejoras

- Al arrancar se comprueban DATABASE_URL y SESSION_SECRET: si faltan, los logs indican cuál y cómo configurarla, en lugar de reiniciarse en bucle con un error de Prisma.

## v1.1.1 — 2026-10-18 14:11

Compatibilidad del build Docker con Railway.

### Cambios técnicos / DB

- Dockerfile sin cachés de BuildKit (--mount=type=cache), que el builder de Railway rechaza si no llevan su identificador de servicio.

## v1.1.0 — 2026-10-18 13:56

Informe PDF del proyecto, plazos y entregables, Google Docs/Sheets desde las tarjetas y menciones con avisos.

### Nuevas funcionalidades

- Informe PDF del proyecto: resumen y avance, estado por columna, entregables, plazos vencidos y próximos, carga por persona, tipos, últimas releases y detalle de cada columna.
- Fecha límite en las tarjetas, con aviso visual de plazo vencido, de hoy o próximo en el tablero y en «Mis tareas».
- Entregables (hitos con fecha objetivo) que agrupan tarjetas, gestionables desde «Ajustes del proyecto».
- Google Docs y Sheets: @docs o @sheets en una tarjeta crea el archivo en tu Drive, lo abre en otra pestaña y lo deja enlazado.
- Comentarios en las tarjetas con menciones @persona y autocompletado.
- Avisos de menciones en la app (campana con contador), por email y por WhatsApp.

### Mejoras

- Las columnas pueden marcarse como «terminadas» para calcular el avance y no avisar de plazos ya cumplidos.
- Preferencias de aviso y conexión con Google en «Mi perfil y plantillas».

### Cambios técnicos / DB

- Migración v1_1: Task.dueDate y deliverableId, Column.isDone y tablas Deliverable, TaskLink, GoogleAccount, TaskComment y Notification.
- OAuth de Google con permiso mínimo drive.file y tokens cifrados con AES-256-GCM.
- Envío de avisos tras responder (after) para no añadir espera; SMTP con nodemailer y WhatsApp Cloud API con plantilla.
- Nuevas variables opcionales: GOOGLE_*, SMTP_*, WHATSAPP_* y APP_TIMEZONE.

## v1.0.0 — 2026-10-18 13:25

Primera versión de Pizarro: kanban multiproyecto y generador de release notes.

### Nuevas funcionalidades

- Tablero Kanban multiproyecto con arrastrar y soltar entre columnas y dentro de cada columna.
- Columnas configurables por proyecto: crear, renombrar, reordenar, asignar rol y borrar cuando están vacías.
- Tarjetas con tipo (Feature, Fix, Chore, Refactor, Hotfix), color, responsable, etiquetas, enlace externo, checklist y descripción en Markdown.
- Capturas pegadas desde el portapapeles o subidas desde archivo/cámara, optimizadas a WebP.
- Selección múltiple y movimiento en lote a «Siguiente salto a producción».
- Generador de release notes con cabecera y pie personales, editor con vista previa, copiar, descargar .md/.txt y «Marcar como desplegado».
- Histórico de releases por proyecto.
- Vista «Mis tareas asignadas».
- Visibilidad de proyectos restringible por usuario.
- Gestión de usuarios (máx. 5) con roles Admin y Miembro.
- Historial de versiones de la aplicación.

### Mejoras

- Interfaz adaptada a móvil con pestañas de columnas y botón flotante para crear tareas o subir capturas.

### Cambios técnicos / DB

- Next.js (App Router) + PostgreSQL con Prisma; migración inicial y seed.
- Sesiones en base de datos con cookie HttpOnly, SameSite=Lax y limitación de intentos de login.
- Despliegue en un único contenedor Docker con volumen persistente para adjuntos (Railway).
