---
title: "Tablón · Manual de operaciones"
subtitle: "Arquitectura, guía de uso y procesos operativos"
version: "v1.2.0"
---

# Tablón — Manual de operaciones

**Versión de la aplicación:** v1.2.0

Este manual describe la arquitectura de Tablón, cómo se usa en el día a día y los procesos para operarla en producción (Railway). Todos los valores que aparecen (emails, dominios, contraseñas) son **ejemplos ficticios**. No escribas en este documento credenciales ni datos reales.

---

## 1. Visión general

Tablón es un tablero Kanban ligero para un equipo de hasta 5 personas. Su objetivo es cubrir un flujo concreto:

1. registrar tareas rápidamente, incluidas capturas de pantalla pegadas desde el portapapeles;
2. moverlas por columnas hasta el **siguiente salto a producción**;
3. generar con un clic las **release notes** agrupadas por tipo, editarlas, exportarlas y marcar el despliegue.

| Concepto | Descripción |
|---|---|
| Proyecto | Espacio de trabajo con sus propias columnas, tareas, etiquetas y releases. |
| Columna | Estado del flujo. Configurable por proyecto. Puede tener un **rol** (*Siguiente salto* o *En producción*). |
| Tarjeta / tarea | Unidad de trabajo con tipo, color, responsable, etiquetas, enlace, checklist, descripción y capturas. |
| Release | Registro histórico de un despliegue: texto final editado y tareas incluidas. |
| Plantillas | Cabecera y pie estándar de cada usuario, que se insertan en las releases que genera. |
| Entregable | Hito del proyecto con fecha objetivo que agrupa tarjetas. Su avance aparece en el informe PDF. |
| Aviso | Notificación que recibe una persona cuando la mencionan con `@`: en la app, por email y, si lo activa, por WhatsApp. |

---

## 2. Arquitectura

### 2.1 Componentes

```
Navegador (React)
   │  HTTPS
   ▼
Railway ── servicio "app" (contenedor Docker, un solo proceso Node.js)
   │         ├─ Next.js 16 · App Router (salida standalone)
   │         │    ├─ Server Components  → lectura con Prisma
   │         │    ├─ Server Actions     → mutaciones validadas con zod
   │         │    └─ Route Handlers     → subida/servido de imágenes, health
   │         ├─ sharp                   → redimensionado a WebP
   │         ├─ @react-pdf/renderer     → informe PDF del proyecto
   │         ├─ avisos (tras responder) → SMTP y WhatsApp Cloud API
   │         ├─ OAuth de Google         → Google Drive API (Docs / Sheets)
   │         └─ /app/uploads  ◀──────── Volume persistente de Railway
   │
   └──────── servicio "Postgres" (PostgreSQL gestionado) ◀── Prisma 7 + driver pg
```

La aplicación es un **monolito en un único contenedor**. No hay colas, cachés externas ni servicios adicionales: con 5 usuarios, cada pieza extra sería un coste y un punto de fallo sin beneficio.

### 2.2 Estructura del repositorio

| Ruta | Contenido |
|---|---|
| `src/app/` | Páginas y rutas (App Router). `(app)/` agrupa las páginas autenticadas. |
| `src/app/api/` | Rutas HTTP: subida y servido de adjuntos, `health`. |
| `src/actions/` | Server Actions (tareas, columnas, proyectos, releases, usuarios, perfil, auth). |
| `src/components/` | Componentes de interfaz. `board/` contiene el tablero, los diálogos y el generador de releases. |
| `src/lib/` | Lógica compartida: sesión, control de acceso, validación, generador de releases, imágenes, seed. |
| `prisma/` | Esquema, migraciones y seed. |
| `scripts/` | Arranque del contenedor, sincronización del changelog, `version:bump`, generación del PDF. |
| `changelog.json` | Fuente de verdad del historial de versiones de la app. |
| `tests/` | Tests unitarios (`npm test`). |

### 2.3 Flujo de una petición

1. `src/proxy.ts` comprueba **sin consultar la base de datos** que existe la cookie de sesión. Si no existe, redirige a `/login` (o devuelve 401 en `/api`). También renueva la caducidad de la cookie al navegar.
2. La página, acción o ruta valida la sesión contra la base de datos (una consulta por petición, cacheada con `React.cache`).
3. Cada operación sobre un recurso comprueba que el proyecto es visible para el usuario (`src/lib/access.ts`).
4. Las mutaciones validan la entrada con `zod` y devuelven `{ ok, data | error }` para que la interfaz muestre el error sin recargar.

