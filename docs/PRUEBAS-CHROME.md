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

Estado tras la ronda 70 (v1.73.1):

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
  usuario de la v1.71.0); lo que salió entró en la v1.72.0.
- Ronda 68: en la nube, sin Claude in Chrome; no se pasó ninguno.
- Tras la ronda 68 (sesión local, 25-26 nov) se pasaron los prompts 1, 2 y 3 sobre la v1.72.0; el informe completo
  está en `docs/handoff/CHROME-R69.md` (anexo de historia: ya no hay que leerlo para empezar). Lo que falló o confundía
  entró en la v1.73.0 (ronda 69).
- Lo aprendido en esa sesión: los avisos de mover tarjetas **no llevan «Deshacer» por diseño** (solo los de asignación
  lo llevan; para lo demás está la flecha ↶ y Ctrl/Cmd+Z), y en «Casa y familia» **todos los tipos tienen plantilla** de
  descripción: para probar el cambio de tipo que quita la plantilla hace falta un proyecto con un tipo sin ella.
- Ronda 70 (v1.73.1): sesión local; una vuelta en Claude in Chrome sobre la instalación local (no la de Railway) sin hallazgos
  nuevos. Los prompts siguen sin pasarse en la instalación de prueba: el 1 cubre ya la v1.73.0 y la v1.73.1 (pasos 21-25).
- Pendientes, en este orden: 1 (pruebas en real de la v1.73.0 y la v1.73.1, con lo que el propietario tiene que hacer a mano),
  2 (auditoría como usuario de la v1.73.1), 3 (primeros informes DMARC; solo mirar) y 4 (WhatsApp en la instalación
  real, con el propietario delante). Antes del 1, el propietario lanza **Actions → Release** de la v1.73.1 (lleva también la
  v1.73.0, que quedó pendiente) y se comprueba en Railway que la instalación de prueba despliega la v1.73.1 desde `stable`.
- Pendiente para el propietario (Claude in Chrome no puede), ya incluido en el prompt 1: ventana privada y móvil sobre la
  web de «Compartir fuera» (la columna «Fontanero» de «Casa R69» o una nueva), Ctrl+V real de una captura en la
  descripción (y pegar con el foco en el título y arrastrar un archivo), dos avisos de asignación seguidos (el primero se
  apaga, ratón encima, Tab+Intro), el menú «PDF de la semana» en una pantalla muy ancha y el acceso con verificación en
  dos pasos.
- Lo creado en la instalación de prueba por esas sesiones (no se ha borrado nada; preguntar antes): proyecto «Casa R69»
  y, en «Proyecto de prueba», la columna «Proveedor», Persona Prueba como miembro y la etiqueta «informes».

## 1. Pruebas en real de la v1.73.0 y la v1.73.1 (instalación de prueba)

Los puntos con ventana privada, Ctrl+V de una imagen de verdad, una ventana muy ancha o el móvil los hace el
propietario: el prompt le pide que los haga y apunta lo que le diga.

