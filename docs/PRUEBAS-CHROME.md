# Prompts para Claude in Chrome

Pruebas que hace Claude in Chrome en el navegador del propietario (Cloudflare, Railway, la web). Cada prompt va en su propia
conversación de Claude in Chrome. Cuando el propietario pasa los informes, se apunta aquí lo que ya está hecho y se
actualizan los prompts que sigan pendientes.

Lo aprendido en las pruebas de la ronda 62 (sirve para todos los prompts):

- Claude in Chrome no puede abrir ventanas de incógnito, redimensionar la ventana a 390 px ni arrastrar tarjetas (el
  arrastre simulado no las mueve: se mueven cambiando «Columna» en el detalle). Lo que necesite eso lo hace el propietario.
- «Recordar este dispositivo 14 días» solo sale en el paso del código de verificación en dos pasos, no en la pantalla de
  email y contraseña (la sesión ya dura 14 días desde el último uso sin marcar nada).
- Sin email configurado, «Nuevo usuario» ya no pide contraseña: al crear la cuenta muestra el enlace de invitación (72 h)
  para pasárselo; si se pierde, «Generar enlace de invitación nuevo» en la fila del usuario («Invitación pendiente»).
- Si se olvida la contraseña del administrador de prueba: en Railway, proyecto de prueba, servicio de Pizarro, pestaña
  *Console*, `node dist/reset-link.mjs <email>` (genera un enlace de un solo uso y queda en Logs como `auth.resetLinkCli`).
- La instalación de prueba tiene `APP_URL` puesta y su dominio de Railway se llama parecido al de la real: comprobar
  siempre el nombre del proyecto de Railway antes de tocar nada.

Estado tras la ronda 62 (v1.66.0):

- Hecho: revisión de Cloudflare y R2 (ronda 60), instalación desde cero en Railway con la web (ronda 60), copias en R2 y
  primera regla de bloqueo (ronda 61), pruebas en real de la v1.64/v1.65 y auditoría como usuario (ronda 62: sus informes
  se convirtieron en los arreglos de la v1.66.0). El `Caddyfile` ya no necesita un VPS: lo valida el workflow
  «Comprobaciones» en cada PR con la misma imagen de Caddy que usa la instalación.
- Pendientes, en este orden: 1 (dirección feedback@getpizarro.com), 2 (segunda regla de bloqueo en R2), 3 (comprobación de
  salud en Railway, cuando las dos instalaciones tengan la v1.66.0), 4 (pruebas en real de la v1.66.0).

## 1. Dirección para los informes de errores (Cloudflare Email Routing)

Antes de pegarlo, sustituye `<TU CORREO>` por el buzón donde quieres recibir los informes.

```text
Quiero que los emails a feedback@getpizarro.com me lleguen a mi correo <TU CORREO>, con el reenvío gratuito de Cloudflare (Email Routing). Trabaja en una pestaña nueva, no cambies nada más de Cloudflare y, si algo no coincide con lo que te describo o te pide pagar, para y pregúntame. No copies en tu informe claves ni datos personales.

1. En el panel de Cloudflare, abre el dominio getpizarro.com → Email → Email Routing. Si no está activado, «Get started» / «Enable Email Routing»: Cloudflare propondrá añadir registros MX y TXT (SPF) al DNS. Antes de aceptarlo, mira en DNS → Records si ya hay registros MX de otro proveedor de correo: si los hay, para y pregúntame (activar Email Routing los sustituiría).
2. Destination addresses → Add destination address: <TU CORREO>. Cloudflare enviará un email de verificación a ese buzón: dime que lo abra y pulse el enlace, y espera a que el estado sea «Verified».
3. Routing rules → Create address: custom address «feedback», action «Send to an email», destination <TU CORREO>. Guárdala y comprueba que está activa.
4. Prueba: dime que envíe desde otro correo un email a feedback@getpizarro.com con el asunto «Prueba feedback» y comprueba conmigo que llega (también en Spam).

Informe en español: qué estaba ya hecho, qué has cambiado (sin copiar el correo completo) y el resultado de la prueba.
```

## 2. Segunda regla de bloqueo en R2 para los adjuntos de las copias

```text
Quiero añadir una regla de retención (Bucket Lock Rule) en el bucket de Cloudflare R2 donde Pizarro guarda las copias de seguridad. Trabaja en una pestaña nueva, no borres nada ni cambies ninguna otra regla, y si algo no coincide con lo que te describo, para y pregúntame. No copies claves en tu informe.

1. Panel de Cloudflare → R2 → el bucket de las copias de Pizarro (el que ya tiene la regla «copias-pizarro» con el prefijo pizarro/pizarro-backup- a 31 días). Si no la encuentras, para y pregúntame.
2. Settings → Bucket Lock Rules → Add rule: nombre «adjuntos-pizarro», prefijo exacto `pizarro/files/`, retención de 180 días. Guarda.
3. Comprueba que quedan las dos reglas («copias-pizarro» a 31 días y «adjuntos-pizarro» a 180 días) y que en la lista de objetos hay ficheros bajo pizarro/files/ (solo mirar).

Informe en español: las reglas que hay ahora (nombre, prefijo y días) y cualquier aviso que mostrara Cloudflare.
```

