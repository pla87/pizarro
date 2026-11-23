# Prompts para Claude in Chrome

Pruebas que hace Claude in Chrome en el navegador del propietario (Cloudflare, Railway, la web). Cada prompt va en su propia
conversación de Claude in Chrome. Cuando el propietario pasa los informes, se apunta aquí lo que ya está hecho y se
actualizan los prompts que sigan pendientes.

Lo aprendido en las pruebas (sirve para todos los prompts):

- Claude in Chrome no puede abrir ventanas de incógnito, redimensionar la ventana a 390 px ni arrastrar tarjetas (el
  arrastre simulado no las mueve: se mueven cambiando «Columna» en el detalle). Lo que necesite eso lo hace el propietario.
- «Recordar este dispositivo 14 días» solo sale en el paso del código de verificación en dos pasos, no en la pantalla de
  email y contraseña (la sesión ya dura 14 días desde el último uso sin marcar nada).
- Sin email configurado, «Nuevo usuario» no pide contraseña: al crear la cuenta muestra el enlace de invitación (72 h)
  para pasárselo; si se pierde, «Generar enlace de invitación nuevo» en la fila del usuario («Invitación pendiente»).
- Si se olvida la contraseña del administrador de prueba: en Railway, proyecto de prueba, servicio de Pizarro, pestaña
  *Console*, `node dist/reset-link.mjs <email>` (genera un enlace de un solo uso y queda en Logs como `auth.resetLinkCli`).
- La instalación de prueba tiene `APP_URL` puesta y su dominio de Railway se llama parecido al de la real: comprobar
  siempre el nombre del proyecto de Railway antes de tocar nada.
- Railway: las líneas de la comprobación de salud («Starting Healthcheck», «Retry window: 10m0s», «Healthcheck
  succeeded!») salen en **Build Logs**, no en Deploy Logs; *Healthcheck Timeout* aparece al rellenar *Healthcheck Path*;
  con un volumen no se pueden subir las réplicas.
- `/forgot-password` redirige al tablero si hay sesión abierta: para verlo hay que cerrar sesión (y luego entra el
  propietario, que tiene la contraseña).

Estado tras la ronda 63 (v1.67.0):

- Hecho: revisión de Cloudflare y R2 (ronda 60), instalación desde cero en Railway con la web (ronda 60), copias en R2 y
  primera regla de bloqueo (ronda 61), pruebas en real de la v1.64/v1.65 y auditoría como usuario (ronda 62), y en la
  ronda 63: `feedback@getpizarro.com` con Cloudflare Email Routing (funciona, probado con un email real), regla de bloqueo
  `adjuntos-pizarro` en `pizarro/files/` a 180 días, comprobación de salud en los dos Railway (`/api/health`, 600 s) y
  pruebas en real de la v1.66.0 (sus fallos se arreglaron en la v1.67.0). El `Caddyfile` lo valida el workflow
  «Comprobaciones» en cada PR.
- Pendientes, en este orden: 1 (pruebas en real de la v1.67.0), 2 (registro DMARC de getpizarro.com, si el propietario lo
  aprueba), 3 (auditoría como usuario con la columna nueva, cuando el propietario lo diga).

## 1. Pruebas en real de la versión 1.67.0 (instalación de prueba)

