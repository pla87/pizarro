---
titulo: Instalar Pizarro
descripcion: Paso a paso y sin ser experto, en tu propio servidor con un solo comando o sin servidor propio, en Railway, Render o Fly.io.
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

- **Un servidor Linux** con procesador x86_64 o arm64: un VPS (un servidor que alquilas por meses a un proveedor de
  alojamiento; cualquiera sirve), un miniordenador en la oficina o una Raspberry Pi 5.
- **Tamaño recomendado: 2 GB de RAM, 1 o 2 procesadores (vCPU) y 20 GB de disco**, más lo que ocupen tus archivos
  adjuntos. Pizarro arranca con 1 GB de RAM, pero con 2 GB va holgado. Suele bastar el plan más sencillo que llegue a
  esas cifras.
- **Acceso por terminal** (SSH) como `root` o con un usuario que pueda usar `sudo`. Desde Windows sirve PowerShell, que
  ya trae SSH; en un Mac, la app Terminal.
- **Docker.** Si no lo tienes, el instalador se ofrece a instalarlo por ti.
- **Un dominio o subdominio** (por ejemplo `pizarro.example.com`) que apunte a la IP del servidor, con los puertos 80
  y 443 abiertos. Si solo lo vas a usar en casa o en la oficina, también funciona en la red local, sin dominio.

