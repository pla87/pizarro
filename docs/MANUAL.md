---
title: "Pizarro · Manual de operaciones"
subtitle: "Arquitectura, guía de uso y procesos operativos"
version: "v1.14.0"
---

# Pizarro — Manual de operaciones

**Versión de la aplicación:** v1.14.0

Este manual describe la arquitectura de Pizarro, cómo se usa en el día a día y los procesos para operarla en producción (Railway). Todos los valores que aparecen (emails, dominios, contraseñas) son **ejemplos ficticios**. No escribas en este documento credenciales ni datos reales.

---

## 1. Visión general

Pizarro es un tablero Kanban ligero para un equipo de hasta 5 personas. Su objetivo es cubrir un flujo concreto:

1. registrar tareas rápidamente, incluidas capturas de pantalla pegadas desde el portapapeles;
2. moverlas por columnas hasta el **siguiente salto a producción**;
3. generar con un clic las **release notes** agrupadas por tipo, editarlas, exportarlas y marcar el despliegue.

| Concepto | Descripción |
|---|---|
| Proyecto | Espacio de trabajo con sus propias columnas, tareas, etiquetas y releases. |
| Columna | Estado del flujo. Configurable por proyecto. Puede tener un **rol** (*Siguiente salto* o *En producción*). |
| Tarjeta / tarea | Unidad de trabajo con tipo, color, responsable, etiquetas, enlace, subtareas, descripción y capturas. |
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
| `User` | email (único), name, passwordHash, role, active, cardStyle, theme, accent, locale, editorMode, preferencias de aviso | Se pueden desactivar o borrar; al borrar a alguien se borran sus proyectos privados. |
| `Session` | id = HMAC del token, userId, expiresAt | El token en claro solo vive en la cookie. |
| `Project` | name, description, restricted, position | `restricted = false` → visible para todos. |
| `ProjectMember` | projectId, userId | Usuarios con acceso a un proyecto restringido. |
| `Column` | projectId, name, position, role | Índice único parcial: como máximo una columna por rol en cada proyecto. |
| `Task` | projectId, columnId, kindId, title, description, color, linkUrl, position, assigneeId, archivedAt | Posición fraccionaria para reordenar actualizando una sola fila. |
| `Label` / `TaskLabel` | name, color | Etiquetas por proyecto. |
| `Subtask` | taskId, title, done, position | Subtareas de una tarea (no pasan a las releases). |
| `UndoEntry` | userId, projectId, label, ops (JSON), createdAt | Las 10 últimas acciones deshacibles de cada usuario en cada proyecto, con sus operaciones inversas. Caducan a los 7 días. |
| `TaskAttachment` | taskId, originalName, width, height, size | El fichero está en `UPLOAD_DIR/<id>.webp` (y `<id>.thumb.webp`). |
| `Release` / `ReleaseTask` | number (correlativo por proyecto), content (Markdown final), deployedAt, autor · instantánea de título y tipo de cada tarea | La instantánea se conserva aunque la tarea se borre. |
| `AppVersionLog` | version (única), releasedAt, summary, changes (JSON) | Se sincroniza desde `changelog.json` en cada arranque. |
| `Deliverable` | projectId, name, description, dueDate, position | Las tareas lo referencian con `deliverableId`. Al borrarlo, quedan sin entregable. |
| `TaskKind` | name, color, position, projectId (opcional) | Tipos de tarea configurables; sin `projectId` son generales, con él son exclusivos de ese proyecto. Nombre único entre los generales y dentro de cada proyecto. Cada tarea tiene `kindId`. |
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
| Google | OAuth con permiso mínimo `drive.file`: solo da acceso a los archivos que crea Pizarro. Parámetro `state` ligado a la sesión contra CSRF. Tokens cifrados en base de datos. Opcionalmente, restringido a un dominio de Workspace. |
| Avisos | Solo se avisa a usuarios activos con acceso al proyecto. El email y el WhatsApp no se repiten a la misma persona por la misma tarea en 10 minutos, y cada autor tiene un tope de envíos por hora. El contenido de los emails se escapa y los enlaces apuntan siempre a `APP_URL`. |

### 2.6 Rendimiento

