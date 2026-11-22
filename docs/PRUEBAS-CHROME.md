# Prompts para Claude in Chrome

Pruebas que hace Claude in Chrome en el navegador del propietario (Cloudflare, Railway, la web). Cada prompt va en su propia
conversación de Claude in Chrome. Cuando el propietario pasa los informes, se apunta aquí lo que ya está hecho y se
actualizan los prompts que sigan pendientes.

Estado tras la ronda 61 (v1.65.0):

- Hecho: revisión de Cloudflare y R2 (ronda 60), instalación desde cero en Railway con la web (ronda 60) y copias en R2
  (ronda 61: las copias siguen llegando cada día —el panel de Cloudflare corta la lista a 25 filas—; regla de bloqueo
  `copias-pizarro` creada en `pizarro/pizarro-backup-` a 31 días; «Copiar ahora», correcta).
- Pendientes, en este orden: 1 (pruebas en real de la v1.64 y la v1.65 y comprobaciones de Railway), 2 (auditoría como
  usuario sobre la instalación de prueba, cuando el propietario lo diga), 3 (validar el Caddyfile en un VPS, solo si hay
  uno con consola web).

## 1. Pruebas en real de las versiones 1.64.0 y 1.65.0

```text
Quiero que compruebes en real algunas novedades de Pizarro que no se pueden probar sin servicios de verdad, y me des un informe. Trabaja en pestañas nuevas, no cambies nada que no te pida y, si algo no coincide con lo que te describo, para y pregúntame. No copies en tu informe claves, valores de variables, emails completos ni datos personales.

Dónde:
- Mi instalación REAL de Pizarro (la del proyecto «Pizarro» de Railway): solo para MIRAR, salvo donde digo lo contrario.
- La instalación de PRUEBA (proyecto `pizarro-prueba-instalacion` de Railway, administrador `admin-prueba@example.com`): aquí sí puedes crear y cambiar cosas. Si no recuerdas su contraseña, para y pídeme que entre yo.
- Antes de cualquier paso que cueste dinero, para y pregúntame.

0. En las dos instalaciones, «Historial de versiones» debe decir v1.65.0. Si alguna está en una anterior, en Railway, en su servicio de Pizarro, comprueba que la rama sea `stable` y pulsa «Deploy». Espera a que termine.

1. Railway (solo mirar, en los dos proyectos): en el servicio de Pizarro, Settings → Deploy: ¿«Healthcheck Path» es /api/health? En Variables, ¿existen variables cuyo nombre empieza por BACKUP_S3_ y APP_URL? (solo los NOMBRES, nunca los valores).

2. Instalación de prueba, sin APP_URL (v1.64): en Administración → Ajustes → Instalación, mira «Dirección pública»: debe decir que sale de Railway. Si la instalación de prueba tiene APP_URL, dime cuál es su origen según la pantalla y no la cambies.

3. Cloudflare (solo mirar): abre mi instalación REAL en Mi perfil y mira el código fuente de la página (Ver código fuente o view-source:). No debe aparecer `__cf_email__` ni `email-decode.min.js`.

4. Tablero en vivo (instalación de prueba): abre el mismo tablero en dos pestañas. En una, mueve una tarjeta, cambia el título de otra y archiva una tercera. En la otra pestaña deben verse los cambios en uno o dos segundos sin recargar la página entera (la búsqueda escrita y la selección se mantienen).

5. Dos cuentas en el mismo navegador (instalación de prueba): crea en Administración → Usuarios una persona de prueba `persona-prueba@example.com` (si no hay email, usa «Generar enlace de invitación nuevo» y abre el enlace en una ventana de incógnito para elegir su contraseña). Entra con el administrador marcando «Recordar este dispositivo», cierra sesión, entra con la persona marcando también «Recordar», cierra sesión y vuelve a entrar con el administrador: no debe pedir el segundo factor ni avisar de «nuevo inicio de sesión».

6. Plantillas (instalación de prueba, v1.65): Nuevo proyecto → «Casa y familia» con «Con tarjetas de ejemplo». Debe abrirse el tablero con unas pocas tarjetas «Ejemplo». En Administración → Tipos y plantillas deben salir 6 plantillas de serie.

7. Informar de un error (instalación de prueba o real, es una instalación oficial): junto a «Cerrar sesión» hay un botón con un bicho. Ábrelo, escribe «Prueba, ignorar», marca «Incluir una captura de la pantalla» y comprueba que la vista previa muestra la página sin el diálogo. NO lo envíes: pulsa «Cancelar».

8. Emails (solo si la instalación de prueba tiene email configurado y tengo el buzón abierto en este Chrome; si no, sáltalo): con la persona de prueba asignada a una tarea, comenta mencionándola. En su email debe salir «<nombre> ha escrito:» con la cita y, al pie, «Dejar de recibir estos emails». Abre ese enlace: debe pedir confirmación sin dar de baja nada. No pulses «Darme de baja».

Termina con un informe en español: para cada punto, «bien», «mal» o «no se pudo», con lo que viste (texto exacto de los avisos) y, si algo falla, una captura descrita. Al final, lo que te haya parecido confuso. No borres nada de lo creado en la instalación de prueba: pregúntame.
```

