---
titulo: Instalar Pizarro
descripcion: Paso a paso y sin ser experto, en tu propio servidor con un solo comando o en Railway sin servidor propio.
---

<!--
Guía de instalación para usuarios: la web la publica en https://getpizarro.com/instalar/ (scripts/build-site.mjs).
Su versión en inglés es docs/web/en/install.md y las dos deben existir. Los identificadores fijos ({#…}) se enlazan
desde la portada, la app y las notas de cada versión: no los cambies. La referencia técnica es docs/INSTALL.md.
-->

# Instalar Pizarro

Pizarro se instala en un servidor tuyo y tus datos se quedan allí. Esta guía te lleva de cero a tu primer tablero: qué
necesitas, cómo instalarlo, los primeros pasos y cómo mantenerlo al día. Si algo no está aquí, la
[documentación técnica completa](../INSTALL.md) lo cuenta con todo detalle.

## Qué necesitas {#que-necesitas}

**Para instalarlo en tu propio servidor:**

- **Un servidor Linux** con procesador x86_64 o arm64: un VPS de cualquier proveedor, un miniordenador en la oficina o
  una Raspberry Pi 5.
- **1 GB de RAM**, 1 procesador y unos 10 GB de disco, más lo que ocupen tus archivos adjuntos.
- **Acceso por terminal** (SSH) como `root` o con un usuario que pueda usar `sudo`.
- **Docker.** Si no lo tienes, el instalador se ofrece a instalarlo por ti.
- **Un dominio o subdominio** (por ejemplo `pizarro.example.com`) que apunte a la IP del servidor, con los puertos 80
  y 443 abiertos. Si solo lo vas a usar en casa o en la oficina, también funciona en la red local, sin dominio.

**O, sin servidor propio:** una cuenta en [Railway](https://railway.com), un servicio en la nube que cobra según lo
que se usa, y otra en GitHub.

## Elige tu camino {#elige-tu-camino}

| | Servidor propio | Railway |
|---|---|---|
| **Ideal si** | Tienes un VPS o un equipo con Linux | No quieres mantener un servidor |
| **Cómo** | Un comando en la terminal | Unos clics en el panel de Railway |
| **Tiempo** | Unos minutos | Unos 15 minutos |
| **HTTPS** | Automático | Automático |
| **Coste** | El de tu servidor | Lo que cobre Railway cada mes |

Los dos caminos acaban igual: en el asistente que crea tu cuenta de administrador. Sigue con
[Servidor propio](#servidor-propio) o salta a [Railway](#railway).

## Instalar en tu servidor con un comando {#servidor-propio}

1. **Apunta tu dominio al servidor.** En el panel de tu proveedor de dominios, crea un registro DNS de tipo `A` para
   `pizarro.example.com` con la IP del servidor (y otro `AAAA` si tiene IPv6). Comprueba también que el cortafuegos
   deja pasar los puertos 80 y 443. Si vas a usar Pizarro solo en la red local, sáltate este paso.

2. **Entra en el servidor** desde la terminal de tu ordenador:

   ```bash
   ssh root@203.0.113.10
   ```

   Cambia `203.0.113.10` por la IP de tu servidor (o `root` por tu usuario).

3. **Ejecuta el instalador.** Copia este comando, cambia `pizarro.example.com` por tu dominio y pégalo en la
   terminal:

   ```bash
   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --domain pizarro.example.com
   ```

   Para usarlo solo en la red local, sin dominio, cambia el final por `--local`:

   ```bash
   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --local
   ```

4. **Responde si te pregunta.** Si el servidor no tiene Docker, el instalador te pregunta si lo instala con el script
   oficial de Docker: escribe `s` y pulsa Intro. Si no le has dado el dominio, te pregunta cómo vas a entrar.

5. **Espera unos minutos.** El instalador descarga Pizarro, crea la configuración con claves seguras, arranca todo y
   comprueba que funciona. Cuando termina, te muestra la dirección y un código para el siguiente paso.

### Lo que verás en pantalla {#en-pantalla}

Algo así (las líneas de descarga se han acortado):

```text
Docker listo: Docker version 27.3.1, build ce12230.
Última versión publicada: v1.50.0.
Descargando Pizarro (v1.50.0) desde GitHub...
Instalando en /opt/pizarro...

Ejecutando deploy/install.sh ...
Creado /opt/pizarro/deploy/.env a partir de .env.example.
Secretos generados: POSTGRES_PASSWORD APP_DB_PASSWORD SESSION_SECRET BACKUP_KEY TOKEN_SECRET ENCRYPTION_KEY
Kit de recuperación escrito en /opt/pizarro/deploy/recovery-kit.txt (permisos 600).

Descargando la imagen de Pizarro...
Arrancando Pizarro...
Esperando a que la app esté lista...

Pizarro está en marcha.

  Dirección:  https://pizarro.example.com
  Asistente:  https://pizarro.example.com/setup
  Código:     K7QM-4TXD      (caduca en 24 horas; se renueva si se reinicia la app)
```

Apunta el **código**: lo necesitas en el siguiente paso. Debajo verás un recuadro que te pide guardar el kit de
recuperación.

> [!IMPORTANT]
> **Guarda el kit de recuperación fuera del servidor.** Es el fichero `/opt/pizarro/deploy/recovery-kit.txt` y
> contiene las claves de tu instalación. Sin ellas, las copias de seguridad no se pueden abrir. Cópialo a un gestor de
> contraseñas o a otro equipo; por ejemplo, para verlo y copiar su contenido:
>
> ```bash
> cat /opt/pizarro/deploy/recovery-kit.txt
> ```

**Qué ha quedado instalado:** el código en `/opt/pizarro` y tres contenedores de Docker que arrancan solos con el
servidor: Caddy (el que da el HTTPS), Pizarro y su base de datos PostgreSQL. Tus datos viven en volúmenes de Docker,
aparte del código, y no se tocan al actualizar.

> [!TIP]
> **¿Prefieres leer el script antes de ejecutarlo?** Descárgalo, revísalo y lánzalo después:
>
> ```bash
> curl -fsSLO https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh
> less get.sh
> sh get.sh --domain pizarro.example.com
> ```

**Otras opciones del instalador** (se añaden al final del comando):

- `--version 1.49.0` instala esa versión en vez de la última.
- `--dir /srv/pizarro` usa otra carpeta (por defecto, `/opt/pizarro`).
- `--yes` instala Docker sin preguntar, si falta.
- `--build` construye Pizarro en el servidor en vez de descargarlo ya hecho (necesita 2 GB de RAM).
- `--help` muestra todas las opciones.

## Primeros pasos {#primeros-pasos}

1. **Abre el asistente** en el navegador: la dirección que te dio el instalador terminada en `/setup` (por ejemplo,
   `https://pizarro.example.com/setup`).
2. **Escribe el código de un solo uso.** Sirve para comprobar que eres tú quien instala el servidor.
3. **Tu organización:** pon su nombre y elige el idioma y la zona horaria de la instalación.
4. **Primer administrador:** tu nombre, tu email y una contraseña de al menos 10 caracteres.
5. **Email:** el asistente te dice si el envío de emails está listo y te deja mandar una prueba. Si aún no lo está,
   continúa: se configura después desde la propia app ([cómo](#email)).
6. **Entra y activa la verificación en dos pasos.** Al iniciar sesión, Pizarro te pide configurarla (es obligatoria
   para los administradores): con una app de códigos, como Google Authenticator, Microsoft Authenticator o la de tu
   gestor de contraseñas, o con un código por email si ya está configurado. Guarda los códigos de recuperación que te
   muestra.
7. **Invita a tu equipo** desde *Administración → Usuarios*.

Cuando terminas, el asistente desaparece: `/setup` ya no existe y a partir de ahí se entra por la pantalla normal de
inicio de sesión.

> [!NOTE]
> **¿Has perdido el código?** Caduca a las 24 horas. Para ver el último o generar uno nuevo, en el servidor:
>
> ```bash
> cd /opt/pizarro/deploy
> docker compose restart app
> docker compose logs app | grep "introduce el código"
> ```

## Instalar en Railway, sin servidor propio {#railway}

[Railway](https://railway.com) pone en marcha Pizarro y su base de datos desde el repositorio de GitHub, con HTTPS.
Se hace desde su panel web, sin terminal.

1. **Crea el proyecto y la base de datos.** En Railway, pulsa *New Project* y elige *Deploy PostgreSQL*. Railway crea
   un servicio llamado `Postgres`.
2. **Añade Pizarro.** En el mismo proyecto, pulsa *+ New → GitHub Repo* y elige `pla87/pizarro` (o tu copia). Railway
   empieza a desplegar enseguida; fallará hasta que pongas las variables del paso 5: es normal.
3. **Elige la rama `stable`.** En el servicio de Pizarro, *Settings → Source → Branch*: elige `stable`. Esa rama solo
   avanza cuando se publica una versión, así que Railway se actualiza solo con versiones terminadas, nunca con cambios
   a medio hacer.
4. **Pon una dirección y un volumen.**
   - *Settings → Networking → Generate Domain* te da una dirección como `https://pizarro-production.up.railway.app`.
     Cópiala.
   - Clic derecho en el servicio → *Attach Volume*, con *Mount path* `/app/uploads`. Ahí se guardan los archivos y las
     copias de seguridad; sin volumen se perderían en cada despliegue.
5. **Añade las variables.** En el servicio de Pizarro, *Variables → Raw Editor*, pega esto y cambia los valores:

   ```env
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   SESSION_SECRET=pega-aqui-una-clave
   TOKEN_SECRET=pega-aqui-otra-clave
   ENCRYPTION_KEY=pega-aqui-otra-clave
   BACKUP_KEY=pega-aqui-la-clave-de-las-copias
   APP_URL=https://pizarro-production.up.railway.app
   UPLOAD_DIR=/app/uploads
   ```

   - `APP_URL` es la dirección del paso 4, con `https://` y sin barra al final.
   - Cada clave debe ser distinta y aleatoria. Puedes generarlas en la terminal de un Mac o un Linux (en Windows, en
     Git Bash): ejecuta este comando tres veces, para `SESSION_SECRET`, `TOKEN_SECRET` y `ENCRYPTION_KEY`:

     ```bash
     openssl rand -base64 48
     ```

     Y este, para `BACKUP_KEY`:

     ```bash
     openssl rand -base64 32
     ```

6. **Despliega.** Pulsa *Deploy*. El primer arranque prepara la base de datos y tarda un par de minutos.
7. **Busca el código del asistente.** En *Deployments → View logs*, busca la línea que dice `introduce el código:`.
   Abre tu dirección terminada en `/setup` y sigue los [primeros pasos](#primeros-pasos) desde el punto 2.

> [!IMPORTANT]
> Guarda `SESSION_SECRET`, `TOKEN_SECRET`, `ENCRYPTION_KEY` y `BACKUP_KEY` también **fuera de Railway**, en un gestor
> de contraseñas. Sin `BACKUP_KEY` las copias no se pueden abrir y sin `ENCRYPTION_KEY` todos tendrían que configurar
> de nuevo su verificación en dos pasos.

> [!NOTE]
> Crea las variables en el servicio de Pizarro, no como *Shared Variables* del proyecto: esas no llegan solas al
> servicio. Y no añadas las variables `SEED_ADMIN_*`: sin ellas, el primer administrador se crea con el asistente.

## Configuración opcional {#configuracion}

Todo esto se activa desde la propia app, en *Administración → Ajustes*, sin tocar el servidor. Nada es obligatorio:
Pizarro funciona sin ello.

### Email {#email}

Con el email, Pizarro envía las invitaciones, los avisos, los resúmenes y el enlace de «¿Olvidaste tu contraseña?».
Se configura en *Administración → Ajustes → Avisos por email* de una de estas dos formas:

- **Con el Gmail de un administrador** (lo más sencillo para una familia o un equipo pequeño): activa la verificación
  en dos pasos en esa cuenta de Google, crea una contraseña de aplicación en <https://myaccount.google.com/apppasswords>
  y pégala en Pizarro junto con la dirección de Gmail.
- **Con el correo de tu empresa:** elige tu proveedor (Google Workspace, Microsoft 365, Brevo, SendGrid, Amazon SES,
  Mailgun o Mailchimp Transactional) y Pizarro rellena el servidor y el puerto; tú pones el usuario y la contraseña.

Pulsa *Enviar email de prueba* para comprobarlo.

### Google, Telegram y WhatsApp {#conexiones}

Cada conexión tiene su guía paso a paso:

- [Iniciar sesión con Google](../guias/google-login.md): entrar con la cuenta de Google, sin otra contraseña.
- [Google Docs, Sheets y Slides](../guias/google-docs.md): crear un documento, una hoja o una presentación desde una tarea.
- [Avisos por Telegram](../guias/telegram.md): gratis y listo en cinco minutos.
- [Avisos por WhatsApp](../guias/whatsapp.md): con la API oficial de Meta, de pago.

## Copias de seguridad {#copias-de-seguridad}

Pizarro hace **una copia automática cada día**, cifrada, de la base de datos y de todos los archivos. Guarda las de las
últimas dos semanas y una por mes de los últimos seis meses, y cada mes prueba a restaurar la última para comprobar
que sirve. Puedes ver cómo van, y hacer una al momento con *Crear copia ahora*, en *Administración → Copias de
seguridad*.

Esas copias se guardan en el propio servidor, así que no te protegen si lo pierdes. Para eso:

1. **Guarda el kit de recuperación fuera del servidor** (o, en Railway, las cuatro claves).
2. **Añade un destino externo**, donde Pizarro sube cada copia: un almacenamiento compatible con S3 (Cloudflare R2,
   Backblaze B2, MinIO…) o una carpeta montada, como un disco USB o un NAS. Para S3, crea un *bucket* privado y una
   clave solo para él y añade sus datos al final de `/opt/pizarro/deploy/.env`:

   ```env
   BACKUP_S3_ENDPOINT="https://<id-de-cuenta>.r2.cloudflarestorage.com"
   BACKUP_S3_BUCKET="pizarro-copias"
   BACKUP_S3_ACCESS_KEY_ID="…"
   BACKUP_S3_SECRET_ACCESS_KEY="…"
   ```

   Aplica el cambio con `docker compose up -d` (en `/opt/pizarro/deploy`) y pulsa *Copiar ahora a destino externo* en
   *Administración → Copias de seguridad*. Todo lo que se sube va cifrado: el proveedor no puede leerlo.

La carpeta montada, la región de S3 y los demás detalles están en la
[documentación técnica](../INSTALL.md#4-copias-de-seguridad).

### Restaurar en un servidor nuevo {#restaurar}

Si pierdes el servidor, necesitas el kit de recuperación y tu destino externo:

1. **Prepara el servidor nuevo sin arrancar Pizarro:** el comando de instalación con `--no-start` al final.

   ```bash
   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --domain pizarro.example.com --no-start
   ```

2. **Pon tus claves.** En `/opt/pizarro/deploy/.env`, sustituye `SESSION_SECRET`, `TOKEN_SECRET`, `ENCRYPTION_KEY` y
   `BACKUP_KEY` por las del kit y añade las variables `BACKUP_S3_*` de tu destino externo.
3. **Restaura y arranca:**

   ```bash
   cd /opt/pizarro/deploy
   docker compose pull app
   docker compose up -d postgres
   docker compose run --rm --no-deps app node dist/restore.mjs s3:latest --files
   docker compose up -d
   ```

Para elegir una copia concreta, volver a una copia anterior en el mismo servidor o restaurar en Railway, mira la
[documentación técnica](../INSTALL.md#6-restaurar).

## Actualizar {#actualizar}

Antes de actualizar, haz una copia: *Administración → Copias de seguridad → Crear copia ahora*.

**En tu servidor,** repite el comando de instalación, sin `--domain`:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh
```

Descarga la última versión publicada, la arranca y conserva tu configuración, el kit de recuperación y tus datos. Los
cambios que necesite la base de datos se aplican solos. Si la actualización se corta a medias, la instalación anterior
sigue intacta.

**En Railway** no tienes que hacer nada: si el servicio sigue la rama `stable`, se actualiza solo cada vez que se
publica una versión.

**Volver a una versión anterior** (o instalar una concreta): añade `--version` con su número.

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --version 1.49.0
```

> [!WARNING]
> Si la versión nueva ya llegó a arrancar, puede haber cambiado la base de datos y una versión anterior quizá no la
> entienda. Por eso conviene la copia de antes: si hace falta, se restaura y se vuelve atrás.

**Qué recibe cada instalación.** Solo versiones publicadas y probadas: el comando de instalación, la imagen de Docker y
la rama `stable` de Railway siguen siempre la última versión publicada, nunca cambios sueltos. Las versiones y sus
novedades están en <https://github.com/pla87/pizarro/releases>.

**Aviso de versión nueva.** Cuando sale una, los administradores ven un aviso discreto en *Administración*. Para ello,
el servidor pregunta a GitHub, como mucho cada 12 horas, cuál es la última versión, sin enviar nada de tu
instalación. Si prefieres que no lo haga, añade `UPDATE_CHECK=0` a `/opt/pizarro/deploy/.env` (o a las variables de
Railway).

## Dominio propio y HTTPS {#dominio}

**En tu servidor,** el HTTPS es automático: en cuanto el dominio apunta al servidor, Caddy pide el certificado a
Let's Encrypt y lo renueva solo. Para cambiar de dominio más adelante:

1. Apunta el dominio nuevo al servidor (registro `A`, como en la instalación).
2. En `/opt/pizarro/deploy/.env`, cambia `DOMAIN` y `APP_URL`:

   ```env
   DOMAIN="pizarro.example.com"
   APP_URL="https://pizarro.example.com"
   ```

3. Aplica el cambio:

   ```bash
   cd /opt/pizarro/deploy
   docker compose up -d
   ```

**En Railway,** para usar tu dominio en vez de la dirección `up.railway.app`:

1. En el servicio de Pizarro, *Settings → Networking → Custom Domain*, escribe tu dominio.
2. Crea en tu proveedor de DNS el registro `CNAME` (y el `TXT`, si lo pide) que te muestra Railway.
3. Cuando el dominio aparezca como activo, cambia `APP_URL` a la dirección nueva y vuelve a desplegar.

Al cambiar de dirección, todos tienen que volver a iniciar sesión, y quien instaló Pizarro como app en el móvil debe
instalarla de nuevo. Si usas «Iniciar sesión con Google», añade también las direcciones nuevas en Google Cloud
([guía](../guias/google-login.md)).

### Otro proxy delante, o sin proxy {#proxy}

Pizarro usa la IP de quien entra para limitar los intentos de acceso y para el registro de actividad. Detrás de un
proxy (el Caddy de la instalación, el de Railway o uno tuyo) la conexión llega desde el proxy, así que la IP real la
cuenta el proxy en las cabeceras `X-Real-IP` o `X-Forwarded-For`. Pero esas cabeceras las puede escribir cualquiera:
Pizarro solo se fía de ellas si hay un proxy delante que las sobrescriba. Lo decide la variable `TRUST_PROXY`:

- **Sin definir** (lo normal): con Docker y en Railway se fía, porque ya llevan su proxy; arrancado con `npm start`, no.
  No hace falta tocar nada.
- **`TRUST_PROXY=1`** si arrancas Pizarro con `npm start` detrás de tu propio proxy (nginx, Apache, otro Caddy…). Ese
  proxy debe sobrescribir `X-Real-IP` con la IP del cliente (en nginx: `proxy_set_header X-Real-IP $remote_addr;`).
- **`TRUST_PROXY=0`** si publicas el contenedor sin el Caddy incluido, con el puerto 3000 abierto tal cual (no es lo
  recomendado).

En tu servidor, la variable va en `/opt/pizarro/deploy/.env` (y se aplica con `docker compose up -d`); en Railway, en
*Variables* del servicio de Pizarro.

> [!NOTE]
> **En la red local, sin dominio,** Pizarro funciona por HTTP, sin cifrar. Es suficiente en casa o en la oficina, pero
> no lo abras así a Internet. Sin HTTPS tampoco funcionan el inicio de sesión con Google ni la instalación como app en
> la mayoría de los móviles.

## Problemas frecuentes {#problemas}

### El navegador dice que el certificado no es válido

El dominio aún no apunta al servidor o los puertos 80 y 443 están cerrados. Comprueba el registro DNS (los cambios
pueden tardar en propagarse) y el cortafuegos. Para ver qué dice Caddy: `docker compose logs caddy` en
`/opt/pizarro/deploy`.

### `/setup` dice «Página no encontrada»

La instalación ya está configurada: entra por la pantalla de inicio de sesión. El asistente solo existe mientras no hay
ningún usuario.

### El instalador se detiene

Lee la línea que empieza por `ERROR:`: dice qué falta. Lo habitual es que no haya Docker (repite el comando y contesta
`s`, o añade `--yes`), que GitHub no responda (inténtalo más tarde) o que la carpeta ya tenga otra cosa (usa `--dir`).
Repetir el comando no estropea nada.

### La app no termina de arrancar

Mira qué pasa con:

```bash
cd /opt/pizarro/deploy
docker compose ps
docker compose logs --tail 80 app
```

Si el disco está casi lleno o falta memoria, la app no arranca o se reinicia sola: libera espacio
(`docker system prune` borra imágenes viejas) o amplía el servidor.

Si el log dice `No se puede conectar con PostgreSQL`, la app no llega a la base de datos: lo dice a los 10 segundos de
intentarlo, junto con el servidor y el motivo (no responde, rechaza la conexión o no existe ese nombre). Comprueba que
el contenedor de la base de datos está en marcha (`docker compose ps`) o, en Railway, la variable `DATABASE_URL`.

### No llegan los emails

Revisa *Administración → Ajustes → Avisos por email*, envía un email de prueba y mira *Administración → Logs*. Con
Gmail, la contraseña debe ser una contraseña de aplicación, no la de la cuenta.

### Las fechas salen con otra hora

Añade tu zona horaria a `/opt/pizarro/deploy/.env`, por ejemplo `APP_TIMEZONE="Europe/Madrid"`, y aplica el cambio
con `docker compose up -d`.

### Nadie puede entrar como administrador

Si se olvidó la contraseña o se perdió el móvil de la verificación en dos pasos, genera un enlace de un solo uso desde
el servidor:

```bash
cd /opt/pizarro/deploy
docker compose exec app node dist/reset-link.mjs persona@example.com
```

Abre el enlace que imprime y elige una contraseña nueva; sirve una vez y caduca a los 30 minutos. Si además se perdió
el móvil, añade `--reset-2fa` al final para que vuelva a configurar la verificación en dos pasos. En Railway, la misma
orden (`node dist/reset-link.mjs …`) se ejecuta en la terminal del servicio (`railway ssh`).

### Si necesitas ayuda

En *Administración → Ajustes → Descargar diagnóstico* obtienes un resumen técnico sin datos personales ni claves. Para
avisar de un fallo, usa *Informar de un error* en *Historial de versiones*. Más casos en la
[documentación técnica](../INSTALL.md#8-resolución-de-problemas).

## Desinstalar {#desinstalar}

> [!CAUTION]
> Antes de borrar nada, descarga lo que quieras conservar: exporta tus proyectos o guarda una copia y el kit de
> recuperación.

**Parar Pizarro** sin borrar los datos (lo vuelves a arrancar con `docker compose up -d`):

```bash
cd /opt/pizarro/deploy
docker compose down
```

**Borrarlo todo,** también la base de datos, los archivos y las copias guardadas en el servidor. No se puede deshacer:

```bash
cd /opt/pizarro/deploy
docker compose down -v
cd /
rm -rf /opt/pizarro
```

Docker sigue instalado por si lo usas para otras cosas. Si no eres `root`, pon `sudo` delante de las órdenes
`docker` y `rm`.

**En Railway,** borra el proyecto desde sus ajustes (*Settings → Danger*). Se borran también la base de datos y el
volumen.

## Documentación técnica {#documentacion-tecnica}

Esta guía cubre lo habitual. Para lo avanzado (instalar a mano sin el comando, construir la imagen, la memoria, el
endurecimiento del contenedor, todas las variables, los destinos de copia y la restauración en detalle) está la
[documentación técnica de instalación](../INSTALL.md), y para el uso y la administración de la app, el
[manual](../MANUAL.md).