### 2.4 Modelo de datos

| Tabla | Campos principales | Notas |
|---|---|---|
| `User` | email (único), name, passwordHash, role, active, cardStyle, preferencias de aviso | Los usuarios no se borran: se desactivan. |
| `Session` | id = HMAC del token, userId, expiresAt | El token en claro solo vive en la cookie. |
| `Project` | name, description, restricted, position | `restricted = false` → visible para todos. |
| `ProjectMember` | projectId, userId | Usuarios con acceso a un proyecto restringido. |
| `Column` | projectId, name, position, role | Índice único parcial: como máximo una columna por rol en cada proyecto. |
| `Task` | projectId, columnId, kindId, title, description, color, linkUrl, position, assigneeId, archivedAt | Posición fraccionaria para reordenar actualizando una sola fila. |
| `Label` / `TaskLabel` | name, color | Etiquetas por proyecto. |
| `Subtask` | taskId, title, done, position | Checklist. |
| `TaskAttachment` | taskId, originalName, width, height, size | El fichero está en `UPLOAD_DIR/<id>.webp` (y `<id>.thumb.webp`). |
| `Release` / `ReleaseTask` | content (Markdown final), deployedAt, autor · instantánea de título y tipo de cada tarea | La instantánea se conserva aunque la tarea se borre. |
| `AppVersionLog` | version (única), releasedAt, summary, changes (JSON) | Se sincroniza desde `changelog.json` en cada arranque. |
| `Deliverable` | projectId, name, description, dueDate, position | Las tareas lo referencian con `deliverableId`. Al borrarlo, quedan sin entregable. |
| `TaskKind` | name (único), color, position | Tipos de tarea configurables; cada tarea tiene `kindId`. |
| `ReleaseTemplate` | userId, kind (HEADER / FOOTER), name, content, position | Cabeceras y pies de release de cada usuario. |
| `TaskComment` | taskId, authorId, body | Las menciones se guardan como `@[Nombre](user:ID)`. |
| `Notification` | userId, actorId, taskId, excerpt, readAt, emailSentAt, whatsappSentAt, deliveryError | Un aviso por persona mencionada, con el resultado de cada envío. |
| `TaskLink` | taskId, kind (GOOGLE_DOC / GOOGLE_SHEET), title, url | Documentos de Google enlazados a la tarjeta. |
| `GoogleAccount` | userId, email, refreshTokenEnc, accessTokenEnc, scope | Tokens OAuth cifrados con AES-256-GCM. |

Además, `Task` tiene `dueDate` (fecha límite, solo día), `Column` tiene `isDone` (sus tarjetas cuentan como terminadas) y `User` tiene sus preferencias de aviso (`notifyEmail`, `notifyWhatsapp`, `whatsappPhone`).

### 2.5 Seguridad

