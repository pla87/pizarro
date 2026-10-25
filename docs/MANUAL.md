---
title: "Pizarro · Manual de operaciones"
subtitle: "Arquitectura, guía de uso y procesos operativos"
version: "v1.22.0"
---

# Pizarro — Manual de operaciones

**Versión de la aplicación:** v1.22.0

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
| Columna | Estado del flujo. Configurable por proyecto. Puede tener un **rol** (*Siguiente salto* o *En producción*). |
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
| `Column` | projectId, name, position, role | Índice único parcial: como máximo una columna por rol en cada proyecto. |
| `Task` | projectId, columnId, kindId, title, description, color, linkUrl, position, assigneeId, archivedAt, `recurrence*` (repetición) | Posición fraccionaria para reordenar actualizando una sola fila. |
| `Label` / `TaskLabel` | name, color | Etiquetas por proyecto. |
| `Subtask` | taskId, title, done, position | Subtareas de una tarea (no pasan a las releases). |
| `UndoEntry` | userId, projectId, taskId, `kind` (UNDO / REDO), label, ops (JSON), createdAt | Las 10 últimas acciones deshacibles (y las 10 rehacibles) de cada usuario en cada proyecto, con sus operaciones inversas. Una acción nueva vacía las rehacibles. Caducan a los 7 días. Su etiqueta se guarda como plantilla traducible. |
| `TaskAttachment` | taskId, originalName, width, height, size | El fichero está en `UPLOAD_DIR/<id>.webp` (y `<id>.thumb.webp`). |
| `Release` / `ReleaseTask` | number (correlativo por proyecto), content (Markdown final), deployedAt, autor · instantánea de título y tipo de cada tarea | La instantánea se conserva aunque la tarea se borre. |
| `AppVersionLog` | version (única), releasedAt, summary, changes (JSON) | Se sincroniza desde `changelog.json` en cada arranque. |
| `Deliverable` | projectId, name, description, dueDate, position | Las tareas lo referencian con `deliverableId`. Al borrarlo, quedan sin entregable. |
| `TaskKind` | name, color, position, projectId (opcional), `subtaskTemplate` (subtareas predefinidas), título y descripción automáticos | Tipos de tarea configurables; sin `projectId` son generales, con él son exclusivos de ese proyecto. Nombre único entre los generales y dentro de cada proyecto. Cada tarea tiene `kindId`. |
| `ReleaseTemplate` | userId, kind (HEADER / FOOTER), name, content, position | Cabeceras y pies de release de cada usuario. |
| `TaskComment` | taskId, authorId, body, `parentId` | Las menciones se guardan como `@[Nombre](user:ID)`. `parentId` enlaza una respuesta con su comentario (un solo nivel). |
| `Notification` | userId, actorId, taskId, excerpt, readAt, emailSentAt, whatsappSentAt, deliveryError | Un aviso por persona mencionada, con el resultado de cada envío. |
| `TaskLink` | taskId, kind (GOOGLE_DOC / GOOGLE_SHEET), title, url | Documentos de Google enlazados a la tarjeta. |
| `GoogleAccount` | userId, email, refreshTokenEnc, accessTokenEnc, scope | Tokens OAuth cifrados con AES-256-GCM. |
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
| Verificación en dos pasos | App TOTP o código por email, con 10 códigos de recuperación (se muestran una vez). Obligatoria para admins con contraseña, opcional para el resto. Los secretos se cifran con una clave derivada de `SESSION_SECRET`. «Recordar este dispositivo 14 días» la omite en ese navegador. Un admin puede reiniciar el segundo paso de otra persona. |
| Inicio con Google | OpenID Connect con PKCE. Solo entran usuarios existentes y activos (por email verificado y, después, por id de Google); opcionalmente limitado a `GOOGLE_WORKSPACE_DOMAIN`. No pide segundo paso propio (vale el de Google). |
| Avisos de cuenta | Email de aviso al iniciar sesión desde un dispositivo desconocido (no en el primer acceso de una cuenta) y tras cualquier cambio de contraseña o de email. Al cambiar el email de una cuenta (desde el perfil o por un admin) se desvincula su cuenta de Google y dejan de valer los enlaces pendientes enviados a la dirección anterior (invitación, restablecer, confirmar); si era una invitación con el email mal escrito, hay que volver a enviarla. Cerrar sesión borra la cookie del navegador. |
| Fuerza bruta y abuso | Límite de intentos de login por pareja IP+email y por IP (ventana de 15 minutos), de «¿Olvidaste tu contraseña?» y de cambios de contraseña. También hay topes de subidas (60 por minuto y persona), comentarios (30 por minuto, 1000 por tarea), subtareas (100 por tarea), documentos de Google (20 por minuto), creación de tareas (300 por minuto y persona), etiquetas y entregables (30 por minuto), suma de adjuntos por tarea y tamaño de cada paquete ZIP de una release (80 MB por defecto cada uno, configurables en cada proyecto entre 10 y 500 MB; cada persona arma un ZIP a la vez y el servidor como mucho dos), cola de imágenes en proceso (más de 10 esperando: «inténtalo de nuevo en unos segundos») e informes PDF (5 por minuto y persona; se generan de uno en uno para que la app no se frene). |
| CSRF | `SameSite=Lax`, verificación de `Origin` integrada en las Server Actions y comprobación explícita de `Origin` en la ruta de subida. |
| Autorización | Sin registro público. Solo los admins gestionan usuarios. Cualquier usuario puede crear proyectos privados (máximo 100 por usuario no admin y 10 creaciones por hora). Cada operación comprueba la visibilidad del proyecto: un usuario no admin solo accede a los proyectos de equipo a los que está **asignado** y a sus privados; los admins acceden a todos los de equipo; los privados solo los ven sus miembros. Deshacer y rehacer nunca reasignan una tarjeta a alguien que ha perdido el acceso. |
| XSS | React escapa todo el contenido. El Markdown se renderiza sin HTML. Los enlaces solo admiten `http(s)` y se abren con `rel="noopener noreferrer"`. CSP estricta con *nonce* distinto en cada petición. |
| Cabeceras | `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `HSTS`. |
| Imágenes | Tamaño máximo configurable, límite de píxeles en sharp (protección frente a *decompression bombs*), reconversión siempre a WebP (se descarta cualquier contenido incrustado) y servido solo a usuarios con acceso. |
| Adjuntos | Cuota por proyecto (`UPLOAD_QUOTA_MB_PER_PROJECT`, 2048 MB por defecto) y cuota total opcional (`UPLOAD_QUOTA_MB_TOTAL`). Limpieza diaria de ficheros huérfanos (de más de 24 h; nunca toca `backups/` y se aborta si más del 50 % parecen huérfanos). |
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
- **¿Olvidaste tu contraseña?** (en la pantalla de acceso, solo con email configurado): escribe tu email y recibirás un enlace (válido 30 min, de un solo uso). La respuesta es siempre la misma exista o no la cuenta. Al usarlo se cierran todas tus sesiones. Tiene límite de intentos.
- **Mi perfil** permite cambiar nombre, contraseña y email:
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

- Para cambiar de proyecto, pulsa el **nombre del proyecto** en la parte superior del tablero (o en la barra superior en móvil) y elige otro en el desplegable. También sirve el selector de la barra lateral. Te quedas en la misma página: desde los **ajustes** de un proyecto pasas a los ajustes del otro, desde las **releases** a sus releases (con el texto buscado) y desde el **tablero** a su tablero. La app recuerda el último que abriste: aunque vayas a *Calendario*, *Avisos*, *Mis tareas*, *Mi perfil* u otra página general, el proyecto sigue elegido en el menú, con sus entradas (*Tablero*, *Releases*, *Ajustes del proyecto*, *Archivadas*) para volver directamente.
- Los administradores crean proyectos desde el selector (**Nuevo proyecto**) y pueden elegir una **plantilla** (ver 3.16) y marcarlo como **privado**; al crearlo se abren primero sus **ajustes** (columnas, tipos, miembros…), con el botón **Ir al tablero** arriba; los proyectos de equipo que crean se añaden solos a sus «Proyectos en los que trabajo». Los demás usuarios también pueden crear proyectos, pero **solo privados** (máximo 100 y 10 creaciones por hora).
- **Qué proyectos ves:** un usuario no admin solo ve los proyectos de equipo a los que está **asignado** y sus proyectos privados. Los administradores pueden abrir cualquier proyecto de equipo, pero en **Mi perfil → Proyectos en los que trabajo** eligen cuáles salen en sus selectores, menús y calendario. Si un admin no ha elegido ninguno, la página de inicio le muestra una pista para hacerlo. Al actualizar a la v1.17 se respetó el acceso previo: todos los usuarios quedaron asignados a los antiguos proyectos públicos y los admins con todos marcados. Sin plantilla, el proyecto trae las columnas *Backlog*, *En progreso*, *Siguiente salto a producción*, *En producción* y *Cerrado*; si quien lo crea usa Pizarro en inglés, salen en inglés (*Backlog*, *In progress*, *Next release*, *In production*, *Closed*).
- **Ajustes del proyecto** contiene:
  - nombre y descripción (admins; en un proyecto privado, cualquier miembro);
  - **visibilidad** (admins), con dos opciones:
    - *Equipo*: lo ven los **usuarios asignados** y todos los administradores. Los usuarios asignados se gestionan aquí (y en **Administración → Proyectos**); quitar la asignación a alguien desasigna sus tarjetas y corta su vista en vivo del proyecto;
    - *Privado*: al pasar un proyecto de equipo a privado, las **personas asignadas pasan a ser miembros** (conservan el acceso y sus tarjetas) y quien lo cambia también es miembro; el diálogo de confirmación indica cuántas personas mantienen el acceso. Los administradores que lo veían solo porque lo tenían en *Proyectos en los que trabajo* pierden el acceso y sus tarjetas se desasignan; luego se pueden quitar miembros. Tiene **miembros** y lo ven **solo ellos**, tampoco los administradores que no sean miembros; no aparece en sus listados, avisos ni asignaciones. Cualquier miembro puede **añadir o quitar miembros**, renombrarlo y borrarlo (escribiendo su nombre). El último miembro no puede salir. Al **borrar a un usuario** se borran los proyectos privados donde era el único miembro; en los demás, simplemente deja de ser miembro. Llevan un **candado** junto a su nombre;
  - etiquetas;
  - **informe semanal por email** (ver 3.9);
  - **Releases** (admins; en un proyecto privado, cualquier miembro): dos límites, entre 10 y 500 MB (80 por defecto cada uno; el del paquete nunca puede ser menor que el de la tarea):
    - **Tamaño máximo de los adjuntos de una tarea:** la suma de los adjuntos de cada tarea; una subida que la supere se rechaza con un aviso que indica el tope;
    - **Tamaño máximo de cada paquete ZIP de una release:** si los adjuntos de la release ocupan más, se descargan en varios ZIP (`release-AAAA-MM-DD-adjuntos-1de3.zip`, …), con el menor número de paquetes posible. Cada ZIP se arma en la memoria del servidor: súbelo solo si hace falta;
  - borrado del proyecto (admins, o cualquier miembro si es privado; pide escribir el nombre para confirmar).
- **Límites de cada proyecto:** como máximo **50 etiquetas**, **100 entregables** y **1000 tareas activas** (las archivadas no cuentan). Al llegar al tope, crear, duplicar, recuperar una archivada o deshacer un borrado avisa con el límite; archiva o borra tareas para hacer sitio. Al crear varias tareas a la vez, si el lote no cabe entero no se crea ninguna. Si una tarea repetitiva se termina con el proyecto lleno, no se crea la siguiente repetición (queda anotado en los logs). Además, cada persona puede crear como mucho 300 tareas, 30 etiquetas y 30 entregables por minuto.

### 3.3 Columnas

Desde el menú «⋯» de cada columna:

- **Renombrar**, **Mover a la izquierda o la derecha**.
- **Rol de la columna**: *Sin rol*, *Siguiente salto* o *En producción*. Si asignas un rol que ya tenía otra columna, esa otra columna pasa a *Sin rol*.
- **Borrar columna**: solo si no tiene tarjetas visibles. Si quedan tarjetas archivadas en ella, pasan a la primera columna del proyecto.
- **Añadir columna**: en escritorio, la barra vertical estrecha con un «+» al final del tablero; en móvil, el botón redondo «+» al final de las pestañas de columnas. No hay límite de 5; el máximo es 30 por proyecto.

### 3.4 Tarjetas

- **Crear:** botón *Nueva tarea*, el «+» de cada columna o el botón flotante en móvil. El formulario empieza por **Título, Tipo y Descripción**; en móvil se abre arriba de la pantalla para que esos campos se vean con el teclado abierto. Solo el título y el tipo son obligatorios; asignarla a alguien es opcional. Si el tipo tiene **subtareas predefinidas**, se añaden al elegirlo (ver 3.14). También se pueden añadir **subtareas** (Enter añade cada una). **Ctrl/⌘+Enter** en cualquier campo crea la tarea.
- **Crear varias a la vez:** botón **Varias tareas** (escritorio) o el botón flotante pequeño encima del «+» (móvil).
  - Elige la columna (por defecto, la que estás viendo) y pega una lista: **cada línea es una tarea** con ese título. Las líneas vacías se ignoran y se quitan viñetas como «-», «*», «1.» o «[ ]».
  - Elige el **tipo para todas** y, si alguna es distinta, cámbialo en su línea. Volver a pulsar un tipo común lo aplica a todas las líneas, también a las cambiadas a mano.
  - **Campos extra** (plegado): responsable, fecha límite, entregable y etiquetas comunes a todas.
  - Las subtareas predefinidas del tipo son opcionales aquí. Hasta 100 tareas de una vez; se añaden al final de la columna en el orden de la lista.
- **Tipo:** por defecto *Funcionalidad* o *Corrección*. Los administradores pueden crear más tipos generales, y cada proyecto puede tener los suyos (ver 3.14).
- **Atajo de captura:** pega una imagen (Ctrl/⌘+V) con el tablero en pantalla y se abre *Nueva tarea* con la captura adjunta.
- **Dos tareas a la vez (escritorio):** con una tarea abierta (nueva o existente), el botón **Nueva tarea** de la cabecera sigue activo por encima del fondo oscuro y abre una tarea nueva al lado (por defecto en *Backlog*): las dos quedan juntas y centradas, con el mismo ancho. Se puede trabajar en las dos; Escape o atrás cierran la última abierta.
- **Crear en otro proyecto:** junto al título *Nueva tarea* hay un desplegable de proyecto (por defecto, el actual). Al elegir otro, las columnas, tipos, personas, entregables y límites de adjuntos pasan a ser los de ese proyecto; la tarea se crea allí, no aparece en el tablero actual y un aviso ofrece **Ir al proyecto**. El borrador recuerda el proyecto elegido.
- **Quién está trabajando:** a la derecha del contador de tarjetas de la cabecera (en móvil, arriba a la derecha) aparecen círculos con las **iniciales** de quienes han hecho cualquier acción en ese tablero (abrir, crear, mover, editar, subir adjuntos…) en los **últimos 5 minutos**, tú incluido; al pasar el ratón se ven sus nombres. Se actualiza cada 20 segundos. Si hay más (cinco en escritorio, tres en móvil), se muestra «+N». Además, cada tarjeta muestra arriba a la izquierda unas **burbujas pequeñas** con quién tiene esa tarea abierta.
- **Trabajar varios a la vez:** si otra persona tiene abierta la misma tarea, el detalle lo indica («Fulano también tiene abierta esta tarea»). Si cambia el **título o la descripción** mientras tú los editas, al guardar no se pisa su texto: se avisa, la tarea se recarga con sus cambios y vuelves a aplicar los tuyos. El resto de campos (tipo, color, responsable…) se guardan al momento y gana el último cambio.
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
- **Descripción con formato:** se guarda como Markdown y, cuando no la estás editando, se ve formateada (títulos, negrita, cursiva, subrayado, tachado, listas, enlaces). Hay dos formas de editarla, a elegir en **Mi perfil → Edición de descripciones**:
  - **Con barra de formato** (por defecto): ves el resultado mientras escribes y aplicas **negrita, cursiva, subrayado, tachado, título, subtítulo, texto normal, lista y lista numerada** con botones (o Ctrl+B / I / U). Si pegas texto en Markdown, se convierte en formato, también en el móvil (aunque el teclado lo pegue envuelto en HTML sin formato). **Supr** o **Retroceso** con texto seleccionado borran toda la selección, también cuando abarca varios elementos de una lista. Al escribir `@` aparece la lista de personas para mencionar (y `@docs` / `@sheets`); la mención se ve como una etiqueta.
  - **Markdown:** escribes los símbolos (`**negrita**`, `*cursiva*`, `~~tachado~~`, `++subrayado++`, `# Título`, `- lista`, `1. lista`); al guardar se ve formateado.
  - En ambos modos, Ctrl/⌘+Enter guarda y Escape cancela.
  - Lo que escribes se guarda tal cual, incluidos `<`, `>`, `&` o comillas, y llega igual al texto de la release (p. ej. `->` no se convierte en `-&gt;`).
