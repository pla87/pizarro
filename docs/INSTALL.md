# Instalar Pizarro en tu propio servidor

Esta guía instala Pizarro en un servidor propio (un VPS, un miniordenador en la oficina…) con **Docker Compose**: tres contenedores, **Caddy** (HTTPS automático), **Pizarro** y **PostgreSQL 16**. Todo vive en la carpeta `deploy/` del repositorio y no cambia nada del despliegue en Railway.

> Pizarro está pensado para **un solo proceso** (una réplica). Las tareas de fondo se turnan con un bloqueo en la base de datos, así que un solapamiento breve durante una actualización no duplica nada, pero no lo escales a varias réplicas.

## 1. Requisitos

| | Mínimo |
|---|---|
| CPU | 1 vCPU (amd64 o arm64) |
| Memoria | **2 GB de RAM** (1 GB funciona con swap, más lento) |
| Disco | 10 GB + lo que ocupen los adjuntos |
| Software | Linux con **Docker 24+** y el plugin `docker compose` |
| Red | Puertos **80** y **443** abiertos hacia Internet y un **dominio** (o subdominio) con un registro DNS `A`/`AAAA` apuntando al servidor |

Sin dominio también funciona en una red local, solo por HTTP (ver 3.3).

Comprueba Docker:

```bash
docker --version          # 24 o superior
docker compose version
```

## 2. Instalación paso a paso

### 2.1 Descargar el código

```bash
sudo mkdir -p /opt/pizarro && sudo chown "$USER" /opt/pizarro
git clone <URL-del-repositorio> /opt/pizarro
cd /opt/pizarro/deploy
```

### 2.2 Ejecutar el instalador

```bash
./install.sh                                # pregunta el dominio (o el modo red local)
./install.sh --domain pizarro.example.com   # sin preguntas
./install.sh --local                        # solo red local, por HTTP (ver 3.3)
```

El script se puede repetir sin riesgo. Hace esto:

1. Comprueba que están Docker 24+ y el plugin `docker compose`.
2. Pregunta el dominio (o la dirección, en modo local) y crea `deploy/.env` con `DOMAIN` y `APP_URL`.
3. Genera `POSTGRES_PASSWORD`, `SESSION_SECRET` y `BACKUP_KEY` con aleatorios fuertes (`openssl rand`, o `/dev/urandom` si no hay `openssl`). **Nunca pisa un secreto que ya existe** en el `.env`.
4. Escribe el **kit de recuperación** `deploy/recovery-kit.txt` (permisos 600) con esos tres secretos y qué hacer si se pierde el servidor.
5. Ejecuta `docker compose up -d --build` (la primera vez construye la imagen: unos minutos) y espera a que la app esté sana.
6. Muestra la dirección del asistente de configuración y el **código de un solo uso** que lee del log de la app.

> **Guarda `recovery-kit.txt` FUERA del servidor** (gestor de contraseñas, otro equipo) y bórralo de aquí si quieres. Sin `BACKUP_KEY` las copias no se pueden leer; si se pierde o cambia `SESSION_SECRET`, todo el mundo tiene que volver a entrar y configurar de nuevo su verificación en dos pasos.

Con `--no-start` solo prepara el `.env` y el kit, sin arrancar nada. Necesita permisos para usar Docker (usuario del grupo `docker`, o `sudo ./install.sh`).

#### Alternativa: hacerlo a mano

```bash
cp .env.example .env
chmod 600 .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "SESSION_SECRET=$(openssl rand -base64 48)"
echo "TOKEN_SECRET=$(openssl rand -base64 48)"
echo "ENCRYPTION_KEY=$(openssl rand -base64 48)"
echo "BACKUP_KEY=$(openssl rand -base64 32)"
```

Copia esos valores en `.env` (`nano .env`) y rellena como mínimo:

- `DOMAIN`: tu dominio, p. ej. `pizarro.example.com`.
- `APP_URL`: la URL completa, p. ej. `https://pizarro.example.com`.
- `POSTGRES_PASSWORD`, `SESSION_SECRET`, `TOKEN_SECRET`, `ENCRYPTION_KEY` y `BACKUP_KEY`: los valores generados.

