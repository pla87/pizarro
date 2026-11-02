# Probar Pizarro en un VPS barato (guía paso a paso)

Esta guía es para probar, **de principio a fin y sin ser técnico**, la instalación de Pizarro en un solo comando sobre un servidor de alquiler. Copia y pega los bloques en orden. Al terminar sabrás si la instalación, las copias de seguridad y la recuperación funcionan de verdad, y borrarás el servidor para dejar de pagar.

- **Duración:** 1 hora para instalar y probar; 2-3 horas si haces también las pruebas de copias, desastre y actualización.
- **Coste:** menos de 1 € (un servidor de ~5 €/mes se cobra por horas y se borra al terminar).
- **Qué necesitas:** una tarjeta, un terminal (macOS: «Terminal»; Windows 10/11: «PowerShell»), y opcionalmente un dominio con acceso a su DNS. Para probar la copia externa, una cuenta gratuita de Cloudflare (R2).
- No pegues nunca claves reales en chats ni en el repositorio. Todo lo de esta prueba se borra al final.

Donde veas `IP-DEL-SERVIDOR` o `pizarro.example.com`, **sustitúyelo por tus valores**.

## Dos formas de probar

| | Con dominio (recomendada) | Sin dominio (`--local`) |
|---|---|---|
| Dirección | `https://pizarro.example.com` | `http://IP-DEL-SERVIDOR` |
| HTTPS | Sí, automático (Let's Encrypt) | No, solo HTTP |
| Necesitas | Un dominio y crear un registro DNS | Nada más |
| Qué no se prueba | Nada | El certificado, el inicio de sesión con Google y las cookies seguras |

Si solo quieres ver que arranca, usa `--local`. Para una prueba completa, usa dominio.

## 1. Elegir y crear el servidor

Sirve cualquier proveedor: **Hetzner Cloud**, **DigitalOcean** u **OVH**. Pide:

| Dato | Valor |
|---|---|
| Sistema | **Ubuntu 24.04** |
| Memoria | **1 GB de RAM** basta (la imagen ya viene construida). Solo si instalas con `--build` (se compila en el servidor) hacen falta 2 GB |
| CPU | 1-2 vCPU |
| Disco | 20 GB o más |
| Precio | ~5 €/mes (se cobra por horas) |
| IPv4 | Activada |
| Acceso | Contraseña de root o clave SSH (lo que ofrezca el proveedor; la clave es más cómoda y segura) |

Al crearlo, el proveedor te da una **dirección IP** (p. ej. `203.0.113.10`). Apúntala: en esta guía es `IP-DEL-SERVIDOR`.

> **Recuerda borrar el servidor al terminar** (sección 11). Apagarlo no basta: un servidor apagado se sigue cobrando.

## 2. Conectarte por SSH

SSH es una ventana de texto que te deja escribir órdenes en el servidor.

**Windows (PowerShell):** pulsa la tecla Windows, escribe «PowerShell» y ábrelo.

```powershell
ssh root@IP-DEL-SERVIDOR
```

**macOS:** abre «Terminal» (Cmd+Espacio, «Terminal»).

```bash
ssh root@IP-DEL-SERVIDOR
```

La primera vez pregunta si te fías del servidor: escribe `yes` y Enter. Si usaste contraseña, escríbela (no se ve nada mientras tecleas; es normal). Si usaste una clave SSH propia, añade `-i RUTA-DE-TU-CLAVE` después de `ssh`.

Esperado: una línea parecida a esta indica que ya estás dentro:

```
root@pizarro-prueba:~#
```

A partir de aquí, lo que pone «en el servidor» se escribe en esa ventana. Para pegar: en PowerShell, clic derecho; en macOS, Cmd+V.

## 3. Cortafuegos: puertos 80 y 443

Pizarro necesita dos puertos abiertos hacia internet: **80** (obtener el certificado y redirigir a HTTPS) y **443** (la web). Además, el **22** para entrar tú por SSH. Muchos proveedores tienen un cortafuegos propio en el panel (Hetzner: *Firewalls*; DigitalOcean: *Networking → Firewalls*; OVH: *Network → Firewall*). Si no creaste ninguno, normalmente ya está todo abierto.

Si creas uno, estas son las reglas de entrada:

| Protocolo | Puerto | Para qué |
|---|---|---|
| TCP | 22 | Entrar por SSH |
| TCP | 80 | Certificado y redirección |
| TCP | 443 | La web |
| UDP | 443 | Opcional (HTTP/3) |

Aplícalo al servidor. Después de instalar (sección 5) puedes comprobar desde **tu ordenador** que los puertos responden:

```powershell
# Windows (PowerShell)
Test-NetConnection IP-DEL-SERVIDOR -Port 80
Test-NetConnection IP-DEL-SERVIDOR -Port 443
```

```bash
# macOS
nc -vz IP-DEL-SERVIDOR 80
nc -vz IP-DEL-SERVIDOR 443
```

Esperado: `TcpTestSucceeded : True` (Windows) o `succeeded` / `open` (macOS). Si da `False` o se queda colgado, el puerto está cerrado: revisa el cortafuegos del panel.

## 4. Registro DNS (solo con dominio)

Salta esta sección si usas `--local`.

En el panel DNS de tu dominio crea un registro:

| Tipo | Nombre | Valor | TTL |
|---|---|---|---|
| `A` | `pizarro` | `IP-DEL-SERVIDOR` | el más bajo (300 s) |

Eso hace que `pizarro.example.com` apunte al servidor. Si usas Cloudflare como DNS, déjalo en **«Solo DNS» (nube gris)**; con la nube naranja, el certificado puede fallar.

**Espera a que se propague** (de 1 a 30 minutos; a veces más). Compruébalo desde tu ordenador:

```bash
nslookup pizarro.example.com
```

Esperado: devuelve `IP-DEL-SERVIDOR` en «Address». Si dice `NXDOMAIN` o devuelve otra IP, espera unos minutos y repite. **No instales hasta que salga tu IP**: sin DNS listo, el certificado HTTPS no se puede conseguir.

## 5. Instalar con un comando

En el servidor. Con dominio:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --domain pizarro.example.com
```

O, para probar por IP sin dominio:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --local
```

Qué verás, en orden:

1. Si falta Docker (en un Ubuntu recién creado, lo normal), pregunta: `¿Instalo Docker con el script oficial (https://get.docker.com)? [s/N]`. Escribe **`s`** y Enter. (Para que no pregunte, añade `--yes` al final del comando.)
2. `Última versión publicada: vX.Y.Z.`, `Descargando Pizarro (vX.Y.Z) desde GitHub...` y `Instalando en /opt/pizarro...`. (Si dice que no puede saber la última versión o que aún no hay ninguna publicada, se detiene: repite más tarde o añade `--build` para construir el código en el servidor, lo que necesita 2 GB de RAM y tarda 5-10 minutos.)
3. `Secretos generados: ...` y `Kit de recuperación escrito en /opt/pizarro/deploy/recovery-kit.txt`.
4. `Descargando la imagen de Pizarro...` y `Arrancando Pizarro...` La imagen ya está construida: se descarga en **segundos o pocos minutos** según la conexión; salen varias líneas de progreso, es normal.
5. `Esperando a que la app esté lista...` y por fin:

```
Pizarro está en marcha.

  Dirección:  https://pizarro.example.com
  Asistente:  https://pizarro.example.com/setup
  Código:     K7QM-4TXD      (caduca en 24 horas; se renueva si se reinicia la app)
```

6. Un recuadro de `#####` con el aviso de guardar el kit de recuperación.

**Copia dos cosas:** la dirección del asistente y el **código** (con `--local` la dirección será `http://IP-DEL-SERVIDOR/setup`).

Si pierdes el código:

```bash
cd /opt/pizarro/deploy && docker compose logs app | grep "introduce el código"
```

### Guardar el kit de recuperación FUERA del servidor

El fichero `/opt/pizarro/deploy/recovery-kit.txt` contiene las claves para leer tus copias de seguridad. **Sin él, la sección 9 no se puede hacer.** Muéstralo en el servidor y cópialo a tu gestor de contraseñas:

```bash
cat /opt/pizarro/deploy/recovery-kit.txt
```

O descárgalo desde **tu ordenador** (otra ventana, no la del servidor):

```bash
scp root@IP-DEL-SERVIDOR:/opt/pizarro/deploy/recovery-kit.txt recovery-kit-prueba.txt
```

(En PowerShell funciona igual.) Nunca lo envíes por email ni lo subas a un repositorio.

Comprobación rápida de que todo está levantado:

```bash
cd /opt/pizarro/deploy && docker compose ps
```

Esperado: tres servicios (`caddy`, `app`, `postgres`) en estado `running`/`Up`, y `app` con `(healthy)`.

## 6. Completar el asistente en el navegador

1. Abre la dirección del asistente (`https://pizarro.example.com/setup`). Con dominio, el candado del navegador debe ser válido. Con `--local`, el navegador avisará de que no es seguro: es normal por usar HTTP.
2. Escribe el **código** de la sección 5.
3. Elige nombre de organización, idioma y zona horaria.
4. Crea el **administrador**: nombre, email (uno tuyo, para poder recibir correos de prueba) y contraseña de 10 caracteres o más.
5. En el paso de email puedes saltar (todavía no hay correo configurado).
6. Inicia sesión. Pizarro pide activar la **verificación en dos pasos**: escanea el QR con una app de autenticación (Google Authenticator, Authy, 1Password…), escribe el código y **guarda los códigos de recuperación**.

Esperado: entras al tablero de Pizarro, y `/setup` ya responde «no encontrado» (404).

## 7. Lista de comprobación funcional

Marca cada punto. Crea cosas reconocibles para poder comprobarlas después (sección 9).

- [ ] **Proyecto:** crea un proyecto «Prueba VPS» con 2-3 columnas.
- [ ] **Tarea con adjunto:** crea una tarea, ábrela y sube una imagen y un PDF. Se ve la miniatura y se abre el PDF. Crea unas 10 tareas, mueve alguna entre columnas y comenta en un par.
- [ ] **Release:** crea una nota de versión (release) y ábrela en la vista previa o publícala.
- [ ] **Email de prueba:** *Administración → Ajustes → Avisos por email*: configura un proveedor SMTP y pulsa el botón de envío de prueba. Esperado: llega un correo. Sin SMTP este punto se salta (no es un fallo; solo faltan invitaciones y «¿Olvidaste tu contraseña?»).
- [ ] **Entrar con Google (opcional):** *Administración → Ajustes → Acceso con Google* y sigue la guía desplegable. Solo funciona con dominio y HTTPS.
- [ ] **Estado:** abre `https://pizarro.example.com/api/health`. Esperado: `{"status":"ok"}`.

Apunta cuántas tareas, adjuntos y releases has creado: los contarás de nuevo tras restaurar.

## 8. Prueba de copias de seguridad

Con `BACKUP_KEY` (la crea el instalador) ya se hacen copias diarias cifradas **dentro del servidor**. Eso no te salva si el servidor desaparece, así que se añade un destino **externo**. Usamos Cloudflare R2 (plan gratuito de 10 GB).

1. En Cloudflare: *R2 → Create bucket*, nombre `pizarro-prueba`, **privado**.
2. *R2 → Manage API tokens → Create API token*: permiso **Object Read & Write**, limitado a ese bucket. Copia el *Access Key ID*, el *Secret Access Key* y la URL del endpoint (`https://<id-de-cuenta>.r2.cloudflarestorage.com`).
3. En el servidor:

   ```bash
   cd /opt/pizarro/deploy
   nano .env
   ```

   Baja al final del fichero y añade (con tus valores):

   ```bash
   BACKUP_S3_ENDPOINT="https://<id-de-cuenta>.r2.cloudflarestorage.com"
   BACKUP_S3_BUCKET="pizarro-prueba"
   BACKUP_S3_ACCESS_KEY_ID="…"
   BACKUP_S3_SECRET_ACCESS_KEY="…"
   BACKUP_S3_PREFIX="pizarro"
   ```

   Guarda con `Ctrl+O`, `Enter` y sal con `Ctrl+X`.
4. Aplica el cambio:

   ```bash
   docker compose up -d
   ```

5. En Pizarro: *Administración → Copias de seguridad*. Pulsa **Crear copia ahora** y, al terminar, **Copiar ahora a destino externo**. Recarga pasados unos minutos.

   Esperado: la última subida aparece como *Correcta*.
6. Comprueba en el panel de R2 que el bucket tiene objetos bajo `pizarro/`.
7. Comprueba desde el servidor que la restauración puede leerlas:

   ```bash
   docker compose run --rm --no-deps app node dist/restore.mjs s3:latest --list
   ```

   Esperado: una lista con al menos una copia llamada `pizarro-backup-AAAAMMDDTHHMMSSZ`. Apúntala.
8. Guarda el diagnóstico del servidor para compararlo luego:

   ```bash
   docker compose exec app node dist/doctor.mjs > /root/doctor-original.json
   ```

   Cópialo a tu ordenador con `scp`, como en la sección 5.

## 9. Prueba de desastre: destruir y restaurar en un VPS nuevo

Esta es la prueba que de verdad importa. Lo único que sobrevivirá es lo que hay en R2 y tu `recovery-kit-prueba.txt`. **Confirma que tienes ambos** antes de seguir.

1. En el panel del proveedor, **elimina el servidor** (*Delete*). Desaparecen disco, base de datos y adjuntos. Comprueba que la dirección ya no responde. **Anota la hora**: el tiempo hasta volver a tener la app es tu tiempo de recuperación real.
2. Crea un servidor nuevo como en la sección 1 (mismas características) y aplica el mismo cortafuegos.
3. Con dominio: cambia el registro `A` (sección 4) a la **IP nueva** y espera la propagación.
4. Conéctate. Como la IP es nueva, si tu ordenador se queja de «host key», borra la entrada vieja y entra:

   ```bash
   ssh-keygen -R IP-DEL-SERVIDOR-ANTIGUO
   ssh root@IP-DEL-SERVIDOR-NUEVO
   ```

5. Instala **sin arrancar** (prepara todo pero no levanta la app):

   ```bash
   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --domain pizarro.example.com --no-start --yes
   ```

6. Edita el `.env` nuevo:

   ```bash
   cd /opt/pizarro/deploy
   nano .env
   ```

   **Sustituye** estos cuatro valores por los de tu `recovery-kit-prueba.txt` (los demás, como `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `DOMAIN` y `APP_URL`, déjalos como están):

   ```bash
   SESSION_SECRET="…"
   TOKEN_SECRET="…"
   ENCRYPTION_KEY="…"
   BACKUP_KEY="…"
   ```

   Y añade al final las cinco líneas `BACKUP_S3_*` de la sección 8. Guarda y sal.
7. Descarga la imagen, restaura y arranca (detalle en la sección 6.3 de `docs/INSTALL.md`):

   ```bash
   docker compose pull app
   docker compose up -d postgres
   docker compose run --rm --no-deps app node dist/restore.mjs s3:latest --list
   time docker compose run --rm --no-deps app node dist/restore.mjs s3:latest --files
   docker compose up -d
   ```

   Esperado: `restore.mjs` verifica la copia, restaura la base de datos y los ficheros y muestra un resumen. Espera 1-2 minutos y comprueba `docker compose ps`: `app` en `(healthy)`. **Anota la hora**: fin del tiempo de recuperación.
8. Abre la dirección. **No** debe salir `/setup`: debe salir el inicio de sesión. Comprueba:

   - [ ] Entras con tu email y contraseña de siempre.
   - [ ] El mismo código 2FA de tu app funciona (si no, `ENCRYPTION_KEY` no es la correcta).
   - [ ] Está el proyecto «Prueba VPS» con sus columnas, tareas y comentarios.
   - [ ] Los adjuntos se abren y las miniaturas se ven; el número coincide con el que apuntaste.
   - [ ] El release sigue ahí.
   - [ ] *Administración → Copias de seguridad* muestra el destino externo.
   - [ ] Puedes subir un adjunto nuevo.

## 10. Prueba de actualización

Actualizar es repetir el mismo comando. Conserva `.env`, el kit y los datos.

1. Mira la versión actual: en la web, abajo de la barra lateral (`v…`), o en el servidor:

   ```bash
   cd /opt/pizarro/deploy && docker compose exec app node dist/doctor.mjs | grep -m1 '"version"'
   ```

2. Vuelve a ejecutar el instalador, con el mismo dominio (o `--local`):

   ```bash
   curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/pla87/pizarro/main/deploy/get.sh | sh -s -- --domain pizarro.example.com
   ```

   Esperado: `Actualizando el código en /opt/pizarro (se conservan deploy/.env y el kit de recuperación)...`, `Los secretos ya existían: no se ha cambiado ninguno.` y al final `La instalación ya estaba configurada: entra con tu usuario.` (sin código de `/setup`).
   Esperado también: `Última versión publicada: vX.Y.Z.` y, en lugar de una compilación, `Descargando la imagen de Pizarro...` (segundos).
3. Comprueba que tus datos siguen ahí y que la versión es la esperada (la misma si no hay novedades, o la nueva).
4. **Fijar o volver a una versión** (opcional): añade `--version X.Y.Z` al mismo comando (por ejemplo `... | sh -s -- --domain pizarro.example.com --version 1.37.0`). Instala el código y la imagen de esa versión. Ojo: las migraciones de la base de datos solo avanzan; si la versión nueva ya migró los datos, volver atrás puede exigir restaurar antes una copia de seguridad (sección 7 y siguientes), así que no cuentes con un «rollback inmediato».
5. **Privacidad:** Pizarro consulta `api.github.com` cada 12 horas para avisar de versiones nuevas (solo pide la última versión, no envía datos de tu instalación). Para desactivarlo, pon `UPDATE_CHECK=0` en `/opt/pizarro/deploy/.env` y ejecuta `docker compose up -d`.

## 11. Desinstalar y limpiar

Cuando termines (y hayas apuntado lo que quieras contar):

1. Opcional, para guardar los registros si algo falló: `docker compose logs --no-color > /root/logs.txt`.
2. Parar y borrar Pizarro y **todos sus datos** en el servidor (sin vuelta atrás):

   ```bash
   cd /opt/pizarro/deploy
   docker compose down -v
   ```

3. **Borra el servidor** en el panel del proveedor (*Delete*, no solo apagar). Comprueba en *Billing* que no queda ningún recurso (servidor, IP flotante, disco, cortafuegos).
4. DNS: borra el registro `A` de `pizarro`.
5. Cloudflare R2: borra el token de API y vacía y elimina el bucket `pizarro-prueba`.
6. Tu ordenador: borra `recovery-kit-prueba.txt` y el diagnóstico guardado. Elimina la entrada de esta prueba en la app de autenticación y quita el servidor de tus claves conocidas con `ssh-keygen -R IP-DEL-SERVIDOR`.

## 12. Problemas frecuentes

| Qué ves | Causa probable | Qué hacer |
|---|---|---|
| El navegador avisa de certificado no válido, o `docker compose logs caddy` habla de «challenge» o «DNS problem» | El DNS aún no apunta al servidor (o apunta a otra IP) | Repite `nslookup` hasta ver tu IP, espera y reinicia Caddy: `cd /opt/pizarro/deploy && docker compose restart caddy`. En Cloudflare, nube gris. |
| La web no carga, o el certificado no se consigue aunque el DNS esté bien | El puerto 80 (o 443) está bloqueado por el cortafuegos del proveedor | Abre 80 y 443 (sección 3) y comprueba con `Test-NetConnection` / `nc`. |
| El instalador se detiene en «No encuentro Docker» y pregunta `[s/N]` | Ubuntu nuevo sin Docker | Responde `s`. Si no te deja (sin terminal), repite el comando añadiendo `--yes`. |
| El instalador dice «Sin Docker no puedo seguir» | Respondiste `n` o dejaste vacío | Repite el comando y responde `s`, o usa `--yes`. |
| «Sin terminal no puedo preguntar el dominio» | Falta `--domain` o `--local` | Añade `--domain pizarro.example.com` o `--local` al comando. |
| Solo con `--build`: la construcción se corta con «Killed» o `exit code 137`, o el servidor se congela | Memoria insuficiente (menos de 2 GB) para compilar | Usa un servidor de 2 GB o más, o instala sin `--build` (con la imagen publicada basta 1 GB). En un apuro, añade swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` y repite el comando. |
| `docker compose pull` dice «unauthorized» o «denied» | El paquete `ghcr.io/pla87/pizarro` aún es privado | Quien publica el repositorio debe hacerlo público una vez, tras la primera release: GitHub → *Packages* → `pizarro` → *Package settings* → *Change visibility* → *Public*. Mientras tanto, instala con `--build`. |
| «La app no ha llegado a healthy en 6 minutos» | Servidor lento o error al arrancar | `cd /opt/pizarro/deploy && docker compose logs --tail 80 app`. Si solo va lento, espera y mira `docker compose ps`. |
| No tengo el código de `/setup` | Caduca a las 24 h o se perdió la pantalla | `docker compose logs app \| grep "introduce el código"`, o `docker compose restart app` y repite. |
| `/setup` da 404 | Ya hay un administrador creado | Entra por `/login`. Para empezar de cero: sección 11 y volver a instalar. |
| `ssh` dice «REMOTE HOST IDENTIFICATION HAS CHANGED» | La IP nueva la usó antes otro servidor | `ssh-keygen -R IP-DEL-SERVIDOR` y vuelve a entrar. |
| Tras restaurar, el 2FA no acepta el código | `ENCRYPTION_KEY` distinta de la original | Pon en `.env` el valor del kit de recuperación y `docker compose up -d`. |
| `restore.mjs` dice «la base ya tiene datos» | La app llegó a arrancar contra la base nueva | Añade `--force` al comando de restauración (borra lo que haya en la base nueva). |

Más casos en la sección 8 de `docs/INSTALL.md`.

## 13. Qué contar al terminar

Copia esta plantilla (sin contraseñas, claves ni códigos):

```
Proveedor / tipo de servidor:
Con dominio o --local:
Tiempos:
  - Instalador (primera vez):
  - Desastre -> app funcionando de nuevo (total):
Qué funcionó:
Qué falló o confundió (mensaje exacto de error y en qué sección):
Lista funcional (sección 7): marcadas / falladas
Verificación tras restaurar (sección 9): marcadas / falladas
Tareas / adjuntos / releases antes y después:
Versión antes y después de actualizar:
Sugerencias para mejorar esta guía:
```