- **Una ida y vuelta por pantalla:** el tablero carga columnas, tarjetas, usuarios, etiquetas y plantillas con consultas en paralelo.
- **Interfaz optimista:** mover tarjetas, marcar subtareas o editar campos se reflejan al instante; si el servidor rechaza el cambio, se revierte y se muestra el error.
- **Posiciones fraccionarias:** mover una tarjeta actualiza una sola fila.
- **Generación de releases en el navegador:** instantánea, sin llamadas al servidor hasta *Marcar como desplegado*.
- **Imágenes:** en móvil, las fotos grandes se reducen en el navegador antes de subirse. El servidor genera una miniatura, y las imágenes se sirven con caché inmutable.
- **Sin dependencias externas en tiempo de ejecución:** fuentes del sistema, sin CDNs.
- **Cambios casi al momento:** cada cambio en un proyecto se avisa al instante a las pestañas que lo tienen abierto (canal *Server-Sent Events* `/api/projects/[id]/events`) y estas se refrescan en menos de un segundo, también entre dos pestañas tuyas. Como respaldo, el tablero también se actualiza al volver a la pestaña y cada 30 segundos.
- **Carga diferida:** el código de los diálogos (detalle de tarea, nueva tarea, release, varias tareas, archivadas) y del editor de texto no se descarga al abrir el tablero; se precarga cuando el navegador está libre y se usa al abrirlos.
- **Logs sin duplicados:** las visitas a una misma página de una misma persona se registran como mucho una vez por minuto (los refrescos automáticos no llenan los logs).

---

## 3. Guía de uso

### 3.1 Acceso

- Entra con tu email y contraseña. No hay registro público: un administrador te da de alta.
- **Mi perfil y plantillas** permite cambiar el nombre visible y la contraseña. Al cambiarla se cierran tus sesiones en los demás dispositivos.
- El icono del ojo junto a un campo de contraseña muestra u oculta lo que escribes.

### 3.2 Proyectos

- Para cambiar de proyecto, pulsa el **nombre del proyecto** en la parte superior del tablero (o en la barra superior en móvil) y elige otro en el desplegable. También sirve el selector de la barra lateral. La app recuerda el último que abriste.
- Los administradores crean proyectos desde el selector (**Nuevo proyecto**). Pueden elegir una **plantilla** (ver 3.16) y marcarlo como **privado**. Sin plantilla, el proyecto trae las columnas *Backlog*, *En progreso*, *Siguiente salto a producción*, *En producción* y *Cerrado*; si quien lo crea usa Pizarro en inglés, salen en inglés (*Backlog*, *In progress*, *Next release*, *In production*, *Closed*).
- **Ajustes del proyecto** contiene:
  - nombre y descripción (admins);
  - **visibilidad** (admins), con tres opciones:
    - *Visible para todos*;
    - *Solo los usuarios seleccionados* (y los administradores);
    - *Privado: solo tú*. Nadie más lo ve ni puede entrar, tampoco los demás administradores, y no aparece en sus listados, avisos ni asignaciones. Pide confirmación. También se puede elegir al crear el proyecto. Si su dueño se desactiva o deja de ser administrador, el proyecto queda **bloqueado** (nadie lo ve) hasta que vuelva a ser administrador activo. Si se **borra** al dueño, sus proyectos privados se borran con él, con todo su contenido (antes se avisa y se pide confirmación). Los proyectos privados llevan un **candado** junto a su nombre;
  - etiquetas;
  - borrado del proyecto (admins; pide escribir el nombre para confirmar).

### 3.3 Columnas

Desde el menú «⋯» de cada columna:

- **Renombrar**, **Mover a la izquierda o la derecha**.
- **Rol de la columna**: *Sin rol*, *Siguiente salto* o *En producción*. Si asignas un rol que ya tenía otra columna, esa otra columna pasa a *Sin rol*.
- **Borrar columna**: solo si no tiene tarjetas visibles. Si quedan tarjetas archivadas en ella, pasan a la primera columna del proyecto.
- **Añadir columna**: en escritorio, la barra vertical estrecha con un «+» al final del tablero; en móvil, el botón redondo «+» al final de las pestañas de columnas. No hay límite de 5; el máximo es 30 por proyecto.