```text
Quiero que compruebes en real las novedades de Pizarro v1.67.0 y me des un informe. Usa la instalación de PRUEBA (proyecto `pizarro-prueba-instalacion` de Railway, administrador `admin-prueba@example.com`); no toques la real. Si no recuerdas la contraseña, para y pídeme que entre yo. Si algo no coincide con lo que te describo, para y pregúntame. Antes de cualquier paso que cueste dinero, para y pregúntame. No copies claves ni datos personales.

0. «Historial de versiones» debe decir v1.67.0. Si no: en Railway, servicio de Pizarro, comprueba que la rama sea `stable` y pulsa «Deploy»; espera a que termine.
1. Columna «Asignación a persona»: en un proyecto de prueba, menú «⋯» de una columna → Rol de la columna → «Asignación a persona». Elige a «Persona Prueba» (o al administrador) y «Vence en 3 días». La cabecera debe mostrar la persona y «Vence en 3 días».
   a. Crea una tarea en esa columna sin fecha: debe quedar asignada a esa persona y con fecha límite dentro de 3 días.
   b. Mueve a esa columna (cambiando «Columna» en el detalle) una tarea con fecha: se asigna a la persona y conserva su fecha.
   c. Pulsa Ctrl+Z (o el botón Deshacer del tablero): la tarea vuelve con su responsable y su fecha anteriores.
   d. Cambia solo el plazo a 5 días: no debe pedir confirmación ni reasignar nada. Cambia la persona: debe pedir confirmación con el número de tarjetas y reasignarlas todas.
   e. «Generar plan» (al pie de la columna): se descarga un PDF «Plan de <persona>…» con las tareas agrupadas en Vencidas / Hoy / Esta semana / Este mes / Más adelante / Sin fecha. Dime qué grupos salen.
   f. Elige otro rol para la columna (por ejemplo «Sin rol»): la persona y el plazo desaparecen de la cabecera.
2. Plantillas propias: si hay alguna plantilla propia en Administración → Tipos y plantillas, entra con «Persona Prueba» (miembro; si no recuerdas su contraseña, sáltalo) y en «Nuevo proyecto» comprueba que puede elegirla.
3. Plan de trabajo para IA (si hay una columna con ese rol): «Generar plan de trabajo» y mira el texto: no debe llevar «Descripción:», ni «Tarea fija…», ni apartados del formulario sin rellenar.
4. Releases: pasa el ratón por un código como «R1F1» en una tarjeta o por «R1» en la página Releases: debe salir una explicación.
5. Logs en inglés (Mi perfil → English): abre Administración → Logs. Los mensajes nuevos deben salir en inglés, también el de una tarea editada con dos campos («Edited “…”: title and type») y el apagado del servidor si lo hay. Vuelve a español.
6. Administración → Copias de seguridad sin destino externo: un solo aviso ámbar arriba; en la tarjeta «Destino externo», el texto en gris con cómo configurarlo.
7. Apariencia: en Mi perfil, elige el tema «Mostaza» y mira que los botones y textos grises se leen bien; vuelve al tema que tenías.
8. Tipos con título automático: crea una tarea de tipo «Casa», cámbiala a «Reforma u obra» (el título pasa a «Obra: …») y vuelve a «Casa»: el prefijo «Obra: » debe desaparecer.

Informe en español: para cada punto, «bien», «mal» o «no se pudo», con el texto exacto de los avisos y, si algo falla, una captura descrita. Al final, lo que te haya parecido confuso. No borres nada de lo creado: pregúntame.
```

## 2. Registro DMARC de getpizarro.com (solo si el propietario lo aprueba)

```text
Quiero añadir un registro DMARC al dominio getpizarro.com en Cloudflare, que Cloudflare recomienda desde que activamos Email Routing. Trabaja en una pestaña nueva, no cambies nada más y, si algo no coincide o te pide pagar, para y pregúntame.

1. Panel de Cloudflare → getpizarro.com → DNS → Records. Comprueba que no existe ya un registro TXT con nombre `_dmarc`. Si existe, para y dímelo.
2. Add record: tipo TXT, nombre `_dmarc`, contenido `v=DMARC1; p=none;` (solo observa, no bloquea nada), TTL Auto. Guarda.
3. Comprueba que el registro aparece en la lista y que Email Routing sigue en «Enabled».

Informe en español: qué había antes y qué has añadido.
```

## 3. Auditoría como usuario (instalación de prueba, cuando el propietario lo diga)

```text
Quiero que uses Pizarro como lo haría una persona nueva en su trabajo y me des un informe de todo lo que confunda, falle o se pueda mejorar. Trabaja en una pestaña nueva y, si algo no coincide con lo que te describo, para y pregúntame.

Dónde: la instalación de PRUEBA en Railway (proyecto `pizarro-prueba-instalacion`, administrador `admin-prueba@example.com`). No toques la real. Antes de cualquier paso que cueste dinero, para y pregúntame. No pongas en tu informe claves, contraseñas ni datos personales.

0. En Historial de versiones, comprueba que es la v1.67.0 (si no: Railway, servicio de Pizarro, rama `stable`, «Deploy»).
1. Crea un proyecto «Casa y familia» con tarjetas de ejemplo y conviértelo en tu forma de organizar la semana de una familia de tres personas: una columna «Asignación a persona» por persona (con su plazo), mueve tareas entre ellas y genera el plan de cada una.
2. Crea tareas de varios tipos, cambia de tipo con la descripción a medias, añade subtareas, comentarios con «@» y adjuntos.
3. Calendario, Mis tareas y Avisos: ¿se entiende qué tienes pendiente y para cuándo?
4. Releases y plan de trabajo para IA en el proyecto «Proyecto de prueba».
5. Administración: Usuarios, Ajustes, Copias de seguridad, Logs (en español y en inglés).
6. Cuenta lo que no entiendas sin ayuda y lo que te sobre.

Informe en español, ordenado de más a menos grave: para cada punto, la pantalla, qué hiciste, qué esperabas, qué pasó (texto exacto) y una propuesta. Separa: fallos, cosas confusas, ideas para simplificar y lo que te ha gustado. No borres nada: pregúntame.
```
