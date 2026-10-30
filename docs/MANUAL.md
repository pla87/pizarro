---
title: "Pizarro · Manual de operaciones"
subtitle: "Arquitectura, guía de uso y procesos operativos"
version: "v1.33.0"
---

# Pizarro — Manual de operaciones

**Versión de la aplicación:** v1.33.0

Este manual describe la arquitectura de Pizarro, cómo se usa en el día a día y los procesos para operarla en producción (Railway). Todos los valores que aparecen (emails, dominios, contraseñas) son **ejemplos ficticios**. No escribas en este documento credenciales ni datos reales.

---

## 1. Visión general

Pizarro es un tablero Kanban ligero para un equipo de hasta 10 personas. Su objetivo es cubrir un flujo concreto:

1. registrar tareas rápidamente, incluidas capturas de pantalla pegadas desde el portapapeles;
2. moverlas por columnas hasta el **siguiente salto a producción**;
3. generar con un clic las **release notes** agrupadas por tipo, editarlas, exportarlas y marcar el despliegue.

| Concepto | Descripción |
|---|---|
| Proyecto | Espacio de trabajo con sus propias columnas, tareas, etiquetas y releases. |
| Columna | Estado del flujo. Configurable por proyecto. Puede tener un **rol** (*Siguiente salto*, *En producción* u otro de los especiales de 3.3). |
| Tarjeta / tarea | Unidad de trabajo con tipo, color, responsable, etiquetas, enlace, subtareas, descripción y capturas. |
| Release | Registro histórico de un despliegue: texto final editado y tareas incluidas. |
| Plantillas de release | Cabecera y pie estándar de cada usuario, que se insertan en las releases que genera. |
| Plantilla de proyecto | Columnas, tipos de tarea (con descripción y subtareas predefinidas) y etiquetas con los que se crea un proyecto nuevo. La gestionan los administradores. |
| Entregable | Hito del proyecto con fecha objetivo que agrupa tarjetas. Su avance aparece en el informe PDF. |
| Aviso | Notificación que recibe una persona (mención, asignación, cambio de fecha, comentario en una tarea que sigue…): en la app, por email y, si lo activa, por WhatsApp. |
| Proyecto de equipo | Proyecto visible para los usuarios **asignados** y para todos los administradores. |
| Proyecto privado | Proyecto con miembros, visible **solo** para ellos (ni siquiera para los administradores). |
| Calendario | Vista mensual con las tareas por fecha límite y los entregables (ver 3.11). |

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

La aplicación es un **monolito en un único contenedor**. No hay colas, cachés externas ni servicios adicionales: con hasta 10 usuarios, cada pieza extra sería un coste y un punto de fallo sin beneficio.

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
| `tests/` | Tests unitarios (`npm test`) y de integración (`npm run test:db`, en `tests/db/`). |

### 2.3 Flujo de una petición

1. `src/proxy.ts` comprueba **sin consultar la base de datos** que existe la cookie de sesión. Si no existe, redirige a `/login` (o devuelve 401 en `/api`). También renueva la caducidad de la cookie al navegar.
2. La página, acción o ruta valida la sesión contra la base de datos (una consulta por petición, cacheada con `React.cache`).
3. Cada operación sobre un recurso comprueba que el proyecto es visible para el usuario (`src/lib/access.ts`).
4. Las mutaciones validan la entrada con `zod` y devuelven `{ ok, data | error }` para que la interfaz muestre el error sin recargar.

### 2.4 Modelo de datos

| Tabla | Campos principales | Notas |
|---|---|---|
| `User` | email (único), name, passwordHash, role, active, cardStyle, theme, accent, locale, editorMode, preferencias de aviso, `mustChangePassword`, `googleSub`, `twoFactorMethod` (y su secreto cifrado), `dailyDigest*` | Se pueden desactivar o borrar; al borrar a alguien se borran los proyectos privados donde era el único miembro. |
| `Session` | id = HMAC del token, userId, expiresAt | El token en claro solo vive en la cookie. |
| `Project` | name, description, `isPrivate`, `privateOwnerId`, position | `isPrivate = false` → proyecto de equipo (usuarios asignados y administradores). `isPrivate = true` → solo sus miembros. |
| `ProjectMember` | projectId, userId | En un proyecto de equipo, los usuarios **asignados**; en uno privado, sus miembros. |
| `AdminProjectPick` | projectId, userId | Proyectos de equipo en los que trabaja cada administrador (los que salen en sus selectores, menús y calendario). |
| `Column` | projectId, name, position, role | Índice único parcial: como máximo una columna con *Siguiente salto* y una con *En producción* por proyecto; el resto de roles se pueden repetir. |
| `Task` | projectId, columnId, kindId, title, description, color, linkUrl, position, assigneeId, archivedAt, `recurrence*` (repetición) | Posición fraccionaria para reordenar actualizando una sola fila. |
| `Label` / `TaskLabel` | name, color | Etiquetas por proyecto. |
| `Subtask` | taskId, title, done, position | Subtareas de una tarea (no pasan a las releases). |
| `UndoEntry` | userId, projectId, taskId, `kind` (UNDO / REDO), label, ops (JSON), createdAt | Las 10 últimas acciones deshacibles (y las 10 rehacibles) de cada usuario en cada proyecto, con sus operaciones inversas. Una acción nueva vacía las rehacibles. Caducan a los 7 días. Su etiqueta se guarda como plantilla traducible. |
| `TaskAttachment` | taskId, originalName, width, height, size | El fichero está en `UPLOAD_DIR/<id>.webp` (y `<id>.thumb.webp`). |
| `ProjectDocument` | projectId, name, mimeType, size, `kind` (TEXT / MARKDOWN / PDF / IMAGE / OTHER), createdById, createdAt, updatedAt, `deletedAt` / `deletedById` (papelera: si hay fecha, está borrado y se purga a los 7 días) | Documentación del proyecto. El fichero está en `UPLOAD_DIR/documents/<id>.bin` (las imágenes, ya en WebP). Se borra en cascada con el proyecto. |
| `Release` / `ReleaseTask` | number (correlativo por proyecto), content (Markdown final), deployedAt, autor · instantánea de título y tipo de cada tarea | La instantánea se conserva aunque la tarea se borre. |
| `AppVersionLog` | version (única), releasedAt, summary, changes (JSON) | Se sincroniza desde `changelog.json` en cada arranque. |
| `Deliverable` | projectId, name, description, dueDate, position | Las tareas lo referencian con `deliverableId`. Al borrarlo, quedan sin entregable. |
| `TaskKind` | name, color, position, projectId (opcional), `subtaskTemplate` (subtareas predefinidas), título y descripción automáticos | Tipos de tarea configurables; sin `projectId` son generales, con él son exclusivos de ese proyecto. Nombre único entre los generales y dentro de cada proyecto. Cada tarea tiene `kindId`. |
| `ReleaseTemplate` | userId, kind (HEADER / FOOTER), name, content, position | Cabeceras y pies de release de cada usuario. |
| `TaskComment` | taskId, authorId, body, `parentId` | Las menciones se guardan como `@[Nombre](user:ID)`. `parentId` enlaza una respuesta con su comentario (un solo nivel). |
| `Notification` | userId, actorId, taskId, excerpt, readAt, emailSentAt, whatsappSentAt, deliveryError | Un aviso por persona mencionada, con el resultado de cada envío. |
| `TaskLink` | taskId, kind (GOOGLE_DOC / GOOGLE_SHEET), title, url | Documentos de Google enlazados a la tarjeta. |
| `GoogleAccount` | userId, email, refreshTokenEnc, accessTokenEnc, scope | Tokens OAuth cifrados con AES-256-GCM. |
| `AppState` | clave, valor | Estado interno que debe sobrevivir a reinicios (p. ej. cuándo se avisó por última vez de una copia atrasada). |
| `AuthToken` | userId, tipo (invitación, restablecer contraseña, confirmar cambio de contraseña o de email), hash, expiresAt, usedAt | Enlaces de un solo uso; solo se guarda el hash del token. |
| `KnownDevice` | userId, hash del dispositivo, lastSeenAt | Dispositivos ya vistos, para el aviso de inicio de sesión nuevo. |
| `LoginChallenge` | userId, método, hash del código, expiresAt, intentos | Paso intermedio del inicio de sesión con verificación en dos pasos. |
| `RecoveryCode` | userId, hash, usedAt | Los 10 códigos de recuperación de la verificación en dos pasos. |
| `TaskFollower` | taskId, userId | Quién sigue una tarea (recibe avisos de sus comentarios). |
| `TaskEvent` | taskId, actorId, tipo, datos, createdAt | Historial de la tarea; se conserva 365 días. |
| `ReportSchedule` | projectId, destinatario, día de la semana, hora, lastSentAt | Programación del informe PDF semanal por email. |

Además, `Session` guarda el dispositivo y la última actividad (para **Sesiones abiertas**). `Task` tiene `dueDate` (fecha límite, solo día), `Column` tiene `isDone` (sus tarjetas cuentan como terminadas) y `User` tiene sus preferencias de aviso (`notifyEmail`, `notifyWhatsapp`, `whatsappPhone`).

### 2.5 Seguridad