- **Colores de tarjeta:** gris, blanco, rojo, naranja, marrón, amarillo, verde, verde oscuro, turquesa, celeste, índigo, azul marino, violeta y rosa (también para etiquetas).
- **Fecha de creación:** al pie del detalle, «Creada por X el 24/10/2026 a las 08:14» (zona horaria de la app).
- **Arrastrar texto:** si seleccionas texto y lo arrastras con el ratón a otro campo (título, descripción, comentario…), se **mueve**; manteniendo **Ctrl** (⌥ en Mac) se **copia** y se queda también en el origen.
- **Subtareas:** añádelas y márcalas. **Doble clic** sobre una, el **lápiz** que aparece al pasar por encima (siempre visible en móvil) o **Enter/F2** con el foco en ella la editan (Enter guarda, Escape cancela) y se **reordenan** arrastrando el icono de seis puntos. Junto al título *Subtareas* hay una barra verde que se llena según la proporción de subtareas hechas (con dos, cada una marca el 50 %, da igual el orden); la tarjeta muestra el progreso (p. ej. `2/4`). Las subtareas **no pasan** al texto de las releases.
- **Adjuntos:** cualquier tipo de archivo de hasta **20 MB por archivo** (`MAX_UPLOAD_MB`), con un **total por tarea** que fija el proyecto (80 MB por defecto, ver 3.2). **Borrar un adjunto** no pide confirmación: sale el aviso «Adjunto borrado» con **Deshacer**, que deshace exactamente ese borrado aunque hayas hecho otras cosas después (Ctrl/⌘+Z y el botón de deshacer siguen deshaciendo tu última acción). La sección indica ambos: «Máx. 20 MB por archivo · 45 / 80 MB en total»; si se supera el total, esa parte se resalta con el color del tema. Pégalos con Ctrl/⌘+V, usa *Añadir* o **arrástralos** sobre la tarea abierta o directamente sobre su **tarjeta en el tablero** (en ambos casos aparece «Suelta para adjuntar»); también desde la ventana de descargas del navegador. Los que no son imagen se listan con su icono, nombre y tamaño, y se descargan (nunca se abren dentro de Pizarro, por seguridad). En la tarjeta del tablero, un icono de imagen indica cuántas imágenes tiene y un icono de clip/archivo cuántos otros archivos (ambos si hay de las dos clases).
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

