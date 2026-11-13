# Instalar Pizarro en tu propio servidor

> **¿Buscas la guía paso a paso?** Está en la web, más sencilla y en español e inglés: <https://getpizarro.com/instalar/> (English: <https://getpizarro.com/en/install/>). Este documento es la referencia técnica completa.

Esta guía instala Pizarro en un servidor propio (un VPS, un miniordenador en la oficina…) con **Docker Compose**: tres contenedores, **Caddy** (HTTPS automático), **Pizarro** y **PostgreSQL 16**. Todo vive en la carpeta `deploy/` del repositorio y no cambia nada del despliegue en Railway.

> Pizarro está pensado para **un solo proceso** (una réplica). Las tareas de fondo se turnan con un bloqueo en la base de datos, así que un solapamiento breve durante una actualización no duplica nada, pero no lo escales a varias réplicas.

## Instalación en un paso

Dos caminos. Elige uno; los dos acaban en el mismo asistente `/setup`.

| | Railway (nube) | Servidor propio (un comando) |
|---|---|---|
| Para quién | Sin servidor ni Linux a mano | Tienes un VPS o un equipo Linux |
| Tiempo | 5–10 minutos | Unos minutos (descarga la imagen ya construida; solo con `--build` se compila en el servidor) |
| Necesitas | Cuenta de Railway | Linux x86_64 o arm64, 1 GB de RAM (2 GB solo si construyes con `--build`), puertos 80/443 y un dominio con DNS ya apuntando al servidor (o red local sin dominio) |
| Obtienes | Pizarro + PostgreSQL + volumen de adjuntos, con HTTPS | Pizarro + PostgreSQL 16 + Caddy (HTTPS automático) en Docker Compose |

### Servidor propio con un comando

En el servidor, como root (o con `sudo` disponible):

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --domain pizarro.example.com
```

Opciones: `--local` (solo red local, por HTTP y sin dominio), `--dir /opt/pizarro` (carpeta; por defecto esa), `--version X.Y.Z` (instala esa versión; sin ella, la última publicada), `--ref <rama|tag>` (código de una rama o etiqueta; una rama se construye en el servidor), `--build` (construye la imagen en el servidor en vez de descargarla, ver «Construir la imagen en tu servidor»), `--no-start`, `--yes` (instala Docker sin preguntar) y `--help`. Sin `--domain` ni `--local`, el script los pregunta.

El script:

1. Comprueba Linux (x86_64 o arm64) y que eres root o tienes `sudo`.
2. Comprueba Docker y el plugin `docker compose`. Si faltan, **te pregunta** si los instala con el script oficial de `get.docker.com` (con `--yes` no pregunta). Si dices que no, se detiene.
3. Averigua la última versión publicada (o usa la que pidas con `--version`), descarga el código de esa etiqueta de GitHub (sin necesitar `git`), comprueba que está completo y lo deja en la carpeta de instalación. Muestra la versión que va a instalar. Si no puede saber cuál es la última (sin red, límite de GitHub o todavía no hay ninguna publicada), **no construye `main` a escondidas**: en una instalación nueva se detiene y sugiere `--build` o `--ref main`, y en una ya existente la deja intacta y sugiere `--version X.Y.Z` o reintentar más tarde.
4. Ejecuta `deploy/install.sh`: descarga la **imagen ya construida** (ver «La imagen ya construida»), crea `deploy/.env` con secretos aleatorios, arranca los contenedores, espera a que la app esté sana y muestra la dirección, el código de `/setup` y el kit de recuperación.

Repetir el mismo comando **actualiza** Pizarro a la última versión (sección 5): prepara el código nuevo aparte y lo cambia de golpe (si se interrumpe, la instalación anterior sigue intacta), y conserva `deploy/.env`, `deploy/recovery-kit.txt` y los datos (que viven en volúmenes de Docker, fuera de la carpeta). Si al actualizar pasas un `--domain` (o `--local`) distinto del que ya está en `deploy/.env`, el script avisa y mantiene el actual; para cambiarlo, edita `DOMAIN` y `APP_URL` en `deploy/.env` y ejecuta `docker compose up -d` en `deploy/`. Haz antes una copia (sección 4). Si prefieres revisar el script antes de ejecutarlo, descárgalo con `curl -fsSLO <url>`, léelo y lánzalo con `sh get.sh --domain …`.

### La imagen ya construida

Cada versión de Pizarro se publica como una **imagen Docker ya construida** en GitHub (`ghcr.io/pla87/pizarro:X.Y.Z`, y `latest` para la última). Una imagen es el programa empaquetado y listo para arrancar, con todo lo que necesita dentro. Antes, cada servidor tenía que fabricarla desde el código; ahora la descarga hecha. Eso da cuatro ventajas:

- **Instalar y actualizar es más rápido:** son unos minutos de descarga en lugar de una compilación larga. No hay que construir nada en el servidor del cliente.
- **Hace falta menos máquina:** compilar la aplicación consume bastante memoria y procesador. Ya no se necesita ese pico: basta con lo que gasta Pizarro funcionando.
- **Es exactamente lo que se probó:** todos los servidores ejecutan el mismo paquete, construido una sola vez con las comprobaciones pasadas, y no una compilación distinta en cada máquina.
- **Volver atrás es rápido:** las versiones anteriores siguen publicadas; volver a una es cambiar el número de versión (sección 5), sin recompilar. Ojo: las migraciones de la base de datos solo avanzan, así que si la versión nueva ya migró los datos, volver atrás puede exigir restaurar antes una copia de seguridad.

La imagen funciona en servidores normales (amd64) y en arm64 (p. ej. Raspberry Pi 5). Pizarro en Railway no la usa (ver sección 5).

> **Para quien publica el repositorio (mantenedor):** tras la primera release, el paquete `ghcr.io/pla87/pizarro` nace **privado** en GitHub. Hay que hacerlo público una vez (en GitHub: perfil u organización → *Packages* → `pizarro` → *Package settings* → *Change visibility* → *Public*); mientras no lo sea, ninguna instalación puede descargar la imagen (`docker compose pull` falla con «unauthorized» o «denied»).

#### Construir la imagen en tu servidor

Si prefieres construirla tú (o has modificado el código, o no hay salida a GitHub), añade `deploy/compose.build.yml`:

```bash
cd /opt/pizarro/deploy
./install.sh --build                                          # o, desde cero: get.sh … --build
docker compose up -d --build                                  # las veces siguientes
```

`--build` apunta `COMPOSE_FILE="compose.yml:compose.build.yml"` en `deploy/.env`, así que `docker compose` usa ese fichero adicional sin que lo repitas. Necesita unos 2 GB de RAM libres y varios minutos. Para volver a la imagen publicada: `./install.sh --unpin` (quita esa línea).

### Railway

El repositorio ya trae `railway.json` (builder Dockerfile, comando de arranque, healthcheck en `/api/health`, una réplica). Hay dos formas:

**A. Con la plantilla publicada** (cuando exista el enlace «Deploy on Railway» de la plantilla de Pizarro): pulsa el botón, acepta las variables propuestas, espera al despliegue y sigue en «Primeros pasos». Los secretos se generan solos.

**B. A mano** (la guía completa está en el README, «Guía de despliegue en Railway»):

1. *New Project → Deploy PostgreSQL* (servicio `Postgres`).
2. *+ New → GitHub Repo*: el repositorio de Pizarro (o tu fork). Railway usa el `Dockerfile` y el `railway.json`. En *Settings → Source → Branch* elige **`stable`**: solo avanza al publicarse una versión, así que Railway no redespliega con cada commit de `main` (detalle y cómo cambiar una instalación que ya usa `main`: README, «Guía de despliegue en Railway», paso 2). Con un fork, `stable` no se actualiza sola: tienes que sincronizarla tú desde el original (y la app no ofrecerá *Informar de un error*, porque no puede saber si el código está modificado).
3. Variables del servicio de la app:

   | Variable | Valor | Origen |
   |---|---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Referencia al servicio Postgres (nombre exacto de tu servicio) |
   | `SESSION_SECRET` | 48+ caracteres | **Generar:** `openssl rand -base64 48` |
   | `TOKEN_SECRET` | 48+ caracteres | **Generar** (recomendada; otra distinta) |
   | `ENCRYPTION_KEY` | 48+ caracteres | **Generar** (recomendada; otra distinta) |
   | `BACKUP_KEY` | 32 bytes en base64 | **Generar:** `openssl rand -base64 32` (activa las copias diarias cifradas) |
   | `APP_URL` | `https://<tu-dominio>` | **Debes ponerla:** *Settings → Networking → Generate Domain* o tu dominio propio |
   | `UPLOAD_DIR` | `/app/uploads` | Fija |

   No definas `SEED_ADMIN_*`: así el primer administrador se crea en `/setup` con un código de un solo uso, que aparece en los logs del despliegue (`introduce el código:`). `PORT` lo inyecta Railway.
