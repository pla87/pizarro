# Prueba real de instalación y recuperación en un VPS

Guía para hacer **una prueba de principio a fin** con un servidor barato: instalar Pizarro, meter datos, hacer copia de seguridad, **destruir el servidor** y recuperarlo todo en uno nuevo. Es la única forma de saber que la recuperación funciona de verdad. No necesitas ser técnico: copia y pega los comandos en orden.

- **Duración:** unas 2-3 horas en total.
- **Coste:** menos de 1 € (un servidor de ~5 €/mes se cobra por horas y se borra al terminar; el dominio ya lo tienes). Cloudflare R2 tiene un plan gratuito de 10 GB.
- **Qué necesitas:** un dominio con acceso a su DNS (se usará un subdominio, p. ej. `prueba.tudominio.com`), una tarjeta, una cuenta de Cloudflare (para R2) y un terminal (macOS/Linux: «Terminal»; Windows 10/11: «PowerShell»).
- No pegues nunca claves reales en chats ni en el repositorio. Las claves de esta prueba se borran al final.

Lo que se prueba: instalador, HTTPS, asistente `/setup`, administrador con doble verificación (2FA), datos y adjuntos, copia cifrada en R2, y restauración en un servidor nuevo con `dist/restore.mjs`.

## 1. Crear el servidor