## 2. Auditoría como usuario (instalación de prueba)

```text
Quiero que uses Pizarro como lo haría una persona nueva en su trabajo y me des un informe de todo lo que confunda, falle o se pueda mejorar. Trabaja en una pestaña nueva y, si algo no coincide con lo que te describo, para y pregúntame.

Dónde probar (muy importante):
- Usa la instalación de PRUEBA en Railway, el proyecto `pizarro-prueba-instalacion`. Si no existe, para y pregúntame.
- No toques mi instalación real ni ningún otro proyecto de Railway.
- Antes de cualquier paso que cueste dinero más allá del uso normal, para y pregúntame.
- Entra con el administrador de prueba (`admin-prueba@example.com`). Si no recuerdas su contraseña, para y pídeme que entre yo.
- No pongas en tu informe claves, contraseñas ni datos personales.

Antes de empezar:
0. En Historial de versiones, comprueba que es la v1.65.0. Si es más antigua: en Railway, en el servicio de Pizarro del proyecto de prueba, mira que la rama sea `stable` y pulsa «Deploy» (o ⌘K → «Deploy Latest Commit»). Espera a que termine y vuelve a mirar.

Recorrido (haz de usuario, no de probador: fíjate en si entiendes cada pantalla sin ayuda):
1. Crea un proyecto desde la plantilla «Casa y familia» con «Con tarjetas de ejemplo» y otro desde «Trabajo y clientes» sin ellas. Debe abrirse su tablero directamente, con la descripción de la plantilla.
2. Crea 5 tareas con el «+» de varias columnas. Prueba a escribir un título y DESPUÉS elegir otro tipo: lo escrito no debe perderse (por ejemplo «Fontanería» → «Obra: Fontanería» con el tipo «Reforma u obra»). Cambia de tipo dos veces seguidas: la descripción y las subtareas no deben mezclarse.
3. Abre una tarea, empieza a escribir en la descripción y, sin guardar, cambia el tipo: lo escrito debe seguir ahí.
4. Mueve tarjetas, añade un comentario con una mención, una subtarea y un adjunto. Abre el mismo tablero en una segunda pestaña e intenta ver si los cambios de una llegan a la otra sin recargar.
5. Crea 60 tareas con «Varias tareas» en una columna: el tablero debe seguir fluido, y la búsqueda debe encontrar la última.
6. Releases: en la columna «Siguiente salto», «Generar release», márcala como desplegada y, en Releases, busca una palabra: debe salir resaltada.
7. Calendario y Mis tareas: pon fechas límite y mira que todo se entiende.
8. Mi perfil: cambia el idioma a inglés y recorre las pantallas principales: fechas al estilo de EE. UU. («Nov 21, 2026»), calendario empezando en domingo, sin palabras británicas («licence», «organisation», «tick»). Vuelve a español.
9. Mi perfil → Avisos: revisa si se entiende qué email llega por cada casilla.
10. Administración: Usuarios (la nota «i» del máximo de usuarios), Ajustes (zona horaria con buscador, nombre bajo el icono, dirección pública), Copias de seguridad (debe decir «Omitida: sin destino externo» si no hay bucket), Logs (descarga el CSV y ábrelo en una hoja de cálculo si puedes).
11. Invita por email a `invitado-prueba@example.com` desde Ajustes del proyecto → General: debe salir «Invitación pendiente». Abre el enlace en una ventana de incógnito, elige contraseña y entra.
12. En el móvil (ventana estrecha de 390 px si no hay móvil): tablero, nueva tarea, detalle y menú.

Termina con un informe en español, ordenado de más a menos grave: para cada punto, la pantalla, qué hiciste, qué esperabas, qué pasó (texto exacto de los avisos) y una propuesta. Separa: fallos, cosas confusas, ideas para simplificar y lo que te ha gustado. No borres el proyecto de prueba de Railway: pregúntame.
```

## 3. Validar el Caddyfile en un VPS (solo si hay uno con consola web)

```text
Necesito comprobar un fichero de configuración en un servidor. Antes de nada: si no tengo un servidor (VPS) con consola en el navegador ya creado en algún proveedor, para y dímelo; no crees ninguno ni pagues nada.

Si lo tengo: abre su consola web (la terminal que ofrece el panel del proveedor) y ejecuta, una línea cada vez y copiándome la salida:

1. `docker --version` (si no hay Docker, para y dímelo).
2. `curl -fsSL https://raw.githubusercontent.com/pla87/pizarro/stable/deploy/Caddyfile -o /tmp/Caddyfile`
3. `docker run --rm -v /tmp/Caddyfile:/etc/caddy/Caddyfile:ro -e DOMAIN=:80 caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile`

Debe terminar con «Valid configuration». Después, borra el fichero con `rm /tmp/Caddyfile`. No toques nada más del servidor. Informe: la salida de los tres comandos (sin direcciones IP ni nombres del servidor).
```