4. Volumen: clic derecho en el servicio → *Attach Volume* → *Mount path* `/app/uploads`. Sin él, los adjuntos y las copias locales se pierden en cada despliegue.
5. *Settings → Networking → Generate Domain* si aún no lo hiciste, ajusta `APP_URL` y pulsa *Deploy*. El healthcheck es `/api/health` (ya en `railway.json`; el primer arranque aplica migraciones, por eso el margen de 120 s).

Guarda `SESSION_SECRET`, `TOKEN_SECRET`, `ENCRYPTION_KEY` y `BACKUP_KEY` fuera de Railway (gestor de contraseñas): sin `BACKUP_KEY` las copias no se pueden leer y sin `ENCRYPTION_KEY` todos pierden la verificación en dos pasos.

#### Publicar la plantilla de Railway (solo el propietario del proyecto)

Una plantilla se crea desde la cuenta de Railway del propietario; no se puede hacer desde el repositorio.

1. En Railway crea un proyecto limpio con los dos servicios de arriba (Postgres + el repositorio) **ya funcionando**, con el volumen en `/app/uploads`.
2. Abre *Workspace Settings → Templates* (o `railway.com/new/template`) y pulsa **Create template**. Elige *Generate from existing project* y selecciona ese proyecto.
3. Revisa cada servicio. En el servicio de Pizarro, en *Variables*, pon estos valores por defecto (la plantilla los resuelve al desplegar):

   ```env
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   SESSION_SECRET=${{secret(48)}}
   TOKEN_SECRET=${{secret(48)}}
   ENCRYPTION_KEY=${{secret(48)}}
   BACKUP_KEY=${{secret(64, "0123456789abcdef")}}
   APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
   UPLOAD_DIR=/app/uploads
   ```

   `secret(longitud)` y `secret(longitud, "alfabeto")` son las funciones de plantilla de Railway; `BACKUP_KEY` en hexadecimal (64 caracteres = 32 bytes) también vale para la app. `${{RAILWAY_PUBLIC_DOMAIN}}` es la variable que Railway rellena cuando el servicio tiene un dominio generado: activa *Generate Domain* en la plantilla. **Esta sintaxis está escrita de memoria: verifícala en la documentación de plantillas de Railway y haz un despliegue de prueba antes de publicar** (si `APP_URL` quedara mal, es lo único que habría que corregir a mano).