**Tareas fijas («Siempre en la release»).** Al pie de la columna *Siguiente salto a producción* hay una sección plegable que indica cuántas tareas fijas tiene. Al abrirla, se despliega hacia arriba con esas tareas y el botón **+ Añadir**. Son tareas que se repiten en cada despliegue (por ejemplo, «Generar el PDF de la release»): entran preseleccionadas en cada release (con la marca *fija*), pero **no salen de la columna** al marcarla como desplegada. Solo se añaden al usar **Generar Release** de esa columna, no con *Release con selección*. Para convertir una tarea en fija, arrástrala sobre la sección: si está cerrada se abre al mantenerla encima un momento. También se puede marcar o desmarcar una tarea existente de esa columna con *Fija en la release* en su detalle. Si se mueve a otra columna o se archiva, deja de ser fija. Cada tarea fija lleva un pequeño interruptor **En todas / Cada dos / Cada tres** (del color de la barra de subtareas): con *Cada dos* solo entra preseleccionada en las releases de número par y con *Cada tres* en las múltiplo de 3 (siempre se puede marcar o desmarcar a mano). Cambiarlo se puede deshacer y queda en el historial; al dejar de ser fija vuelve a *En todas*. Las tareas del panel también se pueden **arrastrar fuera** a cualquier columna y posición (en táctil, con su asa): dejan de ser fijas.

