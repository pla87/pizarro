# Prompts para Claude in Chrome

Desde la ronda 66 los ejecuta Claude Code en el PC del propietario con Claude in Chrome (ver docs/handoff/LOCAL.md); antes,
el propietario los pegaba en Claude in Chrome.

Pruebas que se hacen con Claude in Chrome en el navegador del propietario (Cloudflare, Railway, la web). Cada prompt va en
su propia tarea. Cuando hay informe, se apunta aquí lo que ya está hecho y se actualizan los prompts que sigan pendientes.

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
- Los PDF de Pizarro se descargan (desde la v1.68) o se abren en una pestaña; su texto va con fuentes incrustadas y no
  se lee con read_page. Lo que funciona (así lo hizo el informe de la v1.68): interceptar el Blob de la descarga con
  javascript_tool (por ejemplo, envolviendo `URL.createObjectURL` antes de pulsar el botón) y leer su texto o su
  tamaño; si no, por captura.
- Los tooltips nativos (atributo `title`, al pasar el ratón) no salen en las capturas: se leen con read_page.
- Para ver en *Logs* el apagado en inglés hace falta un apagado nuevo: reiniciar el servicio de Pizarro de la
  instalación de prueba (Railway, *Restart*); los apagados de versiones anteriores siguen en español.
- Railway, margen del apagado: el ajuste del panel está en *Settings → Deploy → Teardown*. Al activarlo propone
  *Draining* 0 y *Overlap* 0; el valor nuevo hay que confirmarlo con el ✓ del campo antes de pulsar «Deploy» (si no,
  no se guarda). Lo que recomienda la guía es la variable `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=15` en *Variables* del
  servicio de Pizarro: da el mismo margen y Pizarro la lee para esperar hasta 10 s. *Overlap* siempre en 0.
- La extensión no siempre puede leer lo que se descarga (un PDF, un CSV, un ZIP, un adjunto): lo que funciona es
  interceptar el Blob antes de pulsar el botón (con javascript_tool, envolviendo `URL.createObjectURL`) y leer su texto
  o su tamaño. Si la descarga es un enlace normal, sin Blob (el CSV de Logs, un adjunto), basta con apuntar el nombre
  del fichero o pedir al propietario que lo abra.
- Railway: `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` también funciona como variable compartida del proyecto (*Shared
  Variables*) si en *Variables* del servicio de Pizarro se pone
  `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=${{shared.RAILWAY_DEPLOYMENT_DRAINING_SECONDS}}` (una compartida sola no llega al
  servicio).

Estado tras la ronda 68 (v1.72.0):

- Hecho: revisión de Cloudflare y R2 (ronda 60), instalación desde cero en Railway con la web (ronda 60), copias en R2 y
  primera regla de bloqueo (ronda 61), pruebas en real de la v1.64/v1.65 y auditoría como usuario (ronda 62),
  `feedback@getpizarro.com`, regla `adjuntos-pizarro`, comprobación de salud y pruebas de la v1.66.0 (ronda 63), pruebas
  en real y auditoría como usuario de la v1.67.0 y registro DMARC `_dmarc` con `p=none` (ronda 64) y, en la ronda 66:
  - pruebas en real de la v1.68.0 y la v1.69.0 en la instalación de prueba: bien en general (lo que falló o confundía
    se arregló en la v1.70.0);
  - informes DMARC: activado DMARC Management de Cloudflare en getpizarro.com, con `rua` de Cloudflare y `p=none`; sigue
    habiendo un solo registro `_dmarc` y Email Routing está en «Enabled»;
  - auditoría como usuario de la v1.69.0 (sus propuestas entraron en la v1.70.0);
  - margen del apagado en Railway comprobado en la instalación de prueba.
- Tras la ronda 67, el propietario pasó los prompts 1 (pruebas en real de la v1.70.0 y la v1.71.0) y 2 (auditoría como
  usuario de la v1.71.0); el 2, solo en parte: sus pasos 2 a 7 quedaron sin probar y van ahora en el prompt 2. Lo que
  salió entró en la v1.72.0.
