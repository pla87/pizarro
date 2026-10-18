# Pizarro

Kanban ligero y generador de *release notes* para equipos pequeños (hasta 5 personas). Tiene tableros multiproyecto, capturas pegadas desde el portapapeles y exportación de releases agrupadas por tipo, con cabecera y pie personalizados por usuario.

- **Stack:** Next.js 16 (App Router, TypeScript, Tailwind CSS 4) · PostgreSQL · Prisma 7 · `@dnd-kit` · `sharp` · `lucide-react`.
- **Despliegue:** un único contenedor Docker (monolito) en Railway, con un volumen persistente para las capturas.
- **Documentación:** [Manual de operaciones (PDF)](MANUAL.pdf) · [fuente Markdown](docs/MANUAL.md) · [Changelog](CHANGELOG.md).

---

## Funcionalidades

| Área | Qué incluye |
|---|---|
| Acceso | Login con email y contraseña (bcrypt). Sesiones en base de datos con cookie `HttpOnly` y `SameSite=Lax`. Sin registro público. Roles `ADMIN` y `MEMBER`. Máximo de 5 usuarios activos. |
| Proyectos | Selector en la barra lateral. Cada proyecto tiene sus columnas, tareas, etiquetas y releases. Por defecto son visibles para todos; un admin puede **restringir la visibilidad** a usuarios concretos. |
| Tablero | Columnas configurables por proyecto: crear, renombrar, reordenar, asignar un rol y borrar si están vacías. Arrastrar y soltar entre columnas y dentro de cada una. Selección múltiple y movimiento en lote. |
| Tarjetas | Tipo (por defecto *Funcionalidad* y *Corrección*; los admins crean más tipos generales y cada proyecto puede tener tipos propios, con su color), color, responsable opcional, etiquetas, enlace externo, checklist, descripción en Markdown y capturas (pegar con Ctrl/⌘+V, archivo o cámara). Se pueden archivar y restaurar. |
| Releases | Botón **Generar Release** en la columna con rol *Siguiente salto*. Eliges una de tus **cabeceras** y uno de tus **pies** (cada usuario puede tener varios). Título, cabecera y una sección por tipo; cada punto lleva un código (F1, C2…), su descripción y sus adjuntos renombrados (`F1_nombre.webp`), descargables juntos en un ZIP. Editor con vista previa, **Copiar todo**, descarga `.md` / `.txt` y **Marcar como desplegado** (mueve las tarjetas a *En producción* o las archiva, y guarda el texto final en el histórico *Releases*). |
| Plazos y entregables | Fecha límite en cada tarjeta (avisos de vencida, hoy o próxima) y **entregables**: hitos con fecha objetivo que agrupan tarjetas. Las columnas pueden contar como «terminadas». |
| Informe PDF | Botón **Informe PDF** en cada proyecto: resumen y avance, estado por columna, entregables, plazos vencidos y próximos, carga por persona, tipos, últimas releases y detalle de cada columna. |
| Google Docs / Sheets | Escribe `@docs` o `@sheets` en la descripción o en un comentario, o pulsa *Nuevo Doc* / *Nuevo Sheet*. Se crea el archivo en tu Google Drive, se abre en otra pestaña y queda enlazado a la tarjeta. Cada usuario conecta su cuenta una vez (permiso mínimo `drive.file`). |
| Comentarios y menciones | Comentarios en las tarjetas con `@persona` (autocompletado). La persona mencionada recibe un aviso en la app (campana con contador), por **email** y, si lo activa, por **WhatsApp**. |
| Vistas | *Mis tareas asignadas*, *Avisos*, histórico de releases por proyecto, *Historial de versiones* de la propia app. |
| Móvil | **Instalable como app** (Android, iPhone y escritorio). Pestañas por columna (arrastra una tarjeta sobre otra pestaña para cambiarla de columna), botón flotante (+) para crear tareas o subir capturas, cámara en el detalle de la tarea, cambio rápido de proyecto desde el título. |
| Personalización | Cada usuario elige el aspecto de las tarjetas: franja de color a la izquierda o tarjeta entera teñida. |

### Roles de columna

Cada proyecto puede tener **como máximo una** columna con cada rol:

- **Siguiente salto (`NEXT_RELEASE`)**: muestra el botón *Generar Release* y es el destino de *Mover seleccionadas a Siguiente salto*.
- **En producción (`IN_PRODUCTION`)**: destino de las tarjetas al *Marcar como desplegado*.

Los roles se cambian desde el menú «⋯» de cada columna. Así puedes renombrar las columnas libremente sin romper el flujo.

---

## Desarrollo local

Requisitos: Node.js 22 o superior y PostgreSQL 14 o superior.

```bash
cp .env.example .env            # y rellena DATABASE_URL, SESSION_SECRET y SEED_ADMIN_*
npm install
npx prisma migrate deploy       # crea las tablas
npm run db:seed                 # admin inicial + proyecto de ejemplo + changelog
npm run dev                     # http://localhost:3000
```

Para generar un `SESSION_SECRET`: `openssl rand -base64 48`.

### Scripts

| Script | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo. |
| `npm run build` / `npm start` | Build de producción (salida *standalone*) y arranque. |
| `npm run check` | Lint + typecheck + tests. |
| `npm test` | Tests unitarios (generador de releases, posiciones, validación, imágenes, changelog). |
| `npm run db:migrate` | Crea una nueva migración en desarrollo (`prisma migrate dev`). |
| `npm run db:deploy` | Aplica las migraciones pendientes. |
| `npm run db:seed` | Seed idempotente: crea el admin si no hay usuarios y un proyecto de ejemplo si no hay proyectos. |
| `npm run changelog:sync` | Sincroniza `changelog.json` con la tabla `AppVersionLog`. |
| `npm run version:bump -- <patch\|minor\|major>` | Registra una nueva versión de la app (ver abajo). |
| `npm run docs:pdf` | Regenera `MANUAL.pdf` a partir de `docs/MANUAL.md`. |

### Registrar una nueva versión de la app

1. `npm run version:bump -- minor` (o `patch`, `major`, `X.Y.Z`). Sube la versión en `package.json` y añade una entrada vacía al principio de `changelog.json`.
2. Rellena en `changelog.json` las listas `nuevas`, `mejoras`, `correcciones` y `tecnicos` de la nueva versión.
3. `npm run version:bump -- --render` para regenerar `CHANGELOG.md`.
4. Haz commit y despliega. Al arrancar, el contenedor sincroniza `changelog.json` con la tabla `AppVersionLog`, y la página *Historial de versiones* muestra la nueva entrada.

---

## Variables de entorno