1. Prepara tus plantillas en **Mi perfil → Plantillas de release notes**. Puedes tener **varias cabeceras** (por ejemplo, «Contexto para IA» o «Para negocio») y **varios pies** (por ejemplo, «Checklist de cierre»), cada uno con su nombre. Se pueden **reordenar**: la primera de cada tipo es la que se propone por defecto en **Generar release**.
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

- En el detalle de la tarjeta, sección **Comentarios**. Escribe `@` y el principio de un nombre para elegir a una persona (↑↓ y Enter). También se puede mencionar en la descripción y en el **título** de la tarea. Los comentarios admiten **respuestas** (un solo nivel).
- **Cuándo recibes un aviso:**
  - te **mencionan**;
  - te **asignan** una tarea;
  - cambia la **fecha límite** de una tarea tuya;
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
4. Si el servidor tiene `GOOGLE_WORKSPACE_DOMAIN`, el archivo de un proyecto de equipo se comparte automáticamente con todo el dominio (por defecto como editor, según `GOOGLE_SHARE_ROLE`); el de un **proyecto privado** se comparte solo con los miembros del proyecto, no con el dominio. Así, quien tenga acceso al proyecto puede abrirlo desde la tarjeta. Si no, compártelo desde Google como cualquier otro documento.
5. Quitar el enlace de la tarjeta no borra el archivo de Drive.