**Guarda `SESSION_SECRET`, `TOKEN_SECRET`, `ENCRYPTION_KEY` y `BACKUP_KEY` fuera del servidor** (en un gestor de contraseñas): son el kit de recuperación. Sin `BACKUP_KEY` las copias no se pueden leer; sin `ENCRYPTION_KEY` (y `TOKEN_SECRET`), al restaurar en otro servidor se pierden la verificación en dos pasos, los códigos de recuperación y las conexiones con Google. Cambiar `SESSION_SECRET` solo obliga a todo el mundo a volver a entrar. `TOKEN_SECRET` y `ENCRYPTION_KEY` son opcionales: si se dejan vacías se usa `SESSION_SECRET` (y entonces cambiarla obliga también a configurar de nuevo el segundo paso). Cómo rotar cada una: `docs/MANUAL.md`, sección 4.4.

Después arranca con `docker compose up -d --build` y sigue el log con `docker compose logs -f app` (Ctrl+C para salir). `docker compose ps` debe mostrar los tres servicios `healthy` / `running`. Caddy pide el certificado HTTPS en cuanto el dominio resuelve al servidor.

### 2.3 Asistente de primer arranque

Con la base de datos vacía y sin `SEED_ADMIN_*` en el `.env`, la app imprime en su log un recuadro como este (el instalador te lo muestra; también con `docker compose logs app | grep "introduce el código"`):

```
[setup] Abre https://pizarro.example.com/setup e introduce el código: K7QM-4TXD
```

El código es de un solo uso para esta instalación: caduca a las 24 horas y se regenera en cada reinicio mientras falte la configuración. Si prefieres uno fijo, define `SETUP_TOKEN` (8 caracteres o más) en el `.env`. Abre `/setup`:

1. **Código** del log. Los intentos fallidos están limitados.
2. **Organización, idioma y zona horaria** de la instalación. Si `APP_TIMEZONE` está definida en el `.env`, manda sobre la zona elegida.
3. **Primer administrador:** nombre, email y contraseña (mínimo 10 caracteres).
4. **Email:** muestra si el servidor tiene SMTP configurado y permite enviar un email de prueba a tu dirección.
5. **Fin:** vas a *Iniciar sesión*. Al entrar, Pizarro te pide activar la verificación en dos pasos (obligatoria para administradores).

Terminado el asistente, el código se borra y `/setup` responde 404. Mientras no haya usuarios, cualquier otra dirección redirige a `/setup`.

Configura el email (`SMTP_*` en `.env`) para tener invitaciones y «¿Olvidaste tu contraseña?», y aplica el cambio con `docker compose up -d`.

### 2.4 Administrador inicial por variables (alternativa)

Para instalaciones automatizadas puedes saltarte el asistente definiendo `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` y, opcionalmente, `SEED_ADMIN_NAME` en `.env`. Si la base de datos no tiene usuarios, el administrador se crea al arrancar y `/setup` queda desactivado (es lo que usa Railway). Entra con esos datos, configura la verificación en dos pasos, cambia la contraseña y borra `SEED_ADMIN_PASSWORD` del `.env`.

## 3. Configuración

### 3.1 Cambiar variables

Edita `.env` y ejecuta `docker compose up -d`: Compose recrea solo los contenedores afectados. No hace falta reconstruir la imagen para ninguna variable (tampoco para la zona horaria ni para el tamaño máximo de los adjuntos).

### 3.2 Memoria

Los límites por defecto están pensados para 2 GB: app 1 GB (montón de Node 640 MB), PostgreSQL 512 MB y Caddy 128 MB. Si un proceso supera su límite, Docker lo reinicia en lugar de dejar sin memoria al servidor. Con más RAM puedes subir `APP_MEM_LIMIT` y `APP_HEAP_MB` (deja `APP_HEAP_MB` en torno al 60–70 % de `APP_MEM_LIMIT`).

### 3.3 Solo red local (sin dominio)

En `.env`: `DOMAIN=":80"` y `APP_URL="http://<ip-del-servidor>"`. Caddy sirve solo HTTP y la cookie de sesión no se marca *Secure*. No lo expongas así a Internet.

