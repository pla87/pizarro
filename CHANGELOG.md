# Changelog

Historial de versiones de Tablón. Fuente: `changelog.json`.

## v1.3.1 — 2026-10-18

Ver la contraseña al escribirla y corrección en «Crear varias tareas».

### Mejoras

- Icono de ojo en los campos de contraseña (inicio de sesión, cambio de contraseña y administración de usuarios) para ver lo que se escribe.

### Correcciones

- Crear varias tareas: «Tipo para todas» cambia ahora todas las líneas, también las que se habían cambiado a mano.

## v1.3.0 — 2026-10-18

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

## v1.2.0 — 2026-10-18

Tipos de tarea configurables, varias plantillas de release, app instalable en el móvil y mejoras de uso en móvil y escritorio.

### Nuevas funcionalidades

- Tipos de tarea configurables por los administradores (nombre, color y orden); cada tipo es una sección de la release.
- Varias cabeceras y pies de release por usuario, con nombre; se eligen en el diálogo de «Generar release» y se sustituyen en el texto ya editado.
- Instalar Tablón como app en Android, iPhone y escritorio (pantalla de inicio, pantalla completa).
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

## v1.1.2 — 2026-10-18

Mensaje claro en los logs si faltan variables de entorno al arrancar.

### Mejoras

- Al arrancar se comprueban DATABASE_URL y SESSION_SECRET: si faltan, los logs indican cuál y cómo configurarla, en lugar de reiniciarse en bucle con un error de Prisma.

## v1.1.1 — 2026-10-18

Compatibilidad del build Docker con Railway.

### Cambios técnicos / DB

- Dockerfile sin cachés de BuildKit (--mount=type=cache), que el builder de Railway rechaza si no llevan su identificador de servicio.

## v1.1.0 — 2026-10-18

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

## v1.0.0 — 2026-10-18

Primera versión de Tablón: kanban multiproyecto y generador de release notes.

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