### 3.4 Tarjetas

- **Crear:** botón *Nueva tarea*, el «+» de cada columna o el botón flotante en móvil. El formulario empieza por **Título, Tipo y Descripción**; en móvil se abre arriba de la pantalla para que esos campos se vean con el teclado abierto. Solo el título y el tipo son obligatorios; asignarla a alguien es opcional. También se pueden añadir **subtareas** (Enter añade cada una). **Ctrl/⌘+Enter** en cualquier campo crea la tarea.
- **Crear varias a la vez:** botón **Varias tareas** (escritorio) o el botón flotante pequeño encima del «+» (móvil).
  - Elige la columna (por defecto, la que estás viendo) y pega una lista: **cada línea es una tarea** con ese título. Las líneas vacías se ignoran y se quitan viñetas como «-», «*», «1.» o «[ ]».
  - Elige el **tipo para todas** y, si alguna es distinta, cámbialo en su línea. Volver a pulsar un tipo común lo aplica a todas las líneas, también a las cambiadas a mano.
  - **Campos extra** (plegado): responsable, fecha límite, entregable y etiquetas comunes a todas.
  - Hasta 100 tareas de una vez; se añaden al final de la columna en el orden de la lista.
- **Tipo:** por defecto *Funcionalidad* o *Corrección*. Los administradores pueden crear más tipos generales, y cada proyecto puede tener los suyos (ver 3.14).
- **Atajo de captura:** pega una imagen (Ctrl/⌘+V) con el tablero en pantalla y se abre *Nueva tarea* con la captura adjunta.
- **Dos tareas a la vez (escritorio):** con una tarea abierta (nueva o existente), el botón redondo **+** que hay fuera del modal, en su esquina inferior derecha, abre una tarea nueva al lado (por defecto en *Backlog*): las dos quedan juntas y centradas, con el mismo ancho. Se puede trabajar en las dos; Escape o atrás cierran la última abierta.
- **Quién está trabajando:** a la izquierda de **Informe PDF** (en móvil, arriba a la derecha) aparecen círculos con las **iniciales** de quienes han hecho cualquier acción en ese tablero (abrir, crear, mover, editar, subir adjuntos…) en los **últimos 5 minutos**, tú incluido; al pasar el ratón se ven sus nombres. Se actualiza cada 20 segundos. Si hay más (cinco en escritorio, tres en móvil), se muestra «+N».
- **Trabajar varios a la vez:** si otra persona tiene abierta la misma tarea, el detalle lo indica («Fulano también tiene abierta esta tarea»). Si cambia el **título o la descripción** mientras tú los editas, al guardar no se pisa su texto: se avisa, la tarea se recarga con sus cambios y vuelves a aplicar los tuyos. El resto de campos (tipo, color, responsable…) se guardan al momento y gana el último cambio.
- **Guardado:** los cambios del detalle se guardan solos; en la cabecera se ve «Guardando…» y después **«Guardado»** con un check verde.
- **Deshacer:** el botón con la flecha de volver, justo a la derecha del nombre del tablero (también en móvil), deshace **tu última acción** en ese tablero, y así hasta las **10 últimas** (cuenta como una sola acción crear una tarea con sus adjuntos y subtareas): crear, editar, mover, archivar, recuperar, borrar (con sus adjuntos y subtareas), subtareas, comentarios, adjuntos, enlaces, columnas y desplegar una release (las tareas vuelven a su sitio y la release sale del histórico). En escritorio también **Ctrl/⌘+Z** con el tablero en pantalla. El aviso de lo deshecho sale en tu idioma. Solo deshace lo tuyo; si algo ya no existe (otra persona lo borró), se salta y se avisa. Las acciones de deshacer caducan a los 7 días.
  - **Con una tarea abierta**, el contexto es esa tarea: deshacer solo actúa sobre lo que has hecho en ella (cada subtarea, cada archivo subido, cada cambio), y el detalle se recarga. En escritorio el botón se ve por encima del fondo oscuro del modal, y Ctrl/⌘+Z también funciona si no estás escribiendo.
