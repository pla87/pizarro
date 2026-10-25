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

### 3.4 Arquitecturas

La imagen se construye para la arquitectura del propio servidor (amd64 o arm64, p. ej. Raspberry Pi 5). Para preparar una imagen de las dos a la vez desde otra máquina: `docker buildx build --platform linux/amd64,linux/arm64 -t <registro>/pizarro:<versión> --push ..` y pon ese nombre en `PIZARRO_IMAGE`.

## 4. Copias de seguridad

- **Automáticas:** con `BACKUP_KEY`, cada día se guarda una copia cifrada de la base de datos en el volumen de subidas (`backups/`), se conservan 14 diarias y 6 mensuales y cada mes se prueba la última. Estado en *Administración → Copias de seguridad*.
- **Los adjuntos no van en esa copia** y la copia vive en el mismo disco. Copia de vez en cuando las dos cosas **fuera del servidor**:

```bash
cd /opt/pizarro/deploy
# Base de datos (formato de pg_dump)
docker compose exec -T postgres pg_dump -U pizarro -Fc pizarro > pizarro-$(date +%F).dump
# Adjuntos y copias automáticas (volumen «pizarro_uploads»)
docker run --rm -v pizarro_uploads:/data:ro -v "$PWD":/backup alpine tar czf /backup/uploads-$(date +%F).tgz -C /data .
```

Guarda los dos ficheros (y `.env`) en otro sitio: otro servidor, un disco externo o un almacenamiento en la nube.

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

### 6.3 Desde una copia automática cifrada (`.pzbak`)

La base de datos tiene que estar **vacía y en la misma migración** que la copia (el `.json` que la acompaña indica `migration` y `build`; `build` empieza por la versión de Pizarro). Con la misma versión de Pizarro que hizo la copia:

```bash
cd /opt/pizarro/deploy
docker compose stop app
docker compose exec -T postgres dropdb -U pizarro pizarro
docker compose exec -T postgres createdb -U pizarro pizarro
# Solo migraciones (sin arrancar la app, que crearía el administrador inicial):
docker compose run --rm --no-deps app sh -c "cd migrator && ./node_modules/.bin/prisma migrate deploy"
# Restaurar (BACKUP_KEY se toma de .env):
docker compose run --rm --no-deps app node dist/restore-backup.mjs /app/uploads/backups/pizarro-backup-AAAAMMDDTHHMMSSZ.pzbak
docker compose up -d
```

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