4. En el servicio de Pizarro configura el volumen (`/app/uploads`) y la descripción de cada variable (por ejemplo: «No la cambies después: invalida sesiones»).
5. En el servicio de Pizarro, la fuente debe ser el repositorio oficial con la rama **`stable`** (*Settings → Source → Branch* en el proyecto de origen antes de generar la plantilla). Comprueba en el despliegue de prueba (punto 7) que el servicio creado sigue `stable` y no `main`; si la plantilla no conserva la rama, indícalo en su descripción («tras desplegar: Settings → Source → Branch → stable»).
6. Pulsa *Create template* y copia el enlace. Pon el botón «Deploy on Railway» en el README apuntando a ese enlace.
7. Prueba la plantilla en un proyecto nuevo de una cuenta limpia: comprueba que arranca, que `/setup` pide el código del log, que `APP_URL` es correcta y que la rama es `stable`.

### Primeros pasos tras instalar

1. **Asistente `/setup`:** abre `<tu dirección>/setup`, escribe el código (en el resumen del instalador o en los logs del despliegue), elige organización, idioma y zona horaria y crea el primer administrador. Después activa la verificación en dos pasos (obligatoria para administradores). Detalle en 2.3.
2. **Email:** *Administración → Ajustes → Avisos por email*. Sin él no hay invitaciones ni «¿Olvidaste tu contraseña?». Detalle y proveedores en 3.6.
3. **Entrar con Google (opcional):** *Administración → Ajustes → Acceso con Google*; la guía desplegable te lleva paso a paso por Google Cloud con las direcciones listas para copiar. Resumen en 3.6, punto 2.
4. **Copias de seguridad:** con `BACKUP_KEY` definida se hacen copias diarias cifradas dentro del servidor; añade un destino **externo** (S3 compatible o carpeta montada, sección 4.1 y 4.2) y guarda el kit de recuperación fuera del servidor.
5. **Invita al equipo** desde *Administración → Usuarios*.

---

## 1. Requisitos