- Ronda 68: en la nube, sin Claude in Chrome; no se pasó ninguno.
- Pendientes, en este orden: 1 (pruebas en real de la v1.72.0), 2 (auditoría como usuario de la v1.72.0), 3 (primeros
  informes DMARC; solo mirar) y 4 (WhatsApp en la instalación real, con el propietario delante).

## 1. Pruebas en real de la v1.72.0 (instalación de prueba)

Los puntos con ventana privada, Ctrl+V de una imagen de verdad, una ventana muy ancha o el móvil los hace el
propietario: el prompt le pide que los haga y apunta lo que le diga.

```text
Quiero que compruebes en real las novedades de Pizarro v1.72.0 y me des un informe. Usa la instalación de PRUEBA (proyecto `pizarro-prueba-instalacion` de Railway, administrador `admin-prueba@example.com`); no toques la real. Si no recuerdas la contraseña, para y pídeme que entre yo. Si algo no coincide con lo que te describo, para y pregúntame. Antes de cualquier paso que cueste dinero, para y pregúntame. No copies claves, enlaces de «Compartir fuera» ni datos personales en el informe. Las descargas (PDF, CSV) léelas interceptando el Blob con javascript_tool; si no hay Blob, apunta el nombre del fichero. Los textos que salen al pasar el ratón, con read_page. No puedes arrastrar, abrir ventanas privadas, cambiar el tamaño de la ventana ni pegar una imagen de verdad: esos pasos me los pides a mí, esperas a que te diga «listo» y apuntas lo que te cuente.

0. «Historial de versiones» debe decir v1.72.0. Si no: en Railway, servicio de Pizarro, comprueba que la rama sea `stable` y pulsa «Deploy»; espera a que termine.
1. Compartir fuera, activar: en «Proyecto de prueba» (que tenga una columna terminada, «Hecho» o parecida), Ajustes del proyecto → Tablero → «Compartir fuera»: marca «Permitir columnas «Compartir fuera»» (aviso ««Compartir fuera» activado»). Prepara una columna con tres tareas: una con una imagen en la descripción, otra con un adjunto y un comentario, y otra asignada a «Persona Prueba». Menú «⋯» de esa columna → Rol de la columna ›: «Compartir fuera» sale al final, con su explicación al pasar por encima; elígelo.
2. Compartir fuera, el pie: salen «Generar web», el aviso «Se publican la descripción, las subtareas, los comentarios y los adjuntos de estas tareas; los adjuntos se podrán descargar.» y el selector «1 mes»; púlsalo tres veces (3 meses, 7 días, 1 mes; lee su descripción con read_page). Pulsa «Generar web»: el diálogo «Web de «…»» dice «Se han publicado 3 tareas.», enseña la dirección, «Copiar», «Enviar por email» y «Vale hasta el … si nadie la usa…». Lee con read_page el globo de la cabecera: «Compartir fuera: Enlace activo hasta el …».
3. Compartir fuera, la página: abre la dirección en una pestaña nueva (no hace falta cerrar sesión: la página no usa la sesión). Comprueba que salen las tres tareas con descripción (y la imagen), subtareas, adjuntos, comentarios y responsable (solo el nombre de pila), y al pie «Este enlace deja de funcionar si nadie lo usa hasta el …». Apunta si se ve algo del proyecto que no sean esas tareas.
4. Compartir fuera, desde la página: «Marcar como hecha» en la tarea de Persona Prueba («Tarea marcada como hecha.»), «Cambiar fecha» en otra («Fecha cambiada.») y un comentario en la tercera con una @mención («Comentario publicado.»). Pulsa un adjunto: apunta el nombre del fichero descargado. Vuelve a la pestaña del tablero SIN recargar: la tarea hecha está arriba de la columna terminada y la fecha ha cambiado. En el detalle, el historial y el comentario van firmados «<columna> (fuera)» y la mención sale como texto.
5. Compartir fuera, deshacer y avisos: pídeme que entre como Persona Prueba (en otro navegador, lo hago yo) y me diga si su campana tiene «<columna> (fuera) ha marcado como hecha «…»» y si su Ctrl+Z en el tablero devuelve la tarea a su columna. Pídeme también que, como Persona Prueba, pulse el botón del enlace del pie de esa columna y te diga si ve la misma dirección (sin dictármela: solo sí o no).
6. Compartir fuera, ventana privada y móvil (lo hago yo): pídeme que abra la dirección en una ventana privada y en el móvil, que marque una tarea, cambie una fecha y comente, y que te diga si todo se lee bien y sin desplazamiento lateral.
7. Compartir fuera, actualizar y revocar: saca una tarea de la columna y crea otra nueva en ella; recarga la pestaña de la página: sigue la que sacaste y no sale la nueva. Pulsa «Actualizar web» (la dirección no cambia) y recarga: ahora al revés. En el diálogo, «Revocar enlace» y confirma: aviso «Enlace revocado» y el globo dice «Compartir fuera: Enlace caducado». Recarga la página: «Esta lista de tareas ha caducado. Contacta con la persona que te ha dado el enlace.». Vuelve a «Generar web» (enlace nuevo) y en Ajustes desmarca «Permitir columnas «Compartir fuera»»: pide confirmar con «Hay 1 enlace activo: dejará de funcionar al momento. ¿Apagarlo?»; confirma. En Administración → Logs, busca «shareOut» y apunta las líneas (generar, abrir, descarga, hecha, fecha, comentario, revocar, apagar); ninguna debe llevar la dirección completa, solo «/x/…».
8. Informe PDF del proyecto (antes de apagar, o vuelve a activarlo y generar la web): en la cabecera, «Compartidas fuera: «…» (enlace activo, caduca el …)», y en «Pendiente» la columna dice «· compartida fuera». No debe salir la dirección.
9. Imagen en la descripción (Ctrl+V lo hago yo): abre una tarea, pulsa «Editar» en la descripción, deja el cursor en medio del texto y pídeme que pegue una captura con Ctrl+V dentro de la caja. Debe salir «Subiendo imagen…» junto a los botones del editor y la imagen quedar insertada donde estaba el cursor; también sale en «Capturas y adjuntos». Pídeme otra pegada con el foco en el título: solo se adjunta. Arrastrar un archivo sobre la descripción en edición (lo hago yo) dice «Suelta para insertar en la descripción».
10. Conflicto con la descripción abierta: abre la misma tarea en dos pestañas. En la A, edita la descripción sin guardar. En la B, cambia la descripción y guarda. En la A, cambia el tipo a uno con prefijo de título: lo que escribiste sigue en el editor y sale en ámbar «La descripción guardada ha cambiado mientras escribías; lo tuyo sigue aquí, sin guardar». Cancela la edición al terminar.
11. Detalle: el pie dice «Deshacer todo» (no «Deshacer») con la ventana como la tengas; apunta su ancho (window.innerWidth). Borra la descripción con su icono: «Descripción borrada» con «Deshacer»; púlsalo: vuelve. Bórrala otra vez, cambia el color de la tarea y pulsa el «Deshacer» del aviso de la descripción: debe decir «Solo se puede deshacer el último cambio: usa la flecha ↶ de arriba.». Deshaz con la flecha ↶ lo que haga falta para dejarla como estaba.
12. Avisos con «Deshacer»: mueve dos tareas una tras otra (cambiando «Columna» en el detalle o con «Mover a…»): el «Deshacer» del primer aviso se apaga al llegar el segundo; con el ratón encima, el primero no se cierra y explica que solo se deshace lo último. Pulsa el «Deshacer» del segundo con el teclado (Tab hasta él e Intro): el foco vuelve a donde estaba. Los textos dicen «tareas»: con «Mover a…» de dos tarjetas, «2 tareas movidas…»; al deshacer, «Deshecho: 2 tareas vuelven a su columna».
13. Cambio de tipo: pasa una tarea con plantilla de descripción (sin tocarla) a un tipo sin plantilla: el aviso dice «… plantilla de la descripción quitada». Pulsa «Deshacer»: «Deshecho el cambio de tipo de «…»» nombra la tarea sin el prefijo del tipo. En Logs, «Cambió el tipo de «…» a «…»», también sin el prefijo.
14. Columnas con el teclado: foco en el nombre de una columna, Alt+→ tres veces: un solo aviso que se actualiza (««…» va ahora después de «…»»); Alt+← hasta el principio: «… va ahora la primera».
15. Roles y Organizar por personas: en un proyecto «Casa y familia» nuevo, Rol de la columna ›: el primero es «Planificación semanal» y el segundo «Asignación a persona». Con dos personas en el proyecto, «Añadir columna» → «Organizar por personas»: sale la nota «Las tareas que pongas en estas columnas salen de su columna actual.»; al crearlas, el aviso dice «2 columnas creadas: … y …» y quedan justo antes de la columna terminada (si el proyecto tiene una), no detrás. Ctrl+Z las quita y las demás vuelven a su sitio.
16. Botones apagados: deja vacía la columna «Esta semana» (Planificación semanal): bajo «PDF de la semana» se lee «No hay tarjetas en «Esta semana»»; al pulsarlo no sale ningún aviso. Con tarjetas, «PDF de la semana» abre su menú justo debajo del botón, con su ancho. Pídeme que lo pruebe yo con la ventana maximizada en una pantalla muy ancha (el menú no debe salir de lado a lado).
17. Asignación a persona: el botón dice «Descargar plan (PDF)»; al pulsarlo, «Generando PDF…» y después el aviso «Plan de … descargado» (lee el PDF por el Blob: título «Plan de …»).
18. Plan de trabajo para IA de «Proyecto de prueba» con una tarea con imagen pegada y otro adjunto, otra que dependa de ella y las dos con la misma prioridad y una etiqueta común: en el paso 2, la imagen sale como «imagen `adjuntos/…/….webp`», «Adjuntos:» va al final de la tarea (tras las subtareas), «Depende de: la tarea 1» sin el título, y el contexto dice «Prioridad de todas las tareas» y «Etiquetas de todas las tareas» (no se repiten en cada tarea). Cierra sin guardar.
19. Administración → Copias de seguridad: la nota «i» de «Descargar» ya no nombra variables; la nota «Para quien instala» de la carpeta dice «Para restaurar una copia: … (variable BACKUP_KEY y node dist/restore.mjs).».
20. Administración → Logs: con read_page, «Descargar CSV» se llama así y su descripción es «Con el periodo y los filtros de la lista»; sin filtros, «Limpiar» está apagado con la descripción «No hay filtros aplicados». Busca «Descarga» de hoy: abrir una tarea con una imagen en la descripción no debe dejar ninguna descarga a tu nombre.
21. Verificación en dos pasos (lo hago yo en parte): cierra sesión y pídeme que entre con la contraseña. En la pantalla del código, «Reenviar código» (si el método es el email) y «Volver a iniciar sesión» deben ir centrados y subrayados; pulsa «Volver a iniciar sesión»: vuelve al acceso. Pídeme que entre del todo.
22. Miembros: en Ajustes del proyecto → General de un proyecto de equipo donde no seas miembro, añádete: el aviso dice «Te has añadido al proyecto» y no sale el recuadro «Enlace al tablero para pasárselo a…». Si hay alguien con la invitación pendiente, añádelo a un proyecto: el recuadro dice «Su invitación es del … y vale 72 horas, hasta el …». Sin email configurado, apunta la nota de debajo («Pizarro no puede enviar emails desde aquí…»). Deshaz lo que hayas añadido.
23. Abre `/admin/types`: ahora sale «No encontrado» (ya no lleva a Tipos y plantillas).

Informe en español: para cada punto, «bien», «mal» o «no se pudo», con el texto exacto de los avisos y, si algo falla, una captura descrita. Al final, lo que te haya parecido confuso. No borres nada de lo creado: pregúntame.
```