| Medida | Implementación |
|---|---|
| Contraseñas | bcrypt (coste 11), entre 10 caracteres y 72 bytes. Tiempo de respuesta constante si el usuario no existe. Los admins no fijan contraseñas ajenas: invitan o fuerzan un cambio por enlace. Los enlaces (invitación 72 h; restablecer y confirmar cambios 30 min) son de un solo uso y se guardan solo como hash. |
| Sesiones | Token aleatorio de 256 bits en cookie `HttpOnly`, `SameSite=Lax` y `Secure` (con HTTPS, con prefijo `__Host-`). En base de datos solo se guarda su HMAC-SHA256 con `SESSION_SECRET`. Caducidad deslizante de 14 días. Cada persona ve y cierra sus sesiones en **Sesiones abiertas**. |
| Revocación | Cerrar sesión, cambiar la contraseña, restablecerla, forzar el cambio, desactivar al usuario o cambiarle el rol eliminan sus sesiones. Iniciar sesión cierra la sesión anterior de ese navegador. Las conexiones en vivo (SSE y presencia) se cortan al instante al desactivar al usuario, cambiarle el rol, cerrar sesiones o quitarle el acceso a un proyecto (incluida la desasignación de un proyecto de equipo); máximo 10 conexiones en vivo por persona. |
| Verificación en dos pasos | App TOTP o código por email, con 10 códigos de recuperación (se muestran una vez). Obligatoria para admins con contraseña, opcional para el resto. Los secretos se cifran con `ENCRYPTION_KEY` (o, si no está definida, con una clave derivada de `SESSION_SECRET`). «Recordar este dispositivo 14 días» la omite en ese navegador. Un admin puede reiniciar el segundo paso de otra persona. |
| Inicio con Google | OpenID Connect con PKCE. Solo entran usuarios existentes y activos (por email verificado y, después, por id de Google); opcionalmente limitado a `GOOGLE_WORKSPACE_DOMAIN`. No pide segundo paso propio (vale el de Google). |
| Avisos de cuenta | Email de aviso al iniciar sesión desde un dispositivo desconocido (no en el primer acceso de una cuenta) y tras cualquier cambio de contraseña o de email. Al cambiar el email de una cuenta (desde el perfil o por un admin) se desvincula su cuenta de Google y dejan de valer los enlaces pendientes enviados a la dirección anterior (invitación, restablecer, confirmar); si era una invitación con el email mal escrito, hay que volver a enviarla. Cerrar sesión borra la cookie del navegador. |
| Fuerza bruta y abuso | Límite de intentos de login por pareja IP+email y por IP (ventana de 15 minutos), de «¿Olvidaste tu contraseña?» y de cambios de contraseña. También hay topes de subidas (60 por minuto y persona), comentarios (30 por minuto; por tarea, 500 por defecto, configurable entre 1 y 1000 en *Administración → Ajustes*), subtareas (100 por tarea), documentos de Google (20 por minuto), creación de tareas (300 por minuto y persona), etiquetas y entregables (30 por minuto), suma de adjuntos por tarea y tamaño de cada paquete ZIP de una release (80 MB por defecto cada uno, configurables en cada proyecto entre 10 y 500 MB, y el de un archivo entre 1 y 100 MB; cada persona arma un ZIP a la vez y el servidor como mucho dos), cola de imágenes en proceso (más de 10 esperando: «inténtalo de nuevo en unos segundos») e informes PDF (5 por minuto y persona; se generan de uno en uno para que la app no se frene). |
| CSRF | `SameSite=Lax`, verificación de `Origin` integrada en las Server Actions y comprobación explícita de `Origin` en la ruta de subida. |
| Autorización | Sin registro público. Solo los admins gestionan usuarios. Cualquier usuario puede crear proyectos privados (máximo 100 por usuario no admin y 10 creaciones por hora). Cada operación comprueba la visibilidad del proyecto: un usuario no admin solo accede a los proyectos de equipo a los que está **asignado** y a sus privados; los admins acceden a todos los de equipo; los privados solo los ven sus miembros. Deshacer y rehacer nunca reasignan una tarjeta a alguien que ha perdido el acceso. |
| XSS | React escapa todo el contenido. El Markdown se renderiza sin HTML. Los enlaces solo admiten `http(s)` y se abren con `rel="noopener noreferrer"`. CSP estricta con *nonce* distinto en cada petición. |
| Cabeceras | `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `HSTS`. |
| Imágenes | Tamaño máximo configurable, límite de píxeles en sharp (protección frente a *decompression bombs*), reconversión siempre a WebP (se descarta cualquier contenido incrustado) y servido solo a usuarios con acceso. |
| Adjuntos | Cuota por proyecto (`UPLOAD_QUOTA_MB_PER_PROJECT`, 2048 MB por defecto) y cuota total opcional (`UPLOAD_QUOTA_MB_TOTAL`). Limpieza diaria de ficheros huérfanos (de más de 24 h; nunca toca `backups/` y se aborta si más del 50 % parecen huérfanos). |
| Documentación | Se sirve solo a quien ve el proyecto, con `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` y `X-Frame-Options: SAMEORIGIN` (solo la propia app puede incrustarla). Nada se sirve como HTML: texto y Markdown van como `text/plain` y los pinta el navegador (el Markdown, con el mismo componente seguro que las descripciones); las imágenes se reconvierten a WebP; el SVG, el HTML y cualquier PDF o texto cuyo contenido no lo sea de verdad son «otros» y solo se descargan (como `application/octet-stream`). El tipo se decide al subir y no cambia al renombrar. |
| Copias de seguridad | Volcado diario de la base de datos, comprimido (gzip) y cifrado con AES-256-GCM (`BACKUP_KEY`). Descargar una copia exige tu contraseña (o un código de tu app de autenticación) y usa un enlace de un solo uso que caduca a los 60 s. Ver 4.5. |
| Contenedor | El proceso Node se ejecuta como el usuario sin privilegios `node`. |
| Google | OAuth con permiso mínimo `drive.file`: solo da acceso a los archivos que crea Pizarro. Parámetro `state` ligado a la sesión contra CSRF. Tokens cifrados en base de datos. Opcionalmente, restringido a un dominio de Workspace. Los archivos de proyectos de equipo se comparten con el dominio; los de proyectos privados, solo con los miembros del proyecto. |
| Informes por email | El informe PDF semanal solo puede enviarse a personas con acceso al proyecto (una dirección externa solo la puede fijar un admin y nunca en proyectos privados). Se vuelve a comprobar al enviar. |
| Registros | Los logs nunca guardan contraseñas, tokens, cookies ni teléfonos (se ocultan por nombre de campo). Una migración de la v1.15 borró las contraseñas que versiones anteriores dejaban en los logs al cambiarlas o restablecerlas. Si alguien escribe en el campo de email del login algo que no es un email (p. ej. una contraseña por error), se registra como «[no es un email]». |
| Avisos | Solo se avisa a usuarios activos con acceso al proyecto (en uno de equipo, los asignados y los admins; en uno privado, solo sus miembros). El email y el WhatsApp no se repiten a la misma persona por la misma tarea en 10 minutos, y cada autor tiene un tope de envíos por hora. El contenido de los emails se escapa y los enlaces apuntan siempre a `APP_URL`. |

### 2.6 Rendimiento

- **Una ida y vuelta por pantalla:** el tablero carga columnas, tarjetas, usuarios, etiquetas y plantillas con consultas en paralelo.
- **Acciones del tablero con pocas idas y vueltas:** mover una tarjeta lee la tarea (con el permiso), su columna, la de destino y las vecinas en paralelo y la coloca en una transacción corta con la columna bloqueada, de modo que dos movimientos simultáneos nunca dejan dos tarjetas en la misma posición; editar una tarea la lee una vez; desplegar una release mueve todas sus tareas con una sola sentencia y prepara las copias de los adjuntos para el histórico después de responder (aparecen unos segundos más tarde; si alguna falla, queda en los logs como `releases.saveAttachments`).
- **Interfaz optimista:** mover tarjetas, marcar subtareas o editar campos se reflejan al instante; si el servidor rechaza el cambio, se revierte y se muestra el error.
- **Posiciones fraccionarias:** mover una tarjeta actualiza una sola fila.
- **Generación de releases en el navegador:** instantánea, sin llamadas al servidor hasta *Marcar como desplegado*.
- **Imágenes:** en móvil, las fotos grandes se reducen en el navegador antes de subirse. El servidor genera una miniatura, y el navegador guarda las imágenes un día en su caché privada; pasado ese tiempo pregunta al servidor, que responde «sin cambios» (304) tras comprobar el acceso, sin volver a enviar la imagen.
- **Sin dependencias externas en tiempo de ejecución:** fuentes del sistema, sin CDNs.
- **Cambios casi al momento:** cada cambio en un proyecto se avisa al instante a las pestañas que lo tienen abierto (canal *Server-Sent Events* `/api/projects/[id]/events`) y estas se refrescan en menos de un segundo, también entre dos pestañas tuyas. Como respaldo, el tablero también se actualiza al volver a la pestaña y cada 2 minutos (el canal en vivo hace el resto).
- **Carga diferida:** el código de los diálogos (detalle de tarea, nueva tarea, release, varias tareas, archivadas) no se descarga al abrir el tablero; se precarga cuando el navegador está libre. El editor con barra de formato solo se descarga cuando se usa.
- **Tablero que solo repinta lo necesario:** al cambiar algo se vuelven a dibujar solo las tarjetas afectadas.
- **Tablero ligero:** al cargar el tablero no se envían las descripciones de las tarjetas (solo si tienen); se piden al abrir cada tarea.
- **Errores de red:** si una acción del tablero falla por red o tras un despliegue, se avisa, se deshace el cambio optimista solo en las tarjetas afectadas y se recarga el tablero.
- **Calendario ligero:** solo carga las tareas y entregables del rango de fechas visible, con índices por fecha límite.
- **Índices y limpieza:** índices para avisos y deshacer; el mantenimiento horario borra avisos leídos de más de 90 días, y cada día se buscan adjuntos huérfanos y se hace la copia de seguridad.
- **Logs sin duplicados:** las visitas a una misma página de una misma persona se registran como mucho una vez por minuto (los refrescos automáticos no llenan los logs).

---

## 3. Guía de uso

### 3.1 Acceso y seguridad de la cuenta

- Entra con tu email y contraseña, o con **Iniciar sesión con Google** si está configurado (solo entra quien ya tiene cuenta). No hay registro público: la cuenta la crea una persona de administración.
- **Primer acceso:** con email configurado recibes un **enlace de invitación** (válido 72 h) para elegir tu contraseña. Sin email, el admin te da una contraseña inicial y la app te obliga a cambiarla al entrar. Si un admin ha forzado el cambio de contraseña, también se pide al entrar con Google (aunque el servidor solo admita Google, hay que elegirla para continuar).
- **Cambio forzado:** si un admin usa **Forzar cambio de contraseña**, no puedes hacer nada más hasta elegir una contraseña nueva y distinta de la actual.
- **¿Olvidaste tu contraseña?** (siempre visible en la pantalla de acceso): con email configurado, escribe tu email y recibirás un enlace (válido 30 min, de un solo uso); la respuesta es siempre la misma exista o no la cuenta, al usarlo se cierran todas tus sesiones y tiene límite de intentos. Si el servidor no envía emails, la página explica las alternativas: entrar con Google (si está configurado) o pedir a un administrador que le genere un enlace de un solo uso con **Forzar cambio de contraseña** en *Administración → Usuarios*. Esa página de Administración avisa cuando no hay ni email ni Google, porque entonces nadie puede recuperar su contraseña por sí mismo.
- **Mi perfil** se organiza en cuatro pestañas (la elegida queda en la dirección, `?tab=`): **Cuenta** (perfil, contraseña, email, verificación en dos pasos, sesiones y Google), **Plantillas** (cabeceras y pies de release notes), **Preferencias** (idioma, apariencia, edición de descripciones, borradores y, para admins, *Proyectos en los que trabajo*) y **Avisos** (menciones, resto de avisos y resumen diario). Permite cambiar nombre, contraseña y email:
  - **Contraseña:** mínimo 10 caracteres y máximo 72 bytes. Con email configurado, el cambio solo se aplica al pulsar el **enlace de confirmación** que recibes (30 min). Tras cualquier cambio llega un email de aviso. Se cierran tus sesiones en los demás dispositivos.
  - **Email:** se confirma desde la nueva dirección y se avisa a la anterior.
- **Sesiones abiertas:** en el perfil, la lista de dispositivos con sesión (las sesiones duran 14 días desde la última actividad). Puedes cerrar una o **cerrar las demás**.
- **Borrar los borradores al cerrar sesión:** opción del perfil que elimina de ese navegador los borradores de tareas (ver 3.4) al cerrar sesión; útil en equipos compartidos.
- **Aviso de inicio de sesión nuevo:** si entras desde un dispositivo desconocido, recibes un email (no en el primer acceso de una cuenta).
- **Verificación en dos pasos:** con una **app de autenticación** (TOTP) o con un **código por email**.
  - Es **obligatoria para los administradores** que entran con contraseña: se configura en su primer acceso (si hay email, elegir la app también exige un código enviado por email). Los demás usuarios pueden activarla en el perfil.
  - Con la app de autenticación, al configurarla se muestran un **código QR** y la **clave** para introducirla a mano.
  - Al activarla se muestran **10 códigos de recuperación** (centrados en pantalla), una sola vez: guárdalos.
  - Casilla **Recordar este dispositivo 14 días** para no repetirla.
  - Un admin puede **reiniciar** el segundo paso de otra persona si lo pierde.
  - Con Google no se pide: vale la verificación de Google.
- El login tiene límite de intentos por pareja IP+email y por IP.
- El icono del ojo junto a un campo de contraseña muestra u oculta lo que escribes.

### 3.2 Proyectos

**Ajustes del proyecto** se organizan en pestañas (la elegida queda en la dirección, `?tab=`): **General** (nombre, visibilidad y miembros, documentos de Google, borrar), **Tablero** (campos opcionales, entregables, tipos de tarea, etiquetas, columnas), **Adjuntos y límites** (tamaños máximos), **Releases** (plantillas de release del proyecto, ver 3.6) e **Informes** (informe semanal por email). Quien no gestiona el proyecto (un miembro sin rol de admin en un proyecto de equipo) ve *Tablero*, *Releases* (solo las plantillas) e *Informes*. Al cambiar de proyecto desde los ajustes se mantiene la pestaña.

- Para cambiar de proyecto, pulsa el **nombre del proyecto** en la parte superior del tablero (o en la barra superior en móvil) y elige otro en el desplegable. También sirve el selector de la barra lateral. Te quedas en la misma página: desde los **ajustes** de un proyecto pasas a los ajustes del otro, desde las **releases** a sus releases (con el texto buscado) y desde el **tablero** a su tablero. La app recuerda el último que abriste: aunque vayas a *Calendario*, *Avisos*, *Mis tareas*, *Mi perfil* u otra página general, el proyecto sigue elegido en el menú, con sus entradas (*Tablero*, *Releases*, *Ajustes del proyecto*, *Archivadas*) para volver directamente.
- Los administradores crean proyectos desde el selector (**Nuevo proyecto**) y pueden elegir una **plantilla** (ver 3.16) y marcarlo como **privado**; al crearlo se abren primero sus **ajustes** (columnas, tipos, miembros…), con el botón **Ir al tablero** arriba; los proyectos de equipo que crean se añaden solos a sus «Proyectos en los que trabajo». Los demás usuarios también pueden crear proyectos, pero **solo privados** (máximo 100 y 10 creaciones por hora).
- **Qué proyectos ves:** un usuario no admin solo ve los proyectos de equipo a los que está **asignado** y sus proyectos privados. Los administradores pueden abrir cualquier proyecto de equipo, pero en **Mi perfil → Proyectos en los que trabajo** eligen cuáles salen en sus selectores, menús y calendario. Si un admin no ha elegido ninguno, la página de inicio le muestra una pista. En el selector de proyectos, **Ver proyectos existentes** abre la lista de todos los proyectos de equipo para abrirlos o **añadirlos a sus proyectos** (o quitarlos). En *Administración → Proyectos*, cada admin aparece como un botón «elegido / no elegido»: cualquier admin puede elegir ahí proyectos para sí mismo y para otros admins (queda en el registro). Al actualizar a la v1.17 se respetó el acceso previo: todos los usuarios quedaron asignados a los antiguos proyectos públicos y los admins con todos marcados. Sin plantilla, el proyecto trae las columnas *Backlog*, *En progreso*, *Siguiente salto a producción*, *En producción* y *Cerrado*; si quien lo crea usa Pizarro en inglés, salen en inglés (*Backlog*, *In progress*, *Next release*, *In production*, *Closed*).
- **Ajustes del proyecto** contiene:
  - nombre y descripción (admins; en un proyecto privado, cualquier miembro);
  - **visibilidad** (admins), con dos opciones:
    - *Equipo*: lo ven los **usuarios asignados** y todos los administradores. Los usuarios asignados se gestionan aquí (y en **Administración → Proyectos**); quitar la asignación a alguien desasigna sus tarjetas y corta su vista en vivo del proyecto;
    - *Privado*: al pasar un proyecto de equipo a privado, las **personas asignadas pasan a ser miembros** (conservan el acceso y sus tarjetas) y quien lo cambia también es miembro; el diálogo de confirmación indica cuántas personas mantienen el acceso. Los administradores que lo veían solo porque lo tenían en *Proyectos en los que trabajo* pierden el acceso y sus tarjetas se desasignan; luego se pueden quitar miembros. Tiene **miembros** y lo ven **solo ellos**, tampoco los administradores que no sean miembros; no aparece en sus listados, avisos ni asignaciones. Cualquier miembro puede **añadir o quitar miembros**, renombrarlo y borrarlo (escribiendo su nombre). El último miembro no puede salir. Al **borrar a un usuario** se borran los proyectos privados donde era el único miembro; en los demás, simplemente deja de ser miembro. Llevan un **candado** junto a su nombre;
  - etiquetas;
  - **informe semanal por email** (ver 3.9);
  - **Releases** (admins; en un proyecto privado, cualquier miembro): tres límites. Las únicas reglas: un archivo nunca puede superar el total de la tarea ni el tamaño de un paquete ZIP. El total de una tarea sí puede superar el del paquete: al descargar la release, sus archivos se reparten en varios ZIP.
    - **Tamaño máximo de un adjunto:** lo que puede pesar cada archivo (de 1 a 100 MB; 20 MB por defecto). Un archivo mayor se rechaza con un aviso que indica el tope del proyecto. Cada archivo se carga entero en la memoria del servidor mientras se sube, así que un valor muy alto significa más memoria por subida: súbelo solo si hace falta. Si el servidor define `MAX_UPLOAD_MB`, esa variable actúa como tope adicional para todos los proyectos;
    - **Tamaño máximo de los adjuntos de una tarea:** la suma de los adjuntos de cada tarea (nunca menos que el de un archivo); una subida que la supere se rechaza con un aviso que indica el tope. Solo cuentan los adjuntos que tiene la tarea: los borrados no suman, aunque aún se puedan recuperar con *Deshacer*;
    - **Tamaño máximo de cada paquete ZIP de una release** (10–500 MB, 80 por defecto; nunca menor que el de un archivo): si los adjuntos de la release ocupan más, se descargan en varios ZIP (`release-AAAA-MM-DD-adjuntos-1de3.zip`, …), con el menor número de paquetes posible. Cada ZIP se arma en la memoria del servidor: súbelo solo si hace falta;
  - **Documentos de Google** (si Google está activado; admins, o cualquier miembro si es privado): con quién se comparten los Docs y Sheets creados desde las tareas (ver 3.10);
  - borrado del proyecto (admins, o cualquier miembro si es privado; pide escribir el nombre para confirmar).
- **Límites de cada proyecto:** como máximo **50 etiquetas**, **100 entregables** y **1000 tareas activas** (las archivadas no cuentan). Al llegar al tope, crear, duplicar, recuperar una archivada o deshacer un borrado avisa con el límite; archiva o borra tareas para hacer sitio. Al crear varias tareas a la vez, si el lote no cabe entero no se crea ninguna. Si una tarea repetitiva se termina con el proyecto lleno, no se crea la siguiente repetición (queda anotado en los logs). Además, cada persona puede crear como mucho 300 tareas, 30 etiquetas y 30 entregables por minuto.

**Campos opcionales de las tareas** (*Ajustes del proyecto*, todos desactivados por defecto): **Coste** (en €, con casilla *Pagado*), **Horas** (estimadas y reales, de 0,25 en 0,25), **Prioridad** (baja, media, alta, urgente), **Cliente** (hasta 120 caracteres, con sugerencias de los ya usados), **Fecha de inicio** (no puede ser posterior a la fecha límite). El **Enlace externo** de la tarea (solo http/https) está siempre disponible y no es un campo opcional; en la v1.30 el antiguo *Enlace de referencia* se integró en él (si una tarea tenía los dos distintos, el de referencia se añadió al final de la descripción). Los activados aparecen en el grupo *Campos* de la tarea nueva y del detalle; la tarjeta muestra la prioridad (con color) y el coste; los filtros del tablero permiten filtrar por prioridad y cliente; *Varias tareas* permite fijar prioridad y cliente comunes; el informe PDF incluye una sección con totales de coste y horas. Los cambios se pueden deshacer y quedan en el historial. Desactivar un campo lo oculta sin borrar los datos. Las plantillas de proyecto guardan qué campos están activos. El borrador de tarea nueva también los guarda. Con *Fecha de inicio* activa, el calendario dibuja las tareas con inicio y fecha límite como una franja (ver 3.11).

### 3.3 Columnas

Desde el menú «⋯» de cada columna:

- **Renombrar**, **Mover a la izquierda o la derecha**.
- **Rol de la columna**: *Sin rol*, *Siguiente salto*, *En producción*, *Esperando*, *Planificación semanal*, *Lista consolidada*, *Revisión con requisitos*, *Agenda*, *Rutinas*, *Entrega al cliente* o *Presupuesto*. *Siguiente salto* y *En producción* son únicos: si asignas uno que ya tenía otra columna, esa otra pasa a *Sin rol* (deshacer se lo devuelve, con sus tareas fijas). Los demás se pueden poner en varias columnas. Al quitarle a una columna el rol *Esperando* o *Rutinas* se borran sus ajustes de ese rol (días de espera o destino); deshacer los recupera.
  - **Esperando** (tareas que dependen de otra persona): con **Recordar tras N d…** (de 1 a 365 días; 3 por defecto) eliges cuándo avisar. Cuando una tarea lleva ese tiempo en la columna, su responsable (o quien la creó, si no tiene) recibe un aviso en Pizarro y, si lo tiene activado, por email. Se avisa una vez por estancia: si la tarea sale y vuelve, cuenta de nuevo (también al restaurarla del archivo). Los días son días naturales en la zona horaria de la app. Al convertir una columna en *Esperando*, sus tareas empiezan a contar desde ese momento. Las tarjetas muestran «Esperando N d» (en ámbar al cumplirse el plazo). No avisa de tareas archivadas ni en columnas que cuentan como terminadas. Lo revisa cada hora la tarea de mantenimiento *Recordatorios de tareas en espera*.
  - **Planificación semanal**: el menú de la columna ofrece **PDF de la semana (por día)**, con las tareas de lunes a domingo de la semana actual según su fecha límite y después *Otras fechas* y *Sin fecha*, y **(por persona)**, agrupadas por responsable con *Sin responsable* al final.
  - **Lista consolidada**: **Ver lista** reúne las subtareas de todas las tarjetas de la columna en una sola lista, agrupada por tarjeta o por tipo de tarea. Marcar un elemento marca la subtarea original (se puede deshacer). Botones **Copiar como texto** (lista Markdown) y **PDF**. Útil para la compra, la maleta o materiales.
  - **Revisión con requisitos**: al sacar una tarjeta de la columna (arrastrando, con el menú, con Alt+flechas, en bloque o desde el detalle) con subtareas sin marcar, avisa de lo que falta («Faltan 2 subtareas: …») con **Mover igualmente** o **Cancelar**. Es solo un aviso.
  - **Agenda**: **Exportar a calendario (.ics)** descarga un archivo con las tareas no archivadas que tienen fecha límite, como eventos de día completo (de la fecha de inicio a la límite si el proyecto usa *Fecha de inicio*; título, descripción en texto y enlace a la tarea), para Google Calendar, Apple u Outlook.
  - **Rutinas**: para tareas recurrentes. Cada tarjeta muestra «Próxima: fecha». Con **Destino de la siguiente aparición** eliges en qué columna se crea la siguiente al terminar o archivar una (por defecto, la propia columna). Una tarea que estuvo en una columna Rutinas sigue yendo a ese destino aunque se termine desde otra columna. El destino no puede ser una columna terminada ni otra de Rutinas. La siguiente aparición copia coste (sin marcar como pagado), horas estimadas, prioridad y cliente, y mueve la fecha de inicio lo mismo que la fecha límite.
  - **Entrega al cliente**: **Resumen para el cliente (PDF)** con nombre del proyecto y fecha y, por tarea, título, tipo, fecha límite y subtareas hechas; sin descripciones, comentarios ni responsables.
  - **Presupuesto**: la cabecera muestra la suma del coste de sus tareas no archivadas y el menú ofrece **Resumen de presupuesto** (Pagado / Pendiente / Total). Al asignar el rol se activa el campo opcional *Coste* (ver 3.2), que no se puede desactivar mientras exista alguna columna Presupuesto.
- **Borrar columna**: solo si no tiene tarjetas visibles. Si quedan tarjetas archivadas en ella, pasan a la primera columna del proyecto.
- **Ancho:** en escritorio, con cuatro columnas o más se reparten todo el ancho de la ventana (mínimo 18 rem; si no caben, scroll horizontal). Con una a tres, cada una mide lo mismo que con cuatro (un cuarto del ancho, sin contar la barra «+»), así que tres ocupan el 75 %.
- **Añadir columna**: en escritorio, la barra vertical estrecha con un «+» al final del tablero; en móvil, el botón redondo «+» al final de las pestañas de columnas. No hay límite de 5; el máximo es 30 por proyecto.

### 3.4 Tarjetas

- **Crear:** botón *Nueva tarea*, el «+» de cada columna o el botón flotante en móvil. El formulario empieza por **Título, Tipo y Descripción**; en móvil se abre arriba de la pantalla para que esos campos se vean con el teclado abierto. Solo el título y el tipo son obligatorios; asignarla a alguien es opcional. Si el tipo tiene **subtareas predefinidas**, se añaden al elegirlo (ver 3.14). También se pueden añadir **subtareas** (Enter añade cada una). **Ctrl/⌘+Enter** en cualquier campo crea la tarea.
- **Crear varias a la vez:** botón **Varias tareas** (escritorio) o el botón flotante pequeño encima del «+» (móvil).
  - Elige la columna (por defecto, la que estás viendo) y pega una lista: **cada línea es una tarea** con ese título. Las líneas vacías se ignoran y se quitan viñetas como «-», «*», «1.» o «[ ]».
  - Elige el **tipo para todas** y, si alguna es distinta, cámbialo en su línea. Volver a pulsar un tipo común lo aplica a todas las líneas, también a las cambiadas a mano.
  - **Campos extra** (plegado): responsable, fecha límite, entregable y etiquetas comunes a todas.
  - Las subtareas predefinidas del tipo son opcionales aquí. Hasta 100 tareas de una vez; se añaden al final de la columna en el orden de la lista.
- **Tipo:** por defecto *Funcionalidad* o *Corrección*. Los administradores pueden crear más tipos generales, y cada proyecto puede tener los suyos (ver 3.14).
- **Atajo de captura:** pega una imagen (Ctrl/⌘+V) con el tablero en pantalla y se abre *Nueva tarea* con la captura adjunta. También puedes arrastrar archivos del escritorio sobre el botón *Nueva tarea* de la cabecera (se resalta sin cambiar de tamaño): se abre el formulario con ellos ya adjuntos. Igual si los sueltas en el **hueco libre de una columna, bajo su última tarjeta** (o en cualquier parte si está vacía; la tarea se crea en esa columna), o en la sección **Siempre en la release** (sobre una de sus tareas, se adjuntan a esa tarea; en la zona vacía o junto a *+ Añadir*, se crea una tarea fija con ellos). Soltar entre dos tarjetas no hace nada. La zona se resalta mientras arrastras; soltar sobre una tarjeta sigue adjuntando a esa tarjeta.
- **Dos tareas a la vez (escritorio):** con una tarea abierta (nueva o existente), el botón **Nueva tarea** de la cabecera sigue activo por encima del fondo oscuro y abre una tarea nueva al lado (por defecto en *Backlog*): las dos quedan juntas y centradas, con el mismo ancho. Se puede trabajar en las dos; Escape o atrás cierran la última abierta. Encima de ese «+» hay otro botón más pequeño, **Varias tareas**, que abre la creación múltiple en ese mismo hueco de la derecha (también Alt+Mayús+N con un diálogo abierto).
- **Crear en otro proyecto:** la primera tarea nueva se crea siempre en el tablero actual. En la **segunda tarea simultánea** y en *Varias tareas* abierta al lado hay un desplegable de proyecto junto al título (por defecto, el actual). Al elegir otro, las columnas, tipos, personas, entregables y límites de adjuntos pasan a ser los de ese proyecto; la tarea se crea allí, no aparece en el tablero actual y un aviso ofrece **Ir al proyecto**.
- **Quién está trabajando:** a la derecha del contador de tarjetas de la cabecera (en móvil, arriba a la derecha) aparecen círculos con las **iniciales** de quienes han hecho cualquier acción en ese tablero (abrir, crear, mover, editar, subir adjuntos…) en los **últimos 5 minutos**, tú incluido; al pasar el ratón se ven sus nombres. Se actualiza cada 20 segundos. Si hay más (cinco en escritorio, tres en móvil), se muestra «+N». Además, cada tarjeta muestra arriba a la izquierda unas **burbujas pequeñas** con quién tiene esa tarea abierta.
- **Trabajar varios a la vez:** si otra persona tiene abierta la misma tarea, el detalle lo indica («Fulano también tiene abierta esta tarea»). Si cambia el **título o la descripción** mientras tú los editas, al guardar no se pisa su texto: se avisa, la tarea se recarga con sus cambios y vuelves a aplicar los tuyos. El resto de campos (tipo, color, responsable…) se guardan al momento y gana el último cambio.
- **Rapidez:** el detalle empieza a cargarse al pulsar la tarjeta. Al mover, editar, duplicar, archivar o borrar tareas, tu pestaña no recarga el tablero entero por su propio aviso en tiempo real (las de los demás, y tus otras pestañas, sí se actualizan); generar una release o cambios que reordenan otras tarjetas sí recargan.
- **Límite de la descripción:** 20 000 caracteres. Si se supera, aparece un contador «N / 20 000» en el color de resaltado junto a los iconos de copiar y borrar, y no se puede guardar. Esos iconos ocupan siempre su sitio, así que el diálogo no cambia de tamaño al escribir.
- **Guardado:** los cambios del detalle se guardan solos; en la cabecera se ve «Guardando…» y después **«Guardado»** con un check verde.
- **Deshacer y rehacer:** el botón con la flecha de volver, justo a la derecha del nombre del tablero (también en móvil), deshace **tu última acción** en ese tablero, y así hasta las **10 últimas** (cuenta como una sola acción crear una tarea con sus adjuntos y subtareas): crear, editar, mover, archivar, recuperar, borrar (con sus adjuntos y subtareas), subtareas, comentarios, adjuntos, enlaces, columnas y desplegar una release (las tareas vuelven a su sitio y la release sale del histórico). En escritorio también **Ctrl/⌘+Z** con el tablero en pantalla. Junto a él está el botón **Rehacer** (mismos contextos, mismo aspecto y el mismo comportamiento flotante), que repone lo deshecho: **Ctrl/⌘+Mayús+Z** o **Ctrl/⌘+Y** en el contexto actual, y **Alt+Mayús+Z** en el tablero. Cualquier acción nueva vacía lo rehacible; se guardan hasta 10. Si **otra persona** ha cambiado lo afectado entre tu deshacer y tu rehacer (o al revés), no se aplica: se avisa («Otra persona ha cambiado esto…») y esa acción se descarta, para no pisar su trabajo. Tus propios cambios no lo bloquean. Deshacer y rehacer nunca reasignan una tarjeta a alguien que ha perdido el acceso. El aviso de lo deshecho sale en tu idioma. Solo deshace lo tuyo; si algo ya no existe (otra persona lo borró), se salta y se avisa. Al deshacer una acción también se borra del **historial** de la tarea lo que había anotado; al rehacerla vuelve a aparecer. Las acciones de deshacer caducan a los 7 días.
  - **Con una tarea abierta**, el contexto es esa tarea: deshacer solo actúa sobre lo que has hecho en ella (cada subtarea, cada archivo subido, cada cambio), y el detalle se recarga. En escritorio el botón de deshacer sigue usable por encima del fondo oscuro del modal, y Ctrl/⌘+Z también funciona si no estás escribiendo.
- **Guardar:** el pie del detalle (también en escritorio) tiene **Guardar** (o **Alt+S**): guarda todo lo que estés editando, tal como esté escrito, y cierra. **Archivar** y **Duplicar** son iconos, y **Borrar** también, de modo que **Archivar**, **Duplicar**, **Borrar**, **Cancelar** y **Guardar** caben en una sola línea; en móvil el pie también los muestra siempre.
- **Cancelar:** deja la tarea como estaba al abrir el detalle y lo cierra: campos, etiquetas, columna, subtareas, documentos de Google y adjuntos (no los comentarios). Es un solo paso de deshacer («Cambios descartados» con **Deshacer**) y no pisa el título ni la descripción si otra persona los cambió entretanto. El **Cancelar** del editor de la descripción solo descarta lo que estás escribiendo en ella.
- **Duplicar:** en el detalle (botón con icono, junto al de **Archivar**) o con **Alt+Mayús+D** sobre la tarjeta. Crea una copia titulada «… (copia)» con las subtareas sin marcar, sin comentarios ni adjuntos; se puede deshacer. También se duplica arrastrando la tarjeta con **Ctrl** pulsado al soltar (ver 3.5).
- **Borradores:** mientras creas o editas una tarea, lo escrito se guarda en tu navegador **cada 5 segundos**. Si cierras la página sin cancelar ni guardar, al volver al tablero el modal se reabre con lo que tenías (en *Nueva tarea*, todos los campos salvo los archivos; en una tarea abierta, el título y la descripción en edición). Solo hay borrador si queda **algo sin guardar**: crear, guardar, cancelar o cerrar el modal lo borra, y una tarea abierta sin cambios nunca se reabre.
- **Persona asignada:** el círculo con iniciales en la esquina inferior derecha de la tarjeta es **la persona asignada** (al pasar el ratón: «Asignada a …»). No indica quién la tiene abierta; eso se ve dentro del detalle y en los círculos de la cabecera.
- **Filtrar el tablero:** el campo *Filtrar* de la cabecera (o la tecla **/**; en móvil, el icono de lupa) muestra solo las tarjetas cuyo título, tipo, responsable o etiquetas contienen todas las palabras escritas, sin distinguir mayúsculas ni acentos. Se ve cuántas quedan («3 de 27») y los contadores de columna cuentan solo las visibles. Se deseleccionan las tarjetas que quedan ocultas. **Se puede arrastrar con filtro activo**: las tarjetas ocultas conservan su orden. Escape borra el texto.
- **Filtros rápidos:** el menú **Filtros**, junto al campo de filtro, ofrece **Mis tareas**, **Vencidas**, **Esta semana**, **Etiqueta**, **Tipo** y **Responsable**. Se guardan por usuario y proyecto y **Limpiar filtros** los quita.
- **Atajos sobre la tarjeta con el foco:** **Espacio** la selecciona, **Alt+↑/↓** la sube o baja dentro de su columna (se puede deshacer), **Alt+M** te asigna la tarea (o te la quita), **Alt+←/→** la mueve a la columna anterior o siguiente, **Alt+D** abre la fecha límite (*Hoy*, *Mañana*, *Próximo lunes*, *Sin fecha*), **F2** renombra en la propia tarjeta y **Alt+Mayús+D** la duplica.
- **Tareas repetitivas:** en el detalle, **Repetir**: *diaria*, *semanal* (día de la semana) o *mensual* (día del mes; en meses cortos se ajusta a fin de mes). Al mover la tarea a una columna terminada o archivarla se crea la siguiente: subtareas sin marcar y fecha límite avanzada. Deshacer elimina la nueva. La tarjeta lleva un icono de repetición. El responsable se conserva solo si sigue teniendo acceso al proyecto.
- **Descartar una tarea nueva:** si cierras *Nueva tarea* (Escape, la X, *Cancelar* o fuera del modal) con algo escrito, se pide confirmación.
- **Editar:** haz clic en la tarjeta. Los cambios se guardan solos (título y enlace al salir del campo; tipo, color, responsable, etiquetas y columna al cambiarlos).
- **Copiar y borrar la descripción:** junto al título *Descripción* hay dos iconos discretos (solo si hay texto). **Copiar** lleva la descripción al portapapeles con su formato (al pegarla en Docs, Gmail o en otra tarea de Pizarro se mantienen negritas, listas y títulos) y también como Markdown. **Borrar** la vacía; en una tarea se puede deshacer desde el aviso.
- **Descripción con formato:** se guarda como Markdown y, cuando no la estás editando, se ve formateada (títulos, negrita, cursiva, subrayado, tachado, listas, listas de tareas `- [ ]`, citas, código, líneas separadoras, enlaces). Todas las descripciones (tareas, tipos de tarea, plantillas de release) tienen la misma **barra de formato**, también en modo Markdown: negrita, cursiva, subrayado, tachado, títulos, listas, lista de tareas, **aumentar y reducir sangría**, cita, código, bloque de código, línea separadora y enlace (Ctrl/⌘+K). En una lista, **Tab** y **Mayús+Tab** aumentan o reducen la sangría; fuera de una lista, Tab sigue pasando al siguiente campo. Alt+F10 lleva a la barra (flechas para moverse, Esc para volver al texto). En móvil, los formatos menos usados están en **Más formatos**. Hay dos formas de editarla, a elegir en **Mi perfil → Edición de descripciones**:
  - **Con barra de formato** (por defecto): ves el resultado mientras escribes y aplicas **negrita, cursiva, subrayado, tachado, título, subtítulo, texto normal, lista y lista numerada** con botones (o Ctrl+B / I / U). Si pegas texto en Markdown, se convierte en formato, también en el móvil (aunque el teclado lo pegue envuelto en HTML sin formato). **Supr** o **Retroceso** con texto seleccionado borran toda la selección, también cuando abarca varios elementos de una lista. Al escribir `@` aparece la lista de personas para mencionar (y `@docs` / `@sheets`); la mención se ve como una etiqueta.
  - **Markdown:** escribes los símbolos (`**negrita**`, `*cursiva*`, `~~tachado~~`, `++subrayado++`, `# Título`, `- lista`, `1. lista`); al guardar se ve formateado.
  - En ambos modos, Ctrl/⌘+Enter guarda y Escape cancela.
  - Lo que escribes se guarda tal cual, incluidos `<`, `>`, `&` o comillas, y llega igual al texto de la release (p. ej. `->` no se convierte en `-&gt;`).