> **Importante:** la aplicación se fía de la cabecera `X-Real-IP` para saber la IP del cliente (límites de intentos, registro de actividad). Por eso el puerto 3000 de Pizarro nunca debe quedar expuesto directamente: solo a través del Caddy incluido (o de otro proxy que sobrescriba `X-Real-IP`). Si no, cualquiera podría falsear su IP.

### 3.4 Arquitecturas

La imagen se construye para la arquitectura del propio servidor (amd64 o arm64, p. ej. Raspberry Pi 5). Para preparar una imagen de las dos a la vez desde otra máquina: `docker buildx build --platform linux/amd64,linux/arm64 -t <registro>/pizarro:<versión> --push ..` y pon ese nombre en `PIZARRO_IMAGE`.

### 3.5 Endurecimiento del contenedor y rol de la base de datos

- **Código de solo lectura.** En la imagen el código es de `root`: el proceso de la app (usuario `node`) solo puede escribir en el volumen de subidas, en `/tmp` y en la caché de Next. `deploy/compose.yml` añade `read_only: true`, `no-new-privileges` y elimina todas las capacidades de Linux salvo las cinco que usa `scripts/start.sh` para ajustar el volumen y bajar a `node`. Comprobación: `docker compose exec app sh -c 'touch /app/server.js'` debe fallar.
- **Rol de base de datos sin superusuario.** En una instalación **nueva**, `install.sh` define `APP_DB_USER=pizarro_app` y `APP_DB_PASSWORD` en `.env`; al crear la base, `deploy/postgres-init/10-app-role.sh` crea ese rol (sin superusuario, con `CREATEDB` para la prueba mensual de restauración, y dueño de la base). La app se conecta con él; `pizarro` queda solo para administrar PostgreSQL.
  Con ese rol, los comandos de las secciones 4.3 y 6 que usan `-U pizarro` para **restaurar** (`dropdb`, `createdb`, `pg_restore`) deben usar `-U pizarro_app`, para que los objetos queden a su nombre.
- **Instalaciones existentes (paso manual y opcional).** Siguen funcionando igual (la app usa `pizarro`). Para migrarlas: haz una copia (sección 4.3), añade a `deploy/.env` `APP_DB_USER="pizarro_app"` y `APP_DB_PASSWORD="<aleatoria: openssl rand -hex 24>"`, y ejecuta
  ```bash
  cd /opt/pizarro/deploy
  docker compose up -d postgres      # recrea el contenedor con las variables nuevas
  docker compose exec -T postgres sh /docker-entrypoint-initdb.d/10-app-role.sh
  docker compose up -d app
  ```
  El script es idempotente: crea el rol y le pasa la propiedad de la base y sus tablas. Para volver atrás, quita las dos variables de `.env` y `docker compose up -d`.

## 4. Copias de seguridad

- **Automáticas:** con `BACKUP_KEY`, cada día se copian, cifrados, la base de datos y **todos los ficheros del volumen de subidas** (adjuntos, miniaturas, copias de releases, documentos) en su carpeta `backups/`. Los ficheros se guardan una sola vez y cada copia solo añade los nuevos. Se conservan 14 diarias y 6 mensuales, y cada mes se restaura la última en una base de datos temporal para comprobar que sirve. Estado en *Administración → Copias de seguridad*.
- **Fuera del servidor:** esas copias viven en el mismo disco que protegen. Configura además **un destino externo** (sección 4.1 o 4.2): tras cada copia diaria se sube allí lo que falte, con la misma retención, y la app avisa si la última subida correcta tiene más de 48 h.
- Guarda `.env` (sobre todo `BACKUP_KEY`) **fuera del servidor**: sin la clave, ninguna copia se puede abrir.
- Con destino externo, por defecto el volumen guarda solo la base de datos (los ficheros van al destino externo y no ocupan el doble). `BACKUP_LOCAL_FILES=1` guarda también una copia local de los ficheros; `0` la evita aunque no haya destino externo.

### 4.1 Almacenamiento S3 compatible (Cloudflare R2, Backblaze B2, MinIO…)