## 2. Auditoría como usuario de la v1.72.0 (instalación de prueba)

Recoge los pasos 2 a 7 de la auditoría de la v1.71.0, que quedaron sin probar, y añade «Compartir fuera».

```text
Quiero que uses Pizarro como lo haría una persona nueva en su trabajo y me des un informe de todo lo que confunda, falle o se pueda mejorar. Trabaja en una pestaña nueva y, si algo no coincide con lo que te describo, para y pregúntame.

Dónde: la instalación de PRUEBA en Railway (proyecto `pizarro-prueba-instalacion`, administrador `admin-prueba@example.com`). No toques la real. Antes de cualquier paso que cueste dinero, para y pregúntame. No pongas en tu informe claves, contraseñas, enlaces de «Compartir fuera» ni datos personales. Lo que necesite una ventana privada, el móvil o arrastrar me lo pides a mí.

0. En Historial de versiones, comprueba que es la v1.72.0 (si no: Railway, servicio de Pizarro, rama `stable`, «Deploy»).
1. Compartir fuera, como una familia con un fontanero: en un proyecto «Casa y familia», activa «Compartir fuera» (Ajustes del proyecto → Tablero), crea una columna «Fontanero» con ese rol y dos o tres tareas con fotos y notas, genera la web y ábrela en otra pestaña como si fueras el fontanero: márcalas, cambia una fecha, comenta. ¿Se entiende qué se publica, cuánto dura el enlace y qué pasa al actualizar o revocar? ¿Se entiende la página sin saber qué es Pizarro?
2. Crea tareas de varios tipos (también con «Varias tareas»), cambia de tipo en el detalle con y sin la descripción a medias, usa «Deshacer todo», pega una imagen en la descripción (Ctrl+V lo hago yo), enlaza tareas con «Bloqueada por» y navega con «Bloquea a» y «← Volver».
3. Mi perfil: cambia el orden de los proyectos y edita una plantilla sin guardar antes de cambiar de pestaña. ¿Se entiende cada opción?
4. Calendario (con varios proyectos y entregables), Mis tareas y Avisos: ¿se entiende qué tienes pendiente y para cuándo? ¿Se entiende la leyenda?
5. Releases y plan de trabajo para IA en el proyecto «Proyecto de prueba» (con imágenes y adjuntos en las descripciones).
6. Administración: Usuarios, Proyectos (miembros y administradores que no lo son), Tipos y plantillas (las «De serie»), Copias de seguridad (¿se entiende sin saber de servidores?), Logs (periodo personalizado, CSV y las líneas de «Compartir fuera»).
7. Historial de versiones: el buscador y el enlace de una versión.
8. Cuenta lo que no entiendas sin ayuda y lo que te sobre.

Informe en español, ordenado de más a menos grave: para cada punto, la pantalla, qué hiciste, qué esperabas, qué pasó (texto exacto) y una propuesta. Separa: fallos, cosas confusas, ideas para simplificar y lo que te ha gustado. No borres nada: pregúntame.
```

