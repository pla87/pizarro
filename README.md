# Pizarro

Kanban ligero y generador de *release notes* para equipos pequeños (sin tope de personas; opcional, `MAX_USERS`). Tiene tableros multiproyecto, capturas pegadas desde el portapapeles y exportación de releases agrupadas por tipo, con cabecera y pie personalizados por usuario.

- **Stack:** Next.js 16 (App Router, TypeScript, Tailwind CSS 4) · PostgreSQL · Prisma 7 · `@dnd-kit` · `sharp` · `lucide-react`.
- **Instalar:** guía paso a paso en la web, [getpizarro.com/instalar](https://getpizarro.com/instalar/) ([English](https://getpizarro.com/en/install/)): requisitos, instalación en un comando, primeros pasos, Railway, copias, actualizar y problemas frecuentes. Se genera desde `docs/web/instalar.md` y `docs/web/en/install.md`.
- **Despliegue:** un único contenedor Docker (monolito) en Railway, con un volumen persistente para las capturas. También se instala en un servidor propio con Docker Compose (Caddy + Pizarro + PostgreSQL): referencia técnica completa en [docs/INSTALL.md](docs/INSTALL.md). Instalación en un paso en un servidor Linux: `curl -fsSL https://raw.githubusercontent.com/pla87/pizarro/stable/deploy/get.sh | sh -s -- --domain pizarro.example.com`. Cada versión se publica como imagen Docker ya construida (`ghcr.io/pla87/pizarro`, amd64 y arm64); actualizar o volver a una versión anterior: [getpizarro.com/instalar/#actualizar](https://getpizarro.com/instalar/#actualizar) (detalle técnico: [docs/INSTALL.md](docs/INSTALL.md), sección 5). Railway sigue construyendo desde el repositorio, desde la rama `stable` (solo versiones publicadas): guía en [Instalar en Railway](#instalar-en-railway). También en **Render** (Blueprint `render.yaml`, botón [Deploy to Render](https://render.com/deploy?repo=https://github.com/pla87/pizarro)) y en **Fly.io** (`deploy/fly.toml`), las dos con la imagen publicada: pasos, coste y cómo actualizar en [docs/INSTALL.md](docs/INSTALL.md) («Render» y «Fly.io»).
- **Web:** [getpizarro.com](https://getpizarro.com) (qué es, cómo se instala y precios; se genera desde `site/`, ver [docs/VENTA.md](docs/VENTA.md), sección 8).
- **Documentación:** [Manual de operaciones (PDF)](https://github.com/pla87/pizarro/releases/latest/download/MANUAL.pdf) (adjunto de la última versión publicada) · [fuente Markdown](docs/MANUAL.md) · [Changelog](CHANGELOG.md).
- **Errores:** con el formulario de [incidencias](https://github.com/pla87/pizarro/issues/new/choose) (o *Informar de un error* en *Historial de versiones* dentro de la app). Solo se atienden versiones publicadas sin modificar. Los fallos de seguridad, en privado: [SECURITY.md](SECURITY.md).

---

## Funcionalidades

| Área | Qué incluye |
|---|---|
| Acceso | Login con email y contraseña (bcrypt). Sesiones en base de datos con cookie `HttpOnly` y `SameSite=Lax`. Sin registro público. Roles `ADMIN` y `MEMBER`. Sin tope de usuarios activos (opcional con `MAX_USERS`). |
| Proyectos | Selector en la barra lateral. Cada proyecto tiene sus columnas, tareas, etiquetas y releases. Por defecto son visibles para todos; un admin puede **restringir la visibilidad** a usuarios concretos. |
| Tablero | Columnas configurables por proyecto: crear, renombrar, reordenar, asignar un rol y borrar si están vacías. Arrastrar y soltar entre columnas y dentro de cada una. Selección múltiple y movimiento en lote. |
| Tarjetas | Tipo (por defecto *Funcionalidad* y *Corrección*; los admins crean más tipos generales y cada proyecto puede tener tipos propios, con su color), color, responsable opcional, etiquetas, enlace externo, checklist, descripción en Markdown y capturas (pegar con Ctrl/⌘+V, archivo o cámara). Se pueden archivar y restaurar. |
| Releases | Botón **Generar release** en la columna con rol *Siguiente salto*. Eliges una de tus **cabeceras** y uno de tus **pies** (cada usuario puede tener varios). Título, cabecera y una sección por tipo; cada punto lleva un código (F1, C2…), su descripción y sus adjuntos renombrados (`F1_nombre.webp`), descargables juntos en un ZIP. Editor con vista previa, **Copiar todo**, descarga `.md` / `.txt` y **Marcar como desplegado** (mueve las tarjetas a *En producción* o las archiva, y guarda el texto final en el histórico *Releases*). |
| Plazos y entregables | Fecha límite en cada tarjeta (avisos de vencida, hoy o próxima) y **entregables**: hitos con fecha objetivo que agrupan tarjetas. Las columnas pueden contar como «terminadas». |
| Informe PDF | Botón **Informe PDF** en cada proyecto: resumen y avance, estado por columna, entregables, plazos vencidos y próximos, carga por persona, tipos, últimas releases y detalle de cada columna. |
| Google Docs / Sheets | Escribe `@docs` o `@sheets` en la descripción o en un comentario, o pulsa *Nuevo Doc* / *Nuevo Sheet*. Se crea el archivo en tu Google Drive, se abre en otra pestaña y queda enlazado a la tarjeta. Cada usuario conecta su cuenta una vez (permiso mínimo `drive.file`). |
| Comentarios y menciones | Comentarios en las tarjetas con `@persona` (autocompletado). La persona mencionada recibe un aviso en la app (campana con contador), por **email** y, si el administrador lo activa y la persona lo conecta, por **Telegram** (gratis) o **WhatsApp** (de pago). |
| Vistas | *Mis tareas asignadas*, *Avisos*, histórico de releases por proyecto, *Historial de versiones* de la propia app. |
| Móvil | **Instalable como app** (Android, iPhone y escritorio). Pestañas por columna (arrastra una tarjeta sobre otra pestaña para cambiarla de columna), botón flotante (+) para crear tareas o subir capturas, cámara en el detalle de la tarea, cambio rápido de proyecto desde el título. |
| Personalización | Cada usuario elige el aspecto de las tarjetas: franja de color a la izquierda o tarjeta entera teñida. |

### Roles de columna

Cada proyecto puede tener **como máximo una** columna con cada rol:

- **Siguiente salto (`NEXT_RELEASE`)**: muestra el botón *Generar release* y es el destino de *Mover seleccionadas a Siguiente salto*.
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
| `npm run build` / `npm start` | Build de producción (salida *standalone*) y arranque (`scripts/start-local.mjs`: deja las subidas en la carpeta del proyecto y no dentro de `.next/standalone`, que se borra en cada build, y antes de abrir el servidor ejecuta las mismas tareas de arranque que el contenedor, `dist/boot.mjs`: registro del arranque, historial de versiones, seed, código de `/setup` en la terminal y plantillas de serie). Las migraciones se aplican aparte (`npx prisma migrate deploy`). |
| `npm run check` | Lint + typecheck + tests. |
| `npm test` | Tests unitarios (generador de releases, posiciones, validación, imágenes, changelog). |
| `npm run test:db` | Tests de integración (permisos y deshacer) contra una PostgreSQL efímera; ver «Tests de integración». |
| `npm run db:migrate` | Crea una nueva migración en desarrollo (`prisma migrate dev`). |
| `npm run db:deploy` | Aplica las migraciones pendientes. |
| `npm run db:seed` | Seed idempotente: crea el admin si no hay usuarios y un proyecto de ejemplo si no hay proyectos. |
| `npm run changelog:sync` | Sincroniza `changelog.json` con la tabla `AppVersionLog`. |
| `npm run version:bump -- <patch\|minor\|major>` | Registra una nueva versión de la app (ver abajo). |
| `npm run docs:pdf` | Genera `MANUAL.pdf` a partir de `docs/MANUAL.md`, para revisarlo en local (no se sube: el workflow Release lo adjunta a cada [release](https://github.com/pla87/pizarro/releases/latest/download/MANUAL.pdf)). |

### Tests de integración (base de datos real)

`npm run test:db` ejecuta `tests/db/*.test.ts` llamando a las Server Actions de verdad (permisos de proyectos públicos, restringidos y privados, miembros, usuarios desactivados, cambio de contraseña forzado, deshacer y avisos). `npm test` sigue siendo solo unitario y no necesita base de datos.

- **Qué hace el script** (`scripts/test-db.mjs`): crea una base plantilla con nombre único `pizarro_test_<aleatorio>` en el servidor de `TEST_DATABASE_URL` (o, si no existe, de `DATABASE_URL`, también desde `.env`), le aplica `prisma migrate deploy`, saca de ella 3 copias (`CREATE DATABASE … TEMPLATE …`) y reparte los ficheros de pruebas entre ellas, 3 a la vez, cada uno en su proceso. Muestra una línea por fichero (la salida completa solo de los que fallan) y un resumen con el total. Borra todas las bases al terminar, también si fallan o se interrumpe con Ctrl+C. El nombre de base de la URL se ignora: la base original nunca se toca. El usuario de PostgreSQL necesita permiso `CREATEDB`.
- **Opciones:** `npm run test:db -- tests/db/undo.test.ts` (solo esos ficheros), `-- --jobs 1` o `TEST_DB_JOBS=1` (en serie, en una base), `-- --verbose` (la salida completa de todos) y cualquier `--test-…` de `node --test` (p. ej. `--test-name-pattern="deshacer"`).
- **Local:** `service postgresql start` (o Docker) y `npm run test:db`. Los tests se niegan a ejecutarse si `DATABASE_URL` no apunta a una base `pizarro_test_*`.
- **Sesión en los tests:** `tests/db/register.mjs` sustituye `next/headers`, `next/cache`, `next/navigation` y `next/server` por stubs solo en el proceso de test; `loginAs(usuario)` crea una sesión real con `createSession` y su cookie va a un «jar» en memoria. No hay ningún atajo de autenticación en el código de producción.
- **CI:** basta un servicio PostgreSQL y dos variables. Ejemplo para GitHub Actions:

```yaml
services:
  postgres:
    image: postgres:16
    env: { POSTGRES_PASSWORD: postgres }
    ports: ["5432:5432"]
    options: --health-cmd pg_isready --health-interval 5s --health-retries 10
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with: { node-version: 22, cache: npm }
  - run: npm ci
  - run: npx prisma generate
    env: { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres" }
  - run: npm run test:db
    env: { TEST_DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres" }
```

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
| `TOKEN_SECRET` | Recomendada | 48+ caracteres aleatorios | Clave HMAC de los enlaces de email, códigos de recuperación, códigos 2FA por email y dispositivos recordados. Sin ella se usa `SESSION_SECRET`. |
| `ENCRYPTION_KEY` | Recomendada | 48+ caracteres aleatorios | Clave con la que se cifran (AES-256-GCM) los secretos TOTP y los tokens de Google. Sin ella se usa `SESSION_SECRET`. Con esta y `TOKEN_SECRET` definidas, rotar `SESSION_SECRET` solo cierra las sesiones. Guárdala fuera del servidor. |
| `TOKEN_SECRET_PREVIOUS` / `ENCRYPTION_KEY_PREVIOUS` | Solo al rotar | la clave anterior | Siguen aceptando lo guardado con la clave anterior. Tras cambiar `ENCRYPTION_KEY`, `node dist/rotate-keys.mjs` (`npm run keys:rotate`) lo re-cifra todo y la anterior se puede quitar. Ver el manual, 4.4. |
| `APP_URL` | Sí (en Railway, Render y Fly.io, solo con dominio propio) | `https://pizarro.example.com` | URL pública. Con `https://` la cookie se marca `Secure` y usa el prefijo `__Host-`. Sin ella, en Railway se usa `https://` + `RAILWAY_PUBLIC_DOMAIN` (la dirección de *Generate Domain*), en Render `RENDER_EXTERNAL_URL` y en Fly.io `https://<FLY_APP_NAME>.fly.dev`. |
| `UPLOAD_DIR` | Sí | `/app/uploads` | Carpeta de capturas (la ruta del volumen). Una ruta relativa (`./uploads`) se resuelve contra la carpeta del proyecto, también con `npm start`. |
| `PORT` | No | Lo inyectan Railway y Render | Puerto HTTP (por defecto 3000). |
| `SEED_ADMIN_EMAIL` | No (alternativa al asistente) | `admin@example.com` | Email del administrador inicial para instalaciones automatizadas. Si no defines `SEED_ADMIN_*` (lo recomendado, también en Railway), con la base de datos vacía el servidor imprime en su log un código de un solo uso y el asistente web `/setup` crea el administrador (ver `docs/INSTALL.md`). |
| `SEED_ADMIN_PASSWORD` | Solo el primer arranque | mínimo 10 caracteres | Contraseña inicial: cámbiala después desde *Mi perfil*. |
| `SEED_ADMIN_NAME` | No | `Administrador` | Nombre visible del admin inicial. |
| `SETUP_TOKEN` | No | 8+ caracteres | Código fijo que el asistente `/setup` acepta además del código del log (que cambia en cada arranque mientras falte la configuración). |
| `MAX_USERS` | No | (sin tope) | Tope opcional de usuarios activos (entero de 1 a 1.000.000; un valor que no lo sea se avisa en el log y no se aplica). Las personas desactivadas no cuentan; cambiarlo pide reiniciar. Un servidor de 1 GB de RAM va holgado hasta unas 25 personas activas a la vez; para más, sube la memoria (2 GB hasta ~50) y vigila la base de datos. |
| `MAX_UPLOAD_MB` | No | (sin tope) | Tope opcional, para todo el servidor, del tamaño de un adjunto. El tamaño máximo real es el de cada proyecto (ajustes del proyecto, 20 MB por defecto, hasta 100); si defines esta variable, ningún proyecto la supera. Se lee al subir cada archivo: cambiarla no exige recompilar. El proxy admite siempre hasta 100 MB por petición. |
| `DATABASE_POOL_SIZE` | No | `10` | Conexiones del pool (entero de 1 a 500; un valor que no lo sea se avisa en el log y se usa 10). |
| `DATABASE_CONNECT_TIMEOUT_MS` | No | `20000` | Tope (ms, de 1000 a 300000) para conseguir una conexión con PostgreSQL. Pasado, la petición falla y el log dice «No se puede conectar con PostgreSQL» con el servidor y el motivo (antes esperaba sin límite). |
| `TRUST_PROXY` | No | `1` / `0` | Si se toma la IP del cliente (límites de intentos, registro, sesiones) de `X-Real-IP` / `X-Forwarded-For`. Solo es seguro con un proxy delante que las sobrescriba. Sin definir: `1` en Docker (`scripts/start.sh`, con el Caddy de `deploy/`) y en Railway, Render y Fly.io (en estas dos, antes que esas cabeceras, la que pone su proxy: `CF-Connecting-IP` en Render, `Fly-Client-IP` en Fly.io); `0` con `npm start` o `node server.js` a mano, que usan la dirección de la conexión. Pon `1` si tienes tu propio proxy delante de `npm start`, y `0` si publicas el contenedor sin proxy. La plataforma se reconoce por `RENDER`/`RENDER_SERVICE_ID` y `FLY_APP_NAME`/`FLY_MACHINE_ID`, que pone ella misma: **no las definas en otro sitio** (por ejemplo, al copiar las variables a un servidor propio), porque entonces se aceptaría `CF-Connecting-IP` o `Fly-Client-IP` tal como la mande cualquiera y se podrían saltar los límites de intentos cambiando de IP en cada intento. |
| `LIVE_REFRESH_JITTER_MS` | No | `2000` | Espera máxima (ms, al azar) con la que cada pestaña recarga el tablero tras un cambio de otra persona, para que no lo hagan todas a la vez. `0` lo hace al momento; como mucho `10000`. |
| `BCRYPT_WORKERS` | No | `0` | Con `0` (o `false`/`off`/`no`) las comprobaciones de contraseña se calculan en el hilo principal en vez de en hilos de trabajo aparte (por defecto, en hilos: no paran el servidor). Solo para diagnosticar. |
| `UPLOAD_QUOTA_MB_PER_PROJECT` | No | `10240` | Cuota de adjuntos por proyecto (MB; 10 GB por defecto). Manda sobre el ajuste de *Administración → Ajustes → Almacenamiento*, pero no sobre la cuota propia de un proyecto. Pasada la cuota, la subida se rechaza mostrando el uso. |
| `UPLOAD_QUOTA_MB_TOTAL` | No | (sin límite) | Cuota total de adjuntos de todo el servidor (MB). |
| `PROJECT_IMPORT_MAX_MB` | No | `500` | Tamaño máximo (MB) del archivo `.pizarro.zip` al importar un proyecto (Nuevo proyecto, «Importar desde un archivo…»). Para JSON de Trello y CSV el tope es 25 MB, o este valor si es menor. Se lee en cada importación. |
| `PDF_WORKER_MAX_MB` | No | `256` | Memoria máxima (MB, de 64 a 4096) del proceso aparte que genera los PDF (informe del proyecto, lista consolidada, resumen de entrega, planificación semanal). Si un PDF la supera, solo falla ese PDF con el error habitual («No se pudo generar el informe») y queda anotado en *Logs*; el servidor sigue funcionando. Súbela si un informe muy grande falla por memoria y el contenedor tiene margen. |
| `BACKUP_KEY` | Para copias automáticas | `openssl rand -base64 32` | Clave AES-256 (32 bytes en base64, o 64 caracteres hexadecimales con `openssl rand -hex 32`) con la que se cifran las copias (base de datos y ficheros). Sin ella las copias están desactivadas. **Guárdala fuera del servidor: sin ella las copias no se pueden abrir.** |
| `BACKUP_LOCAL_FILES` | No | (auto) | Sin definir: la copia local (`UPLOAD_DIR/backups`) incluye los ficheros solo si no hay destino externo. `1`/`0` lo fuerzan. |
| `BACKUP_PAUSE` | No | `1` | Detiene las tareas automáticas de copia (la diaria, la subida al destino externo y la prueba de restauración mensual) mientras se restaura tras perder la base de datos o el volumen, para que la copia de la instalación vacía no llegue al destino externo. Los botones de *Administración → Copias de seguridad* siguen funcionando. Quítala al terminar. |
| `BACKUP_EXTERNAL_DIR` | No | `/copias-externas` | Carpeta montada (disco USB, NAS, SFTP montado) a la que se sube cada copia. Ruta absoluta dentro del contenedor. |
| `BACKUP_S3_ENDPOINT` | Para copias en S3 | `https://<cuenta>.r2.cloudflarestorage.com` | Almacenamiento S3 compatible (Cloudflare R2, Backblaze B2, MinIO…) al que se sube cada copia. Direcciones *path-style*. |
| `BACKUP_S3_BUCKET` | Para copias en S3 | `pizarro-copias` | Bucket (privado). |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | Para copias en S3 | | Clave de API con lectura, escritura y borrado en ese bucket. Nunca se muestran ni se registran. |
| `BACKUP_S3_REGION` | No | `auto` | Región de la firma (R2: `auto`; B2: la del endpoint, p. ej. `eu-central-003`; MinIO: `us-east-1`). |
| `BACKUP_S3_PREFIX` | No | `pizarro` | Prefijo de las claves dentro del bucket. |
| `COOKIE_SECURE` | No | `true` / `false` | Fuerza el atributo `Secure` de la cookie. |
| `APP_TIMEZONE` | No | `Europe/Madrid` | Zona horaria para calcular «hoy» en plazos e informes y para las fechas del navegador. Se lee al arrancar: cambiarla solo exige reiniciar. Sin ella vale la zona elegida en el asistente `/setup` (y, si no hay, `Europe/Madrid`). |
| `UPDATE_CHECK` | No | `0` | Con `0` desactiva el aviso de versión nueva en Administración (por defecto Pizarro consulta la última release pública de GitHub como mucho cada 12 h; no envía datos de tu instalación). |
| `LANDING_AT_ROOT` | No | `1` | Con `1`, quien no tiene sesión ve la presentación del producto en `/` (sin cambiar la dirección) en vez de ir al acceso; sin usuarios, `/` lleva a `/setup`. La presentación siempre está en `/presentacion`. |
| `DISK_MIN_FREE_MB` | No | `1024` | Espacio libre que debe quedar tras una exportación o importación de proyecto. Por defecto, el menor entre 1 GB y el 20 % del volumen (mínimo 100 MB). |
| `HEALTH_MIN_FREE_MB` | No | `200` | Si al disco de subidas le queda menos espacio libre, *Administración* lo avisa y `/api/health` lo lleva en `warnings` (`low_disk_space`; sigue en 200). `0` desactiva la comprobación. |
| `EXIT_ON_UNCAUGHT_EXCEPTION` | No | (desactivado) | `1`: en producción, una excepción no capturada se anota en *Logs* y la app sale para que la plataforma la reinicie (lo fija `deploy/compose.yml`). Sin él, solo se anota. |
| `GIT_SHA` | No (solo al compilar) | commit | Commit para el identificador de versión (en Railway se usa `RAILWAY_GIT_COMMIT_SHA`). Sin él, la hora de la compilación. |
| `LOG_RETENTION_DAYS` | No | `7` | Días que se conservan los logs de *Administración → Logs* (máx. 90). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Para Google Docs/Sheets/Slides | (de Google Cloud) | Cliente OAuth «Aplicación web». Ver [Google Docs, Sheets y Slides](#google-docs-sheets-y-slides). |
| `GOOGLE_WORKSPACE_DOMAIN` | Recomendada con Google | `tu-dominio.com` | Solo admite cuentas de ese dominio y comparte cada archivo nuevo con él, para que todo el equipo pueda abrirlo desde la tarjeta. |
| `GOOGLE_SHARE_ROLE` | No | `writer` | Rol con el que se comparte con el dominio (o, en proyectos privados, con los emails de sus miembros): `writer`, `commenter`, `reader` o `none` (no compartir). Es el valor por defecto: cada proyecto puede elegir otro modo en sus ajustes. |
| `AUTH_GOOGLE_ONLY` | No | `true` | Solo se entra con Google (necesita `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `APP_URL`; sin ellos no tiene efecto). Ver [Acceso con Google y dos pasos](#acceso-con-google-y-verificación-en-dos-pasos). |
| `AUTH_ALLOW_ADMIN_PASSWORD` | No | `true` | Con `AUTH_GOOGLE_ONLY`, deja entrar con contraseña (y segundo paso) a los administradores: acceso de emergencia. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Para avisos por email | `smtp.gmail.com` / `465` / … | Servidor de correo saliente. Ver [Email](#avisos-por-email). |
| `SMTP_ALLOW_PLAINTEXT` | No | `1` | Con las variables `SMTP_*` y un puerto distinto de `465`, STARTTLS es obligatorio salvo con un servidor local (`localhost`, `127.0.0.1`, `::1`). Con `1`, se permite enviar sin cifrar a propósito (un relay de la red privada sin TLS): la contraseña y los enlaces irían en claro. |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_TEMPLATE_NAME` | No | (de Meta) / `aviso_pizarro` | WhatsApp Cloud API. Lo normal es configurarlo en *Administración → Integraciones*; estas variables rellenan los campos que no se guarden allí. Ver [WhatsApp](#avisos-por-telegram-y-whatsapp). |
| `WHATSAPP_TEMPLATE_LANG` / `WHATSAPP_API_VERSION` | No | `es` / `v23.0` | Idioma de la plantilla y versión de la API de Meta. |

Las integraciones son **opcionales**: si faltan sus variables, la app funciona igual y esas opciones aparecen como «no configuradas».

---

## Instalar en Railway

La guía de Railway es una sola: [docs/web/instalar.md](docs/web/instalar.md#instalar-en-railway-sin-servidor-propio-railway), publicada en <https://getpizarro.com/instalar/#railway> con un botón que genera las claves en el navegador (en inglés, [docs/web/en/install.md](docs/web/en/install.md#install-on-railway-with-no-server-of-your-own-railway)). Trae los pasos numerados, qué hacer si falla, lo de después (email, Google, copias en R2/S3, dominio, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`, réplicas) y un texto para que una IA que use tu navegador, como Claude in Chrome, haga la instalación.

## Copias de seguridad

- **Automáticas (base de datos y ficheros):** con `BACKUP_KEY` definida, cada día se vuelca toda la base de datos (instantánea consistente `REPEATABLE READ`, sin `pg_dump`) a `UPLOAD_DIR/backups/pizarro-backup-AAAAMMDDTHHMMSSZ.pzbak` (NDJSON → gzip → AES-256-GCM, con su manifiesto dentro y en un `.json` al lado) y se copian todos los ficheros de `UPLOAD_DIR` (adjuntos, miniaturas, copias de releases, documentos) a un almacén incremental `backups/files/`: cada fichero se cifra por separado y se guarda una sola vez. Un manifiesto cifrado por copia (`.pzman`) lista el volcado y los ficheros. Se conservan las últimas 14 diarias, 6 mensuales y siempre las 3 más recientes, y se borran los ficheros del almacén que ya no nombra ninguna. Cada mes, una **prueba de restauración** restaura la última copia en una base temporal (si el usuario de la base puede crearla; si no, la descifra y la comprueba) y comprueba que están todos sus ficheros. Todo se ve en *Administración → Copias de seguridad* y en los logs (categoría *system*).
- **Destino externo:** en Railway, pon las variables `BACKUP_S3_*` en *Variables* del servicio de Pizarro y vuelve a desplegar. Con Cloudflare R2, conviene una *Bucket Lock Rule* (retención) de 31 días sobre el prefijo de las copias (`<BACKUP_S3_PREFIX>pizarro-backup-`) y, si el espacio lo permite, otra indefinida o de 180 días sobre `<BACKUP_S3_PREFIX>files/`, para que nadie pueda borrarlas antes (Pizarro salta lo retenido y lo cuenta en *Copias de seguridad*). Con `BACKUP_S3_*` (R2, B2, MinIO…) y/o `BACKUP_EXTERNAL_DIR`, tras cada copia se sube lo que falte (reanudable) y se aplica la misma retención; firma AWS SigV4 propia, sin SDK. Si la copia nueva tiene menos de la mitad de personas, proyectos y tareas o de ficheros que la última del destino (con al menos 50 de esas filas o 20 ficheros allí; con copias antiguas, sin cuentas por tabla, el total de filas con al menos 500; p. ej. la primera copia tras perder la base de datos o el volumen), no se sube ni se poda: queda como error. Si la última subida correcta tiene más de 48 h, se avisa como con la copia local. Botón *Copiar ahora a destino externo* (sube aunque la copia sea mucho menor).
- **Restaurar** (sin `git`): `node dist/restore.mjs <origen> [--files] [--force]` en el contenedor, o `npm run backup:restore -- <origen> …` en desarrollo. Origen: `latest`, `s3:latest`, `external:latest`, el nombre de una copia o la ruta de un `.pzman`/`.pzbak`. Sobre una base **vacía**: aplica las migraciones hasta la de la copia, carga los datos en una transacción, aplica el resto de migraciones y restaura los ficheros comprobando su sha256. Pasos en `docs/INSTALL.md` (Docker Compose) y en la sección 4.5 del manual (Railway).
- **Limpieza de huérfanos:** cada hora se borran de `UPLOAD_DIR` los ficheros (adjuntos, miniaturas, copias de releases) que ninguna fila de la base de datos referencia y tienen más de 24 h. No toca `backups/`, enlaces simbólicos ni ficheros con nombres desconocidos, y se cancela sola si más de la mitad de los ficheros parecen huérfanos.

---

## Integraciones opcionales

### Google Docs, Sheets y Slides

1. Entra en [console.cloud.google.com](https://console.cloud.google.com) con una cuenta de tu Google Workspace y crea un proyecto (por ejemplo, «Pizarro»).
2. **APIs y servicios → Biblioteca** → busca **Google Drive API** → **Habilitar**. Es la única API necesaria: los Docs, Sheets y Slides se crean a través de Drive.
3. **Google Auth Platform** (antes «Pantalla de consentimiento de OAuth»):
   - **Branding**: nombre de la app «Pizarro» y email de soporte.
   - **Audience / Público**: tipo **Interno**. Solo podrán conectarse las cuentas de tu Workspace y no hace falta verificación de Google.
   - **Data access / Acceso a datos**: añade los permisos `openid`, `email` y `https://www.googleapis.com/auth/drive.file`. `drive.file` solo da acceso a los archivos que crea Pizarro, no al resto de tu Drive.
4. **Clients / Credenciales → Crear cliente → Aplicación web**:
   - **URI de redirección autorizados**: `https://<tu-dominio>.up.railway.app/api/google/callback`. Debe coincidir exactamente con `APP_URL` + `/api/google/callback`. Si además usarás «Iniciar sesión con Google» ([abajo](#acceso-con-google-y-verificación-en-dos-pasos)), añade también `APP_URL` + `/api/auth/google/callback` (las dos URI en el mismo cliente).
5. Copia el **ID de cliente** y el **secreto** a las variables del servicio (en Railway, *Variables*): `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, y añade `GOOGLE_WORKSPACE_DOMAIN=tu-dominio.com`. Así, cada archivo creado se comparte automáticamente con tu dominio como editor (`GOOGLE_SHARE_ROLE`), y el resto del equipo puede abrirlo desde la tarjeta. En un proyecto privado el archivo no se comparte con el dominio, solo con los emails de los miembros del proyecto. Sin dominio, solo lo ve quien lo crea hasta que lo comparta a mano.
6. Redespliega. Cada usuario entra en **Mi perfil → Google Docs, Sheets y Slides → Conectar con Google**.

> Los tokens de Google se guardan cifrados con `ENCRYPTION_KEY` (o, si no está definida, con una clave derivada de `SESSION_SECRET`). Si cambias esa clave sin poner la anterior en `ENCRYPTION_KEY_PREVIOUS`, cada usuario tendrá que volver a conectar Google (ver el manual, 4.4).

### Avisos por email

Con Google Workspace, lo más sencillo es enviar desde una cuenta dedicada (por ejemplo `avisos@tu-dominio.com`) con una **contraseña de aplicación**:

1. En esa cuenta, activa la **verificación en dos pasos**. Tu administrador de Workspace debe permitirla.
2. Ve a [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) y crea una contraseña de aplicación llamada «Pizarro».
3. En las variables del servicio (en Railway, *Variables*):
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=avisos@tu-dominio.com
   SMTP_PASS=<contraseña de aplicación de 16 caracteres>
   SMTP_FROM=Pizarro <avisos@tu-dominio.com>
   ```

Sirve cualquier otro SMTP (Resend, Brevo, Mailgun…) con sus datos. Con el puerto `465` se usa TLS directo; con `587`, STARTTLS obligatorio (sin cifrar solo con un servidor local o con `SMTP_ALLOW_PLAINTEXT=1`).

### Avisos por Telegram y WhatsApp

Los dos se activan en **Administración → Integraciones → 3. Avisos por Telegram y WhatsApp**, sin tocar variables ni
redesplegar. Después cada persona conecta su canal en *Mi perfil → Avisos* y elige qué avisos recibe por él (por
defecto, menciones y asignaciones). Los tokens se guardan cifrados con `ENCRYPTION_KEY` y nunca vuelven al navegador.

- **Telegram (gratis)**: crea un bot con @BotFather, pega su token y pulsa *Guardar y activar*. Con `APP_URL` https
  pública, Telegram avisa a Pizarro por webhook (`/api/telegram/webhook`, con secreto); si no, Pizarro le pregunta en
  segundo plano cada pocos segundos, así que también funciona en una red local (ese modo es para una sola instancia: con
  varias réplicas, usa el webhook). Guía paso a paso:
  [docs/guias/telegram.md](docs/guias/telegram.md).
- **WhatsApp (de pago, Cloud API de Meta)**: hace falta una app de Meta con un número, un token permanente de usuario
  del sistema y la plantilla de utilidad `aviso_pizarro` aprobada (el texto exacto está en la guía). Meta cobra cada
  aviso entregado. Guía paso a paso, con costes: [docs/guias/whatsapp.md](docs/guias/whatsapp.md).

Precedencia en WhatsApp: lo guardado en Ajustes manda campo a campo; los campos vacíos usan las variables `WHATSAPP_*`
(así las instalaciones que ya las tenían siguen funcionando). Una plantilla que solo viene de `WHATSAPP_TEMPLATE_NAME`
(o la antigua `mencion_pizarro`) se usa con el formato antiguo de 4 variables y solo para menciones, hasta que se
escribe su nombre en Ajustes. Cada persona confirma su número con un código de 6 cifras que le llega por WhatsApp
(15 minutos, 5 intentos; como mucho 3 envíos al día por número y 5 por persona).

Límites: como mucho 30 mensajes de Telegram y 10 de WhatsApp por persona y hora (el resto queda en la campana), además
de los de siempre (un envío externo por persona y tarea cada 10 minutos y 40 por hora por autor). Los envíos salen tras
responder, con hasta 3 intentos (en WhatsApp solo se reintentan el 429 y los fallos de conexión antes de enviar, para no
cobrar dos veces), y el apagado ordenado espera a los que están en curso. Los fallos quedan en
*Administración → Logs* sin tokens y con el teléfono enmascarado; si alguien bloquea el bot, se le desconecta.

English guides: [docs/guias/en/telegram.md](docs/guias/en/telegram.md), [docs/guias/en/whatsapp.md](docs/guias/en/whatsapp.md).

### Acceso con Google y verificación en dos pasos

**Iniciar sesión con Google.** Con `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `APP_URL` definidos, la pantalla de acceso muestra «Iniciar sesión con Google» (OpenID Connect con PKCE, `state` y `nonce`; solo los permisos `openid email profile`, Drive sigue siendo una conexión aparte). Requisitos:

- En el cliente OAuth de Google Cloud añade la URI de redirección autorizada `APP_URL` + `/api/auth/google/callback` (además de la de Drive, `/api/google/callback`).
- No hay registro: entra quien ya tiene cuenta en Pizarro con ese email (verificado por Google). La primera vez se guarda el identificador `sub` de Google y desde entonces se reconoce por él. Si `GOOGLE_WORKSPACE_DOMAIN` está definido, solo valen cuentas de ese dominio.
- El acceso con Google no pide contraseña ni segundo paso (Google aplica el suyo) y no modifica la marca de «contraseña pendiente». Sí avisa por email de los dispositivos nuevos.

**Solo con Google.** `AUTH_GOOGLE_ONLY=true` desactiva el acceso con contraseña para todos. `AUTH_ALLOW_ADMIN_PASSWORD=true` mantiene la contraseña solo para administradores como acceso de emergencia (aparece plegado en la pantalla de acceso). Por defecto ambas están sin definir y se admiten los dos métodos.

**Verificación en dos pasos.** Solo afecta al acceso con contraseña. Cada persona puede activarla en *Mi perfil → Verificación en dos pasos* con una app de autenticación (TOTP, 6 dígitos, 30 s) o un código de 6 dígitos por email (10 minutos, un solo uso; requiere SMTP). Al activarla se muestran 10 códigos de recuperación de un solo uso (solo se guarda su HMAC). Es **obligatoria para administradores**: tras la contraseña se les pide configurarla antes de entrar. Hasta completar el segundo paso no existe sesión. Se permiten 5 fallos por cada contraseña correcta y 20 por persona y hora. «Recordar este dispositivo 14 días» omite el segundo paso en ese navegador (se anula al cambiar la contraseña o el método). Si alguien pierde el móvil y los códigos, un administrador puede restablecerla en *Administración → Usuarios*. Los secretos TOTP se guardan cifrados con `ENCRYPTION_KEY` (o, sin ella, con una clave derivada de `SESSION_SECRET`).

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

Pizarro es software de código disponible, no de código abierto. Es gratis para uso personal (personas físicas, en sus propios servidores, sin fines comerciales ni profesionales) y para uso educativo (centros de enseñanza públicos o privados, como colegios, institutos, universidades, centros de formación profesional y academias, con su profesorado y alumnado, para la docencia, el aprendizaje, la investigación académica y la gestión del propio centro). Las empresas, los profesionales y las demás organizaciones necesitan una licencia comercial de pago único por servidor, con todas las actualizaciones futuras incluidas y sin soporte. Este resumen no sustituye al texto completo: consulta [LICENSE.md](LICENSE.md) (también en `/licencia` en cada instalación y en [getpizarro.com/licencia](https://getpizarro.com/licencia/)). Precio y compra: [getpizarro.com](https://getpizarro.com/#precios).