1. Crea un bucket **privado** y una clave de API con permiso de lectura, escritura y borrado solo en ese bucket (Pizarro borra las copias que ya no toca conservar).
2. Añade a `.env`:

   ```bash
   BACKUP_S3_ENDPOINT="https://<id-de-cuenta>.r2.cloudflarestorage.com"   # B2: https://s3.<región>.backblazeb2.com
   BACKUP_S3_BUCKET="pizarro-copias"
   BACKUP_S3_ACCESS_KEY_ID="…"
   BACKUP_S3_SECRET_ACCESS_KEY="…"
   # Opcionales: región (por defecto «auto»; en B2, la del endpoint, p. ej. eu-central-003) y prefijo dentro del bucket.
   BACKUP_S3_REGION=""
   BACKUP_S3_PREFIX="pizarro"
   ```

3. `docker compose up -d` y, en *Administración → Copias de seguridad*, pulsa **Copiar ahora a destino externo**. Recarga al cabo de unos minutos: debe salir *Correcta*.

Las claves de acceso nunca aparecen en la página ni en los logs. Todo lo que se sube va cifrado con `BACKUP_KEY`: el proveedor no puede leerlo.

### 4.2 Carpeta montada (disco USB, NAS, SFTP montado)

Monta la carpeta en el servidor (p. ej. `/mnt/copias`), dale permiso de escritura al usuario 1000 (`sudo chown 1000:1000 /mnt/copias`) y crea `deploy/compose.override.yml` (Docker Compose lo carga solo):

```yaml
services:
  app:
    volumes:
      - /mnt/copias:/copias-externas
```

Añade `BACKUP_EXTERNAL_DIR="/copias-externas"` a `.env` y `docker compose up -d`. Puedes usar a la vez S3 y una carpeta.

### 4.3 Copia manual (opcional)

También puedes sacar a mano un volcado de PostgreSQL y un archivo del volumen:

```bash
cd /opt/pizarro/deploy
# Base de datos (formato de pg_dump)
docker compose exec -T postgres pg_dump -U pizarro -Fc pizarro > pizarro-$(date +%F).dump
# Adjuntos y copias automáticas (volumen «pizarro_uploads»)
docker run --rm -v pizarro_uploads:/data:ro -v "$PWD":/backup alpine tar czf /backup/uploads-$(date +%F).tgz -C /data .
```

Guarda los dos ficheros (y `.env`) en otro sitio.

## 5. Actualizar

```bash
cd /opt/pizarro/deploy
# 1. Copia (ver sección 4)
docker compose exec -T postgres pg_dump -U pizarro -Fc pizarro > antes-de-actualizar-$(date +%F).dump
# 2. Código nuevo
git -C /opt/pizarro pull
# 3. Reconstruir y arrancar: las migraciones se aplican solas al arrancar
docker compose up -d --build
docker compose logs -f app
```

Si la versión nueva no arranca, vuelve a la anterior (`git -C /opt/pizarro checkout <versión-anterior>` y `docker compose up -d --build`) y, si ya había migrado la base de datos, restaura la copia del paso 1 (sección 6).

## 6. Restaurar

### 6.1 Desde un volcado de `pg_dump`

```bash
cd /opt/pizarro/deploy
docker compose stop app
docker compose exec -T postgres dropdb -U pizarro pizarro
docker compose exec -T postgres createdb -U pizarro pizarro
docker compose exec -T postgres pg_restore -U pizarro -d pizarro --no-owner < pizarro-AAAA-MM-DD.dump
docker compose up -d
```

La app debe ser **la misma versión** que hizo el volcado o una posterior (al arrancar aplica las migraciones que falten).

### 6.2 Adjuntos

```bash
docker compose stop app
docker run --rm -v pizarro_uploads:/data -v "$PWD":/backup alpine sh -c "rm -rf /data/* && tar xzf /backup/uploads-AAAA-MM-DD.tgz -C /data"
docker compose up -d
```

Restaura la base de datos y los adjuntos **de la misma fecha**.

### 6.3 Desde una copia automática (recomendado; sin `git`)

La imagen trae la herramienta `node dist/restore.mjs` y todas las migraciones. Sobre una base de datos **vacía**, verifica la copia, aplica las migraciones hasta la de la copia, carga los datos, aplica las migraciones posteriores y, con `--files`, restaura los ficheros en el volumen de subidas (comprobando cada uno). Vale para copias de esta versión o de cualquier versión anterior; una copia de una versión **más nueva** que la imagen se rechaza (actualiza primero, sección 5).