## 3. Primeros informes DMARC de getpizarro.com (solo mirar, a las 24-48 h)

```text
Hace uno o dos días se activó DMARC Management de Cloudflare en getpizarro.com (registro `_dmarc` con `p=none` y `rua` de Cloudflare). Quiero saber qué dicen los primeros informes. Trabaja en una pestaña nueva y NO cambies nada (ni DNS, ni DMARC, ni Email Routing). Si te pide pagar o algo no coincide, para y pregúntame.

1. Panel de Cloudflare → getpizarro.com → Email → DMARC Management. Apunta el periodo que cubren los informes y si ya ha llegado alguno (si no hay ninguno, dilo y para).
2. Para cada fuente que envía correo con el dominio getpizarro.com (nombre del proveedor o servicio, no direcciones IP sueltas si se puede evitar): cuántos mensajes, si pasan SPF, si pasan DKIM y si pasan DMARC (alineados).
3. Señala las fuentes que no reconozcas o que fallen SPF o DKIM, y di qué crees que son (por ejemplo, reenvíos de Email Routing), sin tocar nada.
4. Comprueba que en DNS → Records sigue habiendo un solo registro `_dmarc` con `p=none`.

Informe en español: una tabla con fuente, mensajes, SPF, DKIM y DMARC, y debajo lo que convendría revisar antes de pasar a `p=quarantine` (solo como propuesta).
```