| Medida | Implementación |
|---|---|
| Contraseñas | bcrypt (coste 11), mínimo 10 caracteres. Tiempo de respuesta constante si el usuario no existe. |
| Sesiones | Token aleatorio de 256 bits en cookie `HttpOnly`, `SameSite=Lax` y `Secure` (con HTTPS, con prefijo `__Host-`). En base de datos solo se guarda su HMAC-SHA256 con `SESSION_SECRET`. Caducidad deslizante de 30 días. |
| Revocación | Cerrar sesión, cambiar la contraseña, restablecerla, desactivar al usuario o cambiarle el rol eliminan sus sesiones. |
| Fuerza bruta | Límite de intentos de login por IP y por email (ventana de 15 minutos), y de cambios de contraseña. |
| CSRF | `SameSite=Lax`, verificación de `Origin` integrada en las Server Actions y comprobación explícita de `Origin` en la ruta de subida. |
| Autorización | Sin registro público. Solo los admins gestionan usuarios y proyectos. Cada operación comprueba la visibilidad del proyecto. |
| XSS | React escapa todo el contenido. El Markdown se renderiza sin HTML. Los enlaces solo admiten `http(s)` y se abren con `rel="noopener noreferrer"`. CSP restrictiva. |
| Cabeceras | `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `HSTS`. |
| Imágenes | Tamaño máximo configurable, límite de píxeles en sharp (protección frente a *decompression bombs*), reconversión siempre a WebP (se descarta cualquier contenido incrustado) y servido solo a usuarios con acceso. |
| Contenedor | El proceso Node se ejecuta como el usuario sin privilegios `node`. |
| Google | OAuth con permiso mínimo `drive.file`: solo da acceso a los archivos que crea Tablón. Parámetro `state` ligado a la sesión contra CSRF. Tokens cifrados en base de datos. Opcionalmente, restringido a un dominio de Workspace. |
| Avisos | Solo se avisa a usuarios activos con acceso al proyecto. El email y el WhatsApp no se repiten a la misma persona por la misma tarea en 10 minutos, y cada autor tiene un tope de envíos por hora. El contenido de los emails se escapa y los enlaces apuntan siempre a `APP_URL`. |

### 2.6 Rendimiento

- **Una ida y vuelta por pantalla:** el tablero carga columnas, tarjetas, usuarios, etiquetas y plantillas con consultas en paralelo.
- **Interfaz optimista:** mover tarjetas, marcar subtareas o editar campos se reflejan al instante; si el servidor rechaza el cambio, se revierte y se muestra el error.
- **Posiciones fraccionarias:** mover una tarjeta actualiza una sola fila.
- **Generación de releases en el navegador:** instantánea, sin llamadas al servidor hasta *Marcar como desplegado*.
- **Imágenes:** en móvil, las fotos grandes se reducen en el navegador antes de subirse. El servidor genera una miniatura, y las imágenes se sirven con caché inmutable.
- **Sin dependencias externas en tiempo de ejecución:** fuentes del sistema, sin CDNs.
- **Refresco ligero:** el tablero se actualiza al volver a la pestaña y cada 30 segundos, para ver los cambios del resto del equipo.

---

## 3. Guía de uso

### 3.1 Acceso

- Entra con tu email y contraseña. No hay registro público: un administrador te da de alta.
- **Mi perfil y plantillas** permite cambiar el nombre visible y la contraseña. Al cambiarla se cierran tus sesiones en los demás dispositivos.

### 3.2 Proyectos

- Para cambiar de proyecto, pulsa el **nombre del proyecto** en la parte superior del tablero (o en la barra superior en móvil) y elige otro en el desplegable. También sirve el selector de la barra lateral. La app recuerda el último que abriste.
- Los administradores crean proyectos desde el selector (**Nuevo proyecto**). Cada proyecto nuevo trae las columnas *Backlog*, *En progreso*, *Siguiente salto a producción*, *En producción* y *Cerrado*.
- **Ajustes del proyecto** contiene:
  - nombre y descripción (admins);
  - **visibilidad** (admins): *Visible para todos* o *Solo los usuarios seleccionados*. Los administradores siempre ven todos los proyectos;
  - etiquetas;
  - tarjetas archivadas, con opción de restaurarlas;
  - borrado del proyecto (admins; pide escribir el nombre para confirmar).

### 3.3 Columnas

Desde el menú «⋯» de cada columna:

- **Renombrar**, **Mover a la izquierda o la derecha**.
- **Rol de la columna**: *Sin rol*, *Siguiente salto* o *En producción*. Si asignas un rol que ya tenía otra columna, esa otra columna pasa a *Sin rol*.
- **Borrar columna**: solo si no tiene tarjetas visibles. Si quedan tarjetas archivadas en ella, pasan a la primera columna del proyecto.
- **Añadir columna**: en escritorio, la barra vertical estrecha con un «+» al final del tablero; en móvil, el botón redondo «+» al final de las pestañas de columnas. No hay límite de 5; el máximo es 30 por proyecto.

### 3.4 Tarjetas

- **Crear:** botón *Nueva tarea*, el «+» de cada columna o el botón flotante en móvil. Solo el título y el tipo son obligatorios; asignarla a alguien es opcional.
- **Tipo:** por defecto *Funcionalidad* o *Corrección*. Los administradores pueden crear más (ver 3.14).
- **Atajo de captura:** pega una imagen (Ctrl/⌘+V) con el tablero en pantalla y se abre *Nueva tarea* con la captura adjunta.
- **Editar:** haz clic en la tarjeta. Los cambios se guardan solos (título y enlace al salir del campo; tipo, color, responsable, etiquetas y columna al cambiarlos). La descripción admite Markdown (Ctrl/⌘+Enter guarda).
- **Checklist:** añade elementos y márcalos. La tarjeta muestra el progreso (p. ej. `2/4`).
- **Capturas:** pega con Ctrl/⌘+V dentro del diálogo, o usa *Añadir* para elegir un archivo. En móvil también tienes el botón **Cámara**, al crear la tarea y en el detalle de una tarea existente. Cada imagen se reduce a 1280 px de ancho como máximo y se guarda como WebP (calidad 75).
- **Archivar** oculta la tarjeta del tablero (se puede restaurar). **Borrar** la elimina con sus adjuntos.

### 3.5 Mover tarjetas

- **Arrastrar y soltar** entre columnas o dentro de la misma.
- **En móvil:** mantén pulsada la tarjeta un instante y arrástrala sobre la **pestaña** de otra columna. La vista cambia a esa columna y puedes soltarla en su sitio o sobre la propia pestaña (queda al final).
- **Selección múltiple:** marca la casilla de varias tarjetas. Aparece una barra con:
  - **Mover a Siguiente salto…** (la columna con ese rol);
  - **Mover a…** cualquier otra columna;
  - **Release con selección**.
- También puedes cambiar la columna desde el detalle de la tarjeta.

### 3.6 Generar una release

1. Prepara tus plantillas en **Mi perfil y plantillas → Plantillas de release notes**. Puedes tener **varias cabeceras** (por ejemplo, «Contexto para IA» o «Para negocio») y **varios pies** (por ejemplo, «Checklist de cierre»), cada uno con su nombre.
2. En el tablero, pulsa **Generar Release** en la columna *Siguiente salto a producción*.
3. **Paso 1:** revisa el título, elige la **cabecera** y el **pie** (o «Ninguna») y marca las tareas incluidas. Por defecto están todas las de la columna; si tenías tarjetas seleccionadas, solo esas.
4. **Paso 2:** se genera el documento, con **una sección por tipo de tarea** en el orden definido por los administradores:

```markdown
<cabecera elegida>