- **Guardar en móvil:** al editar una tarea en el móvil, el pie del modal tiene siempre visibles **Archivar**, **Borrar** y **Guardar**. *Guardar* guarda el título y la descripción tal como estén escritos (aunque sigas editándolos) y cierra.
- **Borradores:** mientras creas o editas una tarea, lo escrito se guarda en tu navegador **cada 5 segundos**. Si cierras la página sin cancelar ni guardar, al volver al tablero el modal se reabre con lo que tenías (en *Nueva tarea*, todos los campos salvo los archivos; en una tarea abierta, el título y la descripción en edición). Solo hay borrador si queda **algo sin guardar**: crear, guardar, cancelar o cerrar el modal lo borra, y una tarea abierta sin cambios nunca se reabre.
- **Persona asignada:** el círculo con iniciales en la esquina inferior derecha de la tarjeta es **la persona asignada** (al pasar el ratón: «Asignada a …»). No indica quién la tiene abierta; eso se ve dentro del detalle y en los círculos de la cabecera.
- **Editar:** haz clic en la tarjeta. Los cambios se guardan solos (título y enlace al salir del campo; tipo, color, responsable, etiquetas y columna al cambiarlos).
- **Descripción con formato:** se guarda como Markdown y, cuando no la estás editando, se ve formateada (títulos, negrita, cursiva, subrayado, tachado, listas, enlaces). Hay dos formas de editarla, a elegir en **Mi perfil y plantillas → Edición de descripciones**:
  - **Con barra de formato** (por defecto): ves el resultado mientras escribes y aplicas **negrita, cursiva, subrayado, tachado, título, subtítulo, texto normal, lista y lista numerada** con botones (o Ctrl+B / I / U). Si pegas texto en Markdown, se convierte en formato. Al escribir `@` aparece la lista de personas para mencionar (y `@docs` / `@sheets`); la mención se ve como una etiqueta.
  - **Markdown:** escribes los símbolos (`**negrita**`, `*cursiva*`, `~~tachado~~`, `++subrayado++`, `# Título`, `- lista`, `1. lista`); al guardar se ve formateado.
  - En ambos modos, Ctrl/⌘+Enter guarda y Escape cancela.
- **Colores de tarjeta:** gris, blanco, rojo, naranja, marrón, amarillo, verde, verde oscuro, turquesa, celeste, índigo, azul marino, violeta y rosa (también para etiquetas).
- **Subtareas:** añádelas y márcalas. **Doble clic** sobre una la edita (Enter guarda, Escape cancela) y se **reordenan** arrastrando el icono de seis puntos. Junto al título *Subtareas* hay una barra verde que se llena según la proporción de subtareas hechas (con dos, cada una marca el 50 %, da igual el orden); la tarjeta muestra el progreso (p. ej. `2/4`). Las subtareas **no pasan** al texto de las releases.
- **Adjuntos:** cualquier tipo de archivo de hasta 10 MB. Pégalos con Ctrl/⌘+V, usa *Añadir* o **arrástralos** sobre la tarea abierta (aparece «Suelta para adjuntar»); también desde la ventana de descargas del navegador. Los que no son imagen se listan con su icono, nombre y tamaño, y se descargan (nunca se abren dentro de Pizarro, por seguridad).
- **Capturas e imágenes:** al tocar o hacer clic en una imagen se ve **a pantalla completa**; se cierra con la **X**, tocando fuera de la imagen, con Escape o con el botón atrás. Con varias imágenes, las flechas pasan de una a otra. En móvil también tienes el botón **Cámara**, al crear la tarea y en el detalle de una tarea existente. Cada imagen se reduce a 1280 px de ancho como máximo y se guarda como WebP (calidad 75).
- **Archivar** oculta la tarjeta del tablero (desde su detalle o, para varias, con **Archivar** en la barra de selección). **Borrar** la elimina con sus adjuntos.
- **Archivadas:** botón en la cabecera del tablero (escritorio) o entrada **Archivadas** del menú lateral. Abre un listado con filtro de las tareas archivadas: tipo, fecha, columna de la que salieron y, si pasaron por una release, la etiqueta **En release: …**. **Recuperar** la devuelve al final de la columna en la que estaba; si esa columna ya no existe, a la primera columna del proyecto (Backlog).
- En escritorio, el detalle de la tarjeta cabe entero en la pantalla: la columna principal y la lateral se desplazan cada una por su lado.