## 4. WhatsApp en la instalación real (contigo delante)

Se hace con el propietario delante: Claude in Chrome guía y rellena; el propietario entra en sus cuentas, pega el token y
autoriza cada paso que pueda costar dinero. Empieza con el **número de prueba de Meta** (gratis, hasta 5 destinatarios
verificados); el número propio y el método de pago, solo si el propietario lo decide después.

```text
Quiero dejar funcionando los avisos de Pizarro por WhatsApp en mi instalación REAL, siguiendo la guía de Pizarro «Avisos por WhatsApp» (en la web de Pizarro, Guías → WhatsApp, o docs/guias/whatsapp.md del repositorio pla87/pizarro). Estoy delante: trabaja en una pestaña nueva y ve paso a paso. Reglas: (1) Antes de cualquier paso que cueste dinero (añadir un método de pago, un número propio, pulsar «Probar» en Pizarro o enviar un código), para y pregúntame. (2) NO copies, leas en voz alta ni pongas en tu informe el token de Meta, mi número de teléfono ni datos personales: el token lo genero y lo pego yo. (3) Si algo no coincide con la guía (nombres de menús de Meta, pasos nuevos), para, descríbeme lo que ves y pregúntame. (4) No toques nada de Pizarro fuera de Administración → Integraciones → WhatsApp y Mi perfil → Avisos.

1. Meta Business (business.facebook.com): comprueba si ya tengo un portfolio empresarial. Si no, dime qué pide para crearlo y espera a que yo lo rellene.
2. Meta for Developers (developers.facebook.com → Mis apps): comprueba si ya hay una app con el producto WhatsApp. Si no, créala con el caso de uso «Conectar con clientes a través de WhatsApp», asociada a mi portfolio, y añade el producto WhatsApp.
3. WhatsApp → Configuración de la API: usaremos el NÚMERO DE PRUEBA de Meta. Apunta (para ti, sin ponerlo en el informe) el «Phone number ID». En el campo «Para», pídeme que añada y verifique mi móvil (lo hago yo).
4. Token permanente: guíame en business.facebook.com/settings → Usuarios del sistema → Añadir (nombre «pizarro», rol Administrador) → Asignar activos (la app y la cuenta de WhatsApp, control total) → Generar nuevo token (caducidad «Nunca», permisos whatsapp_business_messaging y whatsapp_business_management). Cuando salga el token, PARA: lo copio yo.
5. Plantillas (WhatsApp Manager → Plantillas de mensajes): crea «aviso_pizarro» (Utilidad, Predeterminado, idioma Español «es») con el cuerpo EXACTO de la guía (paso 5, con sus saltos de línea) y los ejemplos de las variables de la guía (en {{3}} usa una dirección de ejemplo, no la mía real). Crea «codigo_pizarro» (Autenticación, «Copiar código», mismo idioma, caducidad 15 minutos). Envía las dos y dime su estado; si alguna no está «Aprobada», espera y vuelve a mirar cada pocos minutos (hasta 30 min) antes de seguir.
6. Pizarro → Administración → Integraciones → 3. Avisos por Telegram y WhatsApp → WhatsApp: rellena el Phone number ID, plantilla «aviso_pizarro», idioma exactamente el aprobado («es» o el que muestre Meta), plantilla de verificación «codigo_pizarro». En «Token de acceso», PARA y déjame pegarlo. Pulsa Guardar y después Activar. Apunta el texto exacto de lo que muestra (sin el token).
7. Prueba: pregúntame antes. Si te digo que sí, escribe en «Probar» el número que yo te diga (lo escribo yo si prefieres) y pulsa una sola vez. Deben llegar dos WhatsApp («Mensaje de prueba de Pizarro…» y el código 123456). Apunta lo que dice Pizarro y, si falla, el código de error de Meta y qué dice la guía («Problemas frecuentes»).
8. Mi perfil → Avisos → Avisos en el móvil → WhatsApp: guíame para poner mi número, marcar el consentimiento y «Guardar y enviar código» (pregúntame antes de pulsar). Yo te digo el código de 6 cifras o lo escribo yo; pulsa Confirmar. Deja marcadas solo menciones y asignaciones.
9. Aviso real: en un proyecto de prueba de mi instalación, crea una tarea «Prueba WhatsApp» y asígnamela (o pídeme que me mencione otra persona). Pregúntame si me ha llegado el WhatsApp y cuánto ha tardado. Abre el enlace del mensaje: debe abrir esa tarea.
10. Administración → Logs: busca las líneas de WhatsApp de hoy (envíos, fallos) y apunta lo que dicen (el teléfono sale enmascarado; no copies el token si apareciera).

Informe en español: para cada paso, «hecho», «falló» o «pendiente», con los textos exactos de Meta y de Pizarro (sin token ni teléfono), el estado de las dos plantillas y lo que te haya parecido confuso o distinto de la guía (para corregirla). No borres nada.
```