**O, sin servidor propio:** una cuenta en una de estas tres plataformas en la nube, que cobran cada mes:
[Railway](https://railway.com) (según lo que se usa; necesitas también una cuenta en GitHub),
[Render](https://render.com) (por plan) o [Fly.io](https://fly.io) (según lo que se usa, desde la terminal).

## Elige tu camino {#elige-tu-camino}

| Opción | Servidor propio | Railway | Render | Fly.io |
|---|---|---|---|---|
| **Ideal si** | Tienes un VPS o un equipo con Linux | No quieres mantener un servidor | Quieres crearlo todo con un botón | Te manejas con la terminal |
| **Cómo** | Un comando en la terminal | Unos clics en el panel de Railway | Un botón y su panel web | Unas órdenes con su programa `fly` |
| **Tiempo** | Unos minutos | Unos 15 minutos | Unos 10 minutos | Unos 15 minutos |
| **HTTPS** | Automático | Automático | Automático | Automático |
| **Coste** | El de tu servidor | Según lo que uses, cada mes | Un precio fijo por plan, cada mes | Según lo que uses, cada mes |

Todos los caminos acaban igual: en el asistente que crea tu cuenta de administrador. Sigue con
[Servidor propio](#servidor-propio) o salta a [Railway](#railway), [Render](#render) o [Fly.io](#fly).

## Instalar en tu servidor con un comando {#servidor-propio}

1. **Apunta tu dominio al servidor.** Entra en el panel de quien te vende el dominio y busca el apartado **DNS** (a
   veces se llama **Zona DNS** o *Gestionar DNS*). Crea un registro de tipo `A`: como nombre, la parte de delante del
   dominio (`pizarro` para `pizarro.example.com`, o `@` si usas el dominio entero) y como valor, la IP del servidor. Si
   el servidor tiene IPv6, crea otro de tipo `AAAA` con esa dirección. El cambio puede tardar de unos minutos a unas
   horas en llegar a todo Internet. Si vas a usar Pizarro solo en la red local, sáltate este paso.

2. **Entra en el servidor** desde la terminal de tu ordenador: en Windows, abre **PowerShell** (búscalo en el menú
   Inicio); en un Mac, la app **Terminal**. Escribe:

   ```bash
   ssh root@203.0.113.10
   ```

   Cambia `203.0.113.10` por la IP de tu servidor (o `root` por tu usuario). La primera vez te pregunta si confías en
   el servidor: escribe `yes` y pulsa Intro. Después, la contraseña que te dio el proveedor (mientras la escribes no se
   ve nada: es normal).

3. **Abre los puertos 80 y 443.** Por ellos entra la gente a Pizarro y se pide el certificado HTTPS. Si tu proveedor
   tiene un cortafuegos en su panel (*Firewall*, *Cortafuegos* o *Security group*), añade allí una regla que permita la
   entrada TCP por los puertos 80 y 443. Si además el propio servidor usa `ufw` (compruébalo con `ufw status`: dice
   `Status: active`), ábrelos también en él:

   ```bash
   ufw allow 80,443/tcp
   ```

   Si `ufw status` dice `inactive` o que no existe, no hace falta nada más. En la red local, sin dominio, sáltate este
   paso.

4. **Ejecuta el instalador.** Copia este comando, cambia `pizarro.example.com` por tu dominio y pégalo en la
   terminal:

   ```bash
   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/stable/deploy/get.sh | sh -s -- --domain pizarro.example.com
   ```

   Para usarlo solo en la red local, sin dominio, cambia el final por `--local`:

   ```bash
   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/stable/deploy/get.sh | sh -s -- --local
   ```

5. **Responde si te pregunta.** Si el servidor no tiene Docker, el instalador te pregunta si lo instala con el script
   oficial de Docker: escribe `s` y pulsa Intro. Si no le has dado el dominio, te pregunta cómo vas a entrar.

6. **Espera unos minutos.** El instalador descarga Pizarro, crea la configuración con claves seguras, arranca todo y
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
> contiene las claves de tu instalación. Sin ellas, las copias de seguridad no se pueden abrir. Descárgalo a tu
> ordenador: abre **otra** ventana de PowerShell o de Terminal, en tu ordenador y no en el servidor, y escribe (con la
> IP de tu servidor):
>
> ```bash
> scp root@203.0.113.10:/opt/pizarro/deploy/recovery-kit.txt .
> ```
>
> El fichero llega entero a la carpeta en la que está esa ventana (en Windows, normalmente tu carpeta de usuario). Es
> más seguro que copiarlo de la pantalla, donde es fácil dejarse un trozo. Guárdalo después en un gestor de contraseñas
> o en otro lugar seguro.

**Qué ha quedado instalado:** el código en `/opt/pizarro` y tres contenedores de Docker que arrancan solos con el
servidor: Caddy (el que da el HTTPS), Pizarro y su base de datos PostgreSQL. Tus datos viven en volúmenes de Docker,
aparte del código, y no se tocan al actualizar.

> [!TIP]
> **¿Prefieres leer el script antes de ejecutarlo?** Descárgalo, revísalo y lánzalo después:
>
> ```bash
> curl -fsSLO https://raw.githubusercontent.com/pla87/pizarro/stable/deploy/get.sh
> less get.sh
> sh get.sh --domain pizarro.example.com
> ```

**Otras opciones del instalador** (se añaden al final del comando):

- `--version 1.49.0` instala esa versión en vez de la última (de la 1.38.0 en adelante).
- `--dir /srv/pizarro` usa otra carpeta (por defecto, `/opt/pizarro`).
- `--yes` instala Docker sin preguntar, si falta.
- `--build` construye Pizarro en el servidor en vez de descargarlo ya hecho (necesita 2 GB de RAM).
- `--help` muestra todas las opciones.

### Cambiar la configuración (`.env`) {#editar-env}

Algunas cosas, como el destino externo de las copias, la zona horaria o el dominio, se cambian en el fichero
`/opt/pizarro/deploy/.env` del servidor. Para editarlo, entra en el servidor y ábrelo con el editor `nano` (si no eres
`root`, pon `sudo` delante):

```bash
nano /opt/pizarro/deploy/.env
```

Muévete con las flechas y escribe o cambia lo que haga falta. Para guardar, pulsa **Ctrl+O** y luego Intro; para salir,
**Ctrl+X** (también en un Mac: Ctrl, no Cmd). Después aplica el cambio:

```bash
cd /opt/pizarro/deploy
docker compose up -d
```

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
>
> En Railway, reinicia el servicio de Pizarro (en *Deployments*, menú *⋮* del despliegue activo → *Restart*) y busca
> en el log la línea `PIZARRO ESTÁ SIN CONFIGURAR`: el código nuevo está justo debajo. En Render, reinícialo desde
> *Manual Deploy* y míralo en *Logs*; en Fly.io, con `fly apps restart <nombre>` y después `fly logs`.

## Instalar en Railway, sin servidor propio {#railway}

[Railway](https://railway.com) pone en marcha Pizarro y su base de datos desde el repositorio de GitHub, con HTTPS.
Se hace desde su panel web, sin terminal.

> [!NOTE]
> **Cómo despliega Railway.** Mientras preparas el servicio, Railway no despliega cada cambio: los va juntando en un
> aviso arriba a la izquierda, «Apply N changes», con un botón **Deploy**. En esta guía lo pulsas **una sola vez**, al
> final (paso 7), cuando ya está todo.

1. **Crea el proyecto y la base de datos.** Abre <https://railway.com/new> y elige **Database → PostgreSQL**. Railway
   crea un servicio llamado `Postgres`. Si quieres, ponle nombre al proyecto en *Settings → General*.
2. **Añade Pizarro.** En el mismo proyecto, pulsa **+ Add → GitHub Repository** y elige `pla87/pizarro` (o tu copia).
   Si es la primera vez, Railway te pide permiso para ver tus repositorios de GitHub. Aparece un segundo recuadro: el
   servicio de Pizarro.
3. **Elige la rama `stable`.** Pulsa el recuadro de Pizarro y ve a *Settings → Source → **Branch connected to
   production***. El desplegable muestra todas las ramas: escribe `stable` para filtrar y elígela. Esa rama solo avanza
   cuando se publica una versión, así que Railway se actualiza solo con versiones terminadas, nunca con cambios a medio
   hacer.
4. **Genera la dirección y monta el volumen.**
   - En *Settings → Networking*, pulsa **Generate Domain**. Railway reserva una dirección como
     `pizarro-production.up.railway.app`. No funciona hasta el primer despliegue: es normal.
   - Haz clic derecho en el recuadro de Pizarro → **Attach volume** y, como *Mount path*, escribe `/app/uploads`. Ahí se
     guardan los archivos y las copias de seguridad; sin volumen se perderían en cada despliegue.
5. **Pega las variables.** Pulsa **Generar mis variables**: la página crea en tu navegador cuatro claves aleatorias y
   las pone en el bloque de abajo. No se envían a ningún sitio, ni a esta web ni a Railway: solo están en tu pantalla
   hasta que las copias. Pulsa **Copiar**, ve al servicio de Pizarro → *Variables* → *Raw Editor*, pega y pulsa
   *Update Variables*.

   ```railway-env
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   SESSION_SECRET=pulsa-generar-mis-variables
   TOKEN_SECRET=pulsa-generar-mis-variables
   ENCRYPTION_KEY=pulsa-generar-mis-variables
   BACKUP_KEY=pulsa-generar-mis-variables
   UPLOAD_DIR=/app/uploads
   ```

   - **No hace falta `APP_URL`:** Pizarro usa sola la dirección que reservó Railway en el paso 4. Solo tendrás que
     añadirla si pones un [dominio propio](#dominio).
   - `${{Postgres.DATABASE_URL}}` se queda tal cual: Railway lo cambia por la dirección de la base de datos. Si tu
     servicio de base de datos no se llama `Postgres`, cambia ese nombre.
   - **Guarda ya las cuatro claves** en un gestor de contraseñas (mira el aviso de abajo).
   - **Sin el botón:** también puedes generarlas en la terminal de un Mac o un Linux (en Windows, en Git Bash). Cada
     clave debe ser distinta. Ejecuta este comando tres veces, para `SESSION_SECRET`, `TOKEN_SECRET` y
     `ENCRYPTION_KEY`:

     ```bash
     openssl rand -base64 48
     ```

     Y este, para `BACKUP_KEY`:

     ```bash
     openssl rand -base64 32
     ```

6. **Activa la comprobación de salud.** En el servicio de Pizarro, ve a *Settings → Deploy* y escribe
   `/api/health` en **Healthcheck Path** y `600` en **Healthcheck Timeout** (este campo aparece en cuanto rellenas el
   anterior). Así Railway no da por bueno un despliegue hasta que Pizarro responde, y si
   algo falla al actualizar, sigue con la versión anterior. En esa misma pantalla, deja *Restart Policy* en
   *On Failure* y una sola réplica (es lo que viene; con el volumen, Railway no deja subirlas) y *Custom Start Command*
   vacío.
7. **Despliega una sola vez.** Arriba a la izquierda verás «Apply N changes»: pulsa **Deploy**. Railway construye
   Pizarro y lo arranca, y eso lleva unos minutos. Si Railway llegó a desplegar antes de que tuvieras las variables o el
   volumen, quizá te llegue un email «Build failed»: es normal y no tienes que hacer nada. El despliegue que vale es
   este, ya con todo. Para ver que la comprobación de salud está activa, abre el despliegue en *Deployments* y mira el
   final de *Build Logs* (no en *Deploy Logs*): debe salir `Starting Healthcheck` con `Path: /api/health` y
   `Retry window: 10m0s` y, cuando Pizarro ya responde,
   `Healthcheck succeeded!` (antes, unas cuantas líneas `Attempt #… failed`: es normal mientras se prepara).
8. **Espera a que Pizarro prepare la base de datos.** La primera vez tarda 2 o 3 minutos más, aunque Railway ya ponga
   *Active*. En el servicio de Pizarro, abre *Deployments → View logs*, baja al final del log y espera la línea
   `PIZARRO ESTÁ SIN CONFIGURAR`. Las líneas en rojo del principio son normales. Verás algo así:

   ```text
   ================================================================
   [setup] PIZARRO ESTÁ SIN CONFIGURAR
   [setup] Abre https://pizarro-production.up.railway.app/setup e introduce el código: K7QM-4TXD
   [setup] El código caduca en 24 horas y cambia en cada arranque mientras falte la configuración.
   ================================================================
   ```

9. **Abre el asistente.** Ve a tu dirección terminada en `/setup` y sigue los [primeros pasos](#primeros-pasos) desde
   el punto 2, con el código del log.

> [!IMPORTANT]
> Guarda `SESSION_SECRET`, `TOKEN_SECRET`, `ENCRYPTION_KEY` y `BACKUP_KEY` también **fuera de Railway**, en un gestor
> de contraseñas. Sin `BACKUP_KEY` las copias no se pueden abrir y sin `ENCRYPTION_KEY` todos tendrían que configurar
> de nuevo su verificación en dos pasos.

> [!WARNING]
> **Railway puede proponerte cambios que no has pedido.** A veces el aviso de arriba a la izquierda dice, por ejemplo,
> «Apply 2 changes» con cambios de región o de réplicas que tú no has tocado. Ábrelo para ver qué son antes de pulsar
> **Deploy**:
>
> - **Réplicas:** no apliques un cambio que ponga más de una. Pizarro funciona con una sola instancia (es lo que pone
>   Railway por defecto); con dos o más fallarían los avisos en vivo y los límites de intentos de acceso. Descarta ese
>   cambio o vuelve a poner 1.
> - **Región:** da igual cuál sea, siempre que la base de datos (`Postgres`) esté en la misma. Si están en regiones
>   distintas, Pizarro va más lento.

> [!NOTE]
> Crea las variables en el servicio de Pizarro, no como *Shared Variables* del proyecto: esas no llegan solas al
> servicio. Y no añadas las variables `SEED_ADMIN_*`: sin ellas, el primer administrador se crea con el asistente.

## Instalar en Render {#render}

[Render](https://render.com) pone en marcha Pizarro con un botón: crea el servicio con la imagen oficial, un disco para
tus archivos y la base de datos, y genera las claves. Se hace desde su panel web, sin terminal.

> [!IMPORTANT]
> **Render cobra cada mes por el servicio, el disco y la base de datos.** Su plan gratis solo sirve para curiosear: el
> servicio se duerme a los 15 minutos sin visitas (y con él los avisos en vivo y las copias diarias), no tiene disco,
> así que los archivos adjuntos se pierden en cada despliegue, y la base de datos gratis caduca a los 30 días. Por eso
> el botón crea los planes de pago más pequeños que sirven: consulta su precio en <https://render.com/pricing>.

1. **Crea tu cuenta** en <https://dashboard.render.com> y añade una tarjeta en los ajustes de pago (*Billing*): sin
   ella, Render no crea servicios de pago.
2. **Pulsa el botón.** Abre <https://render.com/deploy?repo=https://github.com/pla87/pizarro>. Render te enseña lo
   que va a crear: el servicio `pizarro` (con un disco de 5 GB para tus archivos) y la base de datos `pizarro-db`, los
   dos en Fráncfort. Ponle un nombre cualquiera y confirma con **Deploy Blueprint**.
3. **Espera a que arranque.** Render descarga Pizarro y prepara la base de datos; la primera vez tarda unos minutos.
   En el servicio `pizarro`, abre la pestaña **Logs** y espera la línea `PIZARRO ESTÁ SIN CONFIGURAR`: justo debajo
   están la dirección de `/setup` y el código.
4. **Guarda las claves.** En la pestaña **Environment** del servicio verás `SESSION_SECRET`, `TOKEN_SECRET`,
   `ENCRYPTION_KEY` y `BACKUP_KEY`: Render las ha generado. Cópialas en un gestor de contraseñas.
5. **Abre el asistente.** Ve a la dirección de tu servicio (aparece arriba, algo como
   `https://pizarro-xxxx.onrender.com`) terminada en `/setup` y sigue los [primeros pasos](#primeros-pasos) desde el
   punto 2.

No hace falta `APP_URL`: Pizarro usa la dirección de Render. Solo tendrás que añadirla si pones un
[dominio propio](#dominio). El plan que crea el botón (*Starter*, 512 MB de memoria) basta para un equipo pequeño. Para
un equipo más grande, o si Render reinicia el servicio por falta de memoria (lo verás en *Events*), cambia el plan en
*Settings → Instance Type* a *Standard* y, en **Environment**, borra `PDF_WORKER_MAX_MB`: limita la memoria de los PDF
para que quepa en *Starter*.

> [!NOTE]
> **La comprobación de salud ya viene puesta.** En *Settings → Health Checks* debe salir `/api/health`. Gracias a ella,
> Render no da por bueno un despliegue hasta que Pizarro responde.

## Instalar en Fly.io {#fly}

[Fly.io](https://fly.io) ejecuta Pizarro en una máquina suya, con un disco (volumen) para tus archivos y una base de
datos. Se maneja desde la terminal, con su programa `fly`.

> [!IMPORTANT]
> **Fly.io no tiene plan gratis para cuentas nuevas:** cobra cada mes lo que se usa (la máquina encendida todo el mes,
> el volumen y la base de datos, que suele ser lo más caro). Consulta los precios en <https://fly.io/pricing>.

1. **Instala `fly` y crea tu cuenta.** En un Mac, `brew install flyctl`; en Linux, `curl -L https://fly.io/install.sh | sh`;
   en Windows, en PowerShell, `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"`. Después escribe
   `fly auth signup` (o `fly auth login` si ya tienes cuenta) y añade una tarjeta en el panel de Fly.io.
2. **Prepara una carpeta con la configuración** y elige el nombre de tu app: es único en todo Fly.io y da tu dirección,
   `https://<nombre>.fly.dev`.

   ```bash
   mkdir pizarro-fly
   cd pizarro-fly
   curl -fsSLO https://raw.githubusercontent.com/pla87/pizarro/stable/deploy/fly.toml
   fly apps create <nombre>
   ```

   Abre `fly.toml` con un editor de texto y cambia `pizarro-example` por tu nombre. Los servidores están en Fráncfort
   (`fra`); si prefieres otra región, cámbiala en `primary_region` y usa la misma en los pasos 3 y 4. Todo lo que
   sigue se escribe en esta carpeta.
3. **Crea el volumen para tus archivos.** Fly avisa de que un solo volumen no tiene copia: es lo normal, las copias de
   Pizarro van aparte.

   ```bash
   fly volumes create pizarro_data --size 5 --region fra
   ```

4. **Crea la base de datos y conéctala.** La primera orden te pregunta un nombre, la región (la misma, o la más cercana)
   y el plan, y al final muestra el identificador del clúster; la segunda la une a tu app.

   ```bash
   fly mpg create
   fly mpg attach <id-del-clúster>
   ```

5. **Genera las claves.** Pulsa **Generar mis variables**: la página crea en tu navegador cuatro claves aleatorias y
   las pone en el bloque de abajo (no se envían a ningún sitio). Pulsa **Copiar**, pégalas en un fichero nuevo llamado
   `pizarro-claves.env` dentro de la carpeta, **guárdalas también en un gestor de contraseñas** y pásalas a Fly:

   ```railway-env
   SESSION_SECRET=pulsa-generar-mis-variables
   TOKEN_SECRET=pulsa-generar-mis-variables
   ENCRYPTION_KEY=pulsa-generar-mis-variables
   BACKUP_KEY=pulsa-generar-mis-variables
   ```

   ```bash
   fly secrets import < pizarro-claves.env
   ```

   En PowerShell, en su lugar: `Get-Content pizarro-claves.env | fly secrets import`. Después borra el fichero. No hace
   falta `APP_URL`: Pizarro usa `https://<nombre>.fly.dev`.
6. **Despliega.** Fly descarga Pizarro, lo arranca y espera a que responda; la primera vez tarda unos minutos.

   ```bash
   fly deploy
   ```

7. **Busca el código** con `fly logs`: espera la línea `PIZARRO ESTÁ SIN CONFIGURAR` (debajo están la dirección y el
   código; para salir, `Ctrl+C`). Abre `https://<nombre>.fly.dev/setup` y sigue los
   [primeros pasos](#primeros-pasos) desde el punto 2.

> [!NOTE]
> **La comprobación de salud y la máquina siempre encendida ya vienen en `fly.toml`.** `fly checks list` muestra la de
> `/api/health` (*passing* si todo va bien). Fly no apaga la máquina por inactividad: Pizarro la necesita encendida
> para los avisos en vivo y las tareas de fondo. No añadas más máquinas: Pizarro funciona con una sola.

## Configuración opcional {#configuracion}

Todo esto se activa desde la propia app, en *Administración → Integraciones*, sin tocar el servidor. Nada es obligatorio:
Pizarro funciona sin ello.

### Email {#email}

Con el email, Pizarro envía las invitaciones, los avisos, los resúmenes y el enlace de «¿Olvidaste tu contraseña?».
Se configura en *Administración → Integraciones → Avisos por email* de una de estas dos formas:

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

1. **Guarda el kit de recuperación fuera del servidor** (o, en Railway, Render o Fly.io, las cuatro claves).
2. **Añade un destino externo**, donde Pizarro sube cada copia: un almacenamiento compatible con S3 (Cloudflare R2,
   Backblaze B2, MinIO…) o una carpeta montada, como un disco USB o un NAS. Para S3, crea un *bucket* privado y una
   clave solo para él y añade sus datos al final de `/opt/pizarro/deploy/.env` ([cómo editarlo](#editar-env)):

   ```env
   BACKUP_S3_ENDPOINT="https://<id-de-cuenta>.r2.cloudflarestorage.com"
   BACKUP_S3_BUCKET="pizarro-copias"
   BACKUP_S3_ACCESS_KEY_ID="…"
   BACKUP_S3_SECRET_ACCESS_KEY="…"
   ```

   Aplica el cambio con `docker compose up -d` (en `/opt/pizarro/deploy`) y pulsa *Copiar ahora a destino externo* en
   *Administración → Copias de seguridad*. Todo lo que se sube va cifrado: el proveedor no puede leerlo.

   **En Railway,** pon las variables `BACKUP_S3_*` en *Variables* del servicio de Pizarro (los mismos nombres y
   valores, sin las comillas), añade también `BACKUP_S3_PREFIX=pizarro` y vuelve a desplegar. **En Render,** igual, en
   *Environment* del servicio. **En Fly.io,** con `fly secrets set`, todas en la misma orden separadas por espacios
   (`fly secrets set BACKUP_S3_ENDPOINT=… BACKUP_S3_BUCKET=… …`): la máquina se reinicia con ellas.

> [!TIP]
> **Con Cloudflare R2, protege las copias con una regla de retención.** En el panel de Cloudflare, en tu *bucket* →
> *Settings* → *Bucket Lock Rules*, añade una regla para el prefijo de las copias, `pizarro/pizarro-backup-` (con el
> `BACKUP_S3_PREFIX` de arriba), con una retención de 31 días y, si el espacio te lo permite, otra para
> `pizarro/files/` (los adjuntos que comparten todas las copias) indefinida o de 180 días. Así nadie puede borrar ni
> sobrescribir una copia antes de tiempo, aunque consiga la clave de acceso o un error borre lo que no debe. Pizarro
> funciona igual con las reglas puestas: lo que aún no se puede borrar lo cuenta en *Copias de seguridad* y lo borra
> cuando vence.

La carpeta montada, la región de S3 y los demás detalles están en la
[documentación técnica](../INSTALL.md#4-copias-de-seguridad).

### Restaurar en un servidor nuevo {#restaurar}

Si pierdes el servidor, necesitas el kit de recuperación y tu destino externo:

1. **Prepara el servidor nuevo sin arrancar Pizarro:** el comando de instalación con `--no-start` al final.

   ```bash
   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/stable/deploy/get.sh | sh -s -- --domain pizarro.example.com --no-start
   ```

2. **Pon tus claves.** En `/opt/pizarro/deploy/.env`, sustituye `SESSION_SECRET`, `TOKEN_SECRET`, `ENCRYPTION_KEY` y
   `BACKUP_KEY` por las del kit (si en el kit alguna pone «no definida», borra su línea) y añade las variables
   `BACKUP_S3_*` de tu destino externo.
3. **Restaura y arranca:**

   ```bash
   cd /opt/pizarro/deploy
   docker compose pull app
   docker compose up -d --wait postgres
   docker compose run --rm --no-deps app node dist/restore.mjs s3:latest --files
   docker compose up -d
   ```

Para elegir una copia concreta, volver a una copia anterior en el mismo servidor o restaurar en Railway, Render o
Fly.io, mira la
[documentación técnica](../INSTALL.md#6-restaurar).

## Actualizar {#actualizar}

Antes de actualizar, haz una copia: *Administración → Copias de seguridad → Crear copia ahora*.

**En tu servidor,** repite el comando de instalación, sin `--domain`:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/stable/deploy/get.sh | sh
```

Descarga la última versión publicada, la arranca y conserva tu configuración, el kit de recuperación y tus datos. Los
cambios que necesite la base de datos se aplican solos. Si la actualización se corta a medias, la instalación anterior
sigue intacta.

**En Railway** no tienes que hacer nada: si el servicio sigue la rama `stable`, se actualiza solo cada vez que se
publica una versión.

**En Render,** cuando salga una versión, en el servicio de Pizarro pulsa *Manual Deploy → Deploy latest reference*:
descarga la última y la arranca.

**En Fly.io,** en la carpeta donde guardaste `fly.toml`, vuelve a escribir `fly deploy`.

**Con `npm start`** (sin Docker), para el servidor, descarga el código de la versión nueva (rama `stable`) y, en la
carpeta de Pizarro, ejecuta `npm ci`, `npx prisma migrate deploy` y `npm run build`; luego vuelve a arrancarlo con
`npm start`.

**Volver a una versión anterior** (o instalar una concreta): añade `--version` con su número.

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/stable/deploy/get.sh | sh -s -- --version 1.49.0
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
Railway o Render, o con `fly secrets set` en Fly.io).

## Dominio propio y HTTPS {#dominio}

**En tu servidor,** el HTTPS es automático: en cuanto el dominio apunta al servidor, Caddy pide el certificado a
Let's Encrypt y lo renueva solo. Para cambiar de dominio más adelante:

1. Apunta el dominio nuevo al servidor (registro `A`, como en la instalación).
2. En `/opt/pizarro/deploy/.env` ([cómo editarlo](#editar-env)), cambia `DOMAIN` y `APP_URL`:

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
3. Cuando el dominio aparezca como activo, añade en *Variables* `APP_URL` con la dirección nueva (por ejemplo,
   `APP_URL=https://pizarro.example.com`, con `https://` y sin barra al final) y vuelve a desplegar. Es el único caso
   en que Railway necesita `APP_URL`.

**En Render,** en el servicio de Pizarro, *Settings → Custom Domains → Add Custom Domain*: escribe tu dominio, crea en
tu proveedor de DNS el registro que te indica Render y, cuando salga como verificado, añade en *Environment*
`APP_URL=https://pizarro.example.com` y guarda (Render vuelve a desplegar).

**En Fly.io,** escribe `fly certs add pizarro.example.com` en la carpeta de `fly.toml`, crea en tu proveedor de DNS los
registros que te muestra y, cuando `fly certs show pizarro.example.com` diga que el certificado está listo, escribe
`fly secrets set APP_URL=https://pizarro.example.com`.

Al cambiar de dirección, todos tienen que volver a iniciar sesión, y quien instaló Pizarro como app en el móvil debe
instalarla de nuevo. Si usas «Iniciar sesión con Google», añade también las direcciones nuevas en Google Cloud
([guía](../guias/google-login.md)).

### Otro proxy delante, o sin proxy {#proxy}

Pizarro usa la IP de quien entra para limitar los intentos de acceso y para el registro de actividad. Detrás de un
proxy (el Caddy de la instalación, el de Railway o uno tuyo) la conexión llega desde el proxy, así que la IP real la
cuenta el proxy en las cabeceras `X-Real-IP` o `X-Forwarded-For`. Pero esas cabeceras las puede escribir cualquiera:
Pizarro solo se fía de ellas si hay un proxy delante que las sobrescriba. Lo decide la variable `TRUST_PROXY`:

- **Sin definir** (lo normal): con Docker, en Railway, en Render y en Fly.io se fía, porque ya llevan su proxy (en
  Render y Fly.io usa la cabecera propia de su proxy); arrancado con `npm start`, no. No hace falta tocar nada.
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

Si el log dice `PostgreSQL aún no responde`, la app está esperando a la base de datos: lo reintenta cada 3 segundos
durante 3 minutos y arranca en cuanto responde. Si al acabar ese tiempo dice `No se puede conectar con PostgreSQL`,
junto con el servidor y el motivo (no responde, rechaza la conexión o no existe ese nombre), comprueba que el
contenedor de la base de datos está en marcha (`docker compose ps` y `docker compose logs --tail 50 postgres`) o, en
Railway, Render o Fly.io, que la base de datos está activa y la variable `DATABASE_URL`. Con la app ya en marcha, el mismo
aviso sale si la base deja de responder durante 20 segundos.

Si el log dice `una migración de la base de datos falló a medias (P3009)`, una actualización no terminó de preparar la
base de datos y la app no arranca hasta resolverlo. El propio log explica qué hacer, con el comando ya completo; los
detalles están en la [documentación técnica](../INSTALL.md#81-una-migración-falló-a-medias-p3009).

### No llegan los emails

Revisa *Administración → Integraciones → Avisos por email*, envía un email de prueba y mira *Administración → Logs*. Con
Gmail, la contraseña debe ser una contraseña de aplicación, no la de la cuenta.

### Las fechas salen con otra hora

Añade tu zona horaria a `/opt/pizarro/deploy/.env` ([cómo editarlo](#editar-env)), por ejemplo `APP_TIMEZONE="Europe/Madrid"`, y aplica el cambio
con `docker compose up -d`.

### Nadie puede entrar como administrador {#sin-acceso}

Si se olvidó la contraseña o se perdió el móvil de la verificación en dos pasos, prueba primero lo que no necesita
terminal:

- **Con el email configurado,** pulsa *¿Olvidaste tu contraseña?* en la pantalla de inicio de sesión.
- **Si se perdió el móvil,** entra con uno de los códigos de recuperación que guardaste al activar la verificación en
  dos pasos.
- **Si otro administrador puede entrar,** que vaya a *Administración → Usuarios* y, junto a esa persona, elija *Forzar
  cambio de contraseña* (le da un enlace de un solo uso) o *Restablecer la verificación en dos pasos*.

Si nada de eso sirve, genera un enlace de un solo uso desde el servidor:

```bash
cd /opt/pizarro/deploy
docker compose exec app node dist/reset-link.mjs persona@example.com
```

Abre el enlace que imprime y elige una contraseña nueva; sirve una vez y caduca a los 30 minutos. Si además se perdió
el móvil, añade `--reset-2fa` al final para que vuelva a configurar la verificación en dos pasos.

**En Railway** no hay carpeta `/opt/pizarro/deploy` ni Docker: abre el servicio de Pizarro en el panel de Railway, ve
a la pestaña *Console* y escribe solo `node dist/reset-link.mjs persona@example.com` (con `--reset-2fa` si hace falta).
Si tu panel no tiene esa pestaña, abre la misma terminal desde tu ordenador con el programa de Railway para la terminal
(su *CLI*): instálalo con `brew install railway` en un Mac, o `npm install -g @railway/cli` en Windows y Linux (necesita
[Node.js](https://nodejs.org)), y después:

```bash
railway login
railway link
railway ssh
```

`railway login` abre el navegador para entrar en tu cuenta; `railway link` te pregunta el proyecto y el servicio (elige
el de Pizarro); `railway ssh` abre una terminal dentro del servicio. Allí escribe la misma orden y, al terminar, `exit`.

**En Render,** abre el servicio de Pizarro, pestaña *Shell*, y escribe `node /app/dist/reset-link.mjs persona@example.com`
(con `--reset-2fa` si hace falta). **En Fly.io,** en tu ordenador:

```bash
fly ssh console -C "node /app/dist/reset-link.mjs persona@example.com"
```

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

**En Render,** borra el servicio y la base de datos (cada uno, al final de su página *Settings*) y, si quieres, el
Blueprint. Al borrar el servicio se borra también su disco.

**En Fly.io,** `fly apps destroy <nombre>` borra la app y su volumen; la base de datos se borra aparte, desde el panel
de Fly.io (*Managed Postgres*).

## Documentación técnica {#documentacion-tecnica}

Esta guía cubre lo habitual. Para lo avanzado (instalar a mano sin el comando, construir la imagen, la memoria, el
endurecimiento del contenedor, todas las variables, los destinos de copia y la restauración en detalle) está la
[documentación técnica de instalación](../INSTALL.md), y para el uso y la administración de la app, el
[manual](../MANUAL.md).