| | Mínimo |
|---|---|
| CPU | 1 vCPU (amd64 o arm64) |
| Memoria | **1 GB de RAM** basta con la imagen publicada (la opción por defecto). Solo si construyes la imagen en el servidor (`--build`) hacen falta 2 GB (o 1 GB con swap, más lento) |
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
git clone https://github.com/pla87/pizarro.git /opt/pizarro
cd /opt/pizarro/deploy
```

### 2.2 Ejecutar el instalador

```bash
./install.sh                                # pregunta el dominio (o el modo red local)
./install.sh --domain pizarro.example.com   # sin preguntas
./install.sh --local                        # solo red local, por HTTP (ver 3.3)
./install.sh --version 1.38.0               # fija esa versión de la imagen (ver sección 5)
./install.sh --build                        # construye la imagen aquí en vez de descargarla
```

El script se puede repetir sin riesgo. Hace esto:

1. Comprueba que están Docker 24+ y el plugin `docker compose`.
2. Pregunta el dominio (o la dirección, en modo local) y crea `deploy/.env` con `DOMAIN` y `APP_URL`.
3. Genera `POSTGRES_PASSWORD`, `SESSION_SECRET` y `BACKUP_KEY` con aleatorios fuertes (`openssl rand`, o `/dev/urandom` si no hay `openssl`). **Nunca pisa un secreto que ya existe** en el `.env`.
4. Escribe el **kit de recuperación** `deploy/recovery-kit.txt` (permisos 600) con esos tres secretos y qué hacer si se pierde el servidor.
5. Descarga la imagen publicada (`docker compose pull app`), ejecuta `docker compose up -d` y espera a que la app esté sana. Con `--build` construye la imagen en el servidor en su lugar.
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

Después arranca con `docker compose up -d` (descarga la imagen publicada) y sigue el log con `docker compose logs -f app` (Ctrl+C para salir). `docker compose ps` debe mostrar los tres servicios `healthy` / `running`. Caddy pide el certificado HTTPS en cuanto el dominio resuelve al servidor.

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

Configura el email para tener invitaciones y «¿Olvidaste tu contraseña?»: desde *Administración → Ajustes → Avisos por email* (sin tocar el servidor) o con `SMTP_*` en `.env` (sección 3.6).

### 2.4 Administrador inicial por variables (alternativa)

Para instalaciones automatizadas puedes saltarte el asistente definiendo `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` y, opcionalmente, `SEED_ADMIN_NAME` en `.env`. Si la base de datos no tiene usuarios, el administrador se crea al arrancar y `/setup` queda desactivado (es lo que usa Railway). Entra con esos datos, configura la verificación en dos pasos, cambia la contraseña y borra `SEED_ADMIN_PASSWORD` del `.env`.

## 3. Configuración

### 3.1 Cambiar variables

Edita `.env` y ejecuta `docker compose up -d`: Compose recrea solo los contenedores afectados. No hace falta reconstruir la imagen para ninguna variable (tampoco para la zona horaria ni para el tamaño máximo de los adjuntos).

### 3.2 Memoria

Los límites por defecto están pensados para 2 GB: app 1 GB (montón de Node 640 MB), PostgreSQL 512 MB y Caddy 128 MB. Si un proceso supera su límite, Docker lo reinicia en lugar de dejar sin memoria al servidor. Con más RAM puedes subir `APP_MEM_LIMIT` y `APP_HEAP_MB` (deja `APP_HEAP_MB` en torno al 60–70 % de `APP_MEM_LIMIT`).

### 3.3 Solo red local (sin dominio)

En `.env`: `DOMAIN=":80"` y `APP_URL="http://<ip-del-servidor>"`. Caddy sirve solo HTTP y la cookie de sesión no se marca *Secure*. No lo expongas así a Internet.

Por HTTP sin TLS el navegador habla HTTP/1.1 y abre como mucho 6 conexiones a la vez con el mismo servidor, compartidas por todas las pestañas. Cada tablero a la vista mantiene una abierta para los cambios en vivo; las pestañas ocultas cierran la suya y la vuelven a abrir al mostrarse (si hubo cambios mientras tanto, el tablero se pone al día solo). Aun así, con muchas ventanas de Pizarro a la vista a la vez (no pestañas: ventanas visibles) puede tardar en cargar o guardar. Con HTTPS (un dominio, o un certificado propio en Caddy) el navegador usa HTTP/2, que lleva todo por una sola conexión, y ese límite desaparece: si en tu red se usa mucho Pizarro en varias ventanas, es la opción recomendada.

> **Importante:** en Docker la aplicación se fía de la cabecera `X-Real-IP` para saber la IP del cliente (límites de intentos, registro de actividad), porque el Caddy incluido la sobrescribe siempre. Por eso el puerto 3000 de Pizarro nunca debe quedar expuesto directamente: solo a través del Caddy incluido (o de otro proxy que sobrescriba `X-Real-IP`). Si aun así lo publicas sin proxy, pon `TRUST_PROXY=0` en `.env`: entonces se usa la dirección de la conexión y nadie puede falsear su IP. Con `npm start` es al revés: por defecto no se fía de esas cabeceras, y si pones tu propio proxy delante, define `TRUST_PROXY=1`.

### 3.4 Arquitecturas

La imagen publicada incluye **amd64 y arm64** (servidores normales y, por ejemplo, una Raspberry Pi 5): Docker descarga la que corresponde a tu máquina. Para preparar tu propia imagen de las dos a la vez desde otra máquina: `docker buildx build --platform linux/amd64,linux/arm64 -t <registro>/pizarro:<versión> --push ..` y pon ese nombre en `PIZARRO_IMAGE`.

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

### 3.6 Email y Google desde Administración → Ajustes

Dos cosas distintas, configurables desde Pizarro (como administrador) sin editar `.env`. Si defines las variables en el servidor, mandan sobre lo guardado en Ajustes y la pantalla se muestra de solo lectura. Los secretos se guardan cifrados con `ENCRYPTION_KEY` y entran en la rotación de claves y en las copias; no se muestran de nuevo ni aparecen en el registro ni en el diagnóstico.

**1. Avisos por email** (invitaciones, recuperar contraseña, avisos e informes). Dos opciones:

- *Gmail de un administrador (uso familiar):* activa la verificación en dos pasos en esa cuenta de Google, crea una contraseña de aplicación en `myaccount.google.com/apppasswords` y pégala en Pizarro junto con la dirección de Gmail (usa `smtp.gmail.com`, puerto 465, SSL/TLS).
- *Servicio de correo de la empresa:* elige el proveedor y Pizarro rellena servidor, puerto y conexión; tú pones usuario y contraseña (cada preajuste explica cuáles). Disponibles: Google Workspace (buzón con contraseña de aplicación en `smtp.gmail.com:465`, o relay en `smtp-relay.gmail.com:587`), Brevo, Mailchimp Transactional (Mandrill), SendGrid (usuario `apikey`), Amazon SES (cambia la región), Mailgun y Outlook/Microsoft 365 (`smtp.office365.com:587`).

El botón *Enviar email de prueba* manda un mensaje a tu dirección. Equivalente por variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM`. Si cambias el servidor, el puerto o el usuario, hay que escribir la contraseña de nuevo.

**2. Acceso con Google** (entrar con «Iniciar sesión con Google» las personas que ya existen en Pizarro con el mismo email; también conecta Docs y Sheets). No envía emails. Necesita `APP_URL` en `.env` (la dirección pública, con `https://`). Antes de empezar decide con qué dirección van a entrar tus usuarios (la del servidor o un dominio propio): ver 3.7, «Paso 0». Ajustes muestra arriba la «Dirección pública de Pizarro» (`APP_URL`) y avisa si estás entrando por otra distinta. En *Ajustes → Acceso con Google* hay una guía desplegable, un paso por pantalla de Google Cloud, con las direcciones y el dominio listos para copiar. Resumen (Google Cloud usa ahora la interfaz «Google Auth Platform»: Overview, Branding, Audience, Clients, Data Access, Verification Center y Settings):