## 3. Comprobación de salud en Railway (las dos instalaciones)

Desde la v1.66.0 el repositorio ya no trae `railway.json` (Railway dejó de leerlo): estos ajustes se ponen una vez en el
panel. Hazlo cuando las dos instalaciones tengan la v1.66.0.

```text
Quiero ajustar dos cosas en los servicios de Pizarro de mis dos proyectos de Railway: el real («Pizarro») y el de prueba («pizarro-prueba-instalacion»). Trabaja en pestañas nuevas, no cambies nada que no te pida y, si algo no coincide, para y pregúntame. No copies valores de variables en tu informe.

En cada proyecto, en el servicio de Pizarro:
0. «Historial de versiones» en la app (o el despliegue activo en Railway) debe ser v1.66.0. Si no, comprueba que la rama sea `stable` y pulsa «Deploy»; espera a que termine.
1. Settings → Deploy: «Healthcheck Path» = /api/health y «Healthcheck Timeout» = 600 (si no ves el tiempo, añade en Variables RAILWAY_HEALTHCHECK_TIMEOUT_SEC con el valor 600). «Restart Policy»: On Failure. Réplicas: 1. No cambies el «Custom Start Command» si está vacío.
2. Despliega de nuevo (Deploy) y, en el log del despliegue (Deploy Logs / pestaña del despliegue), busca las líneas de la comprobación de salud: «Starting Healthcheck», «Path: /api/health» y al final «Healthcheck succeeded!». Cópiame esas líneas.
3. Abre la app y comprueba que funciona (entra y abre un tablero).

Informe en español, por proyecto: qué valores había antes, qué has puesto y las líneas del log.
```

## 4. Pruebas en real de la versión 1.66.0 (instalación de prueba)

```text
Quiero que compruebes en real algunas novedades de Pizarro v1.66.0 y me des un informe. Usa la instalación de PRUEBA (proyecto `pizarro-prueba-instalacion` de Railway, administrador `admin-prueba@example.com`); no toques la real. Si no recuerdas la contraseña, para y pídeme que entre yo. Si algo no coincide con lo que te describo, para y pregúntame. Antes de cualquier paso que cueste dinero, para y pregúntame. No copies claves ni datos personales.

0. «Historial de versiones» debe decir v1.66.0. Si no: en Railway, servicio de Pizarro, rama `stable` y «Deploy».
1. Informar de un error (botón del bicho junto a «Cerrar sesión»): escribe «Prueba, ignorar». Con el teclado (Tab) recorre «Tipo»: el resaltado debe rodear toda la opción. Si la instalación no envía emails, el botón principal debe ser «Enviar por email» (abre el programa de correo con feedback@getpizarro.com) y debajo «o publicarlo en GitHub». NO lo envíes: «Cancelar».
2. Detalle de una tarea con una descripción larga: baja hasta la mitad y haz doble clic en una palabra. El editor debe abrirse sin mover el texto y con el cursor en esa palabra.
3. En una tarea de tipo de la plantilla Casa y familia, escribe algo tras «Qué hay que hacer:» y, sin guardar, cambia el tipo a «Reforma u obra»: lo escrito debe quedar una sola vez, sin cabeceras repetidas ni apartados vacíos del tipo anterior. El aviso debe decir que el tipo está guardado y la descripción no.
4. Comentario con «@» en una tarea abierta: la lista de personas no debe quedar cortada por el borde del diálogo. Los botones redondos del tablero no deben verse encima del diálogo.
5. Menú de proyectos → «+ Nuevo proyecto»: escribe el nombre enseguida; debe entrar entero y el menú debe cerrarse. Créalo desde «Casa y familia»: encima de las columnas debe salir la descripción del proyecto con una X; ciérrala y recarga: no debe volver.
6. Releases: busca una palabra que esté en una release: la release debe salir desplegada con la palabra resaltada.
7. Mis tareas: el filtro debe llamarse «Vencidas y próximos 7 días».
8. Administración → Copias de seguridad: si no hay destino externo, un solo aviso ámbar («Copias automáticas activas, pero solo en el disco de este servidor»); en Tareas de mantenimiento, las que no hicieron nada dicen «Omitida: …» con el motivo.
9. Cambia el idioma a inglés en Mi perfil y mira: el detalle («Created by … on Nov 22, 2026…»), comentarios, Logs (mensajes en inglés en los eventos nuevos), Ajustes → Almacenamiento («… GB free (N% used)»). Vuelve a español.
10. Administración → Ajustes → Zona horaria: pulsa en el campo y escribe «bogo»: debe buscar sin pegar el texto detrás de la zona actual. No guardes.
11. Recuperar contraseña (cierra sesión → «¿Olvidaste tu contraseña?»): sin email, la orden que muestra debe ser solo la de Railway (pestaña Console). Vuelve a entrar.

Informe en español: para cada punto, «bien», «mal» o «no se pudo», con el texto exacto de los avisos y, si algo falla, una captura descrita. Al final, lo que te haya parecido confuso. No borres nada de lo creado: pregúntame.
```
