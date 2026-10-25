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

### 2.2 Crear el fichero de configuración

```bash
cp .env.example .env
chmod 600 .env
```

Genera los secretos y cópialos en `.env`:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "SESSION_SECRET=$(openssl rand -base64 48)"
echo "BACKUP_KEY=$(openssl rand -base64 32)"
```

Edita `.env` (`nano .env`) y rellena como mínimo:

- `DOMAIN`: tu dominio, p. ej. `pizarro.example.com`.
- `APP_URL`: la URL completa, p. ej. `https://pizarro.example.com`.
- `POSTGRES_PASSWORD`, `SESSION_SECRET` y `BACKUP_KEY`: los valores generados.
- `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`: el primer administrador (ver 2.4).
- `APP_TIMEZONE`: tu zona horaria (p. ej. `America/Mexico_City`). Cambiarla más tarde solo exige reiniciar.

**Guarda `SESSION_SECRET` y `BACKUP_KEY` fuera del servidor** (en un gestor de contraseñas). Sin `BACKUP_KEY` las copias no se pueden leer; si cambias `SESSION_SECRET`, todo el mundo tiene que volver a entrar y configurar de nuevo su verificación en dos pasos.

### 2.3 Arrancar

```bash
docker compose up -d --build
```

La primera vez se construye la imagen (unos minutos). Al arrancar, el contenedor de Pizarro aplica las migraciones de la base de datos, crea el administrador inicial y levanta el servidor. Sigue el arranque con:

```bash
docker compose ps                 # los tres servicios deben quedar «healthy» / «running»
docker compose logs -f app        # Ctrl+C para salir
```

Caddy pide el certificado HTTPS en cuanto el dominio resuelve al servidor. Abre `https://<tu-dominio>`.

### 2.4 Primer administrador

1. Entra con `SEED_ADMIN_EMAIL` y `SEED_ADMIN_PASSWORD`.
2. Pizarro te pide configurar la **verificación en dos pasos** (obligatoria para administradores) y cambiar la contraseña.
3. Borra `SEED_ADMIN_PASSWORD` de `.env`: solo se usa cuando la base de datos no tiene usuarios.
4. Configura el email (`SMTP_*` en `.env`) para tener invitaciones y «¿Olvidaste tu contraseña?», y aplica el cambio con `docker compose up -d`.

## 3. Configuración

### 3.1 Cambiar variables

Edita `.env` y ejecuta `docker compose up -d`: Compose recrea solo los contenedores afectados. No hace falta reconstruir la imagen para ninguna variable (tampoco para la zona horaria ni para el tamaño máximo de los adjuntos).

### 3.2 Memoria

Los límites por defecto están pensados para 2 GB: app 1 GB (montón de Node 640 MB), PostgreSQL 512 MB y Caddy 128 MB. Si un proceso supera su límite, Docker lo reinicia en lugar de dejar sin memoria al servidor. Con más RAM puedes subir `APP_MEM_LIMIT` y `APP_HEAP_MB` (deja `APP_HEAP_MB` en torno al 60–70 % de `APP_MEM_LIMIT`).

### 3.3 Solo red local (sin dominio)

En `.env`: `DOMAIN=":80"` y `APP_URL="http://<ip-del-servidor>"`. Caddy sirve solo HTTP y la cookie de sesión no se marca *Secure*. No lo expongas así a Internet.

### 3.4 Arquitecturas

La imagen se construye para la arquitectura del propio servidor (amd64 o arm64, p. ej. Raspberry Pi 5). Para preparar una imagen de las dos a la vez desde otra máquina: `docker buildx build --platform linux/amd64,linux/arm64 -t <registro>/pizarro:<versión> --push ..` y pon ese nombre en `PIZARRO_IMAGE`.

## 4. Copias de seguridad

- **Automáticas:** con `BACKUP_KEY`, cada día se copian, cifrados, la base de datos y **todos los ficheros del volumen de subidas** (adjuntos, miniaturas, copias de releases, documentos) en su carpeta `backups/`. Los ficheros se guardan una sola vez y cada copia solo añade los nuevos. Se conservan 14 diarias y 6 mensuales, y cada mes se restaura la última en una base de datos temporal para comprobar que sirve. Estado en *Administración → Copias de seguridad*.
- **Fuera del servidor:** esas copias viven en el mismo disco que protegen. Configura además **un destino externo** (sección 4.1 o 4.2): tras cada copia diaria se sube allí lo que falte, con la misma retención, y la app avisa si la última subida correcta tiene más de 48 h.
- Guarda `.env` (sobre todo `BACKUP_KEY`) **fuera del servidor**: sin la clave, ninguna copia se puede abrir.
- Con destino externo puedes poner `BACKUP_LOCAL_FILES=0` para que el volumen guarde solo la base de datos y no ocupe el doble con la copia de los ficheros.

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
- **Excepciones no capturadas:** se anotan en *Logs* y la app se reinicia sola (Docker la vuelve a levantar). Lo activa `compose.yml` con `EXIT_ON_UNCAUGHT_EXCEPTION=1`; ponlo a `0` para solo registrarlas.

## 8. Resolución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `docker compose up` dice «Define … en .env» | Falta una variable obligatoria | Rellénala en `.env` (sección 2.2). |
| `[start] ERROR: faltan variables de entorno: SESSION_SECRET(>=32)` | Secreto vacío o corto | `openssl rand -base64 48` y `docker compose up -d`. |
| El navegador avisa de certificado no válido | El DNS aún no apunta al servidor o los puertos 80/443 están cerrados | Comprueba el registro DNS y el cortafuegos; mira `docker compose logs caddy`. |
| La app queda *unhealthy* y `/api/health` dice `low_disk_space` | Disco casi lleno | Libera espacio (`docker system prune` borra imágenes viejas) o amplía el disco. |
| `/api/health` dice `uploads_not_writable` | El volumen de subidas no se puede escribir | `docker compose restart app` (el arranque corrige el propietario); revisa el disco. |
| `/api/health` dice `database` | PostgreSQL parado o contraseña distinta | `docker compose ps`; si cambiaste `POSTGRES_PASSWORD` después de la primera instalación, vuelve a la original (la base ya se creó con ella). |
| La app se reinicia sola a menudo | Falta de memoria o un error | `docker compose logs app` y *Administración → Logs*; sube `APP_MEM_LIMIT`/`APP_HEAP_MB` si hay RAM. |
| Las fechas salen con otra hora | `APP_TIMEZONE` no es la tuya | Cámbiala en `.env` y `docker compose up -d`. |
| El login no mantiene la sesión | `APP_URL` con `https://` pero se entra por `http://` | Entra por la URL de `APP_URL`. |
| No llegan emails | SMTP sin configurar o credenciales erróneas | Revisa `SMTP_*` y *Administración → Logs* (`[notify]`). |