Origen de la copia (primer argumento):

| Origen | Copia |
|---|---|
| `latest` | La más reciente del volumen (`/app/uploads/backups`). |
| `s3:latest` | La más reciente del almacenamiento S3 (`BACKUP_S3_*` de `.env`). |
| `external:latest` | La más reciente de la carpeta externa (`BACKUP_EXTERNAL_DIR`). |
| `s3:pizarro-backup-AAAAMMDDTHHMMSSZ` | Una copia concreta (con `local:`, `s3:` o `external:` delante). |
| `/ruta/pizarro-backup-….pzman` | Una copia en una carpeta montada en el contenedor (con su `files/` al lado). Un `.pzbak` suelto (p. ej. el de *Descargar*) restaura solo la base de datos. |

Opciones: `--files` (también los ficheros), `--files-only` (solo los ficheros; para reanudar si se cortó), `--list` (ver las copias del origen), `--force` (**borra** la base de destino aunque tenga datos).

**Servidor nuevo o disco perdido.** Instala como en las secciones 2 y 3 con el **mismo `.env`** (la misma `BACKUP_KEY` y el mismo destino externo), pero **no arranques todavía la app**:

```bash
cd /opt/pizarro/deploy
docker compose build app
docker compose up -d postgres
# Ver las copias disponibles
docker compose run --rm --no-deps app node dist/restore.mjs s3:latest --list
# Restaurar la base de datos y los ficheros
docker compose run --rm --no-deps app node dist/restore.mjs s3:latest --files
# Arrancar todo
docker compose up -d
```

**Volver a una copia anterior en el mismo servidor** (p. ej. tras un borrado por error):

```bash
cd /opt/pizarro/deploy
docker compose stop app
docker compose exec -T postgres dropdb -U pizarro pizarro
docker compose exec -T postgres createdb -U pizarro pizarro
docker compose run --rm --no-deps app node dist/restore.mjs latest --list
docker compose run --rm --no-deps app node dist/restore.mjs local:pizarro-backup-AAAAMMDDTHHMMSSZ --files
docker compose up -d
```

Notas:

- Si la app llegó a arrancar contra la base nueva, ya tiene el administrador inicial y la restauración se niega: añade `--force` (borra todo lo que tenga esa base).
- `--files` no borra ficheros que no estén en la copia; los sobrantes los quita la limpieza de huérfanos al día siguiente.
- Para restaurar un `.pzbak` descargado: `docker compose run --rm --no-deps -v "$PWD":/restaurar app node dist/restore.mjs /restaurar/pizarro-backup-AAAAMMDDTHHMMSSZ.pzbak`.

## 7. Estado y diagnóstico

- **Salud:** `GET /api/health` responde `{"status":"ok"}` (200) si la base de datos contesta, la carpeta de subidas se puede escribir y quedan al menos `HEALTH_MIN_FREE_MB` (200 MB por defecto) libres en su disco. Si no, 503 con un motivo: `database`, `uploads_not_writable` o `low_disk_space`. Docker la usa para marcar el contenedor como *unhealthy*.
- **Tareas de fondo:** *Administración → Copias de seguridad → Tareas de mantenimiento* muestra cuándo se ejecutó cada tarea y si falló.
- **Logs:** *Administración → Logs* (errores de la app, incluidos los no capturados) y `docker compose logs app`.
- **Diagnóstico para soporte:** si pides ayuda, adjunta el diagnóstico: *Administración → Ajustes → Descargar diagnóstico*, o por consola

  ```bash
  docker compose exec app node dist/doctor.mjs > diagnostico.json
  ```

  Es un JSON legible con la versión, la memoria, qué variables están definidas (nunca su valor), el tamaño de la base de datos y las filas por tabla, las migraciones aplicadas y pendientes, el disco, las tareas de fondo, las copias, la comprobación de salud y los errores de las últimas 24 h agrupados por tipo. No contiene datos personales, mensajes de los logs ni claves.