1. **Proyecto.** En `console.cloud.google.com` crea o elige un proyecto (gratis, sin facturación) y abre *Google Auth Platform* (*Get started* la primera vez).
2. **Branding.** Nombre de la aplicación («Pizarro»); email de asistencia; logotipo (opcional: déjalo vacío si la app es «Externa» y está en producción, porque subir un logotipo obliga a que Google la verifique; en `/pizarro-logo-120.png` hay un PNG de 120×120 de Pizarro); *Application home page* = `APP_URL`; *Privacy policy link* = `APP_URL/privacy` y *Terms of service link* = `APP_URL/terms` (páginas públicas de Pizarro; el email de contacto que muestran se pone en *Ajustes → Acceso con Google → Email de contacto público*); *Authorized domains* = el dominio principal de `APP_URL` sin subdominios (Ajustes lo calcula y lo muestra); email de contacto del desarrollador. Si `APP_URL` es un subdominio de un alojamiento compartido (`*.up.railway.app`, `*.vercel.app`…), ese servicio está en la lista de sufijos públicos y Google suele aceptar la dirección completa como dominio autorizado (Ajustes la muestra); si la rechaza, o para mostrar tu marca, usa un dominio propio. Con `localhost` o una IP no funciona.
3. **Audience.** «Interno» (solo tu organización de Google Workspace) o «Externo» (cualquier cuenta, incluido Gmail). Un «Externo» en *Testing* admite solo los *Test users* que añadas (máximo 100) y los permisos de Drive caducan a los 7 días; en *In production* (*Publish app*) entra cualquiera y los permisos básicos no necesitan verificación.
4. **Data Access.** Permisos: `openid`, `email` y `profile` para entrar (no sensibles); `https://www.googleapis.com/auth/drive.file` para crear Docs y Sheets (solo los archivos que crea la propia Pizarro). En una app «Externa» publicada, Google puede pedir verificación por el permiso de Drive; si no la quieres, deja la app en *Testing* o no uses Docs ni Sheets.
5. **Clients.** *Create client* → *Web application* → un nombre → *Authorized redirect URIs*: `APP_URL/api/auth/google/callback` y `APP_URL/api/google/callback` (exactas: `https`, sin barra final) → *Create* → copia el *Client ID* y el *Client secret*.
6. **En Pizarro.** Pega el ID y el secreto, guarda y el estado pasa a «Activo». Prueba cerrando sesión y entrando con «Iniciar sesión con Google» con un email que ya exista en Pizarro. Opcional: «Dominio de Workspace permitido» (vacío = cualquier cuenta de Google, incluido Gmail).

Si falla: `redirect_uri_mismatch` (la URI no es idéntica: `https`, sin barra final), `access_blocked` o «app no verificada» (la app está en *Testing* y esa cuenta no está en *Test users*, o pide permisos sensibles sin verificar), «No hay ninguna cuenta con ese email» (crea antes el usuario en Pizarro) o el aviso de dominio (hay un «Dominio de Workspace permitido» distinto del de esa cuenta).

Equivalente por variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_WORKSPACE_DOMAIN`. Los cambios guardados en Ajustes se aplican en segundos, sin reiniciar.

### 3.7 Dominio propio o dirección del servidor

**Paso 0 · ¿Dominio propio o la dirección del servidor?** (es también el «Paso 0» de la guía en *Ajustes → Acceso con Google*). La dirección que elijas es `APP_URL`, y de ella salen todos los valores que hay que dar de alta en Google: página principal, enlaces de privacidad (`/privacy`) y condiciones (`/terms`), dominio autorizado y URI de redirección.

- **La dirección del servidor** (por ejemplo `*.up.railway.app` en Railway, o la IP en una red local): funciona sin comprar nada. Google suele aceptar la dirección completa como dominio autorizado (con `localhost` o una IP no funciona). Se ve menos profesional y, si luego cambias a un dominio propio, hay que actualizar Google (ver «Cambiar de una opción a otra»).
- **Un dominio propio** (`pizarro.example.com`), recomendado para clientes. Pasos: añadir el dominio en el alojamiento, crear el registro DNS, esperar al HTTPS, poner `APP_URL` y redesplegar, y después hacer los pasos de Google con los valores nuevos. El dominio autorizado de Google es el dominio registrable (`example.com`), sin subdominios.
  - En **Railway**: ver «Dominio propio en Railway» (abajo).
  - Con **Docker Compose**: crea un registro DNS `A` (y `AAAA` si hay IPv6) de `pizarro.example.com` hacia la IP del servidor, con los puertos 80 y 443 abiertos. En `deploy/.env` pon `DOMAIN="pizarro.example.com"` y `APP_URL="https://pizarro.example.com"` (el instalador `./install.sh --domain pizarro.example.com` lo escribe por ti; Caddy usa `DOMAIN` y pide el certificado de Let's Encrypt solo en cuanto el DNS resuelve). Después `docker compose up -d` (se recrean los contenedores con los valores nuevos).

**Cambiar de una opción a otra más adelante** (por ejemplo de `*.up.railway.app` a un dominio propio), sin cortar el acceso con Google:

1. Pon `APP_URL` en la dirección nueva y redespliega (Railway: *Variables* → *Redeploy*; Docker Compose: `deploy/.env` y `docker compose up -d`).
2. Entra por la dirección nueva en *Administración → Ajustes → Acceso con Google*: arriba verás la «Dirección pública de Pizarro» y las direcciones de redirección ya calculadas. Si entras por una dirección distinta de `APP_URL`, un aviso lo indica y se muestran las URI de las dos (la de `APP_URL` y la que usas) para poder dar de alta ambas durante el cambio.
3. En Google Cloud **añade** las URI de redirección nuevas sin quitar las antiguas (Google admite varias a la vez), y cambia la página principal, los enlaces de privacidad y condiciones y los dominios autorizados.
4. Comprueba que «Iniciar sesión con Google» funciona con la dirección nueva y entonces quita las URI antiguas.
5. Avisa a tu gente: tienen que iniciar sesión otra vez, y quien instaló Pizarro como aplicación debe desinstalarla e instalarla de nuevo desde la dirección nueva.

#### Dominio propio en Railway

Para servir Pizarro en `pizarro.example.com` (sustituye `example.com` por tu dominio) en lugar de la dirección `*.up.railway.app`:

1. **Añadir el dominio en Railway.** Servicio de Pizarro → *Settings* → *Networking* → *Custom Domain* → escribe `pizarro.example.com` y confirma.
2. **Crear los registros DNS.** Railway muestra un registro `CNAME` (nombre `pizarro`, valor algo como `xxxx.up.railway.app`) y, si lo pide, un registro `TXT` de verificación. Créalos en el panel de tu proveedor de DNS tal cual se muestran (si el proveedor añade solo el dominio, escribe únicamente `pizarro` como nombre). Si usas Cloudflare, déjalos sin proxy (nube gris) hasta que el certificado esté emitido.
3. **Esperar al certificado.** Railway lo emite solo (Let's Encrypt) cuando el DNS propaga; puede tardar de unos minutos a unas horas. El dominio pasa a *Active* en el panel.
4. **Cambiar `APP_URL`.** En *Variables* del servicio pon `APP_URL=https://pizarro.example.com` (con `https://` y sin barra final) y vuelve a desplegar (*Redeploy*). Las variables se leen al arrancar.