Ejemplo con **Hetzner Cloud** (https://console.hetzner.cloud); vale cualquier proveedor equivalente (Contabo, DigitalOcean, OVH…).

1. Crea una cuenta y un proyecto (p. ej. «prueba-pizarro»).
2. Genera una clave SSH en tu ordenador (si no tienes una; deja la contraseña vacía o pon una que recuerdes):

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/pizarro_prueba -C "prueba-pizarro"
   cat ~/.ssh/pizarro_prueba.pub
   ```

   En PowerShell, cambia `~/.ssh/` por `$HOME\.ssh\`. El segundo comando muestra la clave **pública** (una línea que empieza por `ssh-ed25519`): es la que se pega en el proveedor. La privada (sin `.pub`) no se comparte con nadie.
3. En Hetzner: *Add Server* con estos valores:
   - Ubicación: la más cercana a ti (p. ej. Falkenstein o Helsinki).
   - Imagen: **Ubuntu 24.04**.
   - Tipo: **CX22** (2 vCPU, 4 GB RAM, ~5 €/mes). Sirve cualquiera con 2 GB de RAM o más.
   - Networking: IPv4 activada (IPv6 opcional).
   - SSH keys: *Add SSH key* y pega la clave pública.
   - Nombre: `prueba-1`.
4. Crea el servidor y apunta su **dirección IP** (p. ej. `203.0.113.10`). Más abajo se escribe como `IP-DEL-SERVIDOR`.

## 2. Cortafuegos (22, 80, 443)

En Hetzner: *Firewalls → Create Firewall*. Reglas de entrada (*Inbound*):

| Protocolo | Puerto | Origen |
|---|---|---|
| TCP | 22 | Cualquiera (o solo tu IP, mejor) |
| TCP | 80 | Cualquiera |
| TCP | 443 | Cualquiera |
| UDP | 443 | Cualquiera (opcional, HTTP/3) |

Aplícalo al servidor (*Apply to → prueba-1*). Todo lo demás queda bloqueado.

## 3. Registro DNS

En el panel DNS de tu dominio crea un registro:

| Tipo | Nombre | Valor | TTL |
|---|---|---|---|
| `A` | `prueba` | `IP-DEL-SERVIDOR` | el más bajo (300 s) |

Si usas Cloudflare como DNS, déjalo en **«Solo DNS» (nube gris)** para que Caddy pueda obtener el certificado. Comprueba que ya responde (puede tardar unos minutos):

```bash
nslookup prueba.tudominio.com
```

Debe devolver tu IP. **Anota la hora de este paso**: en el paso 12 repetirás el cambio de IP.

## 4. Entrar al servidor e instalar Docker

```bash
ssh -i ~/.ssh/pizarro_prueba root@IP-DEL-SERVIDOR
```

Responde `yes` la primera vez. Ya dentro:

```bash
apt-get update && apt-get -y upgrade
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
apt-get install -y git
```

(Si `apt` indica que hace falta reiniciar, ejecuta `reboot`, espera un minuto y vuelve a entrar con `ssh`.)

## 5. Descargar Pizarro e instalar

```bash
mkdir -p /opt/pizarro
git clone <URL-del-repositorio> /opt/pizarro
cd /opt/pizarro/deploy
time ./install.sh --domain prueba.tudominio.com
```

Sustituye `<URL-del-repositorio>` por la dirección del repositorio de Pizarro y `prueba.tudominio.com` por tu subdominio. El instalador construye la imagen (la primera vez tarda **5-10 minutos**), arranca todo y al final escribe algo como:

```
[setup] Abre https://prueba.tudominio.com/setup e introduce el código: K7QM-4TXD
```

**Apunta cuánto tardó** (lo muestra `time`). Si falla el certificado HTTPS, casi siempre es porque el DNS (paso 3) aún no apunta al servidor o el puerto 80/443 está cerrado (paso 2): `docker compose logs caddy`.

## 6. Guardar el kit de recuperación (importante)

El instalador crea `/opt/pizarro/deploy/recovery-kit.txt` con las claves. **Sin él no podrás recuperar nada en el paso 13.** Cópialo a tu ordenador (desde **tu ordenador**, en otra ventana de terminal):

```bash
scp -i ~/.ssh/pizarro_prueba root@IP-DEL-SERVIDOR:/opt/pizarro/deploy/recovery-kit.txt ~/Desktop/recovery-kit-prueba.txt
```

Guárdalo en tu gestor de contraseñas durante la prueba y bórralo al terminar.

## 7. Asistente `/setup`, administrador y 2FA

1. Abre `https://prueba.tudominio.com/setup` en el navegador e introduce el **código** del paso 5. (Si lo perdiste: `cd /opt/pizarro/deploy && docker compose logs app | grep "introduce el código"`.)
2. Rellena organización, idioma y zona horaria.
3. Crea el **administrador** (tu nombre, tu email y una contraseña de 10 caracteres o más).
4. Salta el email (no hay SMTP en esta prueba) o pruébalo si lo configuraste.
5. Inicia sesión. Pizarro pedirá activar la **verificación en dos pasos**: escanea el QR con tu app de autenticación (Google Authenticator, Authy, 1Password…), introduce el código y **guarda los códigos de recuperación** en un sitio seguro.

Comprueba que el candado HTTPS del navegador es válido.

## 8. Crear datos de prueba

Crea cosas reconocibles, para poder comprobarlas después:

1. Un **proyecto** llamado «Prueba VPS» con 2-3 columnas.
2. Unas **10 tareas** repartidas por las columnas, con descripciones, etiquetas y fechas; mueve alguna entre columnas y comenta en un par de ellas.
3. **Adjuntos:** en 3-4 tareas sube imágenes y algún PDF (alguno de varios MB). Apunta nombres y tamaños.
4. **Documentos:** en la sección de documentos del proyecto, sube 2 ficheros (un PDF y una imagen o texto) y, si puedes, crea una carpeta.
5. Si quieres, una nota de versión (release).

Haz una captura o anota: número de tareas, de adjuntos y de documentos. Lo contarás de nuevo en el paso 14.

## 9. Configurar la copia externa en Cloudflare R2

1. En Cloudflare: *R2 → Create bucket*, nombre `pizarro-prueba`, **privado**.
2. *R2 → Manage API tokens → Create API token*: permiso **Object Read & Write**, limitado a ese bucket. Copia el *Access Key ID*, el *Secret Access Key* y la URL del endpoint (`https://<id-de-cuenta>.r2.cloudflarestorage.com`).
3. En el servidor, edita el `.env`:

   ```bash
   cd /opt/pizarro/deploy
   nano .env
   ```

   Añade al final (con tus valores):

   ```bash
   BACKUP_S3_ENDPOINT="https://<id-de-cuenta>.r2.cloudflarestorage.com"
   BACKUP_S3_BUCKET="pizarro-prueba"
   BACKUP_S3_ACCESS_KEY_ID="…"
   BACKUP_S3_SECRET_ACCESS_KEY="…"
   BACKUP_S3_PREFIX="pizarro"
   ```

   Guarda con `Ctrl+O`, `Enter`, y sal con `Ctrl+X`. `BACKUP_KEY` ya está en el `.env` (la creó el instalador).
4. Aplica el cambio: `docker compose up -d`.

## 10. Crear la copia y comprobarla fuera

1. En Pizarro: *Administración → Copias de seguridad*. Pulsa **Crear copia ahora** y, cuando termine, **Copiar ahora a destino externo**. Recarga pasados unos minutos: el estado debe ser *Correcta*.
2. Comprueba en el panel de R2 que el bucket contiene objetos bajo `pizarro/`.
3. Desde el servidor, lista las copias del destino externo (sirve también para comprobar que la restauración puede leerlas):

   ```bash
   cd /opt/pizarro/deploy
   docker compose run --rm --no-deps app node dist/restore.mjs s3:latest --list
   ```

   Apunta el nombre de la copia (`pizarro-backup-AAAAMMDDTHHMMSSZ`).
4. Guarda el diagnóstico del servidor original:

   ```bash
   docker compose exec app node dist/doctor.mjs > /root/doctor-original.txt
   cat /root/doctor-original.txt
   ```

   Cópialo a tu ordenador (`scp`, como en el paso 6) o pégalo en un fichero local: lo compararás luego.
5. Opcional: una copia manual adicional de la base de datos, `docker compose exec -T postgres pg_dump -U pizarro -Fc pizarro > /root/manual.dump`.

## 11. Simular el desastre

Hasta aquí, todo lo que hay en R2 y en tu `recovery-kit-prueba.txt` es lo único que sobrevivirá. Confirma que tienes ambos y:

1. En Hetzner, **elimina el servidor** `prueba-1` (*Delete*). Con él desaparecen el disco, la base de datos y los adjuntos.
2. Comprueba que `https://prueba.tudominio.com` ya no responde.

**Anota la hora** de este paso: el tiempo hasta tener la app de nuevo funcionando es tu *tiempo de recuperación real*.

## 12. Servidor nuevo y DNS

1. Repite el paso 1 (mismo tipo, nombre `prueba-2`, misma clave SSH) y aplícale el mismo cortafuegos (paso 2).
2. Cambia el registro `A` del paso 3 a la **nueva IP**.
3. Como la IP nueva es distinta, borra la entrada vieja de SSH en tu ordenador y entra:

   ```bash
   ssh-keygen -R IP-DEL-SERVIDOR-ANTIGUO
   ssh -i ~/.ssh/pizarro_prueba root@IP-DEL-SERVIDOR-NUEVO
   ```

4. Instala Docker y git como en el paso 4.

## 13. Instalar y restaurar desde R2

Sigue la sección 6.3 de `docs/INSTALL.md` («Servidor nuevo o disco perdido»). Resumido:

```bash
mkdir -p /opt/pizarro
git clone <URL-del-repositorio> /opt/pizarro
cd /opt/pizarro/deploy
./install.sh --domain prueba.tudominio.com --no-start
nano .env
```

En el `.env` nuevo, **sustituye** estos cuatro valores por los de tu `recovery-kit-prueba.txt` (los demás, como `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `DOMAIN` y `APP_URL`, déjalos como están):

```bash
SESSION_SECRET="…"
TOKEN_SECRET="…"
ENCRYPTION_KEY="…"
BACKUP_KEY="…"
```

Y añade al final las cinco variables `BACKUP_S3_*` del paso 9. Guarda y sal. Después:

```bash
docker compose build app
docker compose up -d postgres
docker compose run --rm --no-deps app node dist/restore.mjs s3:latest --list
time docker compose run --rm --no-deps app node dist/restore.mjs s3:latest --files
docker compose up -d
```

`restore.mjs` verifica la copia, restaura la base de datos y los ficheros y muestra un resumen. Si dice «copia de una versión más nueva» o «la base ya tiene datos», copia el mensaje completo para el informe. Cuando acabe, espera 1-2 minutos y comprueba `docker compose ps` (la app debe aparecer *healthy*).

**Anota la hora** en que la app vuelve a abrirse: ese es el fin del tiempo de recuperación.

## 14. Verificar

Abre `https://prueba.tudominio.com`. **No** debe aparecer `/setup`: debe ir al inicio de sesión.

- [ ] Entras con tu email y contraseña.
- [ ] Pizarro pide el código **2FA** y el mismo código de tu app de autenticación funciona (si no, `ENCRYPTION_KEY` no es la correcta).
- [ ] Está el proyecto «Prueba VPS», con las mismas columnas y tareas, en su sitio, con sus comentarios.
- [ ] Los **adjuntos** de las tareas se abren y las miniaturas se ven; los nombres y tamaños coinciden.
- [ ] Los **documentos** del proyecto se abren/descargan.
- [ ] *Administración → Copias de seguridad* muestra el destino externo y permite crear una copia nueva.
- [ ] Sube un adjunto nuevo y comprueba que funciona.

Después guarda el diagnóstico y compáralo con el del servidor original:

```bash
cd /opt/pizarro/deploy
docker compose exec app node dist/doctor.mjs
```

Comprobación opcional de endurecimiento: `docker compose exec app sh -c 'touch /app/server.js'` debe fallar con «Read-only file system».

## 15. Qué debes enviarnos

Copia esta plantilla y rellénala (sin contraseñas, claves ni códigos 2FA):

```
Proveedor / tipo de servidor:
Tiempos:
  - install.sh (primera vez):
  - Creación de la copia + subida a R2:
  - restore.mjs (--files):
  - Desastre -> app funcionando de nuevo (total):
Qué funcionó:
Qué falló o confundió (mensaje exacto de error y paso):
Verificación del paso 14 (marca cada casilla; indica las que fallaron):
Número de tareas / adjuntos / documentos antes y después:
Salida de `docker compose exec app node dist/doctor.mjs`:
  - original (paso 10):
  - tras la restauración (paso 14):
Tamaño de la copia en R2 (aprox.):
Sugerencias para mejorar esta guía:
```

Si algo falla, antes de borrar nada guarda los registros: `docker compose logs --no-color > /root/logs.txt`.

## 16. Borrar todo (y dejar de pagar)

Haz esto **cuando hayas enviado el informe**:

1. Hetzner: elimina el servidor `prueba-2` (*Delete*, no solo apagarlo: un servidor apagado se sigue cobrando), el cortafuegos y la clave SSH del proyecto. Comprueba en *Billing* que no queda ningún recurso.
2. DNS: borra el registro `A` de `prueba`.
3. Cloudflare R2: borra el token de API y vacía y elimina el bucket `pizarro-prueba`.
4. Tu ordenador: borra `recovery-kit-prueba.txt` y la clave `~/.ssh/pizarro_prueba` (y `.pub`). Elimina la entrada de la app de autenticación de esta prueba.

Coste orientativo: CX22 ≈ 0,008 €/hora, así que dos servidores durante 3 horas suponen menos de 0,10 €; R2 y la IP no cuestan en una prueba de este tamaño (Hetzner cobra el mes completo como máximo).