- **Colores de tarjeta:** gris, blanco, rojo, naranja, marrón, amarillo, verde, verde oscuro, turquesa, celeste, índigo, azul marino, violeta y rosa (también para etiquetas).
- **Fecha de creación:** al pie del detalle, «Creada por X el 24/10/2026 a las 08:14» (zona horaria de la app).
- **Arrastrar texto:** si seleccionas texto y lo arrastras con el ratón a otro campo (título, descripción, comentario…), se **mueve**; manteniendo **Ctrl** (⌥ en Mac) se **copia** y se queda también en el origen.
- **Subtareas:** añádelas y márcalas. **Doble clic** sobre una, el **lápiz** que aparece al pasar por encima (siempre visible en móvil) o **Enter/F2** con el foco en ella la editan (Enter guarda, Escape cancela) y se **reordenan** arrastrando el icono de seis puntos. Junto al título *Subtareas* hay una barra verde que se llena según la proporción de subtareas hechas (con dos, cada una marca el 50 %, da igual el orden); la tarjeta muestra el progreso (p. ej. `2/4`). Las subtareas **no pasan** al texto de las releases.
- **Adjuntos:** cualquier tipo de archivo de hasta **20 MB por archivo** (por defecto; cada proyecto fija su máximo, ver 3.2), con un **total por tarea** que fija el proyecto (80 MB por defecto, ver 3.2). **Borrar un adjunto** no pide confirmación: sale el aviso «Adjunto borrado» con **Deshacer**, que deshace exactamente ese borrado aunque hayas hecho otras cosas después (Ctrl/⌘+Z y el botón de deshacer siguen deshaciendo tu última acción). La sección indica ambos: «Máx. 20 MB por archivo · 45 / 80 MB en total»; si se supera el total, esa parte se resalta con el color del tema. Pégalos con Ctrl/⌘+V, usa *Añadir* o **arrástralos** sobre la tarea abierta o directamente sobre su **tarjeta en el tablero** (en ambos casos aparece «Suelta para adjuntar»); también desde la ventana de descargas del navegador. Los que no son imagen se listan con su icono, nombre y tamaño, y se descargan (nunca se abren dentro de Pizarro, por seguridad). En la tarjeta del tablero, un icono de imagen indica cuántas imágenes tiene y un icono de clip/archivo cuántos otros archivos (ambos si hay de las dos clases).
- **Capturas e imágenes:** al tocar o hacer clic en una imagen se ve **a pantalla completa**; se cierra con la **X**, tocando fuera de la imagen, con Escape o con el botón atrás. Con varias imágenes, las flechas pasan de una a otra. En móvil, **Cámara** y **Añadir** son botones visibles, al crear la tarea y en el detalle de una tarea existente. Cada imagen se reduce a 1280 px de ancho como máximo y se guarda como WebP (calidad 75).
- **Archivar** oculta la tarjeta del tablero (desde su detalle o, para varias, con **Archivar** en la barra de selección). **Borrar** la elimina con sus adjuntos.
- **Archivadas:** botón en la cabecera del tablero (escritorio) o entrada **Archivadas** del menú lateral. Abre un listado con filtro de las tareas archivadas: tipo, fecha, columna de la que salieron y, si pasaron por una release, la etiqueta **En release: …**. Una tarea archivada es de **solo lectura**: no admite subtareas, comentarios, adjuntos ni enlaces hasta recuperarla (sí se puede borrar). **Recuperar** la devuelve al final de la columna en la que estaba; si esa columna ya no existe, a la primera columna del proyecto (Backlog).
- **Teclado y accesibilidad:** cada tarjeta es una sola parada de tabulador (la casilla de selección se salta; **Espacio** selecciona la tarjeta con el foco); el selector de tipo es una sola parada de tabulador y se maneja con las flechas; el tabulador salta la barra de formato del editor (**Alt+F10** entra en ella); en una tarea abierta, **Tab desde el título entra directamente en la descripción** (en modo edición) y Mayús+Tab vuelve al título (los botones *Editar* y *Cerrar* se usan con el ratón; Esc cierra); el foco es visible en todas partes; todos los desplegables comparten el mismo menú (flechas, Esc, foco) y las confirmaciones son diálogos de la propia app, no ventanas del navegador.
- En escritorio, el detalle de la tarjeta cabe entero en la pantalla: la columna principal y la lateral se desplazan cada una por su lado.