Qué cambia:

- **Las sesiones de la dirección antigua terminan.** Las cookies son de cada dirección: en el dominio nuevo todo el mundo tiene que iniciar sesión otra vez. La dirección antigua sigue funcionando con sus propias cookies, salvo que actives la redirección opcional (más abajo).
- **Google.** Si usas el acceso con Google o Docs/Sheets, en Google Cloud (*Google Auth Platform*) actualiza: las URI de redirección autorizadas del cliente (`https://pizarro.example.com/api/auth/google/callback` y `https://pizarro.example.com/api/google/callback`), la *Application home page*, los enlaces de privacidad (`https://pizarro.example.com/privacy`) y condiciones (`https://pizarro.example.com/terms`) y el dominio autorizado (`example.com`, sin subdominios). *Administración → Ajustes → Acceso con Google* muestra las direcciones ya calculadas a partir de `APP_URL`. Mientras no lo hagas, entrar con Google fallará con `redirect_uri_mismatch`.
- **Emails.** Los enlaces de los emails (invitaciones, recuperar contraseña, avisos) se construyen con `APP_URL`; los enviados antes del cambio siguen apuntando a la dirección antigua.
- **PWA.** Si alguien instaló Pizarro como aplicación (móvil o escritorio), esa instalación queda ligada a la dirección antigua: que la desinstale y la instale otra vez desde el dominio nuevo.
- **Integraciones.** Cualquier servicio externo que llame a Pizarro (webhooks, calendarios suscritos por URL) debe usar la dirección nueva.

**Redirección opcional.** Pizarro no obliga a usar el host de `APP_URL`: responde en cualquier dirección que llegue al servicio. Para que quien entre por la dirección antigua pase automáticamente a la nueva, define `CANONICAL_REDIRECT=1` (y redespliega). Las peticiones de páginas (GET/HEAD) a un host distinto del de `APP_URL` reciben una redirección 308 al mismo camino y consulta en `APP_URL`; no se tocan `/api/*` (comprobaciones de salud, callbacks de Google), las peticiones internas (`localhost`) ni las que no son GET. Si `APP_URL` está mal escrita se redirige a una dirección inexistente: compruébala antes de activarlo y quítalo (o corrige `APP_URL`) si te quedas sin acceso.

**Presentación en la raíz (`LANDING_AT_ROOT=1`).** Opcional: quien abre `/` sin sesión ve la página de presentación del producto (la dirección no cambia) en vez de ir al acceso; con sesión, todo sigue igual. La presentación también está siempre en `/presentacion`. Mientras la instalación no tenga usuarios, `/` lleva igualmente al asistente `/setup`; si alguna vez no lo hiciera, abre `/setup` directamente. Se define en `deploy/.env` (o en las variables de Railway) y se aplica con `docker compose up -d`.

### 3.8 Dónde se guardan los ficheros y cuánto pueden ocupar

Los adjuntos, sus miniaturas, las copias de adjuntos de las releases, la documentación, las exportaciones y las copias de seguridad locales viven en la carpeta `UPLOAD_DIR` (por defecto `/app/uploads` en la imagen; en Railway, el volumen montado en esa ruta; en Docker Compose, el volumen `pizarro_uploads`). La base de datos solo guarda sus nombres y tamaños.