### 3.11 Otras vistas

El menú lateral muestra, debajo de las opciones del proyecto: **Calendario**, **Avisos**, **Mis tareas asignadas**, **Mi perfil**, **Administración** (solo admins), **Historial de versiones** e **Instalar app**.

- **Mis tareas asignadas:** funciona como una bandeja diaria con tus tarjetas de todos los proyectos a los que tienes acceso, cada fila con un chip del proyecto (icono de carpeta) al principio, agrupadas en **Vencidas**, **Hoy**, **Esta semana**, **Más adelante** y **Sin fecha**, con filtros. No incluye las ya terminadas. Muestra como mucho 500; si tienes más, lo indica con el total.
- **Calendario:** cuadrícula mensual de lunes a domingo.
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
- **Automatización:** cada tipo puede tener un **título automático** y un **texto inicial de la descripción** (al crearlo o editarlo, sección *Automatización*). Al elegir ese tipo en una tarea nueva o existente, el título se sustituye y la descripción empieza por ese texto (sin repetirlo si ya está). El texto inicial admite **formato Markdown** y se edita con el mismo editor que las descripciones (con barra de formato o Markdown, según tu perfil). La lista de tipos explica en una línea lo que hace cada uno. No se aplica en *Varias tareas*.
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

La entrada **Administración** del menú lateral reúne seis pestañas: **Usuarios**, **Proyectos**, **Tipos de tarea** (ver 3.14), **Plantillas de proyecto**, **Copias de seguridad** y **Logs**. En móvil, el menú de pestañas solo se desplaza en horizontal.

**Proyectos:** lista los proyectos de equipo (los privados no aparecen) con los usuarios asignados a cada uno; desde ahí se añaden o quitan usuarios. Los mismos usuarios asignados se gestionan en los ajustes de cada proyecto. Quitar una asignación desasigna las tarjetas de esa persona y corta su conexión en vivo con el proyecto.