- **Versión nueva:** después de un despliegue, las pestañas abiertas se recargan solas al volver a ellas (o muestran «Hay una versión nueva · Recargar» si estás escribiendo), para no usar acciones de la versión anterior.

### 3.5 Mover tarjetas

- **Escritorio (ratón):** arrastra la tarjeta para **reordenarla** dentro de su columna o para llevarla a otra.
- **Móvil y pantallas táctiles:** cada tarjeta tiene un **asa** (⋮⋮) a la derecha. Arrastrándola se **reordena dentro de la columna**. El resto de la tarjeta sirve para hacer scroll y para abrirla con un toque. En móvil no se arrastra entre columnas: usa la selección múltiple o el selector *Columna* del detalle.
- **Selección múltiple:** marca la casilla de varias tarjetas, o la casilla junto al nombre de una columna para **marcar todas sus tarjetas** de una vez (vuelve a pulsarla para desmarcarlas). Aparece una barra («1 seleccionada», «3 seleccionadas») con:
  - **Mover a Siguiente salto…** (la columna con ese rol) y **Mover a…** cualquier otra columna, en la misma fila;
  - **Release con selección**;
  - **Borrar**: pide confirmación y borra las tareas seleccionadas con sus adjuntos.
- También puedes cambiar la columna desde el detalle de la tarjeta.

### 3.6 Generar una release

**Tareas fijas («Siempre en la release»).** Al pie de la columna *Siguiente salto a producción* hay una sección plegable que indica cuántas tareas fijas tiene. Al abrirla, se despliega hacia arriba con esas tareas y el botón **+ Añadir**. Son tareas que se repiten en cada despliegue (por ejemplo, «Generar el PDF de la release»): entran preseleccionadas en cada release (con la marca *fija*), pero **no salen de la columna** al marcarla como desplegada. Solo se añaden al usar **Generar Release** de esa columna, no con *Release con selección*. Para convertir una tarea en fija, arrástrala sobre la sección: si está cerrada se abre al mantenerla encima un momento. También se puede marcar o desmarcar una tarea existente de esa columna con *Fija en la release* en su detalle. Si se mueve a otra columna o se archiva, deja de ser fija. Las tareas del panel también se pueden **arrastrar fuera** a cualquier columna y posición (en táctil, con su asa): dejan de ser fijas.

1. Prepara tus plantillas en **Mi perfil y plantillas → Plantillas de release notes**. Puedes tener **varias cabeceras** (por ejemplo, «Contexto para IA» o «Para negocio») y **varios pies** (por ejemplo, «Checklist de cierre»), cada uno con su nombre.
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

Botón **Informe PDF** en la cabecera del tablero (o en el menú lateral). En escritorio se abre en otra pestaña. En el **móvil** (o con la app instalada) se genera dentro de Pizarro y, al terminar, aparecen los botones **Descargar** y **Abrir**.

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

El menú lateral muestra, debajo de las opciones del proyecto: **Avisos**, **Mis tareas asignadas**, **Mi perfil y plantillas**, **Administración** (solo admins), **Historial de versiones** e **Instalar app**.

- **Mis tareas asignadas:** todas tus tarjetas activas en los proyectos a los que tienes acceso, agrupadas por proyecto y con su columna actual.
- **Releases:** histórico del proyecto, con **buscador** por texto en todo el histórico (título y contenido, sin distinguir mayúsculas ni tildes); sin buscar se muestran las 50 últimas con *Cargar más*, opción de copiar o descargar cada release, y de **Borrar release** (la quita del histórico con sus adjuntos; las tareas no cambian) o **Borrar adjuntos** (conserva el texto). Ambas piden confirmación. Cada entrada indica cuántas tareas y adjuntos tiene; al abrirla se ven los nombres de los adjuntos y el botón **Descargar adjuntos** (ZIP).
- **Historial de versiones:** versión actual de la app y cambios de cada versión, con la **fecha y hora** de su lanzamiento y **buscador** por texto.

### 3.12 Móvil