- **Tamaño del disco.** En Railway el volumen se puede ampliar desde el propio volumen (*Settings → Size*); no hace falta redesplegar. En un servidor propio, ampliando el disco o el volumen de Docker.
- **Cuotas.** Cada proyecto tiene una cuota de almacenamiento (adjuntos, copias en releases y documentación, papelera incluida): **10 GB por defecto**. Se cambia en *Administración → Ajustes → Almacenamiento* (también la cuota total opcional del servidor y, para un proyecto concreto, en *Ajustes del proyecto → Adjuntos y límites*). Si defines `UPLOAD_QUOTA_MB_PER_PROJECT` o `UPLOAD_QUOTA_MB_TOTAL`, esas variables mandan sobre lo guardado en la aplicación. Orden: cuota propia del proyecto, variable de entorno, ajuste de Administración, 10 GB.
- **Ver y liberar espacio.** *Administración → Ajustes → Almacenamiento* muestra la carpeta, el espacio del disco, lo que ocupa cada categoría y los 10 proyectos que más pesan. En *Ajustes del proyecto → Adjuntos y límites* se pueden borrar los adjuntos de tareas archivadas, vaciar la papelera de documentación y quitar las copias de adjuntos de releases antiguas (suelen ser lo que más pesa, porque duplican los adjuntos de las tareas).
- Deja siempre margen en el volumen: las cuotas no incluyen miniaturas, copias de seguridad locales ni exportaciones.

## 4. Copias de seguridad

- **Automáticas:** con `BACKUP_KEY`, cada día se copian, cifrados, la base de datos y **todos los ficheros del volumen de subidas** (adjuntos, miniaturas, copias de releases, documentos) en su carpeta `backups/`. Los ficheros se guardan una sola vez y cada copia solo añade los nuevos. Se conservan 14 diarias, 6 mensuales y siempre las 3 más recientes, y cada mes se restaura la última en una base de datos temporal para comprobar que sirve. Estado en *Administración → Copias de seguridad*.
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
La carpeta tiene que existir: Pizarro no la crea (si falta, la subida queda *Con error*: «La carpeta del destino externo
no existe»), para no dejar las copias en el disco del sistema cuando el disco externo no está montado.

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

Antes de actualizar, haz una copia (sección 4). Las migraciones de la base de datos se aplican solas al arrancar la versión nueva, y tus datos y tu `deploy/.env` no se tocan.

**Servidor propio, la forma más sencilla:** repite el comando de instalación. Averigua la última versión publicada, descarga su código y su imagen, y conserva tu configuración y tus datos:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh
```

(No hace falta repetir `--domain`: se conserva el de `deploy/.env`.)

**Solo la imagen** (más rápido, si no necesitas cambios en `deploy/`; sigue la etiqueta `latest`):

```bash
cd /opt/pizarro/deploy
docker compose pull app
docker compose up -d
docker compose logs -f app
```

Esto solo funciona si no fijaste una versión (ver abajo): una instalación fijada con `PIZARRO_IMAGE` se queda en esa versión hasta que la cambies.

**Fijar una versión o volver a una anterior:**

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --version 1.37.0
```

Instala el código de la etiqueta `v1.37.0` y fija la imagen `ghcr.io/pla87/pizarro:1.37.0` (`PIZARRO_IMAGE` en `deploy/.env`). Las versiones publicadas están en <https://github.com/pla87/pizarro/releases>. Para volver a seguir siempre la última: repite el comando sin `--version`. Sirve igual para actualizar a una versión concreta (no solo para volver atrás). Si la versión nueva no arranca, puedes volver a la anterior así, pero las migraciones de la base de datos solo avanzan: si la versión nueva ya migró los datos, volver puede exigir restaurar antes la copia de seguridad (sección 6), porque una versión anterior puede no entender una base migrada por otra posterior. Por eso la copia previa a actualizar es imprescindible.

**Railway** sigue construyendo desde el repositorio de GitHub con su `Dockerfile` (no usa la imagen publicada). Despliega desde la rama **`stable`**: el workflow *Release* la mueve al commit de cada versión publicada, así que Railway se actualiza solo al publicarse una versión, nunca con commits sueltos de `main`. Para quedarte en una versión, desactiva el despliegue automático del servicio (o apúntalo a la etiqueta `vX.Y.Z` si tu Railway lo permite). Cambiar una instalación que hoy sigue `main`: README, «Guía de despliegue en Railway», paso 2.

**Qué recibe cada instalación.** Nadie recibe commits sueltos: `latest` de la imagen, `get.sh` (sin `--version`), la rama `stable` y el aviso de versión nueva siguen la última **release publicada**. Solo reciben `main` quienes lo piden expresamente (`--ref main`, `--build` sin versiones publicadas o Railway apuntado a `main`).

**Aviso de versión nueva.** Pizarro consulta a GitHub, como mucho cada 12 horas, cuál es la última release publicada. Si es más nueva que la que corre, los administradores ven un aviso discreto en Administración (y un punto junto a «Administración» en el menú) con enlaces a las novedades y a esta sección; se puede ocultar y no vuelve a salir hasta la siguiente versión. Es una petición a `api.github.com` cada 12 horas desde tu servidor: solo pide un dato público (la última versión) y no se envía nada de tu instalación, pero GitHub ve la dirección IP del servidor. Si no quieres esa conexión saliente, desactívalo (abajo). Sin conexión o con el límite de GitHub agotado no pasa nada: simplemente no hay aviso. Para desactivarlo, `UPDATE_CHECK=0` en `deploy/.env` (y `docker compose up -d`) o en las variables de Railway.