**Plantillas de proyecto:** definen las columnas (nombre, orden, rol especial *Siguiente salto* o *En producción* y si cuentan como terminadas), los tipos de tarea propios (con su automatización, descripción en Markdown y **subtareas predefinidas**), qué tipos generales no usará el proyecto y las etiquetas. **Crear desde un proyecto…** rellena una plantilla a partir de un proyecto existente. Al crear un proyecto se elige la plantilla en *Nuevo proyecto*.
- Vienen **12 plantillas de serie**: *Vibecoding*, *Tareas familiares*, *Producción audiovisual*, *Negocio*, *Marketing y contenidos*, *Organización de eventos*, *Soporte y atención al cliente*, *Selección de personal*, *Reformas y obras*, *Viajes*, *Estudios o tesis* y *Mudanza*, con sus columnas, tipos y etiquetas. La lista se ordena alfabéticamente.
- **Ocultar todos los tipos generales:** opción de cada plantilla para que el proyecto nuevo solo use los tipos de la plantilla (por ejemplo, en *Tareas familiares* no salen *Mejora*, *Funcionalidad*, etc.). Está activada en todas las de serie salvo *Vibecoding*. Solo afecta a los proyectos que se creen a partir de ahora; en uno ya creado, desmarca los tipos en *Ajustes del proyecto → Tipos de tarea*.
- Las de serie se pueden **editar** o **borrar**. En una modificada, **Restablecer** vuelve a su contenido original; **Recuperar plantillas por defecto** recrea las de serie que se hayan borrado. Cuando Pizarro mejora una plantilla de serie, se actualiza sola al desplegar si no la has modificado; si la has cambiado, se respeta tu versión.
- **En inglés:** quien usa Pizarro en inglés ve las plantillas de serie sin modificar con su nombre en inglés, y el proyecto se crea con columnas, tipos (con sus descripciones y subtareas) y etiquetas en inglés. Una plantilla de serie modificada o una propia se ofrece y se aplica tal como está guardada. Los tipos generales (*Funcionalidad*, *Corrección*) son comunes a todos los proyectos y conservan su nombre.

**Copias de seguridad:** estado de las copias automáticas (última copia, última prueba de restauración, copias conservadas), **Crear copia ahora** y **Descargar** la última (pide tu contraseña, o un código de tu app de autenticación, y usa un enlace de un solo uso de 60 s; ver 4.5). Solo funciona con `BACKUP_KEY` definida.

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
- **Desvincular Google:** en usuarios con la cuenta de Google vinculada (no en la tuya), quita ese vínculo, cierra sus sesiones y le avisa por email. La próxima vez entrará con su contraseña; si vuelve a entrar con Google con el mismo email, se vincula de nuevo. No afecta a los documentos de Drive.
- **Forzar cambio de contraseña:** marca la cuenta para cambiar la contraseña, cierra sus sesiones y, con email configurado, envía un enlace de restablecimiento (30 min). Hasta que la persona elige una nueva (distinta) no puede usar la app. Los admins no fijan contraseñas a mano.
- **Reiniciar la verificación en dos pasos:** quita el segundo paso de la persona (volverá a configurarlo).
- **Borrar** (papelera): elimina la cuenta para siempre. En los proyectos compartidos sus tareas y comentarios se conservan, sin autor. Si es el único miembro de **proyectos privados**, se muestra un aviso con cuántos son y hay que marcar una casilla de confirmación: se borran con él; en los demás, solo deja de ser miembro. Nadie puede borrarse a sí mismo.

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

Consulta la tabla completa en el `README.md`. Las imprescindibles son `DATABASE_URL`, `SESSION_SECRET`, `APP_URL` y `UPLOAD_DIR`. Las `SEED_ADMIN_*` solo hacen falta en el primer arranque y conviene borrarlas después. Otras variables opcionales de esta versión:

| Variable | Para qué sirve |
|---|---|
| `BACKUP_KEY` | Clave AES-256 de las copias automáticas. Genérala con `openssl rand -base64 32` y **guárdala también fuera de Railway**: sin ella las copias no se pueden leer. Sin la variable, las copias están desactivadas. |
| `UPLOAD_QUOTA_MB_PER_PROJECT` | Cuota de adjuntos por proyecto en MB (por defecto 2048). |
| `UPLOAD_QUOTA_MB_TOTAL` | Cuota total de adjuntos del servidor en MB (opcional; vacío = sin límite). |
| `MAX_UPLOAD_MB` | Tamaño máximo por adjunto en MB (por defecto 20). También fija, al compilar, el tope del cuerpo de la petición: si la cambias, vuelve a desplegar para que se aplique. |
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
| Contraseña olvidada | La persona usa **¿Olvidaste tu contraseña?** (con email configurado). Si no, un admin usa **Forzar cambio de contraseña**. No se fijan contraseñas a mano. |
| Sospecha de cuenta comprometida | **Forzar cambio de contraseña** (cierra sus sesiones) y, si hace falta, reiniciar su verificación en dos pasos. |
| Una persona pierde su segundo paso | Con sus códigos de recuperación puede entrar; si no los tiene, un admin reinicia su verificación en dos pasos. |
| Se pierde el acceso de todos los admins | Conéctate a la base de datos y promueve a un usuario existente: `UPDATE "User" SET role='ADMIN' WHERE email='persona@example.com';` |

### 4.4 Rotar `SESSION_SECRET`