- La pantalla no hace scroll vertical: las columnas llegan justo hasta encima de los botones del sistema (barra de gestos o de navegación).
- El tablero muestra una columna cada vez. Cambias de columna con las pestañas superiores, que indican cuántas tarjetas tiene cada una, o **deslizando el dedo a izquierda o derecha** sobre la columna.
- El botón flotante **+** crea una tarea en la columna visible, con opción de **Cámara** o **Archivo**. El botón *Crear tarea* queda siempre visible abajo del formulario.
- El botón flotante pequeño de encima crea **varias tareas** pegando una lista (ver 3.4).
- Para mover tarjetas entre columnas en móvil, usa la selección múltiple o el selector *Columna* del detalle. Para reordenar dentro de la columna, arrastra el asa ⋮⋮ (ver 3.5).
- **Botón atrás** (del navegador o del móvil):
  - si hay un modal abierto (tarea, nueva tarea, imagen ampliada…), lo cierra;
  - si no, vuelve a la columna que estabas viendo antes; se recuerdan los últimos 5 cambios de columna, y después atrás sale del tablero como siempre.
- **Instalar como app:** en el menú lateral, **Instalar app**.
  - **Android y Chrome de escritorio:** muestra el aviso de instalación.
  - **iPhone y iPad:** explica cómo hacerlo. En **Safari**, pulsa *Compartir → Añadir a pantalla de inicio*.
  - La app se abre a pantalla completa con su icono y mantiene la sesión.

### 3.13 Apariencia

En **Mi perfil y plantillas → Apariencia**, cada persona elige:
- **Tema:** *Sistema* (sigue el modo claro u oscuro del dispositivo, por defecto), *Claro* u *Oscuro*. Se aplica al momento y se recuerda en todos tus dispositivos. Las barras de scroll usan los colores de Pizarro en ambos temas.
- **Tema de color:** *Azul* (por defecto), *Verde bosque*, *Siena*, *Mostaza* o *Blanco y negro*, en modo claro y oscuro. Cambia **toda la app**: fondos, columnas, tarjetas, bordes, textos secundarios, botones, enlaces y resaltados toman los tonos del tema (salvia y verde profundo; arcilla y terracota; arena y mostaza; o grises puros, con negro en claro y blanco en oscuro). Las subtareas hechas (casilla y barra) usan un color que contrasta con el tema: verde neón en el azul. El **logo** de Pizarro y el **recuadro de foco** al moverte con el tabulador también usan el color del tema (la pantalla de acceso mantiene el azul).
- **Distintivos de tipo:** cada tipo conserva su color en todos los temas, pero el texto se oscurece en modo claro y se aclara en modo oscuro para que se lea siempre (también con tipos negros, marinos o blancos).
- **Tarjetas:** *Franja a la izquierda* (por defecto) o *Tarjeta entera del color*, con un tono suave para que el texto se siga leyendo.
- **Idioma · Language:** *Español* (por defecto) o *English*. Cambia toda la interfaz, los mensajes, las fechas, el informe PDF y el **historial de versiones**. No se traducen los datos (nombres de proyectos, columnas, tipos, tareas), el texto de las releases ni los logs de administración. La pantalla de acceso sale siempre en español.
- **Edición de descripciones:** *Con barra de formato* (por defecto) o *Markdown* (ver 3.4).

### 3.14 Tipos de tarea

Hay dos clases de tipos. Cada tipo es una sección de las release notes.

- **Generales** (solo admins): **Administración → Tipos de tarea**. Están disponibles en todos los proyectos.
- **Del proyecto** (cualquiera con acceso al proyecto): **Ajustes del proyecto → Tipos de tarea**. Solo aparecen en ese proyecto.
- **Qué tipos generales usa cada proyecto:** en esa misma sección, la lista *Tipos generales que usa este proyecto*. Los desmarcados no aparecen en sus selectores ni en sus releases. Si un tipo tiene tareas en el proyecto, al desmarcarlo se pide a qué tipo pasan. Siempre queda al menos un tipo.

