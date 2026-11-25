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

Estado tras la ronda 67 (v1.71.0):

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
- Ronda 67: no se pasó ninguno (sesión en la nube, sin el navegador del propietario).
- Pendientes, en este orden: 1 (pruebas en real de la v1.70.0 y la v1.71.0), 2 (auditoría como usuario de la v1.71.0),
  3 (primeros informes DMARC; solo mirar) y 4 (WhatsApp en la instalación real, con el propietario delante).

## 1. Pruebas en real de las versiones 1.70.0 y 1.71.0 (instalación de prueba)

```text
Quiero que compruebes en real las novedades de Pizarro v1.70.0 y v1.71.0 y me des un informe. Usa la instalación de PRUEBA (proyecto `pizarro-prueba-instalacion` de Railway, administrador `admin-prueba@example.com`); no toques la real. Si no recuerdas la contraseña, para y pídeme que entre yo. Si algo no coincide con lo que te describo, para y pregúntame. Antes de cualquier paso que cueste dinero, para y pregúntame. No copies claves ni datos personales. Los PDF se descargan: lee su texto interceptando el Blob de la descarga con javascript_tool (como en el informe de la v1.68) o, si no puedes, por captura. Los textos que salen al pasar el ratón léelos con read_page. No puedes arrastrar: lo que sea arrastrar me lo dejas a mí y lo apuntas.

0. «Historial de versiones» debe decir v1.71.0. Si no: en Railway, servicio de Pizarro, comprueba que la rama sea `stable` y pulsa «Deploy»; espera a que termine. En Railway, servicio de Pizarro → Variables, apunta si existe `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` y con qué valor (debe ser 15; si no está, pregúntame antes de añadirla).
1. Mover columnas con el teclado: en «Proyecto de prueba», pon el foco en el nombre de una columna (Tab) y pulsa Alt+→: la columna pasa un sitio a la derecha y sale el aviso ««…» movida a la posición N». Pulsa Ctrl+Z: vuelve a su sitio. Lee con read_page la descripción del nombre de la columna: «… (arrastra la cabecera o pulsa Alt+flechas para moverla)». En Administración → Logs, busca «Movió la columna».
2. Roles según la plantilla: en un proyecto creado con «Casa y familia», menú «⋯» de una columna → Rol de la columna ›: deben salir primero unos pocos roles (Planificación semanal, Esperando, Lista consolidada, Rutinas, Presupuesto, Asignación a persona) y el resto tras «Más roles…» («Siguiente salto» debe estar ahí, no a la vista). En «Proyecto de prueba» (en blanco o anterior), deben salir todos sin «Más roles…».
3. Organizar por personas: en el proyecto «Casa y familia» con al menos dos personas (añade a «Persona Prueba» como miembro si hace falta), pulsa «Añadir columna»: el diálogo «Nueva columna» ofrece «Organizar por personas: una columna para cada una». Púlsalo: debe explicar «Se crearán N columnas «Asignación a persona», una por persona (…)» (o «Se creará una columna…» si solo falta una). Confirma con «Crear N columnas»: sale «N columnas creadas», con el nombre de cada persona. Ctrl+Z las quita todas de una vez. Vuelve a crearlas para el punto 4. Si solo hubiera una persona, debe decir «En el proyecto solo hay una persona: añade antes a las demás.» con el enlace «Añadir personas al proyecto (se abre en otra pestaña)».
4. Asignación a persona: (a) en la cabecera de una de esas columnas, cambia la persona: debe salir la casilla «Cambiar el nombre de la columna a «…»», marcada. (b) Abre una tarea de otra columna y cambia «Columna» a esa: sale el aviso «Asignada a … · vence el …» (o «Asignada a …» si la columna no tiene plazo) con «Deshacer»; púlsalo: la tarea vuelve con su responsable y su fecha de antes. (c) Con la selección múltiple, «Mover a…» esa columna con dos tarjetas: un solo aviso.
5. Tipo por defecto en la cabecera: en «Casa y familia», la columna «Lista de la compra» de un proyecto nuevo debe traer el tipo por defecto «Compras» y «Citas» el tipo «Cita»: junto al contador de la cabecera sale un punto de color; lee su descripción con read_page: «Tipo por defecto: Compras».
6. Añadir columna: la barra del final del tablero lleva el texto «Añadir columna» en vertical bajo el «+». Crea un proyecto nuevo desde una plantilla (sale su descripción encima de las columnas), añade una columna: el tablero se desplaza hasta ella y la descripción del proyecto sigue a la vista.
7. Detalle: el botón del pie dice «Deshacer todo». Cambia el título y pulsa «Deshacer todo»: pregunta «¿Deshacer todos los cambios?» con «Deshacer todo» y «Seguir editando». Confirma: sale «Cambios descartados» con «Deshacer». Aparte, abre una tarea, escribe en la descripción sin guardar y ciérrala con la X: el diálogo «Cambios sin guardar» sigue ofreciendo «Seguir editando» y «Descartar cambios».
8. Cambio de tipo: crea una tarea de un tipo con subtareas y descripción de plantilla y cámbiala a otro tipo con subtareas: el aviso debe decir algo como «Tipo cambiado: 3 subtareas añadidas, 2 quitadas y plantilla de la descripción aplicada» (apunta el texto exacto) y durar unos 10 segundos. Pulsa «Deshacer»: «Deshecho el cambio de tipo de «…»». Abre «Historial» de la tarea: debe haber una línea «Cambió las subtareas del tipo: quitó …; añadió …». Cambia a un tipo sin subtareas ni plantilla: no sale aviso. En Logs, «Cambió el tipo de «…» a «…»».
9. Guardar la descripción: edita la descripción y pulsa «Guardar descripción»: el foco queda en la descripción guardada y la columna de la tarea no salta; pulsa Intro: vuelve a editarla.
10. Varias tareas: en una columna «Asignación a persona», «Varias tareas»: sale la nota de la columna y el responsable propuesto es su persona. Pon dos líneas y cambia el tipo de una: «Tipo para todas» dice «(ahora hay varios)». Crea las tareas: cada una lleva la descripción de plantilla de su tipo (pero no el prefijo del título).
11. Bloquea a: en la tarea A pon «Bloqueada por» → B. Abre B: debe salir «Bloquea a» con el enlace a A. Púlsalo: se abre A con «← Volver a «B»» en la cabecera; púlsalo: vuelves a B. El color de A no debe haber cambiado a un desplegable «Sin color».
12. Orden de los proyectos: Mi perfil → Preferencias → «Orden de los proyectos»: «Usados recientemente» («Arriba el último que has abierto.») y «Alfabético» («Por nombre, de la A a la Z.»). Elige «Alfabético» y recarga: el selector de la barra lateral y la página de inicio van por nombre. Vuelve a «Usados recientemente», abre el tablero de un proyecto que esté abajo y recarga: ese pasa arriba.
13. Plantillas a medio editar: Mi perfil → Plantillas, edita una cabecera sin guardar y pulsa la pestaña «Avisos»: debe preguntar antes de salir. Cancela y descarta la edición. Lo mismo en Ajustes del proyecto → Plantillas.
14. Avisos: con todos los avisos leídos y alguna tarea vencida, la página Avisos debe decir «No tienes avisos nuevos · N tareas vencidas en Mis tareas»; el enlace lleva al grupo «Vencidas» de Mis tareas.
15. Calendario: con varios proyectos a la vista, las siglas de proyecto van en un cuadro de esquinas rectas (no en un círculo); su descripción (read_page) dice «Proyecto: …». Un entregable dice «Entregable: …». Bajo la cuadrícula, una línea con «Siglas del proyecto» y «Entregable: tareas hechas de su total; el color indica si va en plazo».
16. PDF: en una columna «Planificación semanal», los dos «PDF de la semana» se descargan como «semana-por-dia-…» y «semana-por-persona-…» (apunta los nombres); en el de por persona, las tareas sin fecha dicen «Sin fecha». En una «Lista consolidada», el PDF se llama «lista-por-tarjeta-…» o «lista-por-tipo-…».
17. Generar release: el paso 1 dice «Notas de versión por tipo. Al desplegarla, va al histórico y cada tarea (salvo las fijas) pasa a empezar por su código: «R…F1: …».». Cierra sin desplegar. En «Generar plan de trabajo», el texto lleva la fecha como «24 nov 2026», no «2026-11-24».
18. Historial de versiones: busca una palabra: sale resaltada. Como administrador ves «Cambios técnicos / DB»; si te doy la contraseña de «Persona Prueba», comprueba que ella no los ve (tampoco al buscar ni con «Ver más»). Abre `/changelog#v1.60.0`: baja a esa versión; cambia la dirección a `#v1.62.0` sin recargar: baja a esa.
19. Administración → Usuarios → Editar en tu propia fila: el email sale bloqueado con «Tu propio email se cambia en «Mi perfil».». No cambies nada.
20. Administración → Proyectos: los administradores que no son miembros salen como «(admin, no miembro; lo tiene en su lista)» o «(admin, no miembro; no lo tiene en su lista)», y el recuento añade «· N admins sin ser miembros». En Ajustes del proyecto → General de un proyecto de equipo sin miembros: «Sin miembros. Los administradores lo ven sin ser miembros.»; apunta la nota sobre «Reenviar invitación» o «Generar enlace de invitación nuevo».
21. Administración → Logs: «Periodo» con «Última hora», «Últimas 24 h», «7 días» y «Personalizado…»; elige «Personalizado…»: salen «Desde» y «Hasta» como listas de días. Elige un rango y pulsa «Descargar CSV»: su descripción (read_page) dice «Con el periodo y los filtros de la lista». Si eliges un «Desde» posterior al «Hasta», debe avisar «Periodo personalizado: … Se muestran las últimas 24 h.». Busca una fila «Inicio de sesión fallido» de un email sin cuenta (si no hay, pídeme que pruebe yo uno en ventana privada): el email sale como «a***@…».
22. Administración → Copias de seguridad: los textos no deben nombrar variables («Se guardan en el disco de este servidor…»); las variables están en las notas «Para quien instala». Apunta si alguna frase se entiende mal.
23. Administración → Tipos y plantillas → Plantillas: las de serie llevan la etiqueta «De serie» (no «Por defecto»). Abre «Eventos y viajes»: su descripción ya no habla de «la agenda» y las columnas «Por confirmar» y «Reservado» traen el tipo por defecto «Proveedor».
24. Integraciones → WhatsApp: si está configurado, NO pulses «Probar» sin preguntarme (cada prueba son dos mensajes de pago). Solo apunta si muestra un último error.
25. (v1.71) Railway → servicio de Pizarro → Deploy Logs del último despliegue: busca la línea «[start] Base de datos al día: N migraciones aplicadas, sin lanzar Prisma» y apunta el tiempo de «comprobación».
26. (v1.71) Organizar por personas en un proyecto DE EQUIPO de «Casa y familia» con «Persona Prueba» como miembro: si el proyecto no está en tus «Proyectos en los que trabajo», el diálogo cuenta solo a Persona Prueba y muestra «Los administradores cuentan solo si tienen el proyecto en «Proyectos en los que trabajo».». Añádelo a tu lista, recarga y vuelve a abrirlo: ahora cuenta también contigo. No crees las columnas si ya existen.
27. (v1.71) En una columna «Asignación a persona» con plazo, deja una tarjeta que ya sea de esa persona y tenga fecha; selecciona esa y otra sin responsable de otra columna y «Mover a…» esa columna: un solo aviso «2 tarjetas movidas · 1 asignada a …» con «Deshacer».
28. (v1.71) Menú «⋯» de una columna → Rol de la columna › → «Más roles…»; cierra el menú y ábrelo otra vez: «Más roles…» vuelve a salir plegado.
29. (v1.71) Alt+→ sobre el nombre de una columna y Ctrl+Z: vuelve a su sitio; en Logs, «Movió la columna». (Con dos personas a la vez lo prueba el propietario.)
30. (v1.71) Abre una tarea, edita la descripción, guárdala con Ctrl+Intro, cambia a otra pestaña del navegador y vuelve: la descripción NO debe abrirse sola en edición.
31. (v1.71) Plan de trabajo para IA de «Proyecto de prueba» con una tarea que tenga una imagen pegada en la descripción y otro adjunto: en el texto del paso 2, la imagen sale en la descripción pero no se repite en «Adjuntos».