| Variable | Obligatoria | Ejemplo / valor | Descripción |
|---|---|---|---|
| `DATABASE_URL` | Sí | `${{Postgres.DATABASE_URL}}` | Conexión a PostgreSQL. |
| `SESSION_SECRET` | Sí | 48+ caracteres aleatorios | Clave HMAC para los identificadores de sesión. Si la cambias, se cierran todas las sesiones. |
| `APP_URL` | Sí | `https://tablon.up.railway.app` | URL pública. Con `https://` la cookie se marca `Secure` y usa el prefijo `__Host-`. |
| `UPLOAD_DIR` | Sí | `/app/uploads` | Carpeta de capturas (la ruta del volumen). |
| `PORT` | No | Lo inyecta Railway | Puerto HTTP (por defecto 3000). |
| `SEED_ADMIN_EMAIL` | Solo el primer arranque | `admin@tu-dominio.com` | Email del administrador inicial. |
| `SEED_ADMIN_PASSWORD` | Solo el primer arranque | mínimo 10 caracteres | Contraseña inicial: cámbiala después desde *Mi perfil*. |
| `SEED_ADMIN_NAME` | No | `Administrador` | Nombre visible del admin inicial. |
| `MAX_USERS` | No | `5` | Máximo de usuarios activos. |
| `MAX_UPLOAD_MB` | No | `10` | Tamaño máximo por imagen. |
| `DATABASE_POOL_SIZE` | No | `10` | Conexiones del pool. |
| `COOKIE_SECURE` | No | `true` / `false` | Fuerza el atributo `Secure` de la cookie. |
| `APP_TIMEZONE` | No | `Europe/Madrid` | Zona horaria para calcular «hoy» en plazos e informes. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Para Google Docs/Sheets | (de Google Cloud) | Cliente OAuth «Aplicación web». Ver [Google Docs y Sheets](#71-google-docs-y-sheets). |
| `GOOGLE_WORKSPACE_DOMAIN` | Recomendada con Google | `tu-dominio.com` | Solo admite cuentas de ese dominio y comparte cada archivo nuevo con él, para que todo el equipo pueda abrirlo desde la tarjeta. |
| `GOOGLE_SHARE_ROLE` | No | `writer` | Rol con el que se comparte con el dominio: `writer`, `commenter`, `reader` o `none` (no compartir). |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Para avisos por email | `smtp.gmail.com` / `465` / … | Servidor de correo saliente. Ver [Email](#72-avisos-por-email). |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_TEMPLATE_NAME` | Para avisos por WhatsApp | (de Meta) | WhatsApp Cloud API. Ver [WhatsApp](#73-avisos-por-whatsapp). |
| `WHATSAPP_TEMPLATE_LANG` / `WHATSAPP_API_VERSION` | No | `es` / `v23.0` | Idioma de la plantilla y versión de la API de Meta. |

Las integraciones son **opcionales**: si faltan sus variables, la app funciona igual y esas opciones aparecen como «no configuradas».

> `JWT_SECRET` no se usa: las sesiones son opacas y se guardan en base de datos para poder revocarlas. Su equivalente es `SESSION_SECRET`.

---

## Guía de despliegue en Railway

### 1. Crear el proyecto y la base de datos

1. Entra en [railway.com](https://railway.com) → **New Project**.
2. Elige **Deploy PostgreSQL**. En un proyecto ya creado: botón **+ New** (en algunas versiones de la interfaz, **+ Create**) → **Database → PostgreSQL**. Railway crea el servicio `Postgres` con sus variables (`DATABASE_URL`, `PGHOST`, etc.).

### 2. Vincular este repositorio

1. En el mismo proyecto: **+ New → GitHub Repo** y selecciona este repositorio. Si es la primera vez, autoriza la app de Railway en GitHub.
2. Railway detecta el `Dockerfile` y el `railway.json`. Estos fijan el builder Docker, el comando de arranque `sh scripts/start.sh`, el *healthcheck* en `/api/health` y una única réplica.
3. En el servicio, **Settings → Source**: elige la rama que quieras desplegar (por ejemplo `main`).

### 3. Variables de entorno

> Crea las variables **en el servicio de la app** (`tablon` → *Variables*), no como *Shared Variables* del proyecto. Las compartidas no llegan solas a los servicios: hay que enlazarlas en cada uno con `${{shared.NOMBRE}}`. Además, una variable compartida no puede apuntar a otra de un servicio, como `${{Postgres.DATABASE_URL}}`, y llega vacía. Tras crear o cambiar variables, pulsa **Deploy** para aplicar los cambios pendientes.

En el servicio de la app → **Variables** → **Raw Editor**, pega lo siguiente (ajusta los valores):

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=<resultado de: openssl rand -base64 48>
APP_URL=https://<tu-subdominio>.up.railway.app
UPLOAD_DIR=/app/uploads
SEED_ADMIN_EMAIL=<email del administrador>
SEED_ADMIN_PASSWORD=<contraseña temporal de 10+ caracteres>
SEED_ADMIN_NAME=Administrador
```

- `${{Postgres.DATABASE_URL}}` es una *reference variable*: Railway la sustituye por la URL interna del servicio Postgres (`postgres.railway.internal`), sin salir a internet.
- `PORT` no hace falta: Railway lo inyecta y la app lo respeta.
- Para obtener la URL pública: **Settings → Networking → Generate Domain**. Úsala en `APP_URL`.

### 4. Volumen persistente para las capturas

Sin volumen, las imágenes se pierden en cada despliegue.

1. En el lienzo del proyecto: **+ New → Volume** (o clic derecho sobre el servicio → **Attach Volume**).
2. Selecciona el servicio de la app.
3. **Mount path**: `/app/uploads`. Debe coincidir con `UPLOAD_DIR`.
4. Guarda. Railway redespliega el servicio con el volumen montado.

> El `Dockerfile` **no** usa la instrucción `VOLUME`: Railway la rechaza al construir la imagen ("The VOLUME keyword is banned"). El punto de montaje se define con el Volume del panel. Para Docker local usa `-v tablon_uploads:/app/uploads`.
>
> Railway monta los volúmenes como `root`. El script de arranque ajusta el propietario de `/app/uploads` y después ejecuta la app como el usuario sin privilegios `node`. No hace falta `RAILWAY_RUN_UID`.

### 5. Migraciones y seed inicial

**No tienes que ejecutar nada a mano.** En cada arranque, `scripts/start.sh`:

1. aplica las migraciones pendientes (`prisma migrate deploy`);
2. sincroniza `changelog.json` con la tabla `AppVersionLog`;
3. ejecuta el **seed idempotente**: si no hay usuarios, crea el administrador con `SEED_ADMIN_*`, y si no hay proyectos, crea un *Proyecto de ejemplo*;
4. arranca el servidor.

Cómo comprobarlo: en **Deployments → View logs** deberían aparecer `All migrations have been successfully applied`, `[boot] Administrador inicial creado (…)` y `[start] Arrancando servidor…`.

Después del primer arranque:

1. Entra con el email y la contraseña del seed y **cambia la contraseña** en *Mi perfil y plantillas*.
2. **Borra `SEED_ADMIN_PASSWORD`** (y, si quieres, el resto de `SEED_ADMIN_*`) de las variables de Railway. No se vuelven a usar mientras exista algún usuario.
3. Da de alta al resto del equipo en **Usuarios** (máximo 5 activos).

Si alguna vez necesitas lanzarlos manualmente desde tu máquina con la [CLI de Railway](https://docs.railway.com/guides/cli):

```bash
railway link                                   # selecciona proyecto y servicio
railway run npx prisma migrate deploy          # usa las variables del servicio
railway run npm run db:seed
```

Nota: `railway run` ejecuta el comando en tu máquina con las variables del servicio. Para llegar a la base de datos desde fuera usa la URL pública (`DATABASE_PUBLIC_URL` del servicio Postgres).

### 6. Copias de seguridad (recomendado)

- **Base de datos:** activa los *Backups* del servicio Postgres en Railway, o programa un `pg_dump` con la URL pública.
- **Capturas:** el volumen admite *backups* desde la pestaña del volumen.

---

### 7. Integraciones opcionales (v1.1)

#### 7.1 Google Docs y Sheets

1. Entra en [console.cloud.google.com](https://console.cloud.google.com) con una cuenta de tu Google Workspace y crea un proyecto (por ejemplo, «Pizarro»).
2. **APIs y servicios → Biblioteca** → busca **Google Drive API** → **Habilitar**. Es la única API necesaria: los Docs y Sheets se crean a través de Drive.
3. **Google Auth Platform** (antes «Pantalla de consentimiento de OAuth»):
   - **Branding**: nombre de la app «Pizarro» y email de soporte.
   - **Audience / Público**: tipo **Interno**. Solo podrán conectarse las cuentas de tu Workspace y no hace falta verificación de Google.
   - **Data access / Acceso a datos**: añade los permisos `openid`, `email` y `https://www.googleapis.com/auth/drive.file`. `drive.file` solo da acceso a los archivos que crea Pizarro, no al resto de tu Drive.
4. **Clients / Credenciales → Crear cliente → Aplicación web**:
   - **URI de redirección autorizados**: `https://<tu-dominio>.up.railway.app/api/google/callback`. Debe coincidir exactamente con `APP_URL` + `/api/google/callback`.
5. Copia el **ID de cliente** y el **secreto** a Railway: `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, y añade `GOOGLE_WORKSPACE_DOMAIN=tu-dominio.com`. Así, cada archivo creado se comparte automáticamente con tu dominio como editor (`GOOGLE_SHARE_ROLE`), y el resto del equipo puede abrirlo desde la tarjeta. Sin dominio, solo lo ve quien lo crea hasta que lo comparta a mano.
6. Redespliega. Cada usuario entra en **Mi perfil y plantillas → Google Docs y Sheets → Conectar con Google**.

> Los tokens de Google se guardan cifrados con una clave derivada de `SESSION_SECRET`. Si rotas `SESSION_SECRET`, cada usuario tendrá que volver a conectar Google.

#### 7.2 Avisos por email

Con Google Workspace, lo más sencillo es enviar desde una cuenta dedicada (por ejemplo `avisos@tu-dominio.com`) con una **contraseña de aplicación**:

1. En esa cuenta, activa la **verificación en dos pasos**. Tu administrador de Workspace debe permitirla.
2. Ve a [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) y crea una contraseña de aplicación llamada «Pizarro».
3. En Railway:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=avisos@tu-dominio.com
   SMTP_PASS=<contraseña de aplicación de 16 caracteres>
   SMTP_FROM=Pizarro <avisos@tu-dominio.com>
   ```

Sirve cualquier otro SMTP (Resend, Brevo, Mailgun…) con sus datos. Con el puerto `465` se usa TLS directo; con `587`, STARTTLS.

#### 7.3 Avisos por WhatsApp

Se usa la **WhatsApp Cloud API** oficial de Meta. Pasos:

1. Crea o usa un **portfolio de Meta Business** en [business.facebook.com](https://business.facebook.com).
2. En [developers.facebook.com](https://developers.facebook.com) → **Mis apps → Crear app** → tipo **Empresa (Business)** → añade el producto **WhatsApp**.
3. **WhatsApp → Configuración de la API**:
   - Meta te da un **número de prueba**, que puede enviar a un máximo de 5 destinatarios verificados. Basta para un equipo de 5; añade sus números en «Para».
   - Para producción, añade un número propio dedicado, que no esté en uso en la app de WhatsApp, y verifícalo.
   - Copia el **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`.
4. **Token permanente**: en **Configuración del negocio → Usuarios del sistema**:
   - crea un usuario del sistema (Admin);
   - asígnale la app y la cuenta de WhatsApp;
   - genera un token con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Ese es el `WHATSAPP_TOKEN`.
5. **Plantilla** en **WhatsApp Manager → Plantillas de mensajes → Crear**:
   - Categoría **Utilidad**, nombre `mencion_tablon`, idioma **Español (es)**.
   - Cuerpo (los 4 parámetros, en este orden):
     ```
     {{1}} te ha mencionado en la tarea «{{2}}» ({{3}}). Ábrela aquí: {{4}}
     ```
   - Envíala a revisión y espera a que esté **Aprobada**. Suele tardar minutos.
6. En Railway:
   ```env
   WHATSAPP_TOKEN=<token permanente>
   WHATSAPP_PHONE_NUMBER_ID=<id del número>
   WHATSAPP_TEMPLATE_NAME=mencion_tablon
   WHATSAPP_TEMPLATE_LANG=es
   ```
7. Cada usuario activa **WhatsApp** en *Mi perfil → Avisos de menciones* y escribe su número en formato internacional (`+34…`).

> Meta cobra por cada mensaje de plantilla de utilidad (céntimos en España; consulta su tabla de precios). Si el idioma de la plantilla aprobada es `es_ES` en vez de `es`, cambia `WHATSAPP_TEMPLATE_LANG`. Los errores de envío quedan en los logs con el prefijo `[notify]`.

## Arquitectura (resumen)

```
Navegador ──HTTPS──▶ Railway ──▶ contenedor (node server.js, Next.js standalone)
                                   ├─ Server Components: lectura directa con Prisma
                                   ├─ Server Actions: mutaciones validadas con zod
                                   ├─ /api/tasks/:id/attachments  (subida + sharp)
                                   ├─ /api/attachments/:id        (servir con control de acceso)
                                   ├─ /api/projects/:id/report    (informe PDF)
                                   ├─ /api/google/*               (OAuth de Google) ──▶ Google Drive API
                                   ├─ avisos (after)              ──▶ SMTP · WhatsApp Cloud API
                                   ├─ /api/health
                                   └─ /app/uploads  ◀── Volume
                                         │
                                         ▼
                                   PostgreSQL (servicio Postgres de Railway)
```

Detalles de rendimiento, seguridad y modelo de datos en el [manual](docs/MANUAL.md).

## Licencia

Uso interno. Añade la licencia que prefieras antes de reutilizar el código.