Cambia la variable en Railway y redespliega. Todas las sesiones dejan de ser válidas y cada usuario tendrá que volver a entrar. Las conexiones con Google también se invalidan (sus tokens se cifran con una clave derivada de este secreto): cada usuario tendrá que volver a conectarla. También dejan de valer los enlaces de email pendientes, los dispositivos recordados y las **apps de verificación en dos pasos** (su secreto se cifra con la misma clave): antes de rotar, avisa a los administradores; tras rotar, otro administrador les reinicia el segundo paso desde *Administración → Usuarios* y lo vuelven a configurar al entrar. Hazlo si sospechas que el secreto se ha filtrado.

### 4.5 Copias de seguridad y restauración

- **Copias automáticas cifradas (base de datos):** con `BACKUP_KEY` definida, cada día se vuelca la base de datos (gzip + AES-256-GCM) a `UPLOAD_DIR/backups`. Se conservan **14 diarias y 6 mensuales**. Cada mes se hace una **prueba de restauración** de la última copia. El estado se ve en *Administración → Copias de seguridad*, con **Crear copia ahora** y **Descargar** la última.
  - **Guarda `BACKUP_KEY` también fuera de Railway** (gestor de contraseñas): sin ella las copias no se pueden leer.
  - **Restaurar** en una base **vacía**: `BACKUP_KEY="…" npm run backup:restore -- <fichero>` (con `DATABASE_URL` apuntando a esa base).
  - **La base debe estar en la misma migración que la copia.** El fichero `.json` que acompaña a cada copia indica su migración (`migration`) y la compilación (`build`). La restauración se niega si no coinciden. Para restaurar una copia hecha con una versión anterior de la app:
    1. Crea una base nueva y vacía y **no arranques la app contra ella** (el arranque crea el administrador inicial y la base deja de estar vacía).
    2. Desde una copia del código en la versión de la copia (`git checkout` del commit o etiqueta cuya última carpeta de `prisma/migrations/` coincide con `migration`), ejecuta `npx prisma migrate deploy` con `DATABASE_URL` apuntando a esa base.
    3. Restaura con `npm run backup:restore -- <fichero>` desde esa misma copia del código.
    4. Despliega la versión actual contra esa base: al arrancar aplica las migraciones pendientes y la deja al día.
  - La **prueba de restauración** mensual descifra la copia y comprueba su integridad (sha256, recuentos por tabla y manifiesto); **no** la restaura en una base real. Ensaya de vez en cuando la secuencia anterior en una base de pruebas.
  - Descarga de vez en cuando una copia a un lugar externo: las copias viven en el mismo volumen que los adjuntos. Para descargarla, Pizarro pide tu contraseña (o un código de tu app de autenticación) y genera un enlace de un solo uso válido 60 s.
- **Manual con `pg_dump`:** `pg_dump "$DATABASE_PUBLIC_URL" -Fc -f tablon.dump`. Restauración: `pg_restore --clean --no-owner -d "$DATABASE_PUBLIC_URL" tablon.dump`. También puedes activar los backups del servicio Postgres en Railway (ver «Copias del volumen en Railway»).
- **Capturas y adjuntos (volumen):** las copias automáticas no incluyen los ficheros. Activa los **snapshots del volumen** en Railway. Las imágenes y la base de datos deben restaurarse a la misma fecha para que los adjuntos coincidan.
- **Copias del volumen en Railway:** las copias automáticas de Pizarro no incluyen los adjuntos, así que programa también las copias de Railway.
  1. Abre el servicio que tiene el volumen y entra en la pestaña **Backups**.
  2. Pulsa **Edit schedule** y activa **Daily**, **Weekly** y/o **Monthly**. Railway conserva las diarias 6 días, las semanales 1 mes y las mensuales 3 meses.
  3. Pulsa **Backup now** para hacer una copia inmediata.
  4. Haz lo mismo en el servicio de **PostgreSQL**.
  - **Borrar un volumen borra también sus copias.** Por eso, una vez al mes descarga la última copia de Pizarro (pide contraseña) y guárdala, junto con `BACKUP_KEY`, fuera de Railway.
  - Existe una guía detallada paso a paso para Google Workspace (buzón `avisos@`, cliente OAuth) y para las copias de Railway, en un PDF aparte entregado a la persona propietaria.
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
| Google Docs/Sheets e inicio de sesión | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_WORKSPACE_DOMAIN` (recomendada), `GOOGLE_SHARE_ROLE`, `AUTH_GOOGLE_ONLY`, `AUTH_ALLOW_ADMIN_PASSWORD` | Conectar su cuenta en *Mi perfil* para Docs/Sheets; el inicio de sesión no requiere conectar nada. |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Nada (activado por defecto; se puede desactivar). Con email se activan invitaciones, «¿Olvidaste tu contraseña?», confirmaciones y avisos de cuenta. |
| WhatsApp | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG` | Activarlo y escribir su número en *Mi perfil*. |

Para el **inicio de sesión con Google**, añade al cliente OAuth una segunda URI de redirección autorizada: `https://<dominio>/api/auth/google/callback` (además de `APP_URL` + `/api/google/callback`, la de Drive).