Informe en español: para cada punto, «bien», «mal» o «no se pudo», con el texto exacto de los avisos y, si algo falla, una captura descrita. Al final, lo que te haya parecido confuso. No borres nada de lo creado: pregúntame.
```

## 2. Auditoría como usuario de la v1.71.0 (instalación de prueba)

```text
Quiero que uses Pizarro como lo haría una persona nueva en su trabajo y me des un informe de todo lo que confunda, falle o se pueda mejorar. Trabaja en una pestaña nueva y, si algo no coincide con lo que te describo, para y pregúntame.

Dónde: la instalación de PRUEBA en Railway (proyecto `pizarro-prueba-instalacion`, administrador `admin-prueba@example.com`). No toques la real. Antes de cualquier paso que cueste dinero, para y pregúntame. No pongas en tu informe claves, contraseñas ni datos personales.

0. En Historial de versiones, comprueba que es la v1.71.0 (si no: Railway, servicio de Pizarro, rama `stable`, «Deploy»).
1. Crea un proyecto «Casa y familia» con tarjetas de ejemplo para una familia de tres personas: «Organizar por personas», reordena las columnas con Alt+flechas, mueve tareas entre las columnas de cada persona (con «Columna» en el detalle y con «Mover a…») y usa «Deshacer» en los avisos. Descarga el plan de cada persona y el PDF de la semana.
2. Crea tareas de varios tipos (también con «Varias tareas»), cambia de tipo en el detalle con y sin la descripción a medias, usa «Deshacer todo», enlaza tareas con «Bloqueada por» y navega con «Bloquea a» y «← Volver».
3. Mi perfil: cambia el orden de los proyectos y edita una plantilla sin guardar antes de cambiar de pestaña. ¿Se entiende cada opción?
4. Calendario (con varios proyectos y entregables), Mis tareas y Avisos: ¿se entiende qué tienes pendiente y para cuándo? ¿Se entiende la leyenda?
5. Releases y plan de trabajo para IA en el proyecto «Proyecto de prueba».
6. Administración: Usuarios, Proyectos (miembros y administradores que no lo son), Tipos y plantillas (las «De serie»), Copias de seguridad (¿se entiende sin saber de servidores?), Logs (periodo personalizado y CSV).
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