- **Versión nueva:** después de un despliegue, las pestañas abiertas se recargan solas al volver a ellas (o muestran «Hay una versión nueva · Recargar» si estás escribiendo), para no usar acciones de la versión anterior.

### 3.5 Mover tarjetas

- **Escritorio (ratón):** arrastra la tarjeta para **reordenarla** dentro de su columna o para llevarla a otra (también con filtros activos). Si al **soltarla** mantienes pulsado **Ctrl** (⌥ en Mac), se crea una **copia** en ese sitio (en cualquier columna, también la misma) y la original no se mueve; mientras lo pulsas, la tarjeta arrastrada muestra «+ Duplicar». Se deshace de una vez. Con el teclado, **Alt+←/→** la cambia de columna. El orden de las tarjetas es siempre estable: dos tarjetas nunca comparten posición (la v1.21 corrigió las que la compartían, que podían intercambiarse solas al refrescar).
- **Móvil y pantallas táctiles:** cada tarjeta tiene un **asa** (⋮⋮) a la derecha. Arrastrándola se **reordena dentro de la columna**. El resto de la tarjeta sirve para hacer scroll y para abrirla con un toque. En móvil no se arrastra entre columnas: usa la selección múltiple o el selector *Columna* del detalle.
- **Selección múltiple:** marca la casilla de varias tarjetas, o la casilla junto al nombre de una columna para **marcar todas sus tarjetas** de una vez (vuelve a pulsarla para desmarcarlas). Aparece una barra («1 seleccionada», «3 seleccionadas») con:
  - **Mover a Siguiente salto…** (la columna con ese rol) y **Mover a…** cualquier otra columna, en la misma fila;
  - **Release con selección**;
  - **Borrar**: pide confirmación y borra las tareas seleccionadas con sus adjuntos.
- También puedes cambiar la columna desde el detalle de la tarjeta.

### 3.6 Generar una release

**Tareas fijas («Siempre en la release»).** Al pie de la columna *Siguiente salto a producción* hay una sección plegable que indica cuántas tareas fijas tiene. Al abrirla, se despliega hacia arriba con esas tareas y el botón **+ Añadir**. Son tareas que se repiten en cada despliegue (por ejemplo, «Generar el PDF de la release»): entran preseleccionadas en cada release (con la marca *fija*), pero **no salen de la columna** al marcarla como desplegada. Solo se añaden al usar **Generar Release** de esa columna, no con *Release con selección*. Para convertir una tarea en fija, arrástrala sobre la sección: si está cerrada se abre al mantenerla encima un momento. También se puede marcar o desmarcar una tarea existente de esa columna con *Fija en la release* en su detalle. Si se mueve a otra columna o se archiva, deja de ser fija. Cada tarea fija lleva un pequeño interruptor **En todas / Cada dos / Cada tres** (del color de la barra de subtareas): con *Cada dos* solo entra preseleccionada en las releases de número par y con *Cada tres* en las múltiplo de 3 (siempre se puede marcar o desmarcar a mano). En el diálogo de generar release, su marca indica cuándo le toca: «fija · Cada tres · ahora», «… en la siguiente» o «… dentro de 2». Cambiarlo se puede deshacer y queda en el historial; al dejar de ser fija vuelve a *En todas*. Las tareas del panel también se pueden **arrastrar fuera** a cualquier columna y posición (en táctil, con su asa): dejan de ser fijas.

1. Prepara tus plantillas en **Mi perfil → Plantillas**. Puedes tener **varias cabeceras** (por ejemplo, «Contexto para IA» o «Para negocio») y **varios pies** (por ejemplo, «Checklist de cierre»), cada uno con su nombre. Se pueden **reordenar**: la primera de cada tipo es la que se propone por defecto en **Generar release**. Además, cada proyecto puede tener **sus propias cabeceras y pies** (*Ajustes del proyecto → Releases*; hasta 20 de cada tipo y 20 000 caracteres cada una; las gestiona cualquier miembro del proyecto). En los desplegables de *Generar release* salen **después** de las tuyas, en el orden fijado en el proyecto, agrupadas como *Tuyas* y *Del proyecto*.
2. En el tablero, pulsa **Generar Release** en la columna *Siguiente salto a producción*.
3. **Paso 1:** revisa el título, elige la **cabecera** y el **pie** (o «Ninguna») y marca las tareas incluidas. Las releases de cada proyecto están **numeradas** (1, 2, 3…). El título propuesto es `Release AAAA-MM-DD · Proyecto`; si ese día ya hubo releases en el proyecto, lleva el número tras la fecha: `Release AAAA-MM-DD (2) · Proyecto`, `(3)`… El título se guarda en el histórico pero **no forma parte del texto** que se copia o descarga. Por defecto están todas las de la columna; si tenías tarjetas seleccionadas, solo esas.
4. **Paso 2:** se genera el documento: la **cabecera**, **una sección por tipo de tarea** (generales y luego los del proyecto) y el **pie**:

```markdown
<cabecera elegida>

### Funcionalidad
- **R32F1** · Nueva pantalla de exportación ([enlace](<https://example.com/pr/1>))
  Adjuntos: R32F1_captura.webp, R32F1_detalle.webp
  Descripción de la tarea, sangrada bajo su punto.

### Corrección
- **R32C1** · Error al guardar
- **R32C2** · Corrección del cálculo de totales

<pie elegido>
```

   - **Códigos:** cada punto lleva un código con el **número de la release**, la inicial del tipo y un número por tipo: en la release 32, `R32F1`, `R32F2`… `R32C1`. Si dos tipos empiezan por la misma letra, el segundo usa más letras (p. ej. D y DI). Si otra persona despliega una release mientras generas la tuya, al marcarla como desplegada se avisa para volver a generar el texto con el número correcto.
   - **Títulos con código:** al marcar la release como desplegada, cada tarea que sale de la columna (a *En producción* o al archivo) pasa a llamarse con su código delante: `R32F1: Nueva pantalla de exportación`. Las tareas fijas no se renombran. Si la tarea ya llevaba el código de otra release, el nuevo se antepone sin quitar el anterior; si no cabe en 210 caracteres, se recorta el final. Deshacer el despliegue devuelve los títulos originales; la siguiente aparición de una tarea repetitiva nace con el título original, y el texto de la release y el histórico conservan el título sin código.
   - **Descripción:** la de cada tarea va debajo de su punto. Las menciones salen como `@Nombre`.
   - **Adjuntos:** se nombran `código_nombre-original.webp` y se listan bajo su punto. Si alguna tarea tiene adjuntos, aparece el botón **Descargar adjuntos (N)**, que baja un ZIP (`release-AAAA-MM-DD-adjuntos.zip`) con todos los ficheros ya renombrados.

5. Edita el texto libremente y alterna entre **Editar** y **Vista previa**. Si cambias la cabecera o el pie en este paso, se sustituyen en el texto sin perder lo que has escrito. Si ya habías modificado ese bloque, el nuevo se añade.
6. Exporta con **Copiar todo**, **.md** o **.txt** (nombre `release-AAAA-MM-DD`).
7. **Marcar como desplegado**: elige si las tarjetas pasan a la columna *En producción* o se archivan. El texto final editado queda guardado en el apartado **Releases** del proyecto, junto con una **copia reducida de los adjuntos** (máximo 960 px de ancho, WebP de calidad 55), con sus nombres de la release, que se conserva aunque luego se borren las tareas. Las copias de archivos que no son imagen se guardan enteras y **se borran a los 7 días**; las de imágenes se conservan.

Las secciones sin tareas se omiten.

### 3.7 Plazos y entregables

- **Fecha límite:** en el detalle de la tarjeta (o al crearla). En el tablero, la tarjeta muestra la fecha con estos colores:
  - **rojo** si está vencida;
  - **ámbar** si vence hoy o en los próximos 3 días;
  - **verde** si ya está en una columna terminada.
- **Columnas terminadas:** en el menú «⋯» de una columna, **Contar como terminada**. Por defecto lo son *En producción* y *Cerrado*. Sus tarjetas cuentan como hechas en el avance y no generan avisos de plazo.
- **Entregables:** en **Ajustes del proyecto → Entregables**, el botón **Añadir entregable** abre un formulario (nombre, fecha objetivo y descripción). El lápiz de cada entregable abre el mismo formulario para editarlo. Se asignan desde el detalle de cada tarjeta.

### 3.8 Informe PDF del proyecto

Botón **Informe PDF** en la cabecera del tablero (o en el menú lateral). Si la ventana es estrecha (por ejemplo, a media pantalla), *Informe PDF*, *Archivadas* y *Varias tareas* se muestran solo como icono (con su nombre al pasar el ratón), *Nueva tarea* pasa a *Nueva* y el contador de tarjetas muestra solo el número; el nombre del proyecto nunca se recorta. Los desplegables (como el selector de proyectos) se ven completos siempre que quepan en la pantalla. En escritorio se abre en otra pestaña. En el **móvil** (o con la app instalada) se genera dentro de Pizarro y, al terminar, aparecen los botones **Descargar** y **Abrir**.

Está pensado para leerse de un vistazo; cada sección sale solo si tiene contenido:

- **Resumen:** barra de avance y cuatro cifras (pendientes, vencidas, vencen en 7 días, terminadas), el reparto por tipo de lo pendiente y, si hay, un aviso de tareas sin responsable o sin plazo.
- **Pendiente:** las tareas sin terminar agrupadas por columna, con tipo, responsable, plazo (los vencidos en rojo) y subtareas hechas.
- **Plazos:** vencidos y próximos 14 días.
- **Entregables:** fecha objetivo, avance y estado (*Completado*, *En plazo*, *En riesgo* —vence en 7 días o menos con menos del 75 % hecho—, *Retrasado*, *Sin fecha* o *Sin tareas*).
- **Carga por persona:** pendientes y vencidas de cada una.
- **Terminadas en los últimos 14 días.**
- **Últimas releases:** las cinco últimas, con su número (R32), título, fecha y tareas.

Se genera en el idioma de quien lo pide.

«Hoy» se calcula en la zona horaria `APP_TIMEZONE` (por defecto `Europe/Madrid`).

### 3.9 Colaboración: comentarios, avisos, seguimiento e informes

- En el detalle de la tarjeta, sección **Comentarios**. Escribe `@` y el principio de un nombre para elegir a una persona (↑↓ y Enter). También se puede mencionar en la descripción y en el **título** de la tarea. Los comentarios admiten **respuestas** (un solo nivel). Al abrir la tarea se ven los **20 más recientes**; **Ver anteriores** carga 100 más cada vez (una respuesta cuyo comentario aún no se ha cargado indica «En respuesta a un comentario anterior»). Borrar un comentario sin respuestas lo quita; si tiene respuestas, queda como **«Comentario borrado»** (sin texto ni autor) para no romper el hilo, y desaparece al borrar su última respuesta. Deshacer lo restaura. Cada tarea admite como máximo el número de comentarios fijado en *Administración → Ajustes* (500 por defecto); al llegar se avisa con el límite.
- **Cuándo recibes un aviso:**
  - te **mencionan**;
  - te **asignan** una tarea;
  - cambia la **fecha límite** de una tarea tuya (el aviso sale unos 5 minutos después del último cambio y recoge solo la fecha final, así que mover la tarjeta varias veces seguidas genera un único aviso; si acaba en su fecha original, no se avisa; si la tarea se borra, se archiva o deja de ser tuya mientras tanto, tampoco);
  - hay un **comentario** en una tarea que **sigues**;
  - **responden a tu comentario**.
- **Seguir una tarea:** botón de seguir / dejar de seguir en el detalle. Quien crea, es asignado o comenta una tarea la sigue.
- Los avisos llegan:
  - a **Avisos** (campana con contador en el menú lateral; en móvil, en la barra superior), donde puedes **marcar uno como leído** o todos;
  - por **email**, si el servidor tiene SMTP y la persona no lo ha desactivado (hay preferencias **por tipo de aviso**);
  - por **WhatsApp**, si el servidor lo tiene configurado y la persona lo ha activado con su número (menciones).