En ambos casos:
- **Nuevo tipo:** nombre y color (de la paleta o cualquier otro con el selector de color).
- Las flechas cambian el **orden**. En los selectores y en la release van primero los generales y después los del proyecto, cada grupo en su orden.
- **Automatización:** cada tipo puede tener un **título automático** y un **texto inicial de la descripción** (al crearlo o editarlo, sección *Automatización*). Al elegir ese tipo en una tarea nueva o existente, el título se sustituye y la descripción empieza por ese texto (sin repetirlo si ya está). El texto inicial admite **formato Markdown** y se edita con el mismo editor que las descripciones (con barra de formato o Markdown, según tu perfil). La lista de tipos explica en una línea lo que hace cada uno. No se aplica en *Varias tareas*.
- **Respuesta:** viene creado de serie (título «Respuesta» y descripción que empieza por «Respondo a las preguntas y lo que necesitas de mi:»), pero es un tipo general como cualquier otro: se puede editar o **borrar**.
- **Borrar** un tipo pide a qué tipo pasan sus tareas. Un tipo general solo puede pasar a otro general, y siempre queda al menos uno. Un tipo de proyecto puede pasar a un general o a otro del mismo proyecto.
- **Nombres:** un tipo de proyecto no puede llamarse igual que un general ni que otro de su proyecto. Dos proyectos sí pueden tener tipos con el mismo nombre. Un tipo general nuevo no puede repetir el nombre de ningún tipo de proyecto.
- Al borrar un proyecto se borran también sus tipos.

### 3.15 Atajos de teclado

| Acción | Windows / Linux | Mac |
|---|---|---|
| Crear la tarea, guardar la descripción o enviar un comentario | Ctrl+Enter | ⌘+Enter |
| Cerrar el modal o cancelar la edición | Esc | Esc |
| Deshacer la última acción (escritorio, sin estar escribiendo) | Ctrl+Z | ⌘+Z |
| Nueva tarea con una captura pegada (con el tablero en pantalla) | Ctrl+V | ⌘+V |
| Abrir la tarjeta con el foco | Enter | Enter |
| Añadir subtarea / guardar subtarea editada | Enter | Enter |
| Negrita, cursiva, subrayado (editor con barra) | Ctrl+B / I / U | ⌘+B / I / U |
| Elegir persona o comando en la lista de «@» | ↑ ↓ y Enter o Tab | ↑ ↓ y Enter o Tab |
| Imagen anterior o siguiente (pantalla completa) | ← → | ← → |

### 3.16 Administración (admins)

La entrada **Administración** del menú lateral reúne cuatro pestañas: **Usuarios**, **Tipos de tarea** (ver 3.14), **Plantillas** y **Logs**.

**Plantillas de proyecto:** definen las columnas (nombre, orden, rol especial *Siguiente salto* o *En producción* y si cuentan como terminadas), los tipos de tarea propios (con su automatización), qué tipos generales no usará el proyecto y las etiquetas. **Crear desde un proyecto…** rellena una plantilla a partir de un proyecto existente. Al crear un proyecto se elige la plantilla en *Nuevo proyecto*.

**Logs:** registro detallado de la actividad de los últimos 7 días (configurable con `LOG_RETENTION_DAYS`):
- páginas visitadas, inicios de sesión (también los fallidos, con el email probado y el motivo, nunca la contraseña) y cierres de sesión;
- cada acción (crear, mover, editar, archivar, borrar, desplegar…) con quién, cuándo, desde qué página, cuánto tardó, el resultado y sus datos (sin contraseñas ni tokens);
- subidas y descargas de adjuntos, informes PDF, ZIP de releases, conexiones con Google, envíos de email y WhatsApp, arranques de la app y errores del servidor.

Cada acción se describe en lenguaje claro: «Creó la tarea «X» en «Backlog»», «Movió «X» de «Backlog» a «En progreso»», «Modificó «X»: tipo y responsable», «Desplegó la release «…» con 4 tareas», etc.

**Proyectos privados en los logs:** la actividad de un proyecto privado solo la ve en detalle su dueño. El resto de administradores ve esas filas con la hora y el usuario y el texto «Actividad en un proyecto privado» (también en el CSV); los filtros de texto, nivel y categoría no las tienen en cuenta.

**Solo cambios por defecto:** las consultas (páginas vistas, abrir una tarea, ver archivadas, generar el texto de una release, informes PDF y ZIP) se ocultan salvo que marques **Incluir consultas**. Los avisos y errores se ven siempre.