## Release 2026-10-18 · Proyecto

### Funcionalidad
- Nueva pantalla de exportación ([enlace](<https://example.com/pr/1>))

### Corrección
- Error al guardar
- Corrección del cálculo de totales

<pie elegido>
```

5. Edita el texto libremente y alterna entre **Editar** y **Vista previa**. Si cambias la cabecera o el pie en este paso, se sustituyen en el texto sin perder lo que has escrito. Si ya habías modificado ese bloque, el nuevo se añade.
6. Exporta con **Copiar todo**, **.md** o **.txt** (nombre `release-AAAA-MM-DD`).
7. **Marcar como desplegado**: elige si las tarjetas pasan a la columna *En producción* o se archivan. El texto final editado queda guardado en el apartado **Releases** del proyecto.

Las secciones sin tareas se omiten.

### 3.7 Plazos y entregables

- **Fecha límite:** en el detalle de la tarjeta (o al crearla). En el tablero, la tarjeta muestra la fecha con estos colores:
  - **rojo** si está vencida;
  - **ámbar** si vence hoy o en los próximos 3 días;
  - **verde** si ya está en una columna terminada.
- **Columnas terminadas:** en el menú «⋯» de una columna, **Contar como terminada**. Por defecto lo son *En producción* y *Cerrado*. Sus tarjetas cuentan como hechas en el avance y no generan avisos de plazo.
- **Entregables:** se crean en **Ajustes del proyecto → Entregables** (nombre, fecha objetivo y descripción) y se asignan desde el detalle de cada tarjeta.

### 3.8 Informe PDF del proyecto

Botón **Informe PDF** en la cabecera del tablero (o en el menú lateral). Se abre en otra pestaña y contiene:

- **Resumen:** avance global, pendientes, vencidas, que vencen en 7 días, sin responsable, sin plazo, terminadas y archivadas.
- **Estado por columna:** número de tarjetas, peso, desglose por tipo y vencidas.
- **Entregables:** fecha objetivo, avance y estado. Los estados posibles son *Completado*, *En plazo*, *En riesgo* (vence en 7 días o menos con menos del 75 % hecho), *Retrasado*, *Sin fecha* y *Sin tareas*.
- **Plazos:** vencidos y próximos 14 días, con columna, responsable y checklist.
- **Carga por persona** y **distribución por tipo**.
- **Últimas releases.**
- **Detalle de cada columna** con todas sus tarjetas.

«Hoy» se calcula en la zona horaria `APP_TIMEZONE` (por defecto `Europe/Madrid`).

### 3.9 Comentarios, menciones y avisos

- En el detalle de la tarjeta, sección **Comentarios**. Escribe `@` y el principio de un nombre para elegir a una persona (↑↓ y Enter). También se puede mencionar en la descripción.
- La persona mencionada recibe:
  - un aviso en **Avisos** (campana con contador en el menú lateral; en móvil, en la barra superior);
  - un **email**, si el servidor tiene SMTP y la persona no lo ha desactivado;
  - un **WhatsApp**, si el servidor lo tiene configurado y la persona lo ha activado con su número.
- Cada persona elige sus canales en **Mi perfil y plantillas → Avisos de menciones**.
- Al hacer clic en un aviso se abre directamente la tarjeta.

### 3.10 Google Docs y Sheets

1. Una vez por persona: **Mi perfil y plantillas → Google Docs y Sheets → Conectar con Google**, y acepta el permiso.
2. En una tarjeta, escribe `@sheets` o `@docs` en la descripción o en un comentario y elige *Crear Google Sheet* / *Crear Google Doc*. También puedes usar los botones **Nuevo Doc** / **Nuevo Sheet**.
3. Se crea el archivo en tu Drive con el título de la tarjeta, se abre en otra pestaña y queda en **Documentos de Google** de la tarjeta. Si lo creaste desde el texto, también se inserta su enlace.
4. Si el servidor tiene `GOOGLE_WORKSPACE_DOMAIN`, el archivo se comparte automáticamente con todo el dominio (por defecto como editor, según `GOOGLE_SHARE_ROLE`), y cualquiera del equipo puede abrirlo desde la tarjeta. Si no, compártelo desde Google como cualquier otro documento.
5. Quitar el enlace de la tarjeta no borra el archivo de Drive.

### 3.11 Otras vistas

- **Mis tareas asignadas:** todas tus tarjetas activas en los proyectos a los que tienes acceso, agrupadas por proyecto y con su columna actual.
- **Releases:** histórico del proyecto, con opción de copiar o descargar cada release.
- **Historial de versiones:** versión actual de la app y cambios de cada versión.

### 3.12 Móvil

- El tablero muestra una columna cada vez. Cambias de columna con las pestañas superiores, que indican cuántas tarjetas tiene cada una.
- El botón flotante **+** crea una tarea en la columna visible, con opción de **Cámara** o **Archivo**.
- Para mover tarjetas entre columnas en móvil, arrástralas sobre la pestaña de destino (ver 3.5), usa el selector *Columna* del detalle o la selección múltiple.
- **Instalar como app:** en el menú lateral, **Instalar app**.
  - **Android y Chrome de escritorio:** muestra el aviso de instalación.
  - **iPhone y iPad:** explica cómo hacerlo. En **Safari**, pulsa *Compartir → Añadir a pantalla de inicio*.
  - La app se abre a pantalla completa con su icono y mantiene la sesión.

### 3.13 Apariencia

En **Mi perfil y plantillas → Apariencia de las tarjetas**, cada persona elige cómo se ve el color de las tarjetas:
- **Franja a la izquierda**, el modo por defecto;
- **Tarjeta entera del color**, con un tono suave para que el texto se siga leyendo.

### 3.14 Tipos de tarea (admins)

- **Tipos de tarea** (menú lateral) lista los tipos con su color y su número de tareas.
- **Nuevo tipo:** nombre y color (de la paleta o cualquier otro con el selector de color).
- Las flechas cambian el **orden**, que es el de las secciones en las release notes.
- **Borrar** un tipo pide a qué tipo pasan sus tareas. Siempre queda al menos uno.

### 3.15 Administración de usuarios (admins)

- **Usuarios → Nuevo usuario:** nombre, email, contraseña inicial (10 caracteres o más) y rol. Máximo de 5 usuarios activos (configurable con `MAX_USERS`).
- **Editar:** nombre, email, rol y estado activo. Al desactivar a un usuario o cambiarle el rol se cierran sus sesiones. Un admin no puede quitarse a sí mismo el rol ni desactivarse.
- **Restablecer contraseña:** asigna una nueva y cierra sus sesiones.

---

## 4. Procesos operativos

### 4.1 Despliegue

Cada *push* a la rama configurada en Railway genera una nueva imagen (Dockerfile multi-stage) y la despliega. Al arrancar, el contenedor ejecuta `scripts/start.sh`:

1. ajusta el propietario del volumen y baja al usuario `node`;
2. `prisma migrate deploy` (migraciones pendientes);
3. sincroniza `changelog.json` → `AppVersionLog` y ejecuta el seed idempotente;
4. arranca `node server.js`.

Railway espera a que `/api/health` responda `200` antes de enrutar tráfico al nuevo despliegue. Si una migración falla, el contenedor no arranca y el despliegue anterior sigue activo.

La guía paso a paso de la primera puesta en marcha está en el `README.md`.

### 4.2 Variables de entorno

Consulta la tabla completa en el `README.md`. Las imprescindibles son `DATABASE_URL`, `SESSION_SECRET`, `APP_URL` y `UPLOAD_DIR`. Las `SEED_ADMIN_*` solo hacen falta en el primer arranque y conviene borrarlas después.

### 4.3 Altas, bajas y contraseñas

| Situación | Acción |
|---|---|
| Alta de un miembro | *Usuarios → Nuevo usuario*. Comunica la contraseña inicial por un canal seguro y pide que la cambie. |
| Baja | *Editar → desmarcar «Usuario activo»*. Sus tareas conservan el historial. |
| Contraseña olvidada | Un admin usa *Restablecer contraseña*. |
| Se pierde el acceso de todos los admins | Conéctate a la base de datos y promueve a un usuario existente: `UPDATE "User" SET role='ADMIN' WHERE email='persona@example.com';` |

### 4.4 Rotar `SESSION_SECRET`

Cambia la variable en Railway y redespliega. Todas las sesiones dejan de ser válidas y cada usuario tendrá que volver a entrar. Las conexiones con Google también se invalidan (sus tokens se cifran con una clave derivada de este secreto): cada usuario tendrá que volver a conectarla. Hazlo si sospechas que el secreto se ha filtrado.

### 4.5 Copias de seguridad y restauración

- **PostgreSQL:** activa los backups del servicio Postgres en Railway. Copia manual: `pg_dump "$DATABASE_PUBLIC_URL" -Fc -f tablon.dump`. Restauración: `pg_restore --clean --no-owner -d "$DATABASE_PUBLIC_URL" tablon.dump`.
- **Capturas (volumen):** usa los backups del volumen en Railway. Las imágenes y la base de datos deben restaurarse a la misma fecha para que los adjuntos coincidan.

### 4.6 Publicar una nueva versión de la app

1. Desarrolla el cambio. Si afecta al esquema, crea la migración con `npm run db:migrate -- --name descripcion` y súbela al repositorio.
2. `npm run check` (lint, tipos y tests).
3. `npm run version:bump -- patch|minor|major`, rellena la entrada en `changelog.json` y ejecuta `npm run version:bump -- --render`.
4. Haz commit y *push*. Railway despliega, aplica la migración y la nueva versión aparece en *Historial de versiones*.

### 4.7 Integraciones: Google, email y WhatsApp

Son opcionales e independientes. La configuración paso a paso está en el `README.md`, sección *Integraciones opcionales*:

| Integración | Variables | Qué hace cada usuario |
|---|---|---|
| Google Docs/Sheets | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_WORKSPACE_DOMAIN` (recomendada) y `GOOGLE_SHARE_ROLE` | Conectar su cuenta en *Mi perfil*. |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Nada (activado por defecto; se puede desactivar). |
| WhatsApp | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG` | Activarlo y escribir su número en *Mi perfil*. |

El resultado de cada envío queda en la tabla `Notification` (`emailSentAt`, `whatsappSentAt`, `deliveryError`) y en los logs con el prefijo `[notify]`.

### 4.8 Monitorización

- **Salud:** `GET /api/health` → `{"status":"ok"}` si la base de datos responde.
- **Logs:** en Railway, *Deployments → View logs*. Los errores inesperados del servidor se registran con el prefijo `[action]`, `[upload]` o `[uploads]`.
- **Uso del volumen:** visible en la pestaña del volumen. Como referencia, una captura típica ocupa entre 50 y 300 KB.

### 4.9 Resolución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| El despliegue no arranca: `SESSION_SECRET debe tener al menos 32 caracteres` | Variable vacía o corta | Genera una con `openssl rand -base64 48`. |
| `[boot] No hay usuarios. Define SEED_ADMIN_EMAIL…` | Primer arranque sin variables de seed | Añade `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` y redespliega. |
| El login no mantiene la sesión | `APP_URL` con `https://` pero se accede por `http://` | Accede por HTTPS o ajusta `APP_URL`/`COOKIE_SECURE`. |
| Las capturas desaparecen tras desplegar | No hay volumen montado o la ruta no coincide | Monta un Volume en `/app/uploads` y comprueba que `UPLOAD_DIR` es igual. |
| «La imagen supera el tamaño máximo» | Imagen de más de `MAX_UPLOAD_MB` | Reduce la imagen o sube el límite. |
| No aparece «Generar Release» | Ninguna columna tiene el rol *Siguiente salto* | Asígnalo desde el menú «⋯» de la columna. |
| No se puede «Mover a En producción» | Ninguna columna tiene ese rol | Asígnalo, o elige *Archivar tarjetas* al desplegar. |
| Un miembro no ve un proyecto | El proyecto está restringido | *Ajustes del proyecto → Visibilidad* → márcalo. |
| «La integración con Google no está configurada» | Faltan `GOOGLE_CLIENT_ID`/`SECRET` o `APP_URL` | Configúralos y redespliega. |
| Google devuelve `redirect_uri_mismatch` | La URI de redirección del cliente OAuth no coincide | Debe ser exactamente `APP_URL` + `/api/google/callback`. |
| «Tu conexión con Google ha caducado» | Permiso revocado o `SESSION_SECRET` rotado | Vuelve a conectar en *Mi perfil*. |
| No llegan los emails | Credenciales SMTP o contraseña de aplicación incorrectas | Revisa los logs `[notify]` y la columna `deliveryError`. |
| No llegan los WhatsApp | Plantilla sin aprobar, idioma distinto, token caducado o número no verificado (número de prueba) | Revisa los logs `[notify]`, el estado de la plantilla y `WHATSAPP_TEMPLATE_LANG`. |
| El informe no marca una tarjeta como hecha | Su columna no cuenta como terminada | Menú «⋯» de la columna → *Contar como terminada*. |

---

## 5. Anexo: decisiones técnicas

| Decisión | Motivo |
|---|---|
| Next.js en un solo servicio | Interfaz y API en el mismo despliegue; Server Actions sin capa REST manual. |
| Sesiones en base de datos frente a JWT | Permiten revocar sesiones (cerrar sesión, desactivar usuarios) y la consulta extra no se nota con 5 usuarios. |
| Posiciones fraccionarias | Reordenar sin reescribir toda la columna. |
| Roles de columna | Permiten renombrar y reordenar columnas sin romper el generador de releases. |
| Generación de la release en el cliente | Respuesta instantánea y edición libre antes de guardar. |
| `changelog.json` como fuente | Versionado con el código y legible en revisiones; la tabla `AppVersionLog` se reconstruye en cada arranque. |
| Informe con `@react-pdf/renderer` | Genera el PDF en el servidor sin un navegador: la imagen no crece y el informe tarda milisegundos. |
| OAuth por usuario con `drive.file` | Cada archivo pertenece a quien lo crea, sin cuentas de servicio ni permisos sobre el resto del Drive. |
| Tipos de tarea en tabla | Cada equipo define sus categorías y su orden en la release sin tocar código. Las releases guardan el nombre del tipo como instantánea. |
| App instalable (PWA) | Icono en la pantalla de inicio y pantalla completa sin publicar en tiendas. El service worker no guarda datos en caché, porque todo es privado. |
| Avisos con `after()` | El email y el WhatsApp se envían tras responder: mencionar a alguien no añade espera. |
| Prisma CLI aislado en la imagen | La app usa la salida *standalone* (ligera) y las migraciones usan la CLI oficial sin descargas en el arranque. |