```text
Quiero que compruebes en real las novedades de Pizarro v1.73.0 y v1.73.1 y me des un informe. Usa la instalación de PRUEBA (proyecto `pizarro-prueba-instalacion` de Railway, administrador `admin-prueba@example.com`); no toques la real. Si no recuerdas la contraseña, para y pídeme que entre yo. Si algo no coincide con lo que te describo, para y pregúntame. Antes de cualquier paso que cueste dinero, para y pregúntame. No copies claves, enlaces de «Compartir fuera» ni datos personales en el informe. Las descargas (PDF, CSV, ZIP) léelas interceptando el Blob con javascript_tool; si no hay Blob, apunta el nombre del fichero. Los textos que salen al pasar el ratón, con read_page. No puedes arrastrar, abrir ventanas privadas, cambiar el tamaño de la ventana ni pegar una imagen de verdad: esos pasos me los pides a mí, esperas a que te diga «listo» y apuntas lo que te cuente.

0. «Historial de versiones» debe decir v1.73.1. Si no: en Railway, servicio de Pizarro, comprueba que la rama sea `stable` y pulsa «Deploy»; espera a que termine.
1. Compartir fuera, el pie: en «Proyecto de prueba», activa «Compartir fuera» (Ajustes del proyecto → Tablero) si hace falta y prepara una columna con tres tareas: una con una imagen en la descripción y con un encabezado vacío de plantilla (un apartado sin rellenar), otra con un adjunto que sea una imagen y un comentario, y otra asignada a «Persona Prueba». Rol de la columna › «Compartir fuera». Con la columna sin generar, el pie dice «Se publica todo el contenido de las tareas.» (lee con read_page su descripción al pasar el ratón), hay un botón «Generar web» y la caducidad es un botón con un reloj, «Caduca tras 1 mes sin uso»: púlsalo tres veces (3 meses, 7 días, 1 mes). Pulsa «Generar web»: el botón «Link» sale con el mismo color que «Actualizar web» y su nombre accesible es «Link: enlace de la web»; «Actualizar web» y «Link» caben en una línea.
2. Compartir fuera, el diálogo: tras generar, el diálogo «Web de «…»» dice «Se han publicado 3 tareas.», enseña la dirección destacada (un clic la copia), y debajo «Copiar», «Abrir» (se abre en otra pestaña), «Enviar por email», qué puede hacer quien tenga el enlace, hasta cuándo vale como línea secundaria y «Revocar enlace» apartado del resto. Cierra el diálogo. Lee con read_page el globo de la cabecera: «Compartir fuera: Enlace activo hasta el …».
3. Compartir fuera, la página: con «Abrir», en la pestaña nueva comprueba: arriba, «Compartida por <nombre de pila del administrador> desde Pizarro»; las tres tareas con descripción, la imagen de la descripción como bloque (no pegada al texto), subtareas, adjuntos y comentarios; el adjunto que es imagen con su miniatura (pulsarla descarga el fichero: apunta el nombre); sin el apartado vacío de la plantilla; y al pie «Este enlace deja de funcionar si nadie lo usa hasta el …». Apunta si se ve algo del proyecto que no sean esas tareas.
4. Compartir fuera, desde la página: «Marcar como hecha» en la tarea de Persona Prueba, «Cambiar fecha» en otra y un comentario con una @mención en la tercera. El mensaje de cada acción («Tarea marcada como hecha.», «Fecha cambiada.», «Comentario publicado.») sale en la tarjeta de esa tarea y la página no salta a otra parte. Vuelve a la pestaña del tablero SIN recargar: la tarea hecha está arriba de la columna terminada y la fecha ha cambiado; el historial y el comentario van firmados «<columna> (fuera)» y la mención sale como texto. En Administración → Logs (busca «shareOut»): las descargas y aperturas de la web también llevan «<columna> (fuera)», y ninguna línea lleva la dirección completa, solo «/x/…».
5. Compartir fuera, cambios sin publicar y columna vacía: saca una tarea de la columna y crea otra nueva en ella: el pie muestra en ámbar «Hay cambios sin publicar: pulsa «Actualizar web»». Recarga la pestaña de la página: sigue la que sacaste y no sale la nueva. Pulsa «Actualizar web» (la dirección no cambia): el aviso ámbar desaparece y la página tiene ya la nueva. Marca una tarea como hecha desde la página: el pie NO debe avisar de cambios sin publicar. Después saca todas las tareas de la columna: «Actualizar web» sigue activo y la web queda sin tareas. Con otra columna «Compartir fuera» vacía y sin enlace generado, «Generar web» está apagado y debajo dice «No hay tareas en «…»».
6. Compartir fuera, revocar y quién: pídeme que entre como Persona Prueba (miembro, no administradora; en otro navegador, lo hago yo) y revoque el enlace desde el botón «Link» → «Revocar enlace». Cuando diga «listo», en tu tablero el globo dice «Compartir fuera: Enlace revocado por Persona Prueba el …», y lo mismo el pie y el diálogo. Recarga la página de fuera: «Esta lista de tareas ya no está disponible. Contacta con la persona que te ha dado el enlace.» (un enlace caducado, en cambio, sigue diciendo «ha caducado»). Pulsa «Generar web» otra vez (enlace nuevo): el «revocado por» desaparece. Apaga la función en Ajustes («Hay 1 enlace activo: dejará de funcionar al momento. ¿Apagarlo?») y confirma.
7. Compartir fuera, ventana privada y móvil (lo hago yo): con la web de otra columna activa (la de «Fontanero» de «Casa R69» o una nueva), pídeme que abra la dirección en una ventana privada y en el móvil, que marque una tarea, cambie una fecha y comente, y que te diga si todo se lee bien, sin desplazamiento lateral. Pídeme también que, como Persona Prueba, pulse «Link» y te diga solo si ve la misma dirección.
8. Informe PDF del proyecto (con un enlace activo): en la cabecera, «Compartidas fuera: «…» (enlace activo, caduca el …)», y la columna «· compartida fuera». No debe salir la dirección.
9. Imagen como bloque en la descripción (Ctrl+V lo hago yo): abre una tarea con un párrafo de varias palabras, pulsa «Editar» en la descripción, deja el cursor en medio del texto y pídeme que pegue una captura con Ctrl+V dentro de la caja. Debe salir «Subiendo imagen…» junto a los botones del editor y la imagen quedar en su propio párrafo: el texto se parte en dos (lo de antes arriba, lo de después abajo) y el cursor queda debajo de la imagen; también sale en «Capturas y adjuntos». Pídeme otra pegada con el foco en el título: solo se adjunta. Arrastrar un archivo sobre la descripción en edición (lo hago yo) dice «Suelta para insertar en la descripción». Una imagen pegada antes de la v1.73 en esa u otra tarea se sigue viendo igual. En el modo Markdown (Mi perfil → Edición de descripciones) la imagen se inserta en el cursor, sin partir.
10. Plan para IA y Release con imágenes: en «Proyecto de prueba», genera un plan de trabajo para IA con una tarea con la imagen pegada (la del paso 9) y un adjunto: en el paso 2 la imagen sale en su propia línea como «imagen `adjuntos/…/….webp`» (en una fila de tabla, una cita o una lista se queda en línea, con un espacio). Cierra sin guardar. En «Siguiente salto a producción» (con una tarea con imagen en la descripción y un adjunto), «Generar release» → paso 2: «Descargar .md» y «Descargar adjuntos (N)»; en el .md (léelo por el Blob) la imagen va en su línea y apunta al fichero del ZIP (algo como `R3F1_nombre.webp`), no a «/api/attachments/…». Sin adjuntos en el ZIP, «[imagen: nombre]». «Copiar todo» y el histórico siguen con el enlace interno.
11. Guardar y cerrar: el botón del pie del detalle dice «Guardar y cerrar» con la ventana a su ancho normal (apunta window.innerWidth) y su descripción explica que guarda lo que estás editando y cierra; pídeme que estreche la ventana (lo hago yo): pasa a «Guardar». Alt+S hace lo mismo. Con el título a medio escribir, «Guardar y cerrar» guarda el título y cierra.
12. Aviso ámbar en vivo con dos pestañas de la misma persona: abre la misma tarea en dos pestañas. En la A, edita la descripción sin guardar. En la B, cambia la descripción y guarda. En la A debe salir, sin guardar nada, el aviso ámbar «La descripción guardada ha cambiado mientras escribías…» con «Copiar tu texto»; lo que escribiste sigue en el editor. Cancela la edición al terminar.
13. Deshacer: borra la descripción de una tarea («Descripción borrada» con «Deshacer»), cambia después su color y pulsa el «Deshacer» del aviso de la descripción: sale «Solo se puede deshacer el último cambio: usa la flecha ↶ de arriba.» como aviso informativo (neutro, no rojo) y desaparece solo a los 6 segundos aproximadamente. Deshaz con la flecha ↶ lo necesario. Después, con una acción de fuera reciente (hecha desde la página de «Compartir fuera» en el paso 4) y otra tuya posterior, pulsa el «Deshacer» del aviso de tu acción: debe deshacerla sin error (el aviso ya no falla porque lo último de la pila venga de fuera).
14. Avisos de mover y de asignación: con «Mover a…» de dos tarjetas a una columna normal sale «2 tareas movidas…» SIN «Deshacer» (es por diseño: se deshace con la flecha ↶ o Ctrl+Z, que da «Deshecho: 2 tareas vuelven a su columna»). En un proyecto con columnas «Asignación a persona», manda dos tareas una tras otra con «Mover a…» a la columna de una persona: cada aviso dice «Asignada a <persona>» con «Deshacer»; el del primero se apaga al llegar el segundo. El caso de tener el ratón encima, o de pulsar con Tab e Intro (el foco vuelve a donde estaba), lo hago yo si la extensión no llega a tiempo.
15. Nueva tarea y el tipo: en un proyecto con varios tipos y sin tipo por defecto en la columna «Pendiente», pulsa «+» de esa columna: el tipo marcado es el último que usaste (o el primero) y el título empieza vacío, sin su prefijo; escribe «Arreglar la persiana» y el título se queda así. Elige tú un tipo con título automático (por ejemplo «Obra»): ahora sí pone su prefijo («Obra: Arreglar la persiana»). Fija «Tipo por defecto…» en una columna a un tipo con prefijo y pulsa su «+»: sale con el prefijo. Cancela sin crear.
16. Mi perfil → Plantillas: cambia el texto de una cabecera sin guardar y pulsa otra pestaña: aviso «Cambios sin guardar»; «Descartar cambios» descarta, cambia de pestaña y el navegador ya no avisa al salir. Repite en Ajustes del proyecto → Plantillas.
17. Miembros: en Ajustes del proyecto → General de un proyecto de equipo, añade a un usuario con la invitación pendiente, comprueba que el recuadro del enlace de invitación aparece con su fecha, y pulsa «Quitar» a esa persona: el recuadro de su invitación desaparece. La nota de debajo dice dónde está el botón del enlace de invitación. Vuelve a añadir a quien quitaste si hacía falta.
18. Errata «Respuesta»: crea una tarea con el tipo «Respuesta»: la descripción empieza por «Respondo a las preguntas y lo que necesitas de mí:» (con tilde). Si el tipo estaba personalizado, en Ajustes → Tipos el texto de serie ya no dice «de mi».
19. Menú «PDF de la semana» (lo hago yo): con la ventana maximizada en una pantalla muy ancha, el menú se abre justo debajo de su botón, sin salir de lado a lado.
20. Verificación en dos pasos (lo hago yo en parte): cierra sesión y pídeme que entre con la contraseña; en la pantalla del código, «Reenviar código» y «Volver a iniciar sesión» deben ir centrados y subrayados. Pídeme que entre del todo.

21. Varias tareas pregunta al cerrar (v1.73.1): en «Proyecto de prueba», abre «Varias tareas», escribe dos líneas y ciérralo con Esc: debe preguntar antes de descartar (con «Seguir editando» y «Descartar»); «Seguir editando» conserva el texto. Con el cuadro vacío, Esc lo cierra sin preguntar.
22. Ctrl+Z con una sola recarga (v1.73.1): con el tablero abierto, mueve una tarjeta cambiando «Columna» en su detalle, cierra el detalle y pulsa Ctrl+Z. Con read_network_requests cuenta las cargas del tablero tras el Ctrl+Z: debe ser una, no dos. Pulsa Ctrl+Shift+Z (rehacer) y comprueba lo mismo. Si una tarea la cambió alguien desde la web de «Compartir fuera» (haz un comentario desde la página del paso 4) y luego pulsas Ctrl+Z sobre ella, el aviso debe decir que hay cambios hechos desde fuera.
23. Etiquetas desde el detalle (v1.73.1): abre una tarea en dos pestañas; en la A añade la etiqueta «informes» y en la B (sin recargar) otra distinta, y guarda las dos. Recarga: la tarea debe tener las dos etiquetas, no solo la última.
24. Mis tareas, «Columna:» (v1.73.1): en «Mis tareas asignadas», la pastilla de la columna de cada tarea dice «Columna: <nombre>» (léelo con read_page) y no parece una persona. En el calendario, una tarea vencida enseña su raya roja con la explicación al pasar el ratón.
25. Móvil (lo hago yo, v1.73.1): en el iPhone (o un móvil táctil), tocar el título, un campo de «Nueva tarea» y el buscador no amplía la página; la web de «Compartir fuera» con una tarea con una tabla o un bloque de código largo no se sale de la pantalla; el título del detalle no encoge al editarlo. Apunta lo que diga.

Informe en español: para cada punto, «bien», «mal» o «no se pudo», con el texto exacto de los avisos y, si algo falla, una captura descrita. Al final, lo que te haya parecido confuso. No borres nada de lo creado: pregúntame.
```