El resultado de cada envío queda en la tabla `Notification` (`emailSentAt`, `whatsappSentAt`, `deliveryError`) y en los logs con el prefijo `[notify]`. En los logs, el destinatario aparece enmascarado (`p***@dominio`); el email se envía a la dirección completa.

### 4.8 Enviar emails con Google Workspace

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

**Alternativa:** el servicio *SMTP relay* de Workspace (`smtp-relay.gmail.com`). Las IP de salida de Railway no son fijas, así que no sirve la autorización por IP: usa autenticación SMTP.

### 4.9 Monitorización

- **Salud:** `GET /api/health` → `{"status":"ok"}` si la base de datos responde.
- **Logs de la app:** *Administración → Logs* (ver 3.16), con la duración de cada acción: es el primer sitio donde mirar si algo va lento o falla.
- **Logs del contenedor:** en Railway, *Deployments → View logs*. Los errores inesperados también salen ahí con el prefijo `[action]`, `[upload]` o `[uploads]`.
- **Errores en el navegador:** la pantalla «Algo ha fallado» y cualquier excepción no capturada del navegador se registran en *Logs* (categoría *client*), con la página, el navegador y el código del error para cruzarlo con el del servidor.
- **Uso del volumen:** visible en la pestaña del volumen. Como referencia, una captura típica ocupa entre 50 y 300 KB.

### 4.10 Resolución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| El despliegue no arranca: `SESSION_SECRET debe tener al menos 32 caracteres` | Variable vacía o corta | Genera una con `openssl rand -base64 48`. |
| `[boot] No hay usuarios. Define SEED_ADMIN_EMAIL…` | Primer arranque sin variables de seed | Añade `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD` y redespliega. |
| El login no mantiene la sesión | `APP_URL` con `https://` pero se accede por `http://` | Accede por HTTPS o ajusta `APP_URL`/`COOKIE_SECURE`. |
| Las capturas desaparecen tras desplegar | No hay volumen montado o la ruta no coincide | Monta un Volume en `/app/uploads` y comprueba que `UPLOAD_DIR` es igual. |
| «La imagen supera el tamaño máximo» | Imagen de más de `MAX_UPLOAD_MB` | Reduce la imagen o sube el límite. |
| No aparece «Generar Release» | Ninguna columna tiene el rol *Siguiente salto* | Asígnalo desde el menú «⋯» de la columna. |
| No se puede «Mover a En producción» | Ninguna columna tiene ese rol | Asígnalo, o elige *Archivar tarjetas* al desplegar. |
| Un usuario no ve un proyecto de equipo | No está asignado al proyecto | *Administración → Proyectos* (o *Ajustes del proyecto*) → asígnalo. |
| Un admin no ve un proyecto en sus selectores | No lo ha marcado en sus proyectos de trabajo | *Mi perfil → Proyectos en los que trabajo*. |
| Nadie ve un proyecto privado (ni los admins) | Los privados solo los ven sus miembros | Un miembro puede añadir a más personas desde *Ajustes del proyecto*. |
| No aparece «¿Olvidaste tu contraseña?» ni llegan invitaciones | No hay SMTP configurado | Configura el email (ver 4.8); mientras tanto el admin da una contraseña inicial. |
| «Copias de seguridad» no funciona | Falta `BACKUP_KEY` | Genérala con `openssl rand -base64 32`, guárdala fuera de Railway y redespliega. |
| Se rechaza una subida por cuota | Se superó `UPLOAD_QUOTA_MB_PER_PROJECT` o `UPLOAD_QUOTA_MB_TOTAL` | Borra adjuntos o sube la cuota. |
| Google devuelve `redirect_uri_mismatch` al iniciar sesión | Falta la URI `/api/auth/google/callback` | Añádela al cliente OAuth (ver 4.7). |
| «La integración con Google no está configurada» | Faltan `GOOGLE_CLIENT_ID`/`SECRET` o `APP_URL` | Configúralos y redespliega. |
| Google devuelve `redirect_uri_mismatch` | La URI de redirección del cliente OAuth no coincide | Debe ser exactamente `APP_URL` + `/api/google/callback`. |
| «Tu conexión con Google ha caducado» | Permiso revocado o `SESSION_SECRET` rotado | Vuelve a conectar en *Mi perfil*. |
| No llegan los emails | Credenciales SMTP o contraseña de aplicación incorrectas | Revisa los logs `[notify]` y la columna `deliveryError`. |
| No llegan los WhatsApp | Plantilla sin aprobar, idioma distinto, token caducado o número no verificado (número de prueba) | Revisa los logs `[notify]`, el estado de la plantilla y `WHATSAPP_TEMPLATE_LANG`. |
| Las páginas tardan en cargar a veces | Servicio en una región lejana, *App Sleeping* activado o conexiones a la base de datos frías | En Railway: pon la app y Postgres en la misma región cercana (p. ej. *EU West*) y desactiva *Serverless / App Sleeping*. Revisa en *Logs* la duración de las acciones. |
| El informe no marca una tarjeta como hecha | Su columna no cuenta como terminada | Menú «⋯» de la columna → *Contar como terminada*. |

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