- Cada persona elige sus canales en **Mi perfil → Avisos**. Allí también puede activar un **resumen diario por email** y elegir la hora. El resumen recoge la actividad de los proyectos en los que trabajas (para un admin, los de equipo que eligió en *Proyectos en los que trabajo* y sus privados) y, de cualquier proyecto que puedas ver, lo que tienes asignado y lo vencido.
- La página **Avisos** muestra los 100 últimos y el botón **Cargar más** trae los anteriores. Los avisos ya leídos se borran a los 90 días. Al hacer clic en uno se abre directamente la tarjeta.
- **Historial de la tarea:** sección plegada **Historial** en el detalle, con los cambios de la tarea (se conserva 365 días).
- **Informe semanal por email:** en **Ajustes del proyecto** se elige destinatario, día de la semana y hora, y se envía el informe PDF (ver 3.8). Solo puede ir a personas con acceso al proyecto; una dirección externa solo la puede fijar un admin y nunca en proyectos privados. Se vuelve a comprobar en el momento del envío.
- **App instalada:** accesos directos **Mis tareas** y **Avisos**, y contador de avisos sin leer en el icono.

### 3.10 Google Docs y Sheets

1. Una vez por persona: **Mi perfil → Google Docs y Sheets → Conectar con Google**, y acepta el permiso. Pizarro comprueba la identidad que devuelve Google (firma, emisor, destinatario y caducidad); si no la confirma, avisa con «Google no confirmó la identidad…» y no conecta.
2. En una tarjeta, escribe `@sheets` o `@docs` en la descripción o en un comentario y elige *Crear Google Sheet* / *Crear Google Doc*. También puedes usar los botones **Nuevo Doc** / **Nuevo Sheet**.
3. Se crea el archivo en tu Drive con el título de la tarjeta, se abre en otra pestaña y queda en **Documentos de Google** de la tarjeta. Si lo creaste desde el texto, también se inserta su enlace.
4. Con quién se comparte el archivo lo decide cada proyecto, en **Ajustes del proyecto → Documentos de Google** (visible si Google está activado; lo cambian los administradores y, en un proyecto privado, sus miembros):
   - **Todo el dominio puede editar** / **Todo el dominio puede leer**: solo en proyectos de equipo y si el servidor tiene `GOOGLE_WORKSPACE_DOMAIN`.
   - **Solo las personas del proyecto (editores)**: se comparte con el email de cada miembro activo.
   - **No compartir (solo quien lo crea)**.

   Un proyecto privado nunca se comparte con el dominio (el servidor lo rechaza). Los proyectos que no han elegido nada siguen como antes: los de equipo con el dominio, con el rol de `GOOGLE_SHARE_ROLE` (editor por defecto), y los privados con sus miembros; esas variables son el valor por defecto de los proyectos que no han elegido.
5. Si el archivo se crea pero no se pudo compartir (error de Google, política del Workspace, modo «No compartir» o nadie con quien compartir), la creación sigue valiendo y sale el aviso «Documento creado, pero no se ha compartido: solo lo ves tú» (o «no se pudo compartir con N personas» si falló solo con algunas). En **Documentos de Google** de la tarjeta, ese archivo lleva un icono de advertencia con la explicación, visible para todo el equipo. El fallo queda en el registro de la aplicación (`google.shareFailed`). Si no se compartió, compártelo desde Google como cualquier otro documento.
6. Quitar el enlace de la tarjeta no borra el archivo de Drive.

### 3.11 Otras vistas

El menú lateral muestra, debajo de las opciones del proyecto: **Calendario**, **Avisos**, **Mis tareas asignadas**, **Mi perfil**, **Administración** (solo admins), **Historial de versiones** e **Instalar app**.

- **Mis tareas asignadas:** funciona como una bandeja diaria con tus tarjetas de todos los proyectos a los que tienes acceso, cada fila con un chip del proyecto (icono de carpeta) al principio, agrupadas en **Vencidas**, **Hoy**, **Esta semana**, **Más adelante** y **Sin fecha**, con filtros. No incluye las ya terminadas. Muestra como mucho 500; si tienes más, lo indica con el total.
- **Calendario:** cuadrícula mensual de lunes a domingo. En los proyectos con el campo *Fecha de inicio* activo, las tareas con inicio anterior a la fecha límite se dibujan en escritorio como una **franja** sobre los días que abarcan (hasta 4 por semana; el «+n» abre la lista de las ocultas). **Todo se arrastra:** las tareas a otro día; las franjas, enteras (mueven inicio y fin a la vez) o por un borde (cambian solo el inicio o el fin); y los entregables, a su nueva fecha. Con el teclado, Alt+←/→ mueve la franja y Alt+Mayús+←/→ cambia su fin. Cada cambio muestra un aviso con **Deshacer** (también Ctrl/⌘+Z). En móvil la lista no se arrastra; las tareas siguen en su fecha límite con «inicio → fin», y las que acaban después del mes salen en su día de inicio.
  - Cada tarea con fecha límite aparece en su día, coloreada por tipo (con las iniciales del proyecto cuando miras todos); las terminadas se ven atenuadas. Si un día tiene muchas, aparece «+N más».
  - Un clic abre la tarea. **Arrastrar** una tarea a otro día cambia su fecha límite; con el foco en ella, **Alt+←/→** la mueve ±1 día y **Alt+↑/↓** ±7 días. El botón **Deshacer** (o Ctrl/⌘+Z) revierte el último cambio de fecha.
  - Los **entregables** salen como bandas durante la semana anterior a su fecha, con su avance y estado (*Completado*, *En plazo*, *En riesgo*, *Retrasado*, *Sin tareas*).
  - Filtros de **proyectos** y de **personas** (en ambos puedes marcar varios a la vez; el botón indica «N proyectos» o «N personas»; entre las personas están *Sin asignar* y tú, una sola vez, como «Nombre (yo)») y **Ocultar terminadas**, que se guardan en la URL. «Todos los proyectos» son los proyectos en los que trabajas. Con más de un proyecto a la vista, cada tarea lleva las iniciales de su proyecto.
  - En móvil se muestra como una lista por semanas.
- **Releases:** histórico del proyecto, con **buscador** por texto en todo el histórico (título y contenido, sin distinguir mayúsculas ni tildes); sin buscar se muestran las 50 últimas con *Cargar más*, opción de copiar o descargar cada release, y de **Borrar release** (la quita del histórico con sus adjuntos; las tareas no cambian) o **Borrar adjuntos** (conserva el texto). Ambas piden confirmación. Cada entrada indica cuántas tareas y adjuntos tiene; al abrirla se ven los nombres de los adjuntos y el botón **Descargar adjuntos** (ZIP; uno por paquete si hay varios). Si los adjuntos cambian mientras se descargan los paquetes, se avisa («Los adjuntos han cambiado mientras se descargaban») con **Reintentar**, para no mezclar paquetes de dos versiones. Las copias de los adjuntos que se preparan tras desplegar se retoman solas si el servidor se reinicia a mitad (unos 10 s después de arrancar). Una release no se despliega si alguna de sus tareas se ha archivado, borrado o movido entretanto: avisa para volver a generarla. Dos despliegues simultáneos reciben números consecutivos.
- **Historial de versiones:** versión actual de la app y cambios de cada versión, con la **fecha y hora** de su lanzamiento y **buscador** por texto.

### 3.12 Móvil

- La pantalla no hace scroll vertical: las columnas llegan justo hasta encima de los botones del sistema (barra de gestos o de navegación).
- El tablero muestra una columna cada vez. Cambias de columna con las pestañas superiores, que indican cuántas tarjetas tiene cada una, o **deslizando el dedo a izquierda o derecha** sobre la columna.
- La barra de pestañas tiene siempre a mano **Buscar** y **Filtrar**; **Deshacer** y **Rehacer** están en la barra superior y, con una tarea abierta, en su cabecera.
- El botón flotante **+** crea una tarea en la columna visible, con opción de **Cámara** o **Archivo**. Al crearla (o crear varias), el tablero salta a la columna donde ha quedado y la resalta un momento. El botón *Crear tarea* queda siempre visible abajo del formulario.
- El botón flotante pequeño de encima crea **varias tareas** pegando una lista (ver 3.4).
- Para mover tarjetas entre columnas en móvil, usa la selección múltiple o el selector *Columna* del detalle (la tarjeta queda al final de la columna elegida). Para reordenar dentro de la columna, arrastra el asa ⋮⋮ (ver 3.5).
- **Botón atrás** (del navegador o del móvil):
  - si hay un modal abierto (tarea, nueva tarea, imagen ampliada…), lo cierra;
  - si no, vuelve a la columna que estabas viendo antes; se recuerdan los últimos 5 cambios de columna, y después atrás sale del tablero como siempre.
- **Instalar como app:** en el menú lateral, **Instalar app**.
  - **Android y Chrome de escritorio:** muestra el aviso de instalación.
  - **iPhone y iPad:** explica cómo hacerlo. En **Safari**, pulsa *Compartir → Añadir a pantalla de inicio*.
  - La app se abre a pantalla completa con su icono y mantiene la sesión.

### 3.13 Apariencia