**Publicar una versión (mantenedores).** `npm run version:bump -- minor` registra la versión y, tras fusionar en `main`, `npm run release:tag` crea la etiqueta anotada `vX.Y.Z` en el commit actual (se niega si hay cambios sin confirmar o si la etiqueta ya existe) y `git push origin vX.Y.Z` la sube. Eso lanza `.github/workflows/release.yml`: construye la imagen para amd64 y arm64, la publica en GHCR como `X.Y.Z` y `latest`, crea la GitHub Release con el resumen y los cambios de esa versión tomados de `changelog.json` y mueve la rama `stable` a ese commit (solo versiones `X.Y.Z` sin sufijo, de commits que ya están en `main` y nunca hacia atrás; si `stable` está protegida en GitHub, permite que la mueva *GitHub Actions* o el dueño del token de abajo). Si la versión cambia algún fichero de `.github/workflows/`, GitHub no deja moverla con el token de Actions: crea una vez el secreto de Actions `STABLE_PUSH_TOKEN` con un token *fine-grained* solo de este repositorio y los permisos **Contents** y **Workflows** en lectura y escritura (pasos en `docs/HANDOFF.md`, «Cerrar una versión»). Pega en el secreto solo el valor del token, sin espacios ni saltos de línea. Sin él, el job «Rama stable» falla avisando de qué secreto falta, sin afectar a la imagen ni a la release ya publicadas. Antes de mover nada, el paso «Comprobar STABLE_PUSH_TOKEN» prueba el token (sin mostrarlo) y, si no vale, dice la causa probable: caducado o pendiente de aprobación, sin acceso a este repositorio (*Only select repositories*) o sin **Contents: Read and write**; la falta de **Workflows** se ve al mover («no tiene el permiso Workflows»). Tras arreglar el secreto, **Actions → Mover stable → Run workflow** (rama `main`) mueve `stable` a la última versión publicada sin publicar otra (con las mismas reglas; si ya está ahí, no hace nada). Detalle en `docs/HANDOFF.md`, «Cerrar una versión», puntos 6 a 8. Sin consola: en GitHub, **Actions → Release → Run workflow** (rama `main`) publica la versión de `package.json` y crea la etiqueta a la vez.

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
docker compose pull app
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

- **Elige la copia por su nombre** (con `--list`) en vez de `latest` si la app llegó a arrancar tras perder los datos: su primera copia automática (al minuto de arrancar) es de una instalación vacía y es la más reciente del volumen. Al destino externo no llega si es mucho menor que la última que hay allí (queda como error en *Administración → Copias de seguridad*), salvo que se pulse *Copiar ahora a destino externo*. Para que no se haga ninguna copia mientras restauras, pon `BACKUP_PAUSE=1` en `.env` antes de arrancar y quítala al terminar.
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
- **Informar de un error:** en una versión publicada sin modificar, *Historial de versiones → Informar de un error* abre el formulario de incidencias de GitHub con la versión, el commit, el tipo de instalación, el navegador y el idioma ya rellenos (nada de usuarios, proyectos, emails ni la dirección de la instalación). Hace falta una cuenta de GitHub y la incidencia es pública. Los administradores pueden añadir *Administración → Ajustes → Copiar información técnica* (versión, commit, Node, PostgreSQL, migraciones, funciones activas y los **nombres** de las variables definidas, nunca sus valores). Los fallos de seguridad van en privado: `SECURITY.md`.
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
| No tengo el código de `/setup` | Se imprime en el log al arrancar y caduca a las 24 h | `docker compose restart app` y `docker compose logs app \| grep "introduce el código"`; con `npm start`, sale en la terminal (reinicia para uno nuevo); o define `SETUP_TOKEN` en `.env`. |
| `/setup` da 404 | Ya hay usuarios (la instalación está configurada) o se definió `SEED_ADMIN_*` | Entra en `/login`. Para empezar de cero hay que vaciar la base de datos. |
| `[start] ERROR: faltan variables de entorno: SESSION_SECRET(>=32)` | Secreto vacío o corto | `./install.sh` (genera los que falten) o `openssl rand -base64 48` y `docker compose up -d`. |
| El navegador avisa de certificado no válido | El DNS aún no apunta al servidor o los puertos 80/443 están cerrados | Comprueba el registro DNS y el cortafuegos; mira `docker compose logs caddy`. |
| La app queda *unhealthy* y `/api/health` dice `low_disk_space` | Disco casi lleno | Libera espacio (`docker system prune` borra imágenes viejas) o amplía el disco. |
| `/api/health` dice `uploads_not_writable` | El volumen de subidas no se puede escribir | `docker compose restart app` (el arranque corrige el propietario); revisa el disco. |
| `/api/health` dice `database` | PostgreSQL parado o contraseña distinta | `docker compose ps`; si cambiaste `POSTGRES_PASSWORD` después de la primera instalación, vuelve a la original (la base ya se creó con ella). |
| La app se reinicia sola a menudo | Falta de memoria o un error | `docker compose logs app` y *Administración → Logs*; sube `APP_MEM_LIMIT`/`APP_HEAP_MB` si hay RAM. |
| Las fechas salen con otra hora | La zona elegida en el asistente o `APP_TIMEZONE` no es la tuya | Define `APP_TIMEZONE` en `.env` y `docker compose up -d` (manda sobre la del asistente). |
| El login no mantiene la sesión | `APP_URL` con `https://` pero se entra por `http://` | Entra por la URL de `APP_URL`. |
| En red local por HTTP, con muchas ventanas de Pizarro abiertas, las páginas tardan en cargar o no guardan | Límite de 6 conexiones por servidor de HTTP/1.1 (ver 3.3) | Cierra o minimiza ventanas que no uses, o sirve Pizarro por HTTPS (HTTP/2). |
| No llegan emails | Email sin configurar o credenciales erróneas | Revisa *Administración → Ajustes → Avisos por email* (o `SMTP_*`) y *Administración → Logs* (`[notify]`). |