Se filtra por periodo (1 h, 24 h, 7 días), nivel (Info, Aviso, Error), categoría, usuario y texto. Cada fila se despliega para ver los detalles y la IP. **Descargar CSV** exporta el filtro actual (hasta 20 000 filas). Los registros antiguos se borran solos.

- **Usuarios → Nuevo usuario:** nombre, email, contraseña inicial (10 caracteres o más) y rol. Máximo de 5 usuarios activos (configurable con `MAX_USERS`).
- **Editar:** nombre, email, rol y estado activo. Al desactivar a un usuario o cambiarle el rol se cierran sus sesiones. Un admin no puede quitarse a sí mismo el rol ni desactivarse.
- **Restablecer contraseña:** asigna una nueva y cierra sus sesiones.
- **Borrar** (papelera): elimina la cuenta para siempre. En los proyectos compartidos sus tareas y comentarios se conservan, sin autor. Si tiene **proyectos privados**, se muestra un aviso con cuántos son y hay que marcar una casilla de confirmación: se borran con él. Nadie puede borrarse a sí mismo.

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
| Alta de un miembro | *Administración → Usuarios → Nuevo usuario*. Comunica la contraseña inicial por un canal seguro y pide que la cambie. |
| Baja temporal | *Editar → desmarcar «Usuario activo»*. Sus tareas conservan el historial y sus proyectos privados quedan bloqueados. |
| Baja definitiva | Botón **Borrar** (papelera). Sus proyectos privados se borran con él tras confirmarlo. |
| Contraseña olvidada | Un admin usa *Restablecer contraseña*. |
| Se pierde el acceso de todos los admins | Conéctate a la base de datos y promueve a un usuario existente: `UPDATE "User" SET role='ADMIN' WHERE email='persona@example.com';` |

### 4.4 Rotar `SESSION_SECRET`

Cambia la variable en Railway y redespliega. Todas las sesiones dejan de ser válidas y cada usuario tendrá que volver a entrar. Las conexiones con Google también se invalidan (sus tokens se cifran con una clave derivada de este secreto): cada usuario tendrá que volver a conectarla. Hazlo si sospechas que el secreto se ha filtrado.

### 4.5 Copias de seguridad y restauración

- **PostgreSQL:** activa los backups del servicio Postgres en Railway. Copia manual: `pg_dump "$DATABASE_PUBLIC_URL" -Fc -f tablon.dump`. Restauración: `pg_restore --clean --no-owner -d "$DATABASE_PUBLIC_URL" tablon.dump`.
- **Capturas (volumen):** usa los backups del volumen en Railway. Las imágenes y la base de datos deben restaurarse a la misma fecha para que los adjuntos coincidan.

### 4.6 Publicar una nueva versión de la app

1. Desarrolla el cambio. Si afecta al esquema, crea la migración con `npm run db:migrate -- --name descripcion` y súbela al repositorio.
2. `npm run check` (lint, tipos, traducciones y tests). Rellena también la traducción al inglés de la versión (`en` en `changelog.json`). Los textos nuevos de la interfaz van con `t("texto en español")` y su traducción en `src/i18n/en/`; `npm run i18n:check` lista los que falten.
3. `npm run version:bump -- patch|minor|major` (anota la fecha y la hora del lanzamiento), rellena la entrada en `changelog.json` y ejecuta `npm run version:bump -- --render`.
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
- **Logs de la app:** *Administración → Logs* (ver 3.16), con la duración de cada acción: es el primer sitio donde mirar si algo va lento o falla.
- **Logs del contenedor:** en Railway, *Deployments → View logs*. Los errores inesperados también salen ahí con el prefijo `[action]`, `[upload]` o `[uploads]`.
- **Errores en el navegador:** la pantalla «Algo ha fallado» y cualquier excepción no capturada del navegador se registran en *Logs* (categoría *client*), con la página, el navegador y el código del error para cruzarlo con el del servidor.
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
| Las páginas tardan en cargar a veces | Servicio en una región lejana, *App Sleeping* activado o conexiones a la base de datos frías | En Railway: pon la app y Postgres en la misma región cercana (p. ej. *EU West*) y desactiva *Serverless / App Sleeping*. Revisa en *Logs* la duración de las acciones. |
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