En **Mi perfil → Apariencia**, cada persona elige:
- **Tema:** *Sistema* (sigue el modo claro u oscuro del dispositivo, por defecto), *Claro* u *Oscuro*. Se aplica al momento y se recuerda en todos tus dispositivos. Las barras de scroll usan los colores de Pizarro en ambos temas.
- **Tema de color:** *Azul* (por defecto), *Verde bosque*, *Siena*, *Mostaza*, *Blanco y negro* o *Eva* (botones en morado Evangelion #6848a0, resaltados en verde neón —#66ff33 en claro y #78c838 en oscuro— en los anillos de foco, campos con foco, borde del editor de descripción, foco de añadir archivo y progreso— y un pequeño detalle naranja #f8a030 en el elemento activo del menú y la barra central del logo), en modo claro y oscuro. Cambia **toda la app**: fondos, columnas, tarjetas, bordes, textos secundarios, botones, enlaces y resaltados toman los tonos del tema (salvia y verde profundo; arcilla y terracota; arena y mostaza; o grises puros, con negro en claro y blanco en oscuro). Los temas que no son azules usan blanco puro en los textos más claros del modo oscuro. Las subtareas hechas (casilla y barra) usan un color que contrasta con el tema: verde neón en el azul. El **logo** de Pizarro y el **recuadro de foco** al moverte con el tabulador (3 px de grosor) también usan el color del tema (la pantalla de acceso mantiene el azul). En los selectores de color, el blanco lleva un borde fino para verse en los temas claros.
- **Distintivos de tipo:** cada tipo conserva su color en todos los temas, pero el texto se oscurece en modo claro y se aclara en modo oscuro para que se lea siempre (también con tipos negros, marinos o blancos).
- **Tarjetas:** *Franja a la izquierda* (por defecto) o *Tarjeta entera del color*, con un tono suave para que el texto se siga leyendo.
- **Idioma · Language:** *Español* (por defecto) o *English*. Cambia toda la interfaz, los mensajes, las fechas, el informe PDF y el **historial de versiones**. No se traducen los datos (nombres de proyectos, columnas, tipos, tareas), el texto de las releases ni los logs de administración. La pantalla de acceso sale siempre en español.
- **Edición de descripciones:** *Con barra de formato* (por defecto) o *Markdown* (ver 3.4).

### 3.14 Tipos de tarea

Hay dos clases de tipos. Cada tipo es una sección de las release notes.

- **Generales** (solo admins): **Administración → Tipos de tarea**. Están disponibles en todos los proyectos. Los de serie (*Funcionalidad*, *Corrección*, *Respuesta*) se muestran en inglés (*Feature*, *Bug fix*, *Reply*) a quien usa Pizarro en inglés, mientras un admin no los renombre ni cambie sus plantillas; los editores de tipos muestran siempre el valor guardado.
- **Del proyecto** (cualquiera con acceso al proyecto): **Ajustes del proyecto → Tipos de tarea**. Solo aparecen en ese proyecto.
- **Qué tipos generales usa cada proyecto:** en esa misma sección, la lista *Tipos generales que usa este proyecto*. Los desmarcados no aparecen en sus selectores ni en sus releases. Si un tipo tiene tareas en el proyecto, al desmarcarlo se pide a qué tipo pasan. Siempre queda al menos un tipo.

En ambos casos:
- **Nuevo tipo:** nombre y color (de la paleta o cualquier otro con el selector de color).
- **Subtareas predefinidas:** cada tipo puede llevar una lista (una por línea, máximo 50) que se añade como subtareas al elegir ese tipo en *Nueva tarea*.
- Las flechas cambian el **orden**. En los selectores y en la release van primero los generales y después los del proyecto, cada grupo en su orden.
- **Automatización:** cada tipo puede tener un **título automático** y un **texto inicial de la descripción** (hasta 20 000 caracteres, como las descripciones; al crearlo o editarlo, sección *Automatización*). Al elegir ese tipo en una tarea nueva o existente, el título se sustituye y la descripción empieza por ese texto (sin repetirlo si ya está). El texto inicial admite **formato Markdown** y se edita con el mismo editor que las descripciones (con barra de formato o Markdown, según tu perfil). La lista de tipos explica en una línea lo que hace cada uno. No se aplica en *Varias tareas*.
- **Respuesta:** viene creado de serie (título «Respuesta» y descripción que empieza por «Respondo a las preguntas y lo que necesitas de mi:»), pero es un tipo general como cualquier otro: se puede editar o **borrar**.
- **Borrar** un tipo pide a qué tipo pasan sus tareas. Un tipo general solo puede pasar a otro general, y siempre queda al menos uno. Un tipo de proyecto puede pasar a un general o a otro del mismo proyecto.
- **Nombres:** un tipo de proyecto no puede llamarse igual que un general ni que otro de su proyecto. Dos proyectos sí pueden tener tipos con el mismo nombre. Un tipo general nuevo no puede repetir el nombre de ningún tipo de proyecto.
- Al borrar un proyecto se borran también sus tipos.

### 3.15 Atajos de teclado

Solo en ordenador. Los atajos con Alt usan la tecla física, así que en Mac funcionan con ⌥ aunque esa combinación escriba otro carácter. Salvo los indicados, no actúan mientras escribes en un campo. **?** muestra esta lista dentro de Pizarro, y los botones indican su atajo al pasar el ratón.

| Acción | Windows / Linux | Mac |
|---|---|---|
| Nueva tarea (con una tarea abierta, abre otra al lado) | Alt+N | ⌥+N |
| Varias tareas | Alt+Mayús+N | ⌥+⇧+N |
| Buscar o filtrar tarjetas en el tablero | / | / |
| Ver la lista de atajos | ? | ? |
| Cambiar de proyecto | Alt+P | ⌥+P |
| Deshacer en el tablero (también con una tarea abierta) | Alt+Z | ⌥+Z |
| Archivar la tarea abierta | Alt+A | ⌥+A |
| Guardar y cerrar la tarea (botón **Guardar**), o crear la tarea nueva (también escribiendo) | Alt+S | ⌥+S |
| Generar release | Alt+R | ⌥+R |
| Crear la tarea, guardar la descripción o enviar un comentario | Ctrl+Enter | ⌘+Enter |
| Cerrar el modal, el menú o cancelar la edición | Esc | Esc |
| Deshacer la última acción (en una tarea abierta, la de esa tarea) | Ctrl+Z | ⌘+Z |
| Rehacer en el contexto actual | Ctrl+Mayús+Z o Ctrl+Y | ⌘+⇧+Z o ⌘+Y |
| Rehacer en el tablero | Alt+Mayús+Z | ⌥+⇧+Z |
| Nueva tarea con una captura pegada (con el tablero en pantalla) | Ctrl+V | ⌘+V |
| Abrir la tarjeta con el foco | Enter | Enter |
| Seleccionar la tarjeta con el foco | Espacio | Espacio |
| Subir / bajar la tarjeta con el foco en su columna | Alt+↑ / Alt+↓ | ⌥+↑ / ⌥+↓ |
| Asignarme (o quitarme) la tarjeta con el foco | Alt+M | ⌥+M |
| Mover la tarjeta con el foco a la columna anterior / siguiente | Alt+← / Alt+→ | ⌥+← / ⌥+→ |
| Fecha límite de la tarjeta con el foco (Hoy, Mañana, Próximo lunes, Sin fecha) | Alt+D | ⌥+D |
| Renombrar la tarjeta con el foco en la propia tarjeta | F2 | F2 |
| Duplicar la tarjeta con el foco | Alt+Mayús+D | ⌥+⇧+D |
| Entrar en la barra de formato del editor | Alt+F10 | ⌥+F10 |
| Editar la subtarea con el foco | Enter o F2 | Enter o F2 |
| Añadir subtarea / guardar subtarea editada | Enter | Enter |
| Negrita, cursiva, subrayado (editor con barra) | Ctrl+B / I / U | ⌘+B / I / U |
| Elegir persona o comando en la lista de «@» | ↑ ↓ y Enter o Tab | ↑ ↓ y Enter o Tab |
| Imagen anterior o siguiente (pantalla completa) | ← → | ← → |

En el calendario, con el foco en una tarea: Alt+←/→ (±1 día) y Alt+↑/↓ (±7 días). Con un modal abierto, el tabulador recorre solo sus campos (no salta al tablero de debajo). El tabulador salta la barra de formato del editor.

### 3.16 Administración (admins)

La entrada **Administración** del menú lateral reúne siete pestañas: **Usuarios**, **Proyectos**, **Tipos de tarea** (ver 3.14), **Plantillas de proyecto**, **Copias de seguridad**, **Logs** y **Ajustes** (parámetros generales, como el máximo de comentarios por tarea). En móvil, el menú de pestañas solo se desplaza en horizontal.

**Proyectos:** lista los proyectos de equipo (los privados no aparecen) con los usuarios asignados a cada uno; desde ahí se añaden o quitan usuarios. Los mismos usuarios asignados se gestionan en los ajustes de cada proyecto. Quitar una asignación desasigna las tarjetas de esa persona y corta su conexión en vivo con el proyecto.

**Plantillas de proyecto:** definen las columnas (nombre, orden, rol especial (*Siguiente salto*, *En producción*, *Esperando* o *Planificación semanal*) y si cuentan como terminadas), los tipos de tarea propios (con su automatización, descripción en Markdown y **subtareas predefinidas**), qué tipos generales no usará el proyecto, las etiquetas y las **cabeceras y pies de release** del proyecto. **Crear desde un proyecto…** rellena una plantilla a partir de un proyecto existente. Al crear un proyecto se elige la plantilla en *Nuevo proyecto*.
- Vienen **12 plantillas de serie**: *Vibecoding*, *Tareas familiares*, *Producción audiovisual*, *Negocio*, *Marketing y contenidos*, *Organización de eventos*, *Soporte y atención al cliente*, *Selección de personal*, *Reformas y obras*, *Viajes*, *Estudios o tesis* y *Mudanza*, con sus columnas, tipos y etiquetas. La lista se ordena alfabéticamente.
- **Ocultar todos los tipos generales:** opción de cada plantilla para que el proyecto nuevo solo use los tipos de la plantilla (por ejemplo, en *Tareas familiares* no salen *Mejora*, *Funcionalidad*, etc.). Está activada en todas las de serie salvo *Vibecoding*. Solo afecta a los proyectos que se creen a partir de ahora; en uno ya creado, desmarca los tipos en *Ajustes del proyecto → Tipos de tarea*.
- Las de serie se pueden **editar** o **borrar**. En una modificada, **Restablecer** vuelve a su contenido original; **Recuperar plantillas por defecto** recrea las de serie que se hayan borrado. Cuando Pizarro mejora una plantilla de serie, se actualiza sola al desplegar si no la has modificado; si la has cambiado, se respeta tu versión.
- **En inglés:** quien usa Pizarro en inglés ve las plantillas de serie sin modificar con su nombre en inglés, y el proyecto se crea con columnas, tipos (con sus descripciones y subtareas) y etiquetas en inglés. Una plantilla de serie modificada o una propia se ofrece y se aplica tal como está guardada. Los tipos generales (*Funcionalidad*, *Corrección*) son comunes a todos los proyectos y conservan su nombre.

**Copias de seguridad:** si la última copia correcta tiene más de 48 h (o no hay ninguna con `BACKUP_KEY` definida), sale un aviso destacado en esta pestaña y un punto en la entrada *Administración* del menú, y se envía un email a los administradores como mucho una vez al día (si el email está configurado). Muestra el estado de las copias automáticas (última copia, última prueba de restauración, copias conservadas), **Crear copia ahora** y **Descargar** la última (pide tu contraseña, o un código de tu app de autenticación, y usa un enlace de un solo uso de 60 s; ver 4.5). Solo funciona con `BACKUP_KEY` definida.

**Logs:** registro detallado de la actividad de los últimos 7 días (configurable con `LOG_RETENTION_DAYS`):
- páginas visitadas, inicios de sesión (también los fallidos, con el email probado y el motivo, nunca la contraseña) y cierres de sesión;
- cada acción (crear, mover, editar, archivar, borrar, desplegar…) con quién, cuándo, desde qué página, cuánto tardó, el resultado y sus datos (sin contraseñas ni tokens);
- subidas y descargas de adjuntos (ver una imagen no se registra, solo las descargas), informes PDF, ZIP de releases, conexiones con Google, envíos de email y WhatsApp, arranques de la app y errores del servidor.

Cada acción se describe en lenguaje claro: «Creó la tarea «X» en «Backlog»», «Movió «X» de «Backlog» a «En progreso»», «Modificó «X»: tipo y responsable», «Desplegó la release «…» con 4 tareas», etc.

**Proyectos privados en los logs:** la actividad de un proyecto privado solo la ven en detalle sus miembros. El resto de administradores ve esas filas con la hora y el usuario y el texto «Actividad en un proyecto privado» (también en el CSV); los filtros de texto, nivel y categoría no las tienen en cuenta.

**Solo cambios por defecto:** las consultas (páginas vistas, abrir una tarea, ver archivadas, generar el texto de una release, informes PDF y ZIP) se ocultan salvo que marques **Incluir consultas**. Los avisos y errores se ven siempre.

Se filtra por periodo (1 h, 24 h, 7 días), nivel (Info, Aviso, Error), categoría, usuario y texto. Cada fila se despliega para ver los detalles y la IP. **Descargar CSV** exporta el filtro actual entre las fechas **Desde** y **Hasta** (por defecto, el último día; como máximo, los días que se conservan los logs), y se genera por partes para no cargar la memoria del servidor. Los registros antiguos se borran solos.

- **Usuarios → Nuevo usuario:** nombre, email y rol. Máximo de 10 usuarios activos (configurable con `MAX_USERS`).
  - **Con email configurado:** la persona recibe un **enlace de invitación** (72 h) para elegir su contraseña. El admin no la conoce.
  - **Sin email:** el admin escribe una **contraseña inicial** (10 caracteres o más) y la persona debe cambiarla en su primer acceso.
- **Editar:** nombre, email, rol y estado activo. Al desactivar a un usuario o cambiarle el rol se cierran sus sesiones y sus conexiones en vivo. Un admin no puede quitarse a sí mismo el rol ni desactivarse.
- **Desvincular Google:** en usuarios con la cuenta de Google vinculada (no en la tuya), quita ese vínculo, cierra sus sesiones y le avisa por email. La próxima vez entrará con su contraseña. Mientras tanto Google queda **bloqueado** para esa persona (etiqueta *Google bloqueado*; al intentarlo ve «Tu cuenta de Google está desvinculada…»): se desbloquea cuando entra una vez con su contraseña o cuando un admin pulsa **Permitir Google**, y entonces el siguiente acceso con Google la vincula de nuevo. Sirve si su cuenta de Google pudo verse comprometida. No afecta a los documentos de Drive.
- **Forzar cambio de contraseña:** marca la cuenta para cambiar la contraseña, cierra sus sesiones y, con email configurado, envía un enlace de restablecimiento (30 min). Hasta que la persona elige una nueva (distinta) no puede usar la app. Los admins no fijan contraseñas a mano.
- **Reiniciar la verificación en dos pasos:** quita el segundo paso de la persona (volverá a configurarlo).
- **Borrar** (papelera): elimina la cuenta para siempre. En los proyectos compartidos sus tareas y comentarios se conservan, sin autor. Si es el único miembro de **proyectos privados**, se muestra un aviso con cuántos son y hay que marcar una casilla de confirmación: se borran con él; en los demás, solo deja de ser miembro. Nadie puede borrarse a sí mismo.

### 3.17 Documentación del proyecto

Entrada **Documentación** del menú lateral (debajo de *Releases*): los archivos de referencia del proyecto (guías y notas, PDF de especificaciones o contratos, capturas) para verlos sin salir de la app. Los ve y los sube cualquiera con acceso al proyecto, con las mismas reglas de visibilidad que el tablero (un proyecto privado solo lo ven sus miembros).

- **Subir:** botón *Subir archivos* (varios a la vez), arrastrando archivos a la página o pegándolos con Ctrl+V (capturas de pantalla incluidas). Se suben de uno en uno y, si alguno falla, se muestra el motivo junto a su nombre.
- **Qué se puede ver:** texto plano (`.txt`, `.log`, `.csv`, `.json`, `.yml`…), Markdown (`.md`, con el mismo Markdown seguro que las descripciones de las tarjetas), PDF (con el visor del navegador) e imágenes PNG, JPEG, WebP, GIF o AVIF (se reconvierten a WebP, como los adjuntos). Los textos de más de 1 MB solo se descargan. Cualquier otro tipo (Office, ZIP, SVG, HTML…) aparece en la lista y se puede descargar, pero no tiene vista previa. El tipo se decide al subir mirando también el contenido: un «PDF» que no lo es se trata como un archivo cualquiera.
- **Subir desde cualquier página:** arrastra archivos sobre la entrada **Documentación** del menú (también en el menú del móvil): se resalta y, al soltarlos, se suben a la documentación del proyecto elegido con los mismos límites; un aviso muestra el resultado con **Abrir Documentación**.
- **Visor:** los PDF y las imágenes se abren casi a pantalla completa. **Clic sobre una imagen** la amplía (2,5×) en ese punto y, al mover el ratón, se recorre; otro clic o Escape la reduce (en táctil, toque para ampliar y arrastrar para moverse). Abajo a la derecha están los botones redondos **Nueva tarea** («+») y **Varias tareas** (más pequeño): abren el formulario al lado del visor, que sigue abierto, con un enlace al documento ya escrito en la descripción. Si la ventana es lo bastante ancha, el visor conserva su ancho y se desplaza a la izquierda, con los dos centrados; solo se estrecha si no caben. `/p/<proyecto>/docs?doc=<id>` abre directamente un documento.
- **Lista:** nombre, icono de tipo, tamaño, quién lo subió y fecha, con buscador por nombre (sin distinguir mayúsculas ni tildes). Al pulsar un documento se abre el visor con **Descargar**, **Borrar** (lo envía a la papelera, sin pedir confirmación; el aviso «Documento enviado a la papelera» trae **Deshacer**) y el lápiz para **Renombrar**.
- **Papelera:** el botón **Papelera (N)** (solo aparece si hay algo) muestra los documentos borrados, con quién los borró y cuándo, y los días que quedan. Se conservan **7 días** y después se eliminan solos, fila y fichero (tarea diaria `documentsTrashPurge`, visible en *Administración → Copias*). Desde ahí se pueden **Ver** (vista previa), **Restaurar** (vuelve a comprobar el máximo de 200 documentos y la cuota; si no cabe, lo explica y sigue en la papelera) o **Borrar definitivamente** (pide confirmación). La limpieza de huérfanos no toca los ficheros de la papelera, y las copias de seguridad los incluyen.
- **Límites:** cada archivo, hasta el tamaño máximo de archivo del proyecto (*Ajustes del proyecto*, y `MAX_UPLOAD_MB` si está definida); hasta 200 documentos por proyecto (la papelera no cuenta); y su tamaño, también el de la papelera hasta que se purga, cuenta en la misma cuota de almacenamiento del proyecto que los adjuntos de tareas (`UPLOAD_QUOTA_MB_PER_PROJECT`). Las subidas comparten el tope de 60 por minuto y persona; en todo el servidor se procesan como mucho 3 a la vez y las demás esperan su turno (hasta 60 s).
- **Registro y copias:** se registran las subidas, las descargas explícitas, los renombrados, los borrados a la papelera, las restauraciones, los borrados definitivos y las purgas (no las visualizaciones). Los ficheros están en `UPLOAD_DIR/documents/`, así que entran en las copias de seguridad que incluyen los adjuntos; borrar el proyecto los borra y la limpieza diaria de huérfanos revisa también esa carpeta.

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

Consulta la tabla completa en el `README.md`. Las imprescindibles son `DATABASE_URL`, `SESSION_SECRET`, `APP_URL` y `UPLOAD_DIR`. Las `SEED_ADMIN_*` solo hacen falta en el primer arranque (en un servidor propio con Docker Compose no se usan: el asistente web `/setup` crea el administrador) y conviene borrarlas después. Otras variables opcionales de esta versión:

| Variable | Para qué sirve |
|---|---|
| `TOKEN_SECRET` | Clave de los enlaces de email, códigos de recuperación y dispositivos recordados. Sin ella se usa `SESSION_SECRET`. Ver 4.4. |
| `ENCRYPTION_KEY` | Clave con la que se cifran los secretos de 2FA (TOTP) y las conexiones con Google. Sin ella se usa `SESSION_SECRET`. Ver 4.4. |
| `TOKEN_SECRET_PREVIOUS` / `ENCRYPTION_KEY_PREVIOUS` | Solo durante una rotación: la clave anterior, para seguir leyendo lo que se guardó con ella. Ver 4.4. |
| `BACKUP_KEY` | Clave AES-256 de las copias automáticas. Genérala con `openssl rand -base64 32` (también vale `openssl rand -hex 32`; se ignoran comillas y espacios alrededor) y **guárdala también fuera de Railway**: sin ella las copias no se pueden leer. Sin la variable, las copias están desactivadas. |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_REGION`, `BACKUP_S3_PREFIX` | Destino externo S3 compatible (Cloudflare R2, Backblaze B2, MinIO…) para las copias (ver 4.5). Opcionales; sin ellas, las copias solo quedan en el volumen. |
| `BACKUP_EXTERNAL_DIR` | Carpeta montada (disco USB, NAS…) como destino externo de las copias. Opcional. |
| `BACKUP_LOCAL_FILES` | Sin definir: la copia local incluye los ficheros solo si no hay destino externo. `1`/`0` lo fuerzan. |
| `SETUP_TOKEN` | Solo instalación propia: código fijo que acepta el asistente web del primer arranque (`/setup`), además del que se imprime en el log. Sin uso si ya hay usuarios o con `SEED_ADMIN_*`. |
| `UPLOAD_QUOTA_MB_PER_PROJECT` | Cuota de adjuntos por proyecto en MB (por defecto 2048). |
| `UPLOAD_QUOTA_MB_TOTAL` | Cuota total de adjuntos del servidor en MB (opcional; vacío = sin límite). |
| `MAX_UPLOAD_MB` | Opcional. Tope, para todo el servidor, del tamaño de un adjunto en MB; el máximo real lo fija cada proyecto (20 MB por defecto, hasta 100) y esta variable solo lo recorta. Se lee al subir cada archivo: cambiarla no exige recompilar ni volver a desplegar la imagen. |
| `AUTH_GOOGLE_ONLY` | `true`: solo se entra con Google (necesita la integración de Google configurada). |
| `AUTH_ALLOW_ADMIN_PASSWORD` | `true`: con `AUTH_GOOGLE_ONLY`, los admins pueden seguir entrando con contraseña y segundo paso (acceso de emergencia). |
| `MAIL_OUTBOX_DIR` | **Solo desarrollo, nunca en producción:** guarda cada email como un fichero JSON en esa carpeta en lugar de enviarlo. Con `NODE_ENV=production` se ignora (y queda un error en *Logs*) salvo que `MAIL_OUTBOX_IN_PRODUCTION=1`, pensado solo para probar en local la compilación de producción. |

Tests: `npm test` ejecuta los tests unitarios; `npm run test:db` ejecuta los de integración contra una base PostgreSQL temporal que se crea y se borra sola.

### 4.3 Altas, bajas y contraseñas

| Situación | Acción |
|---|---|
| Alta de un miembro | *Administración → Usuarios → Nuevo usuario*, y después asignarle sus proyectos en *Administración → Proyectos* (sin asignaciones, un usuario no admin no ve ningún proyecto de equipo). Con email configurado, la persona recibe un enlace de invitación (72 h) para elegir su contraseña. Sin email, escribe una contraseña inicial: la persona deberá cambiarla en su primer acceso. |
| Baja temporal | *Editar → desmarcar «Usuario activo»*. Se cierran sus sesiones y conexiones en vivo. Sus tareas conservan el historial; sigue siendo miembro de sus proyectos privados y asignado a los de equipo. |
| Baja definitiva | Botón **Borrar** (papelera). Se borran los proyectos privados donde era el único miembro (tras confirmarlo); en los demás deja de ser miembro. |
| Contraseña olvidada | La persona usa **¿Olvidaste tu contraseña?** (con email configurado; sin email, la página le explica las alternativas). Si no, un admin pulsa **Forzar cambio de contraseña** en *Administración → Usuarios*: sin email, **Generar enlace** le muestra un enlace de un solo uso (30 minutos) para copiarlo y enviárselo por un canal de confianza; con email se envía solo, o se puede **copiar en lugar de enviarlo**. Un admin no puede hacerlo para sí mismo (que lo haga otro admin). Queda en el registro sin el enlace. No se fijan contraseñas a mano. |
| Sospecha de cuenta comprometida | **Forzar cambio de contraseña** (cierra sus sesiones) y, si hace falta, reiniciar su verificación en dos pasos. |
| Una persona pierde su segundo paso | Con sus códigos de recuperación puede entrar; si no los tiene, un admin reinicia su verificación en dos pasos. |
| Ningún admin puede entrar (contraseña olvidada) | Desde la terminal del servidor: `node dist/reset-link.mjs persona@example.com` imprime un enlace de un solo uso (30 minutos); `--reset-2fa` además reinicia su verificación en dos pasos. En Docker Compose: `docker compose exec app node dist/reset-link.mjs …`; en Railway, desde la terminal del servicio (`railway ssh`). Detalles en `docs/INSTALL.md`. |
| Se pierde el acceso de todos los admins | Conéctate a la base de datos y promueve a un usuario existente: `UPDATE "User" SET role='ADMIN' WHERE email='persona@example.com';` |

### 4.4 Rotar claves (`SESSION_SECRET`, `TOKEN_SECRET`, `ENCRYPTION_KEY`)

Pizarro usa tres claves, cada una para una cosa. Así, cambiar una no rompe lo que protegen las otras:

| Clave | Qué protege | Si la cambias sin más… |
|---|---|---|
| `SESSION_SECRET` (obligatoria) | Las sesiones abiertas. | Todo el mundo tiene que volver a entrar. Nada más. |
| `TOKEN_SECRET` (opcional) | Los enlaces de los emails (invitaciones, contraseñas, cambio de email), los códigos de recuperación de la verificación en dos pasos, los códigos enviados por email y los dispositivos recordados. | Dejan de valer los enlaces pendientes, los **códigos de recuperación** y los dispositivos recordados (se vuelve a pedir el segundo paso). |
| `ENCRYPTION_KEY` (opcional) | Los secretos de las apps de verificación (TOTP) y las conexiones con Google, que se guardan cifrados. | Las apps de verificación dejan de funcionar (un admin tiene que reiniciar el segundo paso de cada persona) y hay que volver a conectar Google. |

Si `TOKEN_SECRET` o `ENCRYPTION_KEY` no están definidas, se usa `SESSION_SECRET` en su lugar, exactamente como en las versiones anteriores: una instalación existente sigue funcionando sin tocar nada. Pero entonces rotar `SESSION_SECRET` lo rompe todo a la vez (sesiones, códigos, 2FA y Google). Por eso conviene separarlas. Todas deben tener al menos 32 caracteres; genera cada una con `openssl rand -base64 48`.

**Separar las claves en una instalación existente (sin perder nada).** Copia el valor **actual** de `SESSION_SECRET` en dos variables nuevas, `TOKEN_SECRET` y `ENCRYPTION_KEY`, y redespliega. No cambia nada para nadie: son la misma clave con otro nombre. A partir de ahí ya puedes rotar `SESSION_SECRET` cuando quieras (siguiente procedimiento). En una instalación nueva, genera las tres desde el principio.

**Rotar solo las sesiones** (p. ej. si sospechas que se ha filtrado `SESSION_SECRET`, o alguien ha dejado una sesión abierta en un equipo ajeno). Requisito: `TOKEN_SECRET` y `ENCRYPTION_KEY` definidas (ver el párrafo anterior).
1. Genera un valor nuevo y ponlo en `SESSION_SECRET`.
2. Redespliega. Todo el mundo vuelve a entrar; la verificación en dos pasos, los códigos de recuperación, los dispositivos recordados y Google siguen funcionando.

**Rotar la clave de cifrado** (`ENCRYPTION_KEY`) sin perder la verificación en dos pasos ni Google:
1. Copia el valor actual de `ENCRYPTION_KEY` en `ENCRYPTION_KEY_PREVIOUS` (si nunca la definiste, copia el de `SESSION_SECRET`: era la clave que se usaba).
2. Pon un valor nuevo en `ENCRYPTION_KEY` y redespliega. La app lee lo antiguo con la clave anterior y lo vuelve a cifrar con la nueva a medida que se usa.
3. Para no esperar, vuelve a cifrarlo todo de una vez: `node dist/rotate-keys.mjs` en el contenedor (con Docker Compose: `docker compose exec app node dist/rotate-keys.mjs`; en desarrollo: `npm run keys:rotate`). Con `--dry-run` solo cuenta lo que haría. Se puede repetir sin peligro y con la app en marcha.
4. Si el comando termina con «0 ilegibles», quita `ENCRYPTION_KEY_PREVIOUS` y redespliega. Si quedan ilegibles, es que se cifraron con otra clave que ya no tienes: esas personas tendrán que configurar de nuevo su segundo paso (un admin lo reinicia en *Administración → Usuarios*) o reconectar Google.

**Rotar `TOKEN_SECRET`** (poco habitual): pon el valor actual en `TOKEN_SECRET_PREVIOUS`, uno nuevo en `TOKEN_SECRET` y redespliega. Mientras la anterior siga definida, los enlaces pendientes, los códigos de recuperación y los dispositivos recordados siguen valiendo (los dispositivos se pasan solos a la clave nueva la próxima vez que se usan). Los enlaces caducan en horas (las invitaciones, en 72 h), pero los **códigos de recuperación no se pueden pasar a la clave nueva** (solo se guarda su huella): antes de quitar `TOKEN_SECRET_PREVIOUS`, pide a quien use la verificación en dos pasos que genere códigos nuevos en *Mi perfil*, o asume que los antiguos dejarán de valer.

**Qué se pierde en cada caso, en resumen:**
- Solo `SESSION_SECRET`: las sesiones abiertas.
- `ENCRYPTION_KEY` con `ENCRYPTION_KEY_PREVIOUS` y el comando de rotación: nada.
- `ENCRYPTION_KEY` sin la anterior: las apps de verificación (TOTP) y las conexiones con Google. La verificación por email no se ve afectada.
- `TOKEN_SECRET` con `TOKEN_SECRET_PREVIOUS`: nada mientras la anterior siga puesta; al quitarla, los códigos de recuperación no renovados.
- `TOKEN_SECRET` sin la anterior: los enlaces de email pendientes, los códigos de recuperación y los dispositivos recordados.

**Guarda estas claves fuera del servidor** (en un gestor de contraseñas), junto con el resto del kit de recuperación: `SESSION_SECRET`, `TOKEN_SECRET`, `ENCRYPTION_KEY` y `BACKUP_KEY`. Si pierdes el servidor y restauras una copia en otro, necesitas `BACKUP_KEY` para abrir la copia y `ENCRYPTION_KEY` (y `TOKEN_SECRET`) para que la verificación en dos pasos, los códigos de recuperación y Google sigan funcionando; `SESSION_SECRET` puede ser nueva (solo obliga a entrar de nuevo). Si no has definido `TOKEN_SECRET` ni `ENCRYPTION_KEY`, `SESSION_SECRET` hace de las tres: guárdala y reutilízala.

Al cambiar cualquiera de estas variables en Railway o en el `.env` de Docker Compose, hace falta redesplegar o reiniciar la app (`docker compose up -d`).

### 4.5 Copias de seguridad y restauración

- **Copias automáticas cifradas (base de datos y ficheros):** con `BACKUP_KEY` definida, cada día se copian la base de datos (gzip + AES-256-GCM) y **todos los ficheros de `UPLOAD_DIR`** (adjuntos, miniaturas, copias de releases, documentos de proyecto) a `UPLOAD_DIR/backups`. Los ficheros se guardan cifrados **una sola vez** en un almacén común (`backups/files/`) y cada copia solo añade los nuevos; un manifiesto cifrado por copia (`.pzman`) dice qué volcado y qué ficheros la forman. Se conservan **14 diarias y 6 mensuales**; los ficheros que ya no nombra ninguna copia conservada se borran. El estado se ve en *Administración → Copias de seguridad*, con **Crear copia ahora** y **Descargar** (solo la base de datos, cifrada; pide tu contraseña o un código de tu app y genera un enlace de un solo uso válido 60 s).
  - **Guarda `BACKUP_KEY` también fuera de Railway** (gestor de contraseñas): sin ella las copias no se pueden leer.
  - `BACKUP_LOCAL_FILES`: sin definir, la copia local incluye los ficheros **solo si no hay destino externo** (si lo hay, en el volumen queda solo la base de datos y los ficheros van al destino externo, para no ocupar el doble). `1` o `0` lo fuerzan. Ojo: sin destino externo, la copia de los ficheros ocupa en el volumen tanto como los propios ficheros.
- **Destino externo (muy recomendado):** el volumen guarda a la vez los datos y sus copias; si se pierde, se pierde todo. Tras cada copia diaria, Pizarro sube a un **almacenamiento S3 compatible** (Cloudflare R2, Backblaze B2, MinIO…) lo que aún no tenga, y aplica allí la misma retención.
  1. Crea un bucket privado y una clave de API con permiso de lectura, escritura y borrado **solo en ese bucket**. En R2: *R2 → Create bucket* y *Manage R2 API Tokens → Create API token* (*Object Read & Write*, limitado al bucket).
  2. En el servicio de la app, *Variables*: `BACKUP_S3_ENDPOINT` (en R2, `https://<id-de-cuenta>.r2.cloudflarestorage.com`; en B2, `https://s3.<región>.backblazeb2.com`), `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` y, opcionales, `BACKUP_S3_REGION` (por defecto `auto`; en B2, la región del endpoint) y `BACKUP_S3_PREFIX` (p. ej. `pizarro`). Despliega.
  3. En *Administración → Copias de seguridad → Destino externo* pulsa **Copiar ahora a destino externo** y, al cabo de unos minutos, recarga: debe salir *Correcta*. La primera subida lleva todos los ficheros; las siguientes, solo los nuevos. Si se corta, se reanuda en la siguiente pasada (cada hora).
  - Si hay destino externo y la última subida correcta tiene **más de 48 h**, se avisa en el menú y por email a los administradores, igual que con la copia local.
  - Fuera de Railway también vale una carpeta montada (disco USB, NAS): `BACKUP_EXTERNAL_DIR` (ver `docs/INSTALL.md`).
- **Prueba de restauración mensual:** cada mes se restaura de verdad la última copia en una base de datos temporal (`pizarro_restoretest_…`, que se borra al terminar) y se comprueba que cada destino tiene todos los ficheros de su última copia, descifrando unos cuantos al azar. Si el usuario de la base de datos no puede crear bases de datos, solo se descifra y se comprueba la copia entera, y la página lo indica. En Railway el usuario `postgres` sí puede.
- **Restaurar sin `git`:** la imagen trae la herramienta `node dist/restore.mjs` y todas las migraciones. Restaura en una base de datos **vacía**: aplica las migraciones hasta la de la copia, carga los datos, aplica las migraciones posteriores y, con `--files`, restaura los ficheros (comprobando el sha256 de cada uno). Sirve para copias hechas con esta versión o con cualquier versión anterior; una copia de una versión **más nueva** que la imagen se rechaza.
  - Orígenes: `latest` (la última del volumen), `s3:latest`, `external:latest`, o una copia concreta por su nombre (`s3:pizarro-backup-20261025T031500Z`). `--list` muestra las que hay.
  - **Se ha perdido el volumen o la base de datos** (Railway):
    1. Crea un servicio PostgreSQL nuevo y, si se perdió el volumen, monta uno nuevo en `/app/uploads`.
    2. Apunta `DATABASE_URL` de la app a la base nueva (`${{NombreDelServicio.DATABASE_URL}}`) y despliega. Al arrancar, la app crea el administrador inicial en la base nueva: por eso el paso 3 lleva `--force`.
    3. Abre una consola en el contenedor de la app (`railway ssh --service <app>` con la CLI de Railway) y ejecuta `node dist/restore.mjs s3:latest --files --force` (o `latest --files --force` si el volumen sigue entero). `--force` **borra** lo que haya en la base de destino: compruébalo antes.
    4. Reinicia el servicio (*Restart*) y entra con tus usuarios de siempre.
  - **Volver a una copia anterior** (p. ej. tras un borrado por error): igual, pero restaurando en una base nueva la copia elegida (`node dist/restore.mjs s3:pizarro-backup-AAAAMMDDTHHMMSSZ`, con `DATABASE_URL="<url de la base nueva>"` delante) y cambiando después `DATABASE_URL` de la app a esa base. Los ficheros no hace falta restaurarlos si el volumen está entero (los adjuntos no cambian una vez subidos); los que faltaran se recuperan con `--files-only`.
  - Si la restauración de ficheros se corta, repítela con `--files-only`: salta los que ya están bien.
- **Manual con `pg_dump`:** `pg_dump "$DATABASE_PUBLIC_URL" -Fc -f tablon.dump`. Restauración: `pg_restore --clean --no-owner -d "$DATABASE_PUBLIC_URL" tablon.dump`. Los backups del servicio Postgres y los snapshots del volumen de Railway siguen siendo un complemento útil (pestaña **Backups** de cada servicio: **Edit schedule** y **Backup now**), pero **borrar un volumen borra también sus copias**: el destino externo es lo que protege de eso.
- **Limpieza de huérfanos:** cada día se borran los ficheros de `UPLOAD_DIR` sin registro en la base de datos y con más de 24 h (nunca `backups/`); si más del 50 % parecen huérfanos, se aborta por seguridad.

### 4.6 Publicar una nueva versión de la app

1. Desarrolla el cambio. Si afecta al esquema, crea la migración con `npm run db:migrate -- --name descripcion` y súbela al repositorio.
2. `npm run check` (lint, tipos, traducciones y tests). Rellena también la traducción al inglés de la versión (`en` en `changelog.json`). Los textos nuevos de la interfaz van con `t("texto en español")` y su traducción en `src/i18n/en/`; `npm run i18n:check` lista los que falten.
3. `npm run version:bump -- patch|minor|major` (anota la fecha y la hora del lanzamiento), rellena la entrada en `changelog.json` y ejecuta `npm run version:bump -- --render`.
4. Haz commit y *push*. Railway despliega, aplica la migración y la nueva versión aparece en *Historial de versiones*.

### 4.7 Integraciones: Google, email y WhatsApp

Son opcionales e independientes. La configuración paso a paso está en el `README.md`, sección *Integraciones opcionales*:

| Integración | Variables | Qué hace cada usuario |
|---|---|---|
| Google Docs/Sheets e inicio de sesión | Ninguna: un admin lo configura en *Administración → Ajustes → Acceso con Google* (ver 4.8). Opcionalmente `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_WORKSPACE_DOMAIN`, que tienen prioridad, `GOOGLE_SHARE_ROLE` (valor por defecto de cada proyecto; se cambia en *Ajustes del proyecto → Documentos de Google*), `AUTH_GOOGLE_ONLY`, `AUTH_ALLOW_ADMIN_PASSWORD` | Conectar su cuenta en *Mi perfil* para Docs/Sheets; el inicio de sesión no requiere conectar nada. |
| Email | Ninguna: un admin lo configura en *Administración → Ajustes → Avisos por email* (ver 4.8). Opcionalmente `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, que tienen prioridad (la sección queda de solo lectura). | Nada (activado por defecto; se puede desactivar). Con email se activan invitaciones, «¿Olvidaste tu contraseña?», confirmaciones y avisos. |
| WhatsApp | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG` | Activarlo y escribir su número en *Mi perfil*. |

Para el **inicio de sesión con Google**, añade al cliente OAuth una segunda URI de redirección autorizada: `https://<dominio>/api/auth/google/callback` (además de `APP_URL` + `/api/google/callback`, la de Drive).

El resultado de cada envío queda en la tabla `Notification` (`emailSentAt`, `whatsappSentAt`, `deliveryError`) y en los logs con el prefijo `[notify]`. En los logs, el destinatario aparece enmascarado (`p***@dominio`); el email se envía a la dirección completa.

### 4.8 Avisos por email y acceso con Google (Administración → Ajustes)

Son dos cosas distintas, cada una en su tarjeta:

**1. Avisos por email** (cómo envía Pizarro los avisos, invitaciones y enlaces de contraseña). Dos opciones:

- **Gmail de un administrador (uso familiar):** los avisos salen del Gmail de un admin. Pasos: en esa cuenta de Google activa la *verificación en 2 pasos*; en `myaccount.google.com/apppasswords` crea una **contraseña de aplicación**; en Pizarro escribe la dirección de Gmail y pega esa contraseña (no la normal). Pizarro usa `smtp.gmail.com`, puerto 465 (SSL).
- **Servicio de correo de la empresa:** el servicio de envío de la empresa o del proyecto. Elige el proveedor y se rellenan servidor, puerto y seguridad, con una pista de qué usuario y contraseña pide: **Google Workspace** (buzón con contraseña de aplicación en `smtp.gmail.com:465`, o *SMTP relay* `smtp-relay.gmail.com:587` con autenticación), **Brevo** (`smtp-relay.brevo.com:587`, usuario y clave SMTP de Brevo), **Mailchimp Transactional/Mandrill** (`smtp.mandrillapp.com:587`, clave API), **SendGrid** (`smtp.sendgrid.net:587`, usuario `apikey` y la clave), **Amazon SES** (`email-smtp.<región>.amazonaws.com:587`, credenciales SMTP de SES), **Mailgun** (`smtp.mailgun.org:587`) o **Microsoft 365** (`smtp.office365.com:587`). También vale cualquier otro servidor SMTP.

Después, **Enviar email de prueba** (llega a tu email; si falla, muestra el error). La contraseña se guarda cifrada con `ENCRYPTION_KEY` y no vuelve a mostrarse (**Reemplazar** / **Quitar**); al cambiar de servidor, puerto o usuario hay que escribirla de nuevo. **Desactivar el envío de emails** lo apaga. Si el servidor tiene variables `SMTP_*`, mandan ellas y la tarjeta queda de solo lectura.

**2. Acceso con Google** (botón «Iniciar sesión con Google» para personas que ya tienen usuario en Pizarro con ese mismo email; también activa Docs/Sheets). Se configura dentro de Pizarro, sin depender de dónde esté instalado (solo hace falta `APP_URL`). Google no cobra por esto: no hace falta facturación en Google Cloud.

1. En `console.cloud.google.com` crea un proyecto (gratis).
2. **Pantalla de consentimiento OAuth:** *Interno* si solo entrarán cuentas de tu Google Workspace; *Externo* si entrarán cuentas @gmail. En *Externo*, mientras esté en modo *Pruebas* solo pueden entrar las cuentas que añadas como usuarios de prueba (hasta 100); para el inicio de sesión basta con publicarla, sin verificación de Google (los permisos de Docs/Sheets sí pueden pedir verificación).
3. **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web.** En *URI de redirección autorizados* pega las dos que muestra Pizarro (botones de copiar): `…/api/auth/google/callback` (inicio de sesión) y `…/api/google/callback` (Docs/Sheets).
4. Copia el **ID de cliente** y el **secreto** en la tarjeta. El secreto se guarda cifrado; al cambiar el ID hay que escribirlo de nuevo. **Dominio de Workspace permitido** es opcional: vacío = cualquier cuenta de Google (Gmail incluido).

La tarjeta indica si está **Activo**. Las variables `GOOGLE_*` del servidor, si existen, tienen prioridad. Los cambios se aplican en segundos, sin reiniciar.

#### Enviar emails con Google Workspace mediante variables del servidor

Con variables del servidor (tienen prioridad sobre la tarjeta):

1. Crea un buzón dedicado, por ejemplo `avisos@tu-dominio.com`.
2. Activa en esa cuenta la **verificación en 2 pasos** de Google.
3. En la cuenta de Google, crea una **contraseña de aplicación**.
4. En Railway define:
   - `SMTP_HOST=smtp.gmail.com`
   - `SMTP_PORT=465`
   - `SMTP_USER=avisos@tu-dominio.com`
   - `SMTP_PASS=` la contraseña de aplicación (no la de la cuenta)
   - `SMTP_FROM=Pizarro <avisos@tu-dominio.com>`
5. Redespliega y prueba con una invitación o con «¿Olvidaste tu contraseña?».

Los PDF (informe, plan semanal, lista, entrega) tienen un tiempo máximo de 90 s cada uno: si se supera, se muestra «El PDF tardó demasiado; inténtalo de nuevo» y la cola sigue con los siguientes.

**Alternativa:** el servicio *SMTP relay* de Workspace (`smtp-relay.gmail.com`). Las IP de salida de Railway no son fijas, así que no sirve la autorización por IP: usa autenticación SMTP.

### 4.9 Monitorización

- **Salud:** `GET /api/health` → `{"status":"ok"}` si la base de datos responde, la carpeta de subidas se puede escribir y a su disco le quedan al menos `HEALTH_MIN_FREE_MB` libres (200 MB por defecto; `0` desactiva esta comprobación). Si no, `503` con `{"status":"error","reason":…}` (`database`, `uploads_not_writable` o `low_disk_space`), sin rutas ni detalles.
- **Tareas de mantenimiento:** *Administración → Copias de seguridad → Tareas de mantenimiento* muestra la última ejecución de cada una (tabla `JobRun`). Solo un proceso las ejecuta a la vez (bloqueo consultivo de PostgreSQL), así que un despliegue solapado no las duplica, y «una vez al día» (ficheros huérfanos) se respeta aunque la app se reinicie.
- **Errores del proceso:** las promesas rechazadas y las excepciones no capturadas fuera de una petición quedan en *Logs* (`system.unhandledRejection`, `system.uncaughtException`). Con `EXIT_ON_UNCAUGHT_EXCEPTION=1` (lo fija el `compose.yml` de instalación propia), tras una excepción no capturada la app sale para que Docker la reinicie; en Railway, sin esa variable, solo se registra (sus reintentos son limitados).
- **Logs de la app:** *Administración → Logs* (ver 3.16), con la duración de cada acción: es el primer sitio donde mirar si algo va lento o falla.
- **Logs del contenedor:** en Railway, *Deployments → View logs*. Los errores inesperados también salen ahí con el prefijo `[action]`, `[upload]` o `[uploads]`.
- **Errores en el navegador:** la pantalla «Algo ha fallado» y cualquier excepción no capturada del navegador se registran en *Logs* (categoría *client*), con la página, el navegador y el código del error para cruzarlo con el del servidor.
- **Diagnóstico para soporte:** *Administración → Ajustes → Descargar diagnóstico* (solo admins; 5 descargas cada 10 minutos; queda en *Logs* como `admin.doctor`) descarga un JSON con el estado técnico: versión y compilación, Node, memoria y tiempo encendido, qué variables documentadas están definidas (`set`, `unset` o `invalid`; **nunca su valor**), qué integraciones están activas, tamaño de la base de datos y filas por tabla, migraciones aplicadas y pendientes, espacio del disco de subidas, estado de las tareas de mantenimiento y de las copias, resultado de la comprobación de salud, sesiones activas y cuántos errores y avisos hubo en las últimas 24 h por tipo de acción. **No lleva datos personales**: ni mensajes de los logs, ni emails, ni nombres (se tachan de los mensajes de error), ni claves. Con Docker, lo mismo por consola: `docker compose exec app node dist/doctor.mjs > diagnostico.json`. Revísalo antes de enviarlo si quieres: es texto legible.
- **Uso del volumen:** visible en la pestaña del volumen. Como referencia, una captura típica ocupa entre 50 y 300 KB.

### 4.10 Resolución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| El despliegue no arranca: `SESSION_SECRET debe tener al menos 32 caracteres` | Variable vacía o corta | Genera una con `openssl rand -base64 48`. |
| `[boot] No hay usuarios: el administrador inicial se crea en el asistente web (/setup)…` | Primer arranque sin variables de seed | En un servidor propio, abre `/setup` con el código que el log imprime en un recuadro (`introduce el código: XXXX-XXXX`). En Railway, añade `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` y redespliega. |
| El login no mantiene la sesión | `APP_URL` con `https://` pero se accede por `http://` | Accede por HTTPS o ajusta `APP_URL`/`COOKIE_SECURE`. |
| Las capturas desaparecen tras desplegar | No hay volumen montado o la ruta no coincide | Monta un Volume en `/app/uploads` y comprueba que `UPLOAD_DIR` es igual. |
| «El archivo supera el tamaño máximo del proyecto (N MB por archivo)» | Archivo mayor que el máximo del proyecto (o que `MAX_UPLOAD_MB`, si está definida) | Reduce el archivo o sube el límite en los ajustes del proyecto (hasta 100 MB; un valor muy alto consume más memoria al subir). |
| No aparece «Generar Release» | Ninguna columna tiene el rol *Siguiente salto* | Asígnalo desde el menú «⋯» de la columna. |
| No se puede «Mover a En producción» | Ninguna columna tiene ese rol | Asígnalo, o elige *Archivar tarjetas* al desplegar. |
| Un usuario no ve un proyecto de equipo | No está asignado al proyecto | *Administración → Proyectos* (o *Ajustes del proyecto*) → asígnalo. |
| Un admin no ve un proyecto en sus selectores | No lo ha marcado en sus proyectos de trabajo | *Mi perfil → Proyectos en los que trabajo*. |
| Nadie ve un proyecto privado (ni los admins) | Los privados solo los ven sus miembros | Un miembro puede añadir a más personas desde *Ajustes del proyecto*. |
| «¿Olvidaste tu contraseña?» dice que no hay envío de emails, o no llegan invitaciones | No hay SMTP configurado | Configura el email (ver 4.8); mientras tanto el admin da una contraseña inicial. |
| «Copias de seguridad» no funciona | Falta `BACKUP_KEY` o no es válida | La página de copias explica qué falla sin mostrar la clave (p. ej. «base64 que decodifica a 16 bytes»). Genérala con `openssl rand -base64 32`, guárdala fuera de Railway y redespliega. |
| «Hay una versión nueva de Pizarro. Recarga para seguir.» | Esa pestaña se abrió antes de un despliegue | Pulsa **Recargar**. Nunca se recarga sola mientras escribes o tienes un diálogo abierto. |
| Se rechaza una subida por cuota | Se superó `UPLOAD_QUOTA_MB_PER_PROJECT` o `UPLOAD_QUOTA_MB_TOTAL` | Borra adjuntos o sube la cuota. |
| Google devuelve `redirect_uri_mismatch` al iniciar sesión | Falta la URI `/api/auth/google/callback` | Añádela al cliente OAuth (ver 4.7). |
| «La integración con Google no está configurada» | Faltan `GOOGLE_CLIENT_ID`/`SECRET` o `APP_URL` | Configúralos y redespliega. |
| Google devuelve `redirect_uri_mismatch` | La URI de redirección del cliente OAuth no coincide | Debe ser exactamente `APP_URL` + `/api/google/callback`. |
| «Tu conexión con Google ha caducado» | Permiso revocado, o se cambió la clave de cifrado (`ENCRYPTION_KEY`, o `SESSION_SECRET` si aquella no está definida) sin la anterior (ver 4.4) | Vuelve a conectar en *Mi perfil*. |
| No llegan los emails | Credenciales SMTP o contraseña de aplicación incorrectas | Revisa los logs `[notify]` y la columna `deliveryError`. |
| No llegan los WhatsApp | Plantilla sin aprobar, idioma distinto, token caducado o número no verificado (número de prueba) | Revisa los logs `[notify]`, el estado de la plantilla y `WHATSAPP_TEMPLATE_LANG`. |
| Las páginas tardan en cargar a veces | Servicio en una región lejana, *App Sleeping* activado o conexiones a la base de datos frías | En Railway: pon la app y Postgres en la misma región cercana (p. ej. *EU West*) y desactiva *Serverless / App Sleeping*. Revisa en *Logs* la duración de las acciones. |
| El informe no marca una tarjeta como hecha | Su columna no cuenta como terminada | Menú «⋯» de la columna → *Contar como terminada*. |

### 4.11 Instalación en un servidor propio (Docker Compose)

Además de Railway, Pizarro se puede instalar en cualquier servidor con Docker 24+ (1 vCPU, 2 GB de RAM): `deploy/compose.yml` levanta Caddy (HTTPS automático para `DOMAIN`), la app (el mismo `Dockerfile`) y PostgreSQL 16, con volúmenes, comprobaciones de salud, reinicio automático y límites de memoria. La guía completa (secretos con `openssl rand`, primer administrador, actualizar, restaurar y problemas frecuentes) está en `docs/INSTALL.md`. Nada de la imagen depende de Railway: la zona horaria del navegador llega del servidor (atributo `data-tz`), así que cambiar `APP_TIMEZONE` solo exige reiniciar, y el identificador de versión es la versión del `package.json` más el commit (`GIT_SHA` o `RAILWAY_GIT_COMMIT_SHA`) o, sin commit, la hora de la compilación.

**Endurecido:** el código de la imagen es de root y no se puede modificar en ejecución; con Compose el contenedor de la app es de solo lectura (salvo subidas, caché y `/tmp`), sin privilegios nuevos y con las capacidades mínimas, y las instalaciones nuevas usan un rol de base de datos sin superusuario (`pizarro_app`, con permiso para crear bases para la prueba de restauración). Cómo migrar una instalación existente: `docs/INSTALL.md`, sección 3.5. Guía paso a paso para una prueba completa en un VPS (instalar, copiar a R2, destruir y restaurar): `docs/PRUEBA-VPS.md`.

---

## 5. Anexo: decisiones técnicas

| Decisión | Motivo |
|---|---|
| Next.js en un solo servicio | Interfaz y API en el mismo despliegue; Server Actions sin capa REST manual. |
| Sesiones en base de datos frente a JWT | Permiten revocar sesiones (cerrar sesión, desactivar usuarios) y la consulta extra no se nota con 10 usuarios. |
| Posiciones fraccionarias | Reordenar sin reescribir toda la columna. |
| Roles de columna | Permiten renombrar y reordenar columnas sin romper el generador de releases. |
| Generación de la release en el cliente | Respuesta instantánea y edición libre antes de guardar. |
| `changelog.json` como fuente | Versionado con el código y legible en revisiones; la tabla `AppVersionLog` se reconstruye en cada arranque. |
| Informe con `@react-pdf/renderer` | Genera el PDF en el servidor sin un navegador: la imagen no crece y el informe tarda milisegundos. |
| OAuth por usuario con `drive.file` | Cada archivo pertenece a quien lo crea, sin cuentas de servicio ni permisos sobre el resto del Drive. |
| Copias cifradas dentro de la app | Restaurables sin `pg_dump` y con la clave fuera del servidor; protegen frente a fallos y filtraciones del volumen. |
| Tipos de tarea en tabla | Cada equipo define sus categorías y su orden en la release sin tocar código. Las releases guardan el nombre del tipo como instantánea. |
| App instalable (PWA) | Icono en la pantalla de inicio y pantalla completa sin publicar en tiendas. El service worker no guarda datos en caché, porque todo es privado. |
| Avisos con `after()` | El email y el WhatsApp se envían tras responder: mencionar a alguien no añade espera. |
| Prisma CLI aislado en la imagen | La app usa la salida *standalone* (ligera) y las migraciones usan la CLI oficial sin descargas en el arranque. |