## 2. Auditoría como usuario de la v1.73.0 (instalación de prueba)

Lo mismo que la auditoría de la v1.72.0, con lo nuevo de «Compartir fuera» (diálogo, pie, quién revocó) y de las imágenes.

```text
Quiero que uses Pizarro como lo haría una persona nueva en su trabajo y me des un informe de todo lo que confunda, falle o se pueda mejorar. Trabaja en una pestaña nueva y, si algo no coincide con lo que te describo, para y pregúntame.

Dónde: la instalación de PRUEBA en Railway (proyecto `pizarro-prueba-instalacion`, administrador `admin-prueba@example.com`). No toques la real. Antes de cualquier paso que cueste dinero, para y pregúntame. No pongas en tu informe claves, contraseñas, enlaces de «Compartir fuera» ni datos personales. Lo que necesite una ventana privada, el móvil o arrastrar me lo pides a mí.

0. En Historial de versiones, comprueba que es la v1.73.0 (si no: Railway, servicio de Pizarro, rama `stable`, «Deploy»).
1. Compartir fuera, como una familia con un fontanero: en un proyecto «Casa y familia», activa «Compartir fuera» (Ajustes del proyecto → Tablero), crea una columna «Fontanero» con ese rol y dos o tres tareas con fotos y notas, genera la web y ábrela en otra pestaña como si fueras el fontanero: márcalas, cambia una fecha, comenta. ¿Se entiende el diálogo (la dirección, «Copiar», «Abrir», «Enviar por email»), el pie corto, el botón «Link» y la caducidad? ¿Se entiende qué se publica, cuánto dura el enlace y qué pasa al actualizar o revocar (y quién lo revocó)? ¿El aviso «Hay cambios sin publicar» llega cuando lo necesitas? ¿Se entiende la página sin saber qué es Pizarro, con «Compartida por …» arriba y las miniaturas de las fotos?
2. Crea tareas de varios tipos (también con «Varias tareas»), cambia de tipo en el detalle con y sin la descripción a medias, usa «Deshacer todo», pega una imagen en la descripción (Ctrl+V lo hago yo) y escribe texto antes y después de ella, enlaza tareas con «Bloqueada por» y navega con «Bloquea a» y «← Volver». ¿Se entiende «Guardar y cerrar»?
3. Mi perfil: cambia el orden de los proyectos y edita una plantilla sin guardar antes de cambiar de pestaña. ¿Se entiende cada opción?
4. Calendario (con varios proyectos y entregables), Mis tareas y Avisos: ¿se entiende qué tienes pendiente y para cuándo? ¿Se entiende la leyenda?
5. Releases y plan de trabajo para IA en el proyecto «Proyecto de prueba» (con imágenes y adjuntos en las descripciones): ¿el texto descargado se entiende y las imágenes se encuentran en el ZIP?
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