- **Rotar claves:** tras cambiar `ENCRYPTION_KEY` (con la anterior en `ENCRYPTION_KEY_PREVIOUS`), `docker compose exec app node dist/rotate-keys.mjs` vuelve a cifrar todo con la nueva; después quita la anterior. Detalles en `docs/MANUAL.md`, 4.4.
- **Recuperar el acceso sin email:** si alguien olvida su contraseña, un administrador abre *Administración → Usuarios → Forzar cambio de contraseña*; sin email configurado la app muestra un enlace de un solo uso (30 minutos) para pasárselo por un canal de confianza. Si **ningún administrador puede entrar** (olvidó la contraseña o perdió el móvil de la verificación en dos pasos), genera el enlace desde la consola del servidor:

  ```bash
  # Docker Compose
  docker compose exec app node dist/reset-link.mjs persona@example.com
  # añade --reset-2fa para borrar también su verificación en dos pasos
  docker compose exec app node dist/reset-link.mjs persona@example.com --reset-2fa
  ```

  Imprime `APP_URL/reset/<token>`: ábrelo en el navegador y elige la contraseña nueva. Sirve una sola vez y caduca a los 30 minutos; un usuario desactivado se rechaza. En **Railway** el código vive dentro del contenedor del servicio (donde existe `dist/`), así que hay que ejecutar la orden allí: con la CLI, `railway ssh` (o el terminal del servicio en el panel) y dentro `node dist/reset-link.mjs persona@example.com`. `railway run` no es lo adecuado: ejecuta en tu máquina (con las variables de Railway), donde normalmente no existe `dist/` ni se alcanza la base de datos interna.
- **Excepciones no capturadas:** se anotan en *Logs* y la app se reinicia sola (Docker la vuelve a levantar). Lo activa `compose.yml` con `EXIT_ON_UNCAUGHT_EXCEPTION=1`; ponlo a `0` para solo registrarlas.

## 8. Resolución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `docker compose up` dice «Define … en .env» | Falta una variable obligatoria | Ejecuta `./install.sh` otra vez (rellena lo que falte sin tocar lo demás) o ponla en `.env`. |
| No tengo el código de `/setup` | Se imprime en el log al arrancar y caduca a las 24 h | `docker compose restart app` y `docker compose logs app \| grep "introduce el código"`; o define `SETUP_TOKEN` en `.env`. |
| `/setup` da 404 | Ya hay usuarios (la instalación está configurada) o se definió `SEED_ADMIN_*` | Entra en `/login`. Para empezar de cero hay que vaciar la base de datos. |
| `[start] ERROR: faltan variables de entorno: SESSION_SECRET(>=32)` | Secreto vacío o corto | `./install.sh` (genera los que falten) o `openssl rand -base64 48` y `docker compose up -d`. |
| El navegador avisa de certificado no válido | El DNS aún no apunta al servidor o los puertos 80/443 están cerrados | Comprueba el registro DNS y el cortafuegos; mira `docker compose logs caddy`. |
| La app queda *unhealthy* y `/api/health` dice `low_disk_space` | Disco casi lleno | Libera espacio (`docker system prune` borra imágenes viejas) o amplía el disco. |
| `/api/health` dice `uploads_not_writable` | El volumen de subidas no se puede escribir | `docker compose restart app` (el arranque corrige el propietario); revisa el disco. |
| `/api/health` dice `database` | PostgreSQL parado o contraseña distinta | `docker compose ps`; si cambiaste `POSTGRES_PASSWORD` después de la primera instalación, vuelve a la original (la base ya se creó con ella). |
| La app se reinicia sola a menudo | Falta de memoria o un error | `docker compose logs app` y *Administración → Logs*; sube `APP_MEM_LIMIT`/`APP_HEAP_MB` si hay RAM. |
| Las fechas salen con otra hora | La zona elegida en el asistente o `APP_TIMEZONE` no es la tuya | Define `APP_TIMEZONE` en `.env` y `docker compose up -d` (manda sobre la del asistente). |
| El login no mantiene la sesión | `APP_URL` con `https://` pero se entra por `http://` | Entra por la URL de `APP_URL`. |
| No llegan emails | SMTP sin configurar o credenciales erróneas | Revisa `SMTP_*` y *Administración → Logs* (`[notify]`). |
