# Changelog

Historial de versiones de Pizarro. Fuente: `changelog.json`.

## v1.52.0 — 2026-11-13 16:46

Repeticiones en el calendario, borrar tu cuenta, duplicar con adjuntos, releases con barra de formato, tableros grandes fluidos y textos más breves

### Nuevas funcionalidades

- Las tareas que se repiten muestran sus apariciones futuras en el Calendario (con borde discontinuo) y como serie repetida en el calendario suscrito y en el .ics.
- «Nueva tarea» tiene el campo «Repetir» (cada día, semana o mes), igual que el detalle.
- Puedes borrar tu propia cuenta desde «Mi perfil», con contraseña, verificación en dos pasos y la palabra BORRAR; lo que creaste en proyectos compartidos queda como «Usuario eliminado».

### Mejoras

- Duplicar una tarea copia también sus adjuntos y documentos de Google enlazados; cada copia es independiente y cuenta para la cuota.
- Con «Con barra de formato» en Mi perfil, el texto de las releases se edita con la misma barra que las descripciones, sin «Editar / Vista previa».
- Al cambiar de proyecto, en lugar de columnas grises se dibuja el contorno del logo (solo si la carga tarda).
- Tableros con cientos o miles de tarjetas: el buscador y el arrastre van fluidos también en equipos lentos.
- Textos más breves en Administración, Mi perfil, Calendario, Documentación, importar y la instalación; los detalles pasan a notas «i».
- Los botones que no harían nada (vaciar una papelera vacía, Guardar sin cambios, Limpiar sin filtros…) aparecen atenuados y desactivados.
- Las copias de seguridad nunca borran la última copia buena y avisan si la última es mucho menor (con «La reducción es correcta» si fue a propósito).
- Exportar un proyecto incluye la papelera de Documentación, la cuota propia y los datos de los documentos de Google.
- Una importación cortada por un reinicio ya no deja ficheros sueltos.

### Correcciones

- Guardar un formulario sin conexión avisa «Sin conexión: no se ha guardado» en lugar de «Algo ha fallado», y conserva lo escrito.
- El .ics de una columna Agenda limita las series de repetición y su texto, como el calendario suscrito.
- La copia de una tarea muestra en su descripción las imágenes de sus propios adjuntos copiados, no las de la original.
- Al exportar e importar un proyecto, las imágenes de descripciones y comentarios se siguen viendo.
- En el Calendario sin conexión, mover una tarea o un entregable vuelve a su día con el aviso de sin conexión.
- Sin conexión, «Borrar los borradores al cerrar sesión» y borrar una release o sus adjuntos avisan en lugar de quedarse a medias.
- En «Nueva tarea» recuperada de un borrador, el día de «Repetir» sigue a la fecha límite.

### Cambios técnicos / DB

- TRUST_PROXY decide si la IP se toma de X-Real-IP / X-Forwarded-For (sí por defecto en Docker y Railway; no con npm start).
- Conexión a PostgreSQL con tiempo máximo de 10 s (DATABASE_CONNECT_TIMEOUT_MS) y DATABASE_POOL_SIZE validado.
- Imagen Docker unos 43 MB más pequeña y páginas legales con unos 45 KB menos de JavaScript.
- El calendario suscrito anota sus consultas como mucho una vez cada 6 horas por dirección.
- Acciones de GitHub actualizadas, Dependabot con 7 días de espera y minimatch corregido en la herramienta de lint (0 vulnerabilidades).

## v1.51.1 — 2026-11-13 10:36

Dependencias al día: Next 16.4.5, editor 3.32.3 y librería de emails con su corrección de seguridad

### Correcciones

- La librería de envío de emails se actualiza a una versión que corrige cómo interpreta direcciones raras (avisos de seguridad de nodemailer).
- Al abrir un diálogo (por ejemplo, Nueva tarea), si entras muy rápido en otro campo el foco ya no salta de vuelta al título.

### Cambios técnicos / DB

- Next 16.4.5, editor TipTap 3.32.3, nodemailer 10.3.1, marked 18.1.3, lucide-react 1.69.0, Tailwind 4.3.4 y @types/qrcode 1.5.6 (todas publicadas hace al menos 7 días).
- fast-uri 3.1.9 (dependencia de la herramienta de Prisma) con sus avisos corregidos; sin vulnerabilidades en las dependencias de producción.
- Prueba del tablero más estable: espera a que la caja de comentario se vacíe tras guardar.

## v1.51.0 — 2026-11-12 23:24

Guía de instalación en getpizarro.com, plantilla de autenticación de WhatsApp, funciona sin conexión, copias que siempre se restauran y cinco vueltas de revisión y caza de bugs

### Nuevas funcionalidades

- Guía de instalación completa y sencilla en getpizarro.com (/instalar/), en español e inglés.
- WhatsApp: el código de verificación llega con una plantilla de autenticación («Copiar código»), como exige Meta.
- Administración → Ajustes → Instalación: cambiar el nombre de la organización, el idioma por defecto y la zona horaria.
- «Reenviar invitación» para quien aún no ha entrado, e idioma al crear un usuario.
- Workflow «Mover stable» para poner la rama stable en la última versión sin publicar otra.

### Mejoras

- Sin conexión o con el servidor reiniciándose, la app ya no se cae: avisa, conserva lo escrito y se pone al día al volver.
- Las pestañas en segundo plano liberan su conexión en vivo; en red local sin HTTPS ya no se cuelga con muchas pestañas.
- Los conflictos de edición solo saltan si se cambia el mismo campo, también desde otra pestaña propia.
- Varias personas pueden comentar a la vez y todas ven todos los comentarios.
- Las contraseñas se comprueban en hilos aparte y con tope: un ataque de muchos intentos ya no frena la app.
- Recargas escalonadas tras cambios ajenos, menos precargas, caché en Administración y menos JavaScript en el navegador.
- Deshacer con muchos adjuntos, arrastrar con muchas tarjetas y la cabecera del tablero con nombres largos van mejor.
- Accesibilidad: «Saltar al contenido», tarjetas y campos del detalle con nombre, atajos anunciados y foco correcto.
- Los títulos cuentan los emojis como se ven y el contador dice cuánto cabe de verdad.
- Los resúmenes por email ya no esperan a las copias de seguridad; la copia usa su propia conexión.

### Correcciones

- Las copias de instalaciones con más de 500 tareas o comentarios vuelven a restaurarse siempre.
- Configurar un destino externo ya no borra de golpe los ficheros de las copias locales.
- Una descripción preparada a propósito ya no puede congelar el servidor al generar un calendario .ics.
- Con npm start, una instalación nueva muestra el código del asistente y crea las plantillas de serie.
- Cambiar el idioma en el asistente o en Mi perfil ya no borra lo escrito.
- Las invitaciones salen en el idioma de la instalación o el elegido.
- Una release ya no se registra con el título antiguo de una tarea renombrada mientras tanto.
- Si otra persona borra la tarea que tienes abierta, se avisa y se ofrece copiar tu texto.
- Avatares y calendario con emojis en el nombre, caracteres nulos en filtros, cuotas imposibles y otros detalles.

### Cambios técnicos / DB

- Bloqueos advisory en un único módulo, copia y subida externa con bloqueo entre procesos, conexiones pg con tope.
- Pruebas más estables (sin esperas fijas ni topes frágiles), nuevas suites e2e e install-e2e, diccionarios por tema.
- La rama stable se mueve con un token comprobado antes de usarlo.

## v1.50.0 — 2026-11-11 03:19

Avisos por Telegram y WhatsApp, guías de conexión en getpizarro.com, versiones con nombre para todas las instalaciones, informar de errores y tres vueltas de revisión y caza de bugs

### Nuevas funcionalidades

- Avisos por Telegram (gratis) y WhatsApp (de pago, API oficial de Meta): los activa un administrador en Ajustes y cada persona conecta su canal en Mi perfil, eligiendo qué avisos recibe.
- Guías de conexión en getpizarro.com: iniciar sesión con Google, Google Docs y Sheets, Telegram y WhatsApp.
- «Informar de un error» en Historial de versiones (en versiones oficiales) y «Copiar información técnica» para administradores.
- Las instalaciones de Railway pueden seguir la rama stable, que solo avanza con versiones publicadas.

### Mejoras

- El tablero, los ajustes, el calendario, las releases y el informe cargan mucho más rápido en instalaciones grandes.
- Abrir «Nueva tarea» u otros diálogos ya no hace parpadear el tablero.
- Las personas que no son administradoras pueden crear proyectos privados desde el selector.
- Dos personas pueden editar el título de la misma tarea sin que se pierda lo que escribe ninguna.
- La sesión caducada ofrece «Iniciar sesión» y conserva lo que estabas escribiendo.
- Las pantallas a las que llegas desde un email y la verificación en dos pasos salen en tu idioma.
- Los adjuntos y documentos conservan su nombre con paréntesis, comas o &, y la extensión aunque el nombre sea largo.
- La búsqueda de archivadas ignora las tildes.
- La web ya no repite el precio en la portada y enlaza a las guías; el pie indica la autoría del proyecto.
- Las acciones de GitHub van fijadas a commits exactos y Dependabot propone las actualizaciones.

### Correcciones

- Una release ya no se despliega si otra persona movió alguna de sus tareas mientras tanto.
- Las release notes, el informe PDF, los avisos y los ajustes ya no mezclan textos en español en la interfaz en inglés.
- Los códigos de release son los mismos para todo el equipo aunque cada persona use un idioma.
- El texto con `<`, `>` o `&` ya no sale como `&lt;` en avisos, emails, releases ni en el calendario suscrito.
- El informe PDF corta los títulos muy largos y ya no imprime los emojis como basura.
- Un cambio de cuota se aplica al momento a las subidas, y una subida que no cabe se rechaza antes de guardarla; con el disco lleno, el aviso lo dice.
- Deshacer muchas tarjetas ya no choca con otra persona que mueve las mismas.
- Los avisos de cambio de fecha ya no se pierden si el servidor se reinicia, aunque esté parado más de un día.
- Con `npm start`, las subidas ya no se guardan dentro de la carpeta que borra cada compilación.
- El resumen diario ya no cuenta como nuevas tus propias tareas.

### Cambios técnicos / DB

- Migraciones 20261120100000 (mensajería: UserChannel, TelegramLinkCode; las preferencias de WhatsApp salen de User) y 20261120130000 (primer intento de los avisos de fecha).
- Límite de memoria del generador de PDF (PDF_WORKER_MAX_MB) y limitador de intentos con IPv6 /64 y bloqueos de seguridad aparte.
- El workflow Release mueve la rama stable (con STABLE_PUSH_TOKEN opcional) y no republica una versión ya etiquetada.
- Plantilla de incidencias, SECURITY.md y Dependabot.

## v1.49.0 — 2026-11-10 23:41

Gratis también para centros educativos, «Nuevo proyecto» mucho más simple, web más concisa con «Instalación» en el menú, y correcciones de la revisión

### Nuevas funcionalidades

- Pizarro es gratis también para centros educativos: docencia, aprendizaje, investigación académica y gestión del propio centro.

### Mejoras

- «Nuevo proyecto» es mucho más simple: nombre, un desplegable «Empezar con» y una línea que describe la opción.
- Cerrar una tarea con un comentario a medio editar pide confirmación, y «Descartar cambios» también descarta el renombrado de una subtarea.
- Los borradores de comentarios se borran siempre al cerrar sesión.
- La web tiene «Instalación» en el menú y deja solo lo que distingue a Pizarro.
- Mientras subes un archivo, los comentarios de otras personas siguen apareciendo al momento.
- Los textos en inglés repetidos usan siempre la mejor traducción (por ejemplo, «Inline code» en la barra de formato).

### Correcciones

- Deshacer un comentario recién escrito ya no deja su texto en los avisos de otras personas.
- Deshacer el borrado de un comentario devuelve el texto a sus avisos.
- Una escritura de archivo fallida ya no deja ficheros sueltos.
- Relanzar a mano la publicación de una versión ya publicada se detiene antes de cambiar nada.

### Cambios técnicos / DB

- Limpieza: traducciones sin uso y repetidas, restos antiguos y nuevo `npm run i18n:unused`.
- Las pruebas en navegador buscan solas el Chromium instalado.

## v1.48.0 — 2026-11-10 02:03

Nueva web de getpizarro.com con capturas reales, deshacer mucho más rápido, apagado que espera a las subidas, micrófono del título solo al editarlo y columnas que indican que siguen

### Nuevas funcionalidades

- Nueva web del producto en getpizarro.com: explica qué es Pizarro con capturas reales de la app, en español e inglés y en modo claro y oscuro.

### Mejoras

- El micrófono del título solo aparece mientras editas el título, sin que el título se mueva.
- Las columnas con más tarjetas de las que caben tienen las esquinas inferiores rectas para indicar que siguen.
- Deshacer y rehacer tras mover cientos de tarjetas es mucho más rápido y ya no satura la base de datos.
- Al reiniciar o actualizar, el servidor espera a que terminen las subidas en curso y avisa al balanceador.
- Al pegar más de 100 subtareas, el aviso dice cuántas no caben.

### Correcciones

- Una subida cortada por un reinicio ya no deja un adjunto roto.
- Los avisos de un comentario editado o borrado ya no conservan el texto antiguo.
- Quitar y volver a poner una mención ya no avisa dos veces.
- Pegar HTML enorme o malformado ya no congela la pestaña.
- El recordatorio de licencia desaparece en cuanto registras la licencia o declaras uso personal.
- Mover o archivar muchas tarjetas mientras se genera una release ya no puede chocar con ella.
- El menú lateral en inglés vuelve a decir «Notifications».

### Cambios técnicos / DB

- Limpieza del repositorio: código muerto, scripts sueltos y restos del nombre antiguo.
- La publicación manual de versiones solo funciona desde main y los permisos de los workflows son mínimos.
- Nueva columna Notification.commentId (migración 20261119110000).

## v1.47.0 — 2026-11-09 21:25

Web getpizarro.com y recordatorio de licencia, comentarios editables con borrador y menciones legibles, pegado de imágenes y tablas fiable, detalle de tarea más cómodo

### Nuevas funcionalidades

- Web del producto en getpizarro.com: qué es, cómo se instala, precios y licencia, en español e inglés.
- Recordatorio discreto para administradores (como mucho una vez al mes) mientras la instalación no tenga licencia registrada ni esté declarada de uso personal; nada se bloquea.
- Administración → Licencia: registrar la licencia (titular y factura) o declarar uso personal.
- Editar tus comentarios con un lápiz discreto; se marcan «(editado)» y los demás lo ven al momento.
- El comentario sin enviar se guarda como borrador durante un día.
- Pegar una lista en «Añadir subtarea» crea una subtarea por línea.
- Las tablas copiadas de Word, Google Docs, Excel o una web se pegan como tabla.

### Mejoras

- Las menciones se ven como @Nombre resaltado mientras escribes, sin códigos.
- El título del detalle ocupa todo el ancho; «Guardado» aparece sin quitarle sitio.
- La columna de campos del detalle ya no tiene un scroll propio inútil.
- «Capturas y adjuntos (n)» muestra cuántos hay y los adjuntos se ordenan por nombre.
- Cerrar la tarea con la descripción o una subtarea a medio escribir pide confirmación.
- El enlace externo sin «https://» se completa solo.
- La barra de selección flota sobre el tablero sin cambiar el scroll de las columnas.
- Las plantillas de release se editan en su sitio, una a la vez.
- «Nuevo proyecto» reúne en una sola lista proyecto en blanco, ejemplos y plantillas.

### Correcciones

- Pegar una imagen en «Nueva tarea» ya no da avisos dobles de archivo vacío y funciona con el foco en cualquier parte.
- Copiar texto de Word, Excel u Outlook ya no adjunta una imagen de la selección.
- La importación de un proyecto grande con una conexión normal ya no se corta a los 30 minutos.
- Los avisos de asignación de varias tareas llegan en el idioma de quien los recibe.
- Dos guardados simultáneos de la descripción ya no se pisan.
- Una release ya no incluye una tarea archivada mientras se generaba.
- Ocultar a la vez los últimos tipos ya no deja el proyecto sin tipos.

### Cambios técnicos / DB

- Web estática en site/ generada con scripts/build-site.mjs y publicada con GitHub Pages.
- Nueva suite e2e de pegado y más comprobaciones en la del tablero.

## v1.46.0 — 2026-11-04 14:21

Pegar Markdown en la descripción, tablas e imágenes conservadas, campos de tarea más fiables, barra de formato como una sola caja y subidas lentas cortadas

### Nuevas funcionalidades

- Al chocar con el cambio de otra persona en el título o la descripción, el aviso ofrece «Copiar tu texto».

### Mejoras

- La barra de formato y el texto forman una sola caja: mismo borde, esquinas y contorno de foco, también pegada arriba y tras cambiar el tamaño de la ventana.
- El editor con barra muestra y conserva las tablas y las imágenes de Markdown.
- Coste y horas admiten coma decimal.
- Las subidas que van demasiado lentas se cortan y dejan libre el hueco para los demás.
- Con teclado en la tableta, Escape cierra primero el diálogo abierto y luego el menú.

### Correcciones

- Ya se puede pegar en la descripción texto Markdown con código dentro de una negrita o un enlace (antes no se pegaba nada).
- Abrir y guardar una descripción con una tabla en el editor con barra ya no la borra.
- «Sr. García…» o «a) …» ya no se convierten en listas numeradas perdiendo el texto; los escapes y el contenido de los fragmentos de código se conservan.
- «12,5» en coste u horas ya no se guarda como 125 ni se borra.
- Guardar un campo ya no borra lo que se estaba escribiendo en otro; el enlace externo sigue a deshacer y a los cambios de otros.
- Un borrador recuperado ya no pisa el cambio de otra persona.
- Cancelar con muchos cambios ya no borra ni pisa lo que hicieron otras personas.
- Un título enorme ya no frena el servidor.
- La pantalla de error en inglés ya no puede quedarse en blanco tras un despliegue; el canal en vivo se reabre si el servidor lo cierra; deshacer pendiente de confirmar ya no se anota como hecho; el color vuelve a la paleta abierta al pasar a móvil.

### Cambios técnicos / DB

- Prueba de exportar proyectos que ya no deja carpetas temporales.
- @tiptap/extension-code y @tiptap/extension-paragraph declaradas explícitamente.

## v1.45.0 — 2026-11-03 00:51

Deshacer con aviso y por lotes, PDF en segundo plano, modal de tarea más cómodo, títulos largos recortados y menos carga

### Nuevas funcionalidades

- Deshacer y rehacer avisan con su nombre si otra persona cambió lo mismo después, y piden confirmación.
- El conmutador Tablero/Lista es un solo icono junto al filtro, que no cambia de sitio.

### Mejoras

- Detalle de la tarea más ancho en escritorio, con los botones de guardar y cancelar siempre visibles y el color en un selector compacto cuando no cabe.
- La barra de formato fija ya no deja asomar nada por encima ni descuadra la esquina.
- Títulos largos: el campo se pone en rojo al pasarse y, al guardar, se recortan a 210 caracteres con aviso en lugar de perderse.
- Forzar el cambio de contraseña anula también la contraseña actual.
- Deshacer o rehacer acciones sobre cientos de tarjetas tarda una fracción de segundo (antes, varios segundos).
- Los PDF se generan en un proceso aparte: un informe grande ya no frena la app.
- El tablero no se recarga cada vez que vuelves a la pestaña si el canal en vivo funciona.
- En español, la pantalla de acceso y el tablero cargan unos 60 KB menos (el diccionario de inglés solo se descarga en inglés).
- Apagado ordenado al desplegar: se guardan los registros pendientes y se esperan los emails en curso.
- Los avisos sin leer se borran al año.

### Correcciones

- Los informes PDF con muchas tareas pendientes (más de unas 150 en una columna) fallaban siempre; ahora se generan y vuelven a mostrar el pie de página.
- Cancelar en el detalle con más de 10 cambios hechos ya no deja cambios antiguos sin revertir.
- El manual explica el límite de la privacidad de los proyectos privados frente a un administrador.

### Cambios técnicos / DB

- Generador de PDF en dist/pdf-worker.mjs (worker_thread).
- i18n separada en parte común y diccionario inglés cargado bajo demanda en el cliente.
- NEXT_MANUAL_SIG_HANDLE=1 y apagado propio.

## v1.44.0 — 2026-11-02 23:07

Revisión de toda la app: seguridad, rendimiento y fallos del tablero, las copias y el registro; cuadro propio en las columnas

### Nuevas funcionalidades

- Renombrar columna, el plazo de «Esperando» y el límite de tarjetas usan un cuadro propio de la app (el aviso del navegador no sale en algunas apps de móvil).

### Mejoras

- «Cancelar» en el detalle de una tarea deshace solo lo que hiciste tú desde que la abriste; lo que cambiaron otras personas se queda.
- La vista de lista muestra el candado de las tareas bloqueadas.
- El calendario suscrito deja fuera las tareas terminadas y sigue funcionando al cambiar la clave secreta del servidor.
- Importar CSV: las columnas terminadas van al final. Trello: se guardan los 200 comentarios más recientes de cada tarjeta. Tope de 25 MB para JSON y CSV. Jira deja de aparecer como origen admitido.
- Cada acción lee la sesión una sola vez (antes tres o cuatro); la presencia hace la mitad de peticiones y seguir una tarea ya no recarga el tablero de los demás.
- Las sesiones duran de verdad 14 días desde el último uso.
- «Instalar app» vuelve a aparecer en Android; el menú del móvil y los diálogos son accesibles con teclado y lector de pantalla.
- Copias: se guardan siempre las 3 más recientes y la variable BACKUP_PAUSE=1 detiene las automáticas mientras se restaura.

### Correcciones

- Seguridad: cambiar, restablecer o forzar la contraseña anula los cambios de email pendientes (alguien que conociera la contraseña podía quedarse con la cuenta).
- Seguridad: una petición enorme sin cuenta ya no puede llenar la memoria del servidor; las subidas se cortan al pasar del máximo aunque no indiquen su tamaño.
- Seguridad: con «solo Google», el formulario de contraseña ya no revela si la contraseña era correcta.
- Un mensaje con caracteres raros ya no bloquea para siempre el registro de Administración.
- Tras perder el disco o la base de datos, la primera copia automática ya no puede sustituir a la buena en el destino externo; la limpieza de ficheros no borra nada si la base está vacía.
- Un ZIP dañado ya no deja una importación colgada para siempre; los ZIP de releases ya no ocupan memoria más de la cuenta.
- Deshacer ya no deja tareas fijas fuera de la columna de release ni pisa roles de columna de otras personas.
- Deshacer el borrado de una tarea repetitiva ya no puede perderla; descartar deshaceres antiguos ya no borra ficheros que otro deshacer necesita; los comentarios importados conservan su autor.
- Los topes de subtareas, comentarios, tipos, proyectos privados y plantillas ya no se saltan con peticiones a la vez.
- Los recordatorios de «Esperando» ya no dejan sin email a otras personas cuando hay muchos.
- Textos sin traducir en el deshacer de una subida y en el nombre de una plantilla creada desde un proyecto.

### Cambios técnicos / DB

- next y eslint-config-next 16.4.3.
- Las rutas de subida salen del proxy (2 MB de cuerpo como mucho) y leen con tope propio; documentos y adjuntos comparten el tope de 300 subidas por minuto.
- Desempate de posiciones con una sola consulta; un sondeo de presencia por tablero.
- La importación comprueba el espacio en disco antes de recibir el archivo.

## v1.43.1 — 2026-11-02 20:24

Mantenimiento: seguridad y rendimiento de la importación, el calendario suscrito y las tareas bloqueadas, y correcciones

### Mejoras

- Importar desde Trello o CSV es mucho más rápido con archivos grandes y conserva el texto técnico como `Promise<void>`.
- Comprobar un bloqueo entre tareas pasa de hasta 1000 consultas a una sola.
- El calendario suscrito con «todas las de mis proyectos» muestra los mismos proyectos que la página Calendario.
- La página de presentación solo anuncia el pago con tarjeta y la factura automática cuando el enlace de pago existe.

### Correcciones

- El enlace secreto del calendario ya no puede quedar escrito en el registro de Administración si algo falla (tampoco los enlaces de restablecer contraseña o confirmar email).
- Una descripción preparada a propósito ya no puede bloquear el servidor al generar el calendario.
- Al mover o editar un entregable, Apple Calendar y Outlook ya actualizan la fecha.
- Dos bloqueos simultáneos A→B y B→A ya no dejan dos tareas bloqueadas en círculo.
- Importar un proyecto con muchísimas tareas encadenadas ya no deja el servidor colgado.
- Importaciones: un CSV con millones de filas, textos enormes o muchos comentarios ya no agotan la memoria; las tareas con más de 20 etiquetas se recortan (antes no se podían editar después); se evitan menciones falsas.
- La vista de lista ya no pinta cada tarea dos veces, e «ir a la tarea» desde un aviso funciona en esa vista.
- Los lectores de pantalla anuncian el límite superado en las pestañas de columna del móvil.
- Textos de ejemplo de Licencia y Textos legales traducidos.

### Cambios técnicos / DB

- Migración: fecha de última modificación en los entregables.
- Prueba intermitente de exportaciones estabilizada (el trabajador de fondo se detiene tras su prueba).
- marked pasa a dependencias de la aplicación y qrcode queda fijado.

## v1.43.0 — 2026-11-02 19:26

Importar desde Trello y CSV, calendario suscribible, límite por columna, tareas bloqueadas, vista de lista y licencia en Administración

### Nuevas funcionalidades

- Importar desde Trello (JSON) y desde CSV (Asana, Jira, Notion, GitHub Projects, Wekan, Kanboard…), además del ZIP de Pizarro.
- Suscribirse al calendario: enlace privado para Google Calendar, Apple Calendar u Outlook que se actualiza solo.
- Límite de tarjetas por columna: solo avisa, con la columna en rojo al pasarlo.
- Tareas bloqueadas: «Bloqueada por» otra tarea del proyecto, con candado en la tarjeta y enlace en el detalle.
- Vista de lista ordenable, junto al tablero.
- Administración → Licencia: muestra si la instalación tiene licencia comercial registrada (solo informativo) y lleva a la compra.
- Botón «Comprar» y precio «100 € + IVA» en la página de presentación; guía para configurar el pago con Stripe y la factura automática.

### Mejoras

- La barra de formato fija conserva el borde resaltado y las esquinas redondeadas del recuadro, y nunca sale de él.
- Las imágenes se reutilizan 10 segundos sin volver a preguntar, y las del detalle se cargan solo al aparecer en pantalla.
- Administración sigue con ocho pestañas: «Tipos de tarea» y «Plantillas de proyecto» se unen en «Tipos y plantillas».
- Tocar la etiqueta de un campo ya no corta el dictado.

### Correcciones

- El resumen diario parte del envío anterior y no pierde novedades aunque salga a otra hora.
- Una imagen borrada no puede volver a verse unos segundos por una lectura que coincidía con el borrado.
- En modo Markdown, la barra de formato fija ya no tapa los botones Guardar y Cancelar.

### Cambios técnicos / DB

- Migraciones: límite por columna, tarea que bloquea y suscripción al calendario.
- Diseño propuesto de reglas sencillas en docs/IDEAS.md (sin implementar).

## v1.42.0 — 2026-11-02 15:12

Precio de la licencia, dictado que se para al salir del campo, edición más cómoda en el móvil, imágenes más rápidas y seguridad del acceso

### Nuevas funcionalidades

- Precio de la licencia en la página de presentación: 100 €, pago único por servidor, con pago con tarjeta y factura (DNI opcional).

### Mejoras

- El dictado se para solo al pasar a otro campo o al pulsar fuera, en vez de seguir grabando.
- Móvil: el micrófono del título solo aparece mientras editas el título.
- Al editar la descripción, la barra de formato se queda fija arriba al hacer scroll.
- Las imágenes del tablero se sirven casi el doble de rápido, y siguen dejando de verse al momento al quitar el acceso.
- Desde un dispositivo recordado se admiten 10 intentos de contraseña en vez de 6: nadie puede bloquearte desde fuera tu propio equipo.
- La licencia deja claro que todo uso que no sea personal o familiar necesita licencia, sin excepciones.

### Correcciones

- El límite de intentos por cuenta ya no se puede saltar lanzando muchas peticiones a la vez.
- El enlace a la licencia mantiene el idioma elegido, y /licencia respeta el idioma de quien ha iniciado sesión.

### Cambios técnicos / DB

- Caché en memoria de los datos de cada adjunto y uso de la caché de permisos al servir imágenes; pruebas de revocación.
- Las imágenes WebP muy altas también se recomprimen.

## v1.41.0 — 2026-11-02 13:40

Licencia: gratis para uso personal y pago único para empresas; página de presentación simplificada; seguridad y correcciones

### Nuevas funcionalidades

- Licencia de Pizarro (LICENSE.md y página pública /licencia): gratis para uso personal; las empresas y profesionales necesitan una licencia de pago único por servidor, con actualizaciones gratis para siempre y sin soporte.
- Las condiciones del servicio por defecto incluyen el apartado «Licencia del software», y el pie del acceso enlaza a la licencia.

### Mejoras

- Página de presentación más corta y clara, centrada en lo que distingue a Pizarro: simple, pago único, tus datos en tu servidor; con precios y licencia. Se quitan la demo y la comparativa.
- La administración ya no enlaza a la página de presentación.
- Los micrófonos del título y de la descripción quedan perfectamente alineados.
- El límite por cuenta del acceso cuenta solo los intentos fallidos: quien acierta su contraseña ya no puede quedar bloqueado por sus propios intentos.
- Abrir una tarea ya no se anota en el registro de actividad (más ligero).
- Nueva cabecera de seguridad que aísla la pestaña de Pizarro de otras webs.
- Mi perfil explica a los administradores que la verificación en dos pasos también se pide al entrar con Google, y el registro anota esos accesos como «con Google y verificación en dos pasos».
- Nuevo proyecto: el nombre sugerido cambia al cambiar de ejemplo mientras no lo hayas escrito tú.

### Correcciones

- Liberar espacio nunca borra más elementos de los que se confirmaron, y la sección se actualiza si algo cambió.
- Archivadas: la búsqueda y «Cargar más» ya no se mezclan; recuperar una tarea que ya recuperó otra persona la quita de la lista.
- Un aviso repetido renueva su tiempo en pantalla en vez de desaparecer antes.

### Cambios técnicos / DB

- Se quita el límite por pareja IP+email, que ya no actuaba.
- Nuevo campo en el paso intermedio del acceso para recordar si vino de Google (migración).
- Prueba de que LICENSE.md y el texto de /licencia coinciden (npm run license:sync).

## v1.40.0 — 2026-11-02 12:42

Ejemplos de proyecto listos para usar, página de presentación mejorada, más seguridad en el acceso y correcciones

### Nuevas funcionalidades

- Nuevo proyecto → «Empezar desde»: proyecto en blanco o un ejemplo listo para usar (Equipo de software, Familia y casa, Preparación de un evento, Empresa y clientes), con sus columnas, tipos, campos y unas tarjetas de muestra con la etiqueta «Ejemplo».
- Administración → Ajustes: tarjeta «Página de presentación» con el enlace para verla.
- Página de presentación: secciones «Cómo se instala», «Precios» (próximamente, con el email de contacto) y «Preguntas frecuentes».

### Mejoras

- Inicio de sesión: además del límite por conexión, como mucho 6 intentos por cuenta cada 15 minutos.
- Los administradores que entran con Google pasan también por la verificación en dos pasos de Pizarro.
- Las imágenes de un proyecto dejan de verse en cuanto se quita el acceso (antes el navegador las guardaba hasta un día).
- Móvil: el título de la tarea ocupa como mucho dos líneas; al tocarlo se edita y se ve entero.
- El micrófono para dictar el título va dentro de la caja del campo.
- Liberar espacio: opciones de más de 7 y de 15 días.
- Ajustes del proyecto y de administración cargan más rápido (consultas en paralelo).

### Correcciones

- Dictado en Chrome para Android: ya no repite el texto («esto, esto es, esto es una…»).
- Liberar espacio ya no puede borrar adjuntos de una tarea recuperada ni un documento restaurado mientras tanto, y pide confirmar de nuevo si hay más contenido del mostrado.
- La purga automática de la papelera ya no borra el archivo de un documento restaurado a la vez.
- El aviso de cuota total superada mostraba «{used}» y «{limit}» sin rellenar a quien no es administrador.
- Archivadas: «Cargar más» ya no se pierde si se recupera una tarea mientras se pagina, ni mezcla resultados de una búsqueda anterior.
- Archivar varias tareas ya no cuenta ni anota las que ya estaban archivadas; recuperar dos veces seguidas no duplica el movimiento.
- Dos columnas creadas a la vez ya no superan el máximo ni comparten posición; mover una columna en el extremo no deja un deshacer vacío.
- Los avisos de error idénticos seguidos ya no se apilan duplicados.
- Una subida múltiple se detiene al alcanzar la cuota en vez de intentar todos los archivos.

### Cambios técnicos / DB

- Las subidas rechazan por tamaño declarado y por cola llena antes de ocupar un hueco de subida.
- El registro de errores del navegador rechaza cuerpos grandes antes de leerlos.
- Las cuotas generales se guardan en una sola transacción.

## v1.39.0 — 2026-11-02 02:29

Gestión del almacenamiento: cuotas configurables, desglose y liberar espacio por proyecto, y correcciones

### Nuevas funcionalidades

- Administración → Ajustes → Almacenamiento: dónde se guardan los ficheros, espacio del disco, cuánto ocupa cada cosa, los proyectos que más ocupan y las cuotas (por proyecto, 10 GB por defecto, y total opcional) sin tocar variables del servidor.
- Ajustes del proyecto → Adjuntos y límites → Almacenamiento: barra de uso, desglose (adjuntos de tareas activas y archivadas, copias en releases, documentación y su papelera), cuota propia del proyecto y acciones para liberar espacio: borrar copias de releases antiguas, adjuntos de tareas archivadas, vaciar la papelera y los 20 archivos más grandes.

### Mejoras

- Al superar la cuota, el aviso explica cómo liberar espacio o pedir que se amplíe (con enlace para admins); al desplegar una release que deja el proyecto por encima, se avisa.
- Tareas archivadas: búsqueda en el servidor por título o release y «Cargar más» (antes solo las 500 últimas).
- Crear varias tareas con responsable le avisa una vez («N tareas»).

### Correcciones

- Ya no llegan avisos de cambio de fecha si el cambio se deshizo o canceló.
- Archivar o borrar varias tarjetas funciona aunque otra persona haya quitado alguna.
- Recuperar una tarea que ya no está archivada da un aviso en lugar de moverla.
- Rehacer después de deshacer el despliegue de una release ya no mueve tareas sin release.
- Restaurar un documento de la papelera funciona aunque el proyecto esté al límite.
- Los emails de avisos distintos sobre la misma tarea ya no se bloquean entre sí.
- Solo quien lanzó una exportación o importación ve su estado; el kit de recuperación ya no muestra claves vacías.

### Cambios técnicos / DB

- Migración: Project.storageQuotaMb. Cuotas en AppState (uploadQuotaMbPerProject, uploadQuotaMbTotal); precedencia proyecto > variables > ajuste > 10 GB. src/lib/storage-cleanup.ts (borrado por lotes de filas y ficheros, invalida deshacer).

## v1.38.0 — 2026-11-02 01:44

Actualizaciones con versiones e imagen publicada, página de presentación con demo, subir archivos sin límite y descargas reanudables

### Nuevas funcionalidades

- Actualizaciones con versiones: cada release lleva su etiqueta en GitHub y una imagen Docker ya construida (ghcr.io/pla87/pizarro) para instalar y actualizar en segundos; se puede fijar o volver a una versión con --version.
- Aviso en Administración cuando hay una versión nueva de Pizarro, con enlace a las novedades y a cómo actualizar (se puede ocultar por versión o desactivar con UPDATE_CHECK=0).
- Página de presentación pública (/presentacion) con las funciones principales, comparativa con Trello, Asana, Notion y Jira, y una demo interactiva con un proyecto de ejemplo que funciona en el navegador.

### Mejoras

- Se pueden soltar o adjuntar todos los archivos que quieras de una vez: suben en cola de 3 en 3, con progreso y reintentos; un aviso indica los que no caben y por qué.
- La columna lateral del detalle de la tarea ya no tiene scroll horizontal y los colores se reparten en dos filas.
- Ajustes de correo y de Google más breves; cada proveedor indica de dónde salen el usuario y la contraseña.
- Exportaciones: la nueva sustituye a la anterior del mismo proyecto, las descargas se pueden reanudar si se cortan, se hacen dos a la vez y se deja más margen de disco libre.
- La guía de prueba en un VPS describe la instalación en un paso.

### Correcciones

- Cancelar o cerrar la tarea detiene las subidas pendientes; los contadores de la tarjeta no retroceden.
- El diálogo de nueva tarea no se cierra mientras crea y sube.
- Dos exportaciones casi simultáneas ya no se borran entre sí.
- El instalador ya no construye una versión sin publicar si GitHub no responde.

### Cambios técnicos / DB

- Workflow .github/workflows/release.yml (imagen multiarquitectura y GitHub Release con las notas del changelog); npm run release:tag. compose usa la imagen publicada (compose.build.yml para construir). Range/ETag en descargas de exportación. DISK_MIN_FREE_MB, PROJECT_TRANSFER_CONCURRENCY=2, LANDING_AT_ROOT, UPDATE_CHECK.

## v1.37.0 — 2026-11-02 00:16

Exportar e importar en segundo plano, dictado por voz, instalación en un paso y ajustes de interfaz

### Nuevas funcionalidades

- Exportar e importar proyectos en segundo plano, con barra de progreso: la exportación se descarga cuando está lista (disponible 24 horas) y se puede cerrar el diálogo; un aviso indica cuándo termina. Tienen su propia cola y no frenan las descargas de releases.
- Dictado por voz en títulos, descripciones y «Varias tareas» (botón de micrófono; gratis con el reconocimiento de voz del navegador). Se puede ocultar y cambiar de idioma en Mi perfil → Preferencias.
- Instalación en un paso en un servidor propio con un solo comando (deploy/get.sh), que también actualiza conservando la configuración y los datos; guía para Railway.

### Mejoras

- Documentación: botón de papelera en cada documento de la lista, sin abrirlo.
- Borrar proyecto: el nombre a escribir se ve fuera de la caja.
- Nuevo proyecto e importar: textos más cortos, «Crear como proyecto privado inicialmente» y el enlace de importar junto a los botones.
- La columna lateral del detalle de la tarea es más estrecha y deja más espacio a la descripción.
- Al sostener un archivo un segundo sobre «Siempre en la release» plegado, se abre para soltarlo en una tarea.

### Correcciones

- Una exportación solo la descarga quien la pidió y mientras siga gestionando el proyecto.
- El panel «Siempre en la release» vuelve a su estado tras soltar un archivo.
- El dictado en un título con menciones se guarda y respeta el largo máximo de cada campo.
- El aviso de exportación terminada sale una sola vez aunque haya varias pestañas abiertas.

### Cambios técnicos / DB

- Migración: ProjectTransferJob. PROJECT_TRANSFER_CONCURRENCY (1 por defecto). Máximo de 64 MB para los datos de un proyecto (project.json). Las copias de seguridad no incluyen exportaciones ni importaciones en curso. Permissions-Policy: microphone=(self).

## v1.36.1 — 2026-11-01 20:40

Guía de Google para dominio propio o dirección del servidor y correcciones de exportar e importar

### Nuevas funcionalidades

- Ajustes → Acceso con Google muestra la dirección pública de Pizarro (APP_URL), avisa si estás entrando por otra dirección y lista las direcciones de redirección de ambas para poder migrar sin cortes.
- Paso 0 en la guía de Google: dominio propio o dirección del servidor, y cómo pasar de uno a otro (Railway y Docker Compose).

### Mejoras

- Exportar: muestra el error del servidor si falla y, en Chrome, deja elegir dónde guardar el archivo mientras se descarga.
- El diálogo Nuevo proyecto no se puede cerrar mientras se importa.
- Importar respeta el orden de las tarjetas empatadas, de los tipos y de las plantillas, y conserva rutinas, avisos de espera ya enviados, seguidores y autor del contenido.

### Correcciones

- Importar usa el tamaño real de los archivos para la cuota y se detiene en cuanto la supera, sin bloquear las subidas de otras personas mientras importa.
- Nombres de adjuntos de releases y enlaces de Google importados saneados; títulos de más de 210 caracteres recortados con aviso.
- Etiquetas que solo se diferencian en mayúsculas ya no impiden importar.
- La cursiva sobre varias zonas en cursiva ya no rompe el texto; el menú «Más formatos» se coloca bien con el teclado del móvil.

### Cambios técnicos / DB

- Formato pizarro-project v1 con campos opcionales nuevos (compatible con los exports de la v1.36.0); lectura del export en una transacción RepeatableRead; límite del directorio central del ZIP.

## v1.36.0 — 2026-11-01 19:24

Exportar e importar proyectos, textos legales RGPD, diálogos fijos con el teclado del móvil y correcciones de la revisión

### Nuevas funcionalidades

- Exportar un proyecto (Ajustes del proyecto → General): con o sin adjuntos, y solo el tablero o todo el histórico (tareas archivadas, releases e historial). Descarga un archivo .pizarro.zip.
- Importar un proyecto desde ese archivo con «Importar desde un archivo…» en «Nuevo proyecto»: se crea un proyecto nuevo y las personas se asocian por email.
- Textos legales por defecto completos según el RGPD y la LOPDGDD, en español e inglés, para revisar por un profesional.

### Mejoras

- En el móvil, con el teclado abierto, los diálogos se quedan fijos en la zona visible y solo se desplaza su contenido.
- «Nuevo Doc» y «Nuevo Sheet» van en la misma línea.
- Los selectores de color de tipos y plantillas también se manejan con el teclado.

### Correcciones

- Con muchos PDF en cola se muestra el aviso «Hay muchos PDF generándose» en vez de un error genérico.
- En modo Markdown, el botón de cursiva ya no convierte la negrita en cursiva, y Mayús+Tab funciona con listas sangradas con tabuladores.
- El menú «Más formatos» se mantiene dentro de la pantalla y no se abre solo.
- Con Google configurado en el servidor ya se pueden guardar el dominio y el email de contacto público.
- Al cambiar servidor, puerto o usuario del correo aparece el campo de contraseña para escribirla de nuevo.
- Los registros ya no guardan enlaces de restablecimiento ni de confirmación.

### Cambios técnicos / DB

- Migración: TaskComment.authorName. Formato pizarro-project v1 (manifest.json, project.json y files/<sha256>) con comprobación de huellas y versión. PROJECT_IMPORT_MAX_MB (500 por defecto).

## v1.35.1 — 2026-10-31 14:16

Las apps instaladas se recuperan solas tras una actualización

### Nuevas funcionalidades

- Las pantallas de error ofrecen «Reintentar», «Recargar» y «Volver a iniciar sesión» (limpia la sesión y vuelve a la pantalla de acceso).

### Mejoras

- Tras una actualización, una página de acceso o de verificación en dos pasos que se quedó abierta (por ejemplo en la app instalada) se recarga sola en vez de fallar.
- Los errores del navegador en las páginas de acceso también quedan en Administración → Logs, marcados «(sin sesión)».

### Correcciones

- En la app instalada, iniciar sesión justo después de una actualización mostraba «Algo ha fallado» y no llegaba a pedir el segundo paso.

### Cambios técnicos / DB

- deploymentId de Next para detectar versiones distintas; /api/client-errors, /api/version y /api/auth/reset accesibles sin sesión (con límites).

## v1.35.0 — 2026-10-30 19:53

Textos legales editables, dominio propio, selector de color con teclado y anillos de foco sin recortar

### Nuevas funcionalidades

- Textos legales editables: nueva pestaña Administración → Textos legales con la política de privacidad y las condiciones en Markdown (español e inglés), vista previa, restaurar el texto por defecto, nombre del responsable y email de contacto.
- Guía para usar un dominio propio en Railway y redirección opcional al dominio principal (CANONICAL_REDIRECT=1).

### Mejoras

- El selector de color se maneja con el teclado: Tab entra en el color elegido, las flechas se mueven, Espacio o Enter eligen y el siguiente Tab sale.

### Correcciones

- Los anillos de foco ya no se recortan en el diálogo de tarea (Historial, Guardar…), en Varias tareas, en el menú lateral, en los registros ni al llegar al borde de una zona con scroll.

### Cambios técnicos / DB

- AppState legal.* para los textos legales; src/lib/canonical-url.ts.

## v1.34.0 — 2026-10-30 18:41

Guía de Google paso a paso con logo y páginas públicas, barra de formato en una línea y adjuntar el documento abierto

### Nuevas funcionalidades

- Guía paso a paso del acceso con Google, pantalla por pantalla de Google Cloud (Branding, Audience, Data Access, Clients), con botones para copiar cada dato y el logo de Pizarro (120×120) para descargar.
- Páginas públicas de privacidad y condiciones (/privacy y /terms), enlazadas desde la pantalla de acceso, con un email de contacto público opcional.
- Al crear una tarea desde Documentación, botón «Adjuntar «documento»» para añadir el documento abierto como adjunto.

### Mejoras

- La barra de formato ocupa siempre una sola línea: lo que no cabe pasa a «Más formatos». Se quita el botón de lista de tareas (para eso están las subtareas).
- Si hay 5 PDF esperando, los nuevos se rechazan con «inténtalo en un momento»; el informe semanal que falla se reintenta como mucho una vez por hora.
- El comando de emergencia de contraseñas queda apuntado en el registro de actividad.

### Correcciones

- Las tarjetas de opciones de Avisos por email se leen bien en todos los temas.
- Color de fondo en tema oscuro del calendario.

### Cambios técnicos / DB

- public/pizarro-logo-120.png; AppState google.publicContactEmail; acción de registro auth.resetLinkCli.

## v1.33.0 — 2026-10-30 16:33

Email y acceso con Google configurables desde Pizarro, más formato Markdown y plantillas de release para todo el proyecto

### Nuevas funcionalidades

- Acceso con Google configurable desde Administración → Ajustes (ID y secreto de cliente cifrado, dominio opcional, URIs para copiar y pasos en Google Cloud), sin variables del servidor.
- Avisos por email más claros: «Gmail de un administrador (uso familiar)» o «Servicio de correo de la empresa» con proveedores ya preparados (Workspace, Brevo, Mailchimp/Mandrill, SendGrid, Amazon SES, Mailgun, Microsoft 365) y botón para desactivar el envío.
- Barra de formato en todas las descripciones, también en modo Markdown: aumentar y reducir sangría (también con Tab y Mayús+Tab en listas), lista de tareas, cita, código, bloque de código, línea separadora y enlace (Ctrl+K).
- Las plantillas de proyecto de Administración incluyen cabeceras y pies de release.

### Mejoras

- Cualquier miembro del proyecto puede gestionar sus plantillas de release.
- Al cambiar de proyecto en los ajustes se mantiene la pestaña.

### Correcciones

- Las cabeceras y pies «Del proyecto» elegidos al generar una release ya no salen vacíos.
- Mover en el calendario una tarea de un solo día hacia atrás ya no falla.
- Los botones «+N» del calendario se cierran al volver a pulsarlos; en móvil se ven los rangos que acaban en los días del mes siguiente.
- Al cambiar servidor o usuario del correo, o el ID de cliente de Google, hay que volver a escribir la contraseña o el secreto.
- Más mensajes de error traducidos al inglés.

### Cambios técnicos / DB

- Migración: ProjectTemplate.releaseTemplates. Secreto de Google cifrado en AppState (rotación de claves y diagnóstico). Comprobación de traducciones también para errores del servidor.

## v1.32.0 — 2026-10-30 14:18

Email configurable desde Pizarro, ajustes del proyecto en pestañas con plantillas de release propias y arreglos del tablero

### Nuevas funcionalidades

- Envío de emails configurable desde Administración → Ajustes (servidor SMTP, botón «Usar Gmail», contraseña cifrada y email de prueba), sin tocar las variables del servidor.
- Cabeceras y pies de release propios de cada proyecto (Ajustes del proyecto → Releases), que salen en «Generar release» después de los tuyos, en el orden del proyecto.
- Ajustes del proyecto en pestañas: General, Tablero, Adjuntos y límites, Releases e Informes.

### Mejoras

- Al abrir una tarea desde Documentación, el visor conserva su ancho si caben los dos y la pareja queda centrada.
- El texto inicial de los tipos de tarea admite 20 000 caracteres, como las descripciones; si un texto pasa del límite se avisa en color de resaltado junto a copiar y borrar.
- El modal de editar tipo de tarea es más ancho.
- Los avisos de «Esperando» ya no se quedan cortos con muchas tareas, y los PDF tienen un tiempo máximo de 90 s para no bloquear a los siguientes.

### Correcciones

- Al soltar una tarjeta en otra columna ya no parece volver a su sitio.
- Soltar archivos entre dos tarjetas ya no crea una tarea: solo en el hueco libre bajo la última.
- El diálogo y la caja de descripción ya no cambian de tamaño al aparecer los iconos de copiar y borrar.
- El texto inicial de los tipos de tarea ya no se corta en silencio a 2000 caracteres.
- Al quitar el rol Esperando o Rutinas a una columna se borran sus ajustes (deshacer los recupera).

### Cambios técnicos / DB

- Migración: ProjectReleaseTemplate. Ajustes de email en AppState con la contraseña cifrada (incluida en la rotación de claves y en el diagnóstico). Avisos de espera por lotes con SQL; cola de PDF con tiempo máximo.

## v1.31.0 — 2026-10-30 13:19

Recuperar el acceso sin email, todo el calendario se arrastra, proyectos para admins y correcciones de la revisión

### Nuevas funcionalidades

- Sin email configurado, «Forzar cambio de contraseña» genera un enlace de un solo uso (30 minutos) que el admin copia y entrega; con email también puede copiarlo en vez de enviarlo.
- Comando de emergencia `node dist/reset-link.mjs <email>` para cuando ningún admin puede entrar (ver INSTALL.md).
- Calendario: las franjas de tareas con inicio y fin se arrastran para moverlas o se estiran por sus bordes; los entregables también se arrastran. Con deshacer.
- «Ver proyectos existentes» para administradores: lista los proyectos de equipo y permite añadirlos a sus proyectos de trabajo.
- Administración → Proyectos: un admin puede elegir proyectos para sí mismo y para otros admins pulsando su nombre.

### Mejoras

- La siguiente aparición de una tarea recurrente copia coste (sin pagar), horas estimadas, prioridad y cliente, y desplaza la fecha de inicio.
- El .ics de la columna Agenda exporta rangos de inicio a fin.
- Los «+N» del calendario abren la lista de franjas o entregables ocultos; en móvil aparecen los rangos que acaban después del mes.
- Los días «Esperando» se cuentan en días naturales de la zona de la app, igual en la tarjeta y en el aviso.

### Correcciones

- Convertir una columna en «Esperando» ya no dispara avisos de tareas antiguas; restaurar una tarea archivada reinicia su espera.
- Deshacer el borrado de una columna recupera los destinos de Rutinas; un destino no puede ser una columna terminada ni otra de Rutinas.
- El PDF de entrega al cliente muestra las menciones sin «@».
- El .ics ya no borra guiones bajos ni asteriscos dentro de palabras o enlaces.
- Deshacer entradas anteriores a la v1.30 vuelve a funcionar; restaurar una tarea conserva su origen de repetición y de Rutinas.
- Los documentos se revalidan siempre, así que quitar el acceso a un proyecto surte efecto al momento.
- Los nombres de archivo de las releases usan la fecha de la zona de la app.

### Cambios técnicos / DB

- Nuevas acciones moveDeliverable y setAdminProjectPick; página /projects. Menos consultas en subtareas, documentos y sugerencias de clientes.

## v1.30.0 — 2026-10-30 12:25

Un solo enlace externo, rangos en el calendario, recuperar el acceso sin email y un tablero más ligero en tiempo real

### Nuevas funcionalidades

- Calendario: con el campo «Fecha de inicio» activo, las tareas con inicio y fecha límite se dibujan como una franja de varios días (en móvil, «inicio → fin»).
- Recuperar el acceso: «¿Olvidaste tu contraseña?» aparece siempre; si el servidor no envía emails, explica las alternativas (Google o pedir a un admin que fuerce el cambio). Administración → Usuarios avisa si no hay ni email ni Google.
- Suelta archivos sobre una tarea de «Siempre en la release» para adjuntárselos; fuera de una tarea, dentro del panel, se crea una tarea fija con ellos.

### Mejoras

- Un solo «Enlace externo» por tarea: el campo opcional «Enlace de referencia» se integra en él.
- El borrador de tarea nueva guarda también los campos opcionales.
- La pestaña que mueve, edita, duplica, archiva o borra tareas ya no recarga todo el tablero por su propio aviso en tiempo real.
- El detalle de una tarea empieza a cargarse al pulsarla, así que se abre antes.
- La presencia y los avisos en tiempo real comprueban los permisos con menos consultas.

### Cambios técnicos / DB

- Migración: Task.externalUrl pasa a linkUrl si estaba vacío (si había dos enlaces distintos, el de referencia se añade al final de la descripción) y se quita de taskFields.
- Las acciones devuelven el id del cambio publicado (cid) en una lista de acciones revisadas; caché de acceso de 30 s para presencia y visores, vaciada al revocar.

## v1.29.0 — 2026-10-30 00:10

Campos opcionales y columna Presupuesto, cinco columnas especiales nuevas, visor de documentación ampliado y mejoras de rendimiento

### Nuevas funcionalidades

- Campos opcionales por proyecto (Ajustes del proyecto): coste con «pagado», horas estimadas y reales, prioridad, cliente, fecha de inicio y enlace de referencia. Se ven en el detalle, en la tarjeta y en los filtros.
- Columna «Presupuesto»: suma el coste de sus tareas en la cabecera y ofrece un resumen Pagado / Pendiente / Total. Activa el campo Coste, que no se puede desactivar mientras exista.
- Columna «Lista consolidada»: reúne las subtareas de todas sus tarjetas en una sola lista marcable, con copia como texto y PDF.
- Columna «Revisión con requisitos»: avisa antes de sacar una tarjeta con subtareas sin marcar.
- Columna «Agenda»: exporta sus tareas con fecha a un calendario (.ics).
- Columna «Rutinas»: muestra la próxima aparición de cada tarea recurrente y elige a qué columna va la siguiente.
- Columna «Entrega al cliente»: PDF de resumen sin comentarios ni datos internos.
- Documentación: zoom con clic en las imágenes, botones de nueva tarea y varias tareas en el visor, y soltar archivos sobre «Documentación» del menú para subirlos.

### Mejoras

- El visor de PDF e imágenes ocupa casi toda la pantalla y deja sitio para abrir una tarea al lado.
- El botón «Varias tareas» es más pequeño que el de «Nueva tarea», como en el móvil.
- Con 1 a 3 columnas, cada una mide lo mismo que con 4 (un cuarto del ancho).
- Mi perfil tiene una pestaña propia para las plantillas de release notes.
- Abrir una tarea y varias acciones sobre tareas hacen menos consultas; las subidas simultáneas hacen cola para no agotar la memoria.

### Cambios técnicos / DB

- Migraciones: campos opcionales (Project.taskFields y columnas de Task), roles BUDGET, CHECKLIST, REVIEW, AGENDA, ROUTINES y DELIVERY, Column.routineTargetColumnId y Task.routineColumnId con disparador.
- Como mucho 3 subidas procesándose a la vez en el servidor (el resto espera hasta 60 s). La suma global de almacenamiento solo se calcula si hay cuota global. INSTALL.md: no exponer el puerto 3000 sin el proxy.

## v1.28.0 — 2026-10-27 19:20

Columnas Esperando y Planificación semanal, varias tareas al lado, pestañas en Mi perfil y arreglos del tablero

### Nuevas funcionalidades

- Columnas «Esperando»: tras N días (3 por defecto) en la columna, avisa a la persona asignada (o a quien creó la tarea). Las tarjetas muestran «Esperando N d».
- Columnas «Planificación semanal»: el menú de la columna genera un PDF de la semana por día o por persona.
- Los roles Esperando y Planificación semanal se pueden poner en varias columnas del mismo proyecto.
- Suelta archivos en el hueco libre de una columna o en «Siempre en la release» para crear allí una tarea con ellos adjuntos.
- Botón «Varias tareas» encima del «+» del diálogo de nueva tarea: abre la creación múltiple al lado, con desplegable de proyecto.

### Mejoras

- El desplegable de proyecto solo aparece en la segunda tarea simultánea, más estrecho y separado del título; la primera siempre se crea en el tablero actual.
- Mi perfil se divide en pestañas: Cuenta, Preferencias y Avisos.
- Con tres columnas o más, el tablero ocupa todo el ancho en escritorio.
- El botón «Nueva tarea» ya no cambia de tamaño al arrastrar archivos sobre él.

### Correcciones

- El anillo de selección de la primera tarjeta de cada columna y del botón «+ Añadir» de las tareas fijas ya no se ve recortado.
- Deshacer un cambio de rol de columna devuelve el rol a la columna original y mantiene las tareas fijas como fijas.

### Cambios técnicos / DB

- Migración: roles WAITING y WEEKLY_PLAN, Column.waitingDays, Task.columnEnteredAt/waitingNotifiedAt con disparador al cambiar de columna; índice único de rol solo para NEXT_RELEASE e IN_PRODUCTION.
- Nueva tarea de mantenimiento «Recordatorios de tareas en espera» (cada hora). La restauración de copias borra también las funciones de la base.

## v1.27.0 — 2026-10-27 12:07

Soltar archivos en Nueva tarea, pestañas de Administración con forma de pestaña, Docker endurecido y guía de prueba en un VPS

### Nuevas funcionalidades

- Arrastra archivos al botón «Nueva tarea» para abrir el formulario con ellos ya adjuntos.
- Guía paso a paso para probar la instalación propia en un VPS, con copia a R2 y restauración (docs/PRUEBA-VPS.md).

### Mejoras

- Las pestañas de Administración muestran el foco redondeado arriba y recto abajo, como pestañas.
- Instalación propia endurecida: código de solo lectura, contenedor sin privilegios extra y rol de base de datos sin superusuario.

### Cambios técnicos / DB

- Dockerfile: el código pertenece a root; solo /app/uploads y /app/.next/cache son del usuario de la app. deploy/postgres-init crea el rol pizarro_app.

## v1.26.0 — 2026-10-26 01:27

Papelera de documentos, límites de adjuntos más flexibles, BACKUP_KEY más tolerante y aviso de versión nueva

### Nuevas funcionalidades

- Papelera en la documentación del proyecto: lo borrado se puede restaurar durante 7 días y después se elimina solo.

### Mejoras

- El total de adjuntos de una tarea puede superar el tamaño de un paquete ZIP de release (sus archivos se reparten en varios paquetes); solo cada archivo debe caber en un paquete.
- BACKUP_KEY admite también formato hex y se ignoran comillas y espacios; si no es válida, la página de copias explica por qué sin mostrarla.
- Tras un despliegue, una pestaña antigua avisa «Hay una versión nueva de Pizarro. Recarga para seguir.» en lugar de «Error inesperado».

### Correcciones

- El foco con el tabulador se ve completo en las pestañas de Administración y del tablero en móvil.
- Copias: restaurar no vacía una base de datos ajena sin --force, una copia fallida no deja volcados a medias y la subida al destino externo tolera ficheros borrados entretanto.

### Cambios técnicos / DB

- Migración: ProjectDocument.deletedAt y deletedById. Nueva tarea de mantenimiento documentsTrashPurge.

## v1.25.0 — 2026-10-25 20:22

Documentación del proyecto, copias completas con destino externo y restauración sin git, asistente de primer arranque e instalador, claves separadas y diagnóstico

### Nuevas funcionalidades

- Documentación del proyecto: nueva sección del menú para subir y consultar al momento textos, Markdown, PDF e imágenes.
- Copias de seguridad completas: base de datos y todos los ficheros, cifrados, con destino externo opcional (S3 compatible como Cloudflare R2 o Backblaze B2, o una carpeta montada) y botón «Copiar ahora a destino externo».
- Restaurar una copia sin git, con un solo comando (node dist/restore.mjs); la prueba mensual restaura de verdad en una base temporal.
- Instalación propia: asistente web del primer arranque (/setup, con código de un solo uso), instalador de un comando (deploy/install.sh) y kit de recuperación.
- Administración → Ajustes: Descargar diagnóstico para soporte, sin datos personales ni secretos (también node dist/doctor.mjs).

### Mejoras

- Al desplegar, el código de la release se añade delante del título sin quitar el anterior; los títulos admiten 210 caracteres.
- En el diálogo de release, las tareas fijas «Cada dos» o «Cada tres» indican si toca ahora, en la siguiente o dentro de N.
- Los avisos de cambio de fecha esperan 5 minutos.
- Claves separadas opcionales (TOKEN_SECRET y ENCRYPTION_KEY) con rotación gradual: cambiar SESSION_SECRET ya solo cierra las sesiones.

### Cambios técnicos / DB

- Migración: tabla ProjectDocument. Nuevos comandos dist/restore.mjs, dist/rotate-keys.mjs y dist/doctor.mjs; dist/restore-backup.mjs se sustituye por dist/restore.mjs.

## v1.24.0 — 2026-10-25 16:11

Comentarios por páginas con tope configurable y borrado que conserva el hilo, avisos de fecha agrupados, títulos con el código de la release y primeros pasos para instalarlo fuera de Railway

### Nuevas funcionalidades

- Al desplegar una release, cada tarea que pasa a producción (o al archivo) lleva delante su código: «R3R1: Respuesta».
- Administración → Ajustes: máximo de comentarios por tarea (500 por defecto, hasta 1000).
- Instalación propia con Docker Compose (Caddy con HTTPS automático, Postgres y la app) y guía docs/INSTALL.md.

### Mejoras

- Comentarios: se ven los 20 más recientes y «Ver anteriores» carga 100 más cada vez.
- Borrar un comentario con respuestas lo deja como «Comentario borrado» sin romper el hilo.
- Los avisos de cambio de fecha se agrupan: llegan unos 3 minutos después del último cambio, con la fecha final.
- La zona horaria (APP_TIMEZONE) se aplica al arrancar, también en el navegador, sin recompilar.
- Mantenimiento en un solo proceso a la vez, con su estado visible en Administración → Copias de seguridad; el control de salud comprueba también el disco.

### Cambios técnicos / DB

- Migraciones: TaskComment.deletedAt, tabla PendingDueNotice y tabla JobRun. Errores no capturados del proceso registrados en los logs.

## v1.23.0 — 2026-10-25 13:56

Tamaño máximo de un adjunto por proyecto sin recompilar, contadores de adjuntos exactos, Google bloqueado tras desvincular, aviso de copias atrasadas, Docs compartidos por proyecto y paso a privado sin perder miembros

### Nuevas funcionalidades

- Ajustes del proyecto: tamaño máximo de un adjunto (1–100 MB, nunca mayor que el total por tarea) y modo de compartir los documentos de Google.
- Aviso en Administración (y email a los admins) si la última copia de seguridad tiene más de 48 h.
- Administración → Usuarios: Permitir Google para quien tenga Google bloqueado.

### Mejoras

- Tras desvincular Google, no se vuelve a vincular solo: hace falta entrar con contraseña o que un admin lo permita.
- Pasar un proyecto de Equipo a Privado conserva a sus miembros (los admins que solo lo veían por su perfil pierden el acceso).
- Si un documento de Google se crea pero no se comparte, se avisa y queda marcado en la tarea.
- MAX_UPLOAD_MB se aplica al arrancar: cambiarlo ya no exige recompilar.

### Correcciones

- El total de adjuntos de una tarea se calcula siempre con los adjuntos reales (no puede quedarse con megas de adjuntos ya borrados).
- Borrar un tipo ya no pasa sus tareas a un tipo general oculto en ese proyecto; el calendario descarta fechas antiguas al recibir datos nuevos.

### Cambios técnicos / DB

- Migraciones: Project.fileMaxMb y googleShareMode, TaskLink.shareStatus, User.googleRelinkBlocked, tabla AppState e índice de avisos por fecha.

## v1.22.0 — 2026-10-25 11:42

Ritmo de las tareas fijas, crear tareas en otro proyecto, copiar y borrar la descripción, desvincular Google y endurecimiento tras la auditoría

### Nuevas funcionalidades

- Tareas fijas de la release con ritmo: En todas, Cada dos (releases pares) o Cada tres (múltiplos de 3).
- Nueva tarea en otro proyecto: desplegable de proyecto junto al título, con sus columnas, tipos, personas y entregables.
- Botones discretos para copiar (con formato) y borrar la descripción.
- Administración → Usuarios: Desvincular Google.

### Mejoras

- El aviso «Adjunto borrado» deshace exactamente ese borrado; Ctrl+Z sigue deshaciendo la última acción.
- Descarga de adjuntos de una release en varios paquetes protegida: si cambian a mitad, se avisa y se puede reintentar.
- Las copias de adjuntos del histórico se retoman solas si el servidor se reinicia al desplegar.
- Los adjuntos de hasta 20 MB ya se aceptan de verdad (antes el servidor cortaba en 12 MB).

### Correcciones

- Auditoría externa revisada: desplegar no omite en silencio tareas que ya no están, cuota de adjuntos atómica, identidad de Google verificada al conectar Drive, avisos que no salen si la persona perdió el acceso, comprobación de origen más estricta y varios endurecimientos más.
- Revisión del lote: copias de release sin duplicados ni filas sin fichero y bloqueos sin interbloqueos.

### Cambios técnicos / DB

- Migraciones: Task.evergreenEvery, Release.attachmentsPending y un nombre único por copia de adjunto en cada release. MAIL_OUTBOX_DIR se ignora en producción salvo MAIL_OUTBOX_IN_PRODUCTION=1.

## v1.21.0 — 2026-10-24 19:14

Orden de tarjetas estable, duplicar arrastrando con Ctrl, Cancelar en el detalle, límites separados de adjuntos y de paquetes, y móvil más cómodo

### Nuevas funcionalidades

- Arrastra una tarjeta con Ctrl pulsado al soltar (⌥ en Mac) para crear una copia en ese sitio, también en la misma columna.
- Botón Cancelar en el detalle de la tarea: deja la tarea como estaba al abrirla, en un solo paso de deshacer.
- Exportar logs a CSV entre dos fechas (por defecto, el último día).

### Mejoras

- Límites separados en Ajustes del proyecto → Releases: adjuntos de una tarea y cada paquete ZIP (el del paquete nunca es menor).
- Borrar un adjunto ya no pide confirmación: se puede deshacer desde el aviso.
- Móvil: Filtrar siempre a mano junto a Buscar, Deshacer y Rehacer también dentro de la tarea, y tras crear una tarea el tablero salta a su columna.
- Deshacer borra del historial de la tarea lo que había anotado la acción; rehacer lo vuelve a poner.
- Si un admin forzó el cambio de contraseña, también se pide al entrar con Google.

### Correcciones

- Las tarjetas de una columna ya no se reordenan solas al mover otras: dos tarjetas nunca comparten posición y las que la compartían se han corregido.
- Revisión de código: un ZIP de adjuntos a la vez por persona, aviso fiable de los paquetes de una release guardada, tope en la cola de imágenes y Cancelar sin confiar en datos del navegador.

### Cambios técnicos / DB

- Migraciones: posiciones sin empates, límite de adjuntos por tarea (Project.taskAttachMaxMb) e historial asociado al deshacer (UndoEntry.eventIds/events).

## v1.20.1 — 2026-10-24 12:04

Mover, editar y desplegar más rápidos; el selector Columna deja la tarjeta al final

### Mejoras

- Mover tarjetas, editar tareas y desplegar releases es más rápido (menos consultas a la base de datos; el despliegue responde sin esperar a copiar los adjuntos al histórico).

### Correcciones

- Al cambiar una tarea de columna desde el selector «Columna» del detalle, queda al final de la columna (antes podía quedar arriba).

### Cambios técnicos / DB

- Batería de pruebas de navegador de las acciones del tablero (351 comprobaciones) y pruebas de base de datos que fijan su comportamiento.

## v1.20.0 — 2026-10-24 10:48

Límites por proyecto, adjuntos con tope por tarea y releases en varios paquetes, soltar archivos en las tarjetas, tipos generales en inglés y proyecto que se mantiene en el menú

### Nuevas funcionalidades

- Arrastra archivos directamente sobre una tarjeta del tablero para adjuntarlos.
- Releases con muchos adjuntos: se descargan en varios paquetes ZIP del tamaño máximo del proyecto, con el menor número posible.
- Límites por proyecto: 50 etiquetas, 100 entregables y 1000 tareas activas.

### Mejoras

- El tamaño máximo del proyecto limita también la suma de adjuntos de cada tarea; la sección de adjuntos indica el máximo por archivo y el total usado, resaltado si se supera.
- El proyecto sigue elegido en el menú al ir al calendario, avisos, perfil u otras páginas generales.
- Los tipos generales de serie se muestran en inglés a quien usa Pizarro en inglés.
- La fecha de creación de una tarea incluye la hora.
- Arrastrar texto seleccionado a otro campo lo mueve; con Ctrl (⌥ en Mac) lo copia.
- Las tareas archivadas son de solo lectura hasta recuperarlas.

### Correcciones

- Revisión de seguridad: al cambiar el email de una cuenta se desvincula Google y caducan los enlaces enviados a la dirección anterior; cerrar sesión borra la cookie; los errores del navegador solo se registran con sesión válida.

### Cambios técnicos / DB

- Migración: índices por fecha de creación y por autor en tareas, comentarios, adjuntos, enlaces, releases y avisos.

## v1.19.0 — 2026-10-23 23:09

Plantillas en inglés, calendario con varias personas, cambio de proyecto sin perder la página, tope del ZIP por proyecto y correcciones del editor

### Nuevas funcionalidades

- Calendario: elige varias personas a la vez (incluida «Sin asignar»); tú apareces una sola vez, como «Nombre (yo)».
- Con la interfaz en inglés, las plantillas de serie se ofrecen en inglés y crean columnas, tipos y etiquetas en inglés.
- Ajustes del proyecto → Releases: tamaño máximo del ZIP de adjuntos de una release (80 MB por defecto).

### Mejoras

- Al cambiar de proyecto te quedas en la misma página (tablero, releases o ajustes).
- Al crear un proyecto se abren primero sus ajustes, con un botón «Ir al tablero».
- Adjuntos de hasta 20 MB.
- En una tarea, Tab desde el título entra directamente en la descripción.
- Pegar Markdown en el móvil conserva el formato.
- Las imágenes se guardan un día en la caché del navegador: los tableros con muchas imágenes cargan más rápido.
- Los logs solo anotan las descargas (no cada imagen vista) y muestran los destinatarios de avisos enmascarados (p***@dominio).

### Correcciones

- Supr o Retroceso con texto seleccionado borra toda la selección, también entre elementos de lista.
- El anillo de foco de los botones de archivar y duplicar ya no se corta.
- Revisión de código: logs de proyectos privados siempre ocultos a quien no es miembro, cambios de etiquetas y entregables en vivo, búsqueda de releases acotada y menos consultas repetidas.

### Cambios técnicos / DB

- Migración: Project.releaseZipMaxMb (tope del ZIP de adjuntos de releases).

## v1.18.0 — 2026-10-23 15:53

Cabecera adaptada a media pantalla, calendario con varios proyectos, rehacer protegido frente a cambios ajenos, 12 plantillas de serie y mejoras de rendimiento y robustez

### Nuevas funcionalidades

- Calendario: elige varios proyectos a la vez.
- Seis plantillas de serie nuevas: Soporte y atención al cliente, Selección de personal, Reformas y obras, Viajes, Estudios o tesis y Mudanza.
- Opción de plantilla «Ocultar todos los tipos generales» (activada en las de serie salvo Vibecoding).

### Mejoras

- Cabecera del tablero a media pantalla: botones con solo icono, «Nueva» y el número de tarjetas sin saltos de línea; el nombre del proyecto no se recorta.
- Los desplegables se ven completos si caben en la pantalla.
- El blanco de los selectores de color tiene borde en los temas claros.
- Tema Eva: verde más neón en modo claro; indicadores de foco de 3 px en todos los temas.
- Rehacer (y deshacer tras rehacer) no se aplica si otra persona cambió lo afectado entretanto.
- Las plantillas de serie que no hayas modificado se actualizan solas.

### Correcciones

- Varias correcciones de robustez y rendimiento de la revisión de código: deshacer/rehacer sin bloqueos por cambios propios, arranque tolerante, ZIP e informes PDF con límites, logs que no se pierden y menús que se recolocan.

### Cambios técnicos / DB

- Migraciones: opción de plantillas y huella de las de serie; huella en las entradas de deshacer.

## v1.17.0 — 2026-10-23 14:24

Asignación de usuarios a proyectos, botón de rehacer, calendario, plantillas de proyecto por defecto, QR para la verificación en dos pasos, tema Eva retocado y ajustes de seguridad

### Nuevas funcionalidades

- Asignación a proyectos: quien no es administrador solo ve los proyectos a los que está asignado; los administradores eligen en su perfil en cuáles trabajan; nueva pestaña Administración → Proyectos.
- Botón de rehacer junto al de deshacer (Ctrl/⌘+Mayús+Z, Ctrl/⌘+Y, Alt+Mayús+Z).
- Calendario: tareas por fecha límite con arrastrar para cambiarla, entregables con avance y estado, filtros y vista por semanas en móvil.
- 6 plantillas de proyecto por defecto (Vibecoding, Tareas familiares, Producción audiovisual, Negocio, Marketing y contenidos, Organización de eventos), restablecibles y recuperables.
- Código QR y clave al configurar la verificación en dos pasos.
- Opción de perfil para borrar los borradores al cerrar sesión.

### Mejoras

- Hasta 10 usuarios.
- Sesiones y dispositivos recordados de 14 días; descargar una copia de seguridad pide la contraseña.
- Los Google Docs de proyectos privados solo se comparten con sus miembros.
- Archivar y Duplicar como iconos: los botones de la tarea caben en una línea.
- Botones de Cámara y Añadir más visibles en móvil.
- Las tarjetas distinguen imágenes y archivos con su icono.
- Teclado: un Tab por tarjeta, Espacio selecciona y Alt+↑/↓ la mueve dentro de la columna.
- Tema Eva con el morado y el verde del Eva-01 y detalles en naranja; foco y bordes de escritura en verde.
- Mis tareas muestra claramente el proyecto de cada tarea.
- «Mi perfil» y «Plantillas de proyecto» como nombres de menú; códigos de recuperación centrados; añadir miembro en una línea en móvil.

### Correcciones

- El menú de Administración ya no tiene scroll vertical en móvil.
- En una instalación nueva los administradores no veían el proyecto de ejemplo.
- Correcciones de seguridad y rendimiento de la revisión de código.

### Cambios técnicos / DB

- Migraciones: asignación de proyectos (sin proyectos «visibles para todos»), ajustes de seguridad, rehacer, plantillas por defecto e índices del calendario.

## v1.16.0 — 2026-10-23 01:41

Cuentas más seguras (acceso con Google, verificación en dos pasos, enlaces por email, sesiones), proyectos privados compartidos, tema Eva, atajos y filtros nuevos, tareas recurrentes, colaboración ampliada y copias de seguridad cifradas

### Nuevas funcionalidades

- Iniciar sesión con Google (cuentas existentes, opcionalmente solo de tu dominio).
- Verificación en dos pasos con app o código por email: obligatoria para administradores, opcional para el resto, con códigos de recuperación y «recordar este dispositivo».
- ¿Olvidaste tu contraseña?, confirmación por email de los cambios de contraseña y de email, aviso de inicio de sesión desde un dispositivo nuevo y página de sesiones abiertas.
- Los administradores ya no escriben contraseñas: fuerzan el cambio o invitan por email.
- Proyectos privados compartidos: solo los ven sus miembros (tampoco los administradores) y cualquier persona puede crear uno.
- Tema de color Eva.
- Atajos sobre la tarjeta: Alt+M asignarme, Alt+←/→ mover de columna, Alt+D fecha, F2 renombrar, Alt+Mayús+D duplicar; y «Duplicar» en la tarea.
- Filtros rápidos (mis tareas, vencidas, esta semana, etiqueta, tipo, responsable), también en móvil.
- Tareas recurrentes y subtareas predefinidas por tipo.
- Avisos de asignación, cambio de fecha, comentarios y respuestas; seguir tareas; marcar avisos uno a uno; menciones en el título; respuestas a comentarios; historial de la tarea.
- Resumen diario por email (opcional) e informe PDF semanal por email.
- Mis tareas como bandeja diaria; accesos directos y contador en el icono de la app.
- Copias de seguridad cifradas automáticas con prueba de restauración mensual.

### Mejoras

- Botón Guardar en la tarea, también en escritorio, que guarda todo lo que se está editando.
- Se puede arrastrar con un filtro activo.
- Con una tarea abierta, «Nueva tarea» y deshacer siguen a mano en escritorio.
- Tabulador más cómodo en todos los modales; menús y confirmaciones propios de la app.
- Plantillas de release ordenables (la primera es la de por defecto).
- Textos blancos puros en los temas no azules y presencia junto al número de tarjetas.
- Quién tiene abierta cada tarea se ve en la propia tarjeta.
- El tablero redibuja solo las tarjetas que cambian y descarga el editor con barra solo si se usa.

### Correcciones

- Al abrir una tarea por enlace directo aparecía el error de React #418.
- Cerrar el visor de imágenes tocando fuera ya no cierra la tarea en móvil.
- Varias correcciones de seguridad y robustez de la revisión de código.

### Cambios técnicos / DB

- Política de seguridad del navegador estricta (nonce), corte inmediato de conexiones en vivo al perder el acceso, cuotas de adjuntos y limpieza diaria de archivos huérfanos.
- Pruebas de integración contra PostgreSQL real (npm run test:db).
- Migraciones: cuentas por email, proyectos privados con miembros, tema Eva, productividad, Google y 2FA, colaboración.

## v1.15.0 — 2026-10-22 02:35

Atajos de teclado y filtro del tablero, caracteres especiales intactos en las releases, y dos pasadas de revisión con correcciones de seguridad, fiabilidad, accesibilidad y rendimiento

### Nuevas funcionalidades

- Atajos de teclado: Alt+N nueva tarea, Alt+Mayús+N varias tareas, / filtrar, ? ver atajos, Alt+P cambiar de proyecto, Alt+Z deshacer en el tablero, Alt+A archivar, Alt+S guardar y cerrar, Alt+R generar release (⌥ en Mac).
- Filtro del tablero por título, tipo, responsable y etiquetas, con recuento «3 de 27».
- Subtareas editables con el lápiz o con Enter/F2, además del doble clic.
- «Cargar más» en Avisos.

### Mejoras

- Al cerrar «Nueva tarea» con algo escrito se pide confirmación.
- Con un modal abierto, el tabulador no sale al tablero; Escape cierra los menús desplegables.
- Botones de icono más fáciles de tocar en móvil; avisos de error anunciados a lectores de pantalla; visor de imágenes y pestañas de la release accesibles.
- Si una acción del tablero falla por red, se avisa, se revierte solo lo afectado y se recarga.
- El tablero carga más rápido: sin descripciones hasta abrir cada tarea.
- La fecha de los logs incluye el año; «1 resultado» en singular.

### Correcciones

- Los caracteres como >, < o & escritos con la barra de formato llegaban a la release como &gt;, &lt; o &amp;.
- Seguridad: las contraseñas cambiadas o restablecidas quedaban en claro en los logs; ya no se guardan y se han borrado las existentes.
- Las menciones en un proyecto privado avisaban a su dueño aunque se mencionara a otra persona.
- Varias correcciones de robustez: tareas archivadas no editables, archivado masivo de un solo proyecto, deshacer de releases acotado al proyecto, errores de concurrencia con mensaje claro, soltar un archivo con dos modales abiertos ya no lo sube dos veces.

### Cambios técnicos / DB

- Migraciones: índices de avisos y deshacer, y limpieza de contraseñas en logs antiguos.
- Límites de subidas, comentarios, subtareas, documentos de Google y tamaño del ZIP de adjuntos.
- Mantenimiento: borra avisos leídos de más de 90 días; limpieza de memoria de visores de tareas.

## v1.14.0 — 2026-10-21 22:55

Etiquetas de tipo legibles en cualquier color, foco y logo con el color del tema, plantillas de tipo con Markdown y correcciones de borradores, deshacer en inglés y la tecla Supr en listas

### Mejoras

- Las etiquetas de tipo se leen bien con cualquier color, también negro, marino o blanco: el texto se oscurece en modo claro y se aclara en modo oscuro.
- El recuadro de foco al moverse con el tabulador usa siempre el color del tema (antes aparecía blanco en algunos elementos).
- El logo de Pizarro toma el color del tema elegido.
- El texto inicial de la descripción de un tipo de tarea admite Markdown y se edita con el mismo editor que las descripciones.
- Sin plantilla, un proyecto creado por alguien que usa Pizarro en inglés trae las columnas en inglés.
- El aviso de deshacer sale en el idioma de cada persona.
- El círculo de la tarjeta indica «Asignada a …» al pasar el ratón.

### Correcciones

- Los borradores solo se guardan si queda algo sin guardar: una tarea ya creada, guardada o cancelada no se vuelve a abrir al entrar en el tablero.
- Corregido: pulsar Supr al final de una lista en la descripción creaba y borraba una línea vacía alternativamente.

### Cambios técnicos / DB

- Las etiquetas de deshacer se guardan como plantillas traducibles; las antiguas se muestran tal cual.

## v1.13.0 — 2026-10-21 15:44

Temas de color completos y más cuidados, historial de versiones en inglés, menciones con la barra de formato, barra de formato por defecto y optimizaciones.

### Nuevas funcionalidades

- Menciones en el editor con barra de formato: al escribir @ aparece la lista de personas (y @docs / @sheets); la mención se ve como una etiqueta.

### Mejoras

- Temas de color rehechos: cada tema (Verde bosque, Siena, Mostaza, Blanco y negro) cambia toda la app —fondos, columnas, tarjetas, bordes y textos—, no solo los resaltados. Blanco y negro es completamente en grises.
- Subtareas hechas en verde neón (casilla y barra) en el tema azul.
- Historial de versiones también en inglés.
- La edición con barra de formato es la opción por defecto.
- La pantalla de acceso sale siempre en español.
- El tablero carga menos código al abrirse: los diálogos y el editor se cargan al usarlos (con precarga en segundo plano).
- Los refrescos automáticos ya no registran una visita cada vez en los logs.

### Correcciones

- Tonos 200 y 300 del color principal que no estaban definidos (algunos textos y bordes salían sin color).

### Cambios técnicos / DB

- Migración v1_13: AppVersionLog.summaryEn/changesEn y editorMode WYSIWYG por defecto (también para los usuarios existentes). Escala slate-* y color on-brand por tema. Limpieza de código sin uso (exports, helpers obsoletos). @tiptap/extension-mention y @tiptap/suggestion 3.32.0.

## v1.12.0 — 2026-10-20 23:46

Pizarro en inglés, descripciones con formato (Markdown o barra de formato), informe PDF más útil con descarga en móvil, cambios casi al instante entre pestañas, borradores automáticos, colores de acento, releases numeradas y deshacer por tarea.

### Nuevas funcionalidades

- Idioma: español o inglés en «Mi perfil y plantillas» (interfaz, mensajes, fechas, informe PDF y emails de aviso).
- Descripciones con formato: se ven formateadas al no editarlas y se escriben en Markdown o con barra de formato (negrita, cursiva, subrayado, tachado, título, subtítulo, texto normal y listas), a elegir en el perfil. Pegar Markdown lo convierte en formato.
- Colores de acento: Azul, Verde bosque, Siena, Mostaza y Blanco y negro, en claro y oscuro; la barra de subtareas contrasta con cada uno.
- Colores de tarjeta nuevos: blanco, marrón, verde oscuro y azul marino.
- Releases numeradas por proyecto: los códigos llevan el número (R32M4) y el histórico lo muestra.
- Borradores: la tarea que creas o editas se guarda cada 5 s en el navegador y se reabre si cerraste la página sin cancelar ni guardar.
- Móvil: botón Guardar fijo abajo a la derecha (con Archivar y Borrar) que guarda el título y la descripción tal como estén escritos.

### Mejoras

- Informe PDF más corto y útil: resumen con 4 cifras, lo pendiente por columna, plazos, entregables, carga, terminadas recientes y últimas releases (solo las secciones con contenido). En móvil se genera en la app con botones Descargar y Abrir.
- Los cambios de otras pestañas y personas aparecen casi al instante (menos de un segundo).
- Deshacer con contexto: con una tarea abierta deshace solo lo de esa tarea; crear una tarea con sus adjuntos cuenta como una acción; el botón ya no queda borroso detrás del modal y el aviso lleva el icono de deshacer.
- «Respuesta» es un tipo general como los demás y se puede borrar.
- Historial de versiones con la hora de cada lanzamiento.

### Correcciones

- Error de React #418 en la página de releases (y en avisos): las fechas se formatean con la misma zona horaria en servidor y navegador.
- El recuadro de foco de las opciones del menú lateral ya no se corta.
- Espacio a la izquierda del candado de los proyectos privados.

### Cambios técnicos / DB

- Migración v1_12: User.accent/locale/editorMode, Release.number (rellenado por fecha), UndoEntry.taskId y se elimina TaskKind.system. i18n propio (src/i18n, clave = texto en español, npm run i18n:check). Canal SSE /api/projects/[id]/events. Editor TipTap 3 con @tiptap/markdown. changelog.json con releasedAt.

## v1.11.0 — 2026-10-20 19:10

Deshacer las 10 últimas acciones, avisos para trabajar varios a la vez, subtareas al crear y reordenables, indicador «Guardado», candado de privados y recarga automática tras desplegar.

### Nuevas funcionalidades

- Botón Deshacer (flecha de volver) junto al nombre del tablero, también en móvil y con Ctrl/⌘+Z: deshace tus 10 últimas acciones en el tablero, incluidos borrados con adjuntos y despliegues de releases.
- Al crear una tarea se pueden añadir subtareas.
- Subtareas: doble clic para editarlas y arrastre desde el icono de seis puntos para reordenarlas.
- Aviso «Fulano también tiene abierta esta tarea» y protección al editar el título o la descripción a la vez que otra persona.
- Móvil: círculos de quién está activo en el tablero, arriba a la derecha.

### Mejoras

- Indicador «Guardando… / Guardado» en el detalle de la tarea.
- Candado junto al nombre de los proyectos privados.
- Los círculos de actividad te incluyen a ti.
- Tras un despliegue, las pestañas abiertas se recargan solas al volver a ellas (o avisan si estás escribiendo).

### Correcciones

- Dos tareas a la vez: quedan juntas y centradas, con el mismo ancho y un hueco pequeño.
- Tarjetas que a veces volvían un momento a su orden anterior: un refresco pedido antes de un cambio ya no pisa ese cambio.
- Error «Server Action … was not found on the server» al usar una pestaña abierta antes de un despliegue.

### Cambios técnicos / DB

- Migración v1_11: UndoEntry y Task.contentUpdatedAt/contentUpdatedById. Operaciones inversas por acción (src/lib/undo.ts) guardadas por runAction; los ficheros de adjuntos borrados se conservan mientras su entrada exista. buildId propio y /api/version. Presencia por tarea en memoria (/api/tasks/[id]/viewers).

## v1.10.0 — 2026-10-19 22:57

Barra de progreso de subtareas, dos tareas a la vez en escritorio, Ctrl+Enter para crear, quién está activo en el tablero, sacar tareas de la sección de fijas, logs con solo cambios por defecto y borrado de usuarios.

### Nuevas funcionalidades

- Subtareas con barra de progreso verde junto al título, que se llena según la proporción de subtareas hechas. Las subtareas no pasan a las releases.
- Escritorio: con una tarea abierta, el botón «+» de fuera del modal abre una tarea nueva a la derecha (en Backlog) y la abierta pasa a la izquierda.
- Ctrl/⌘+Enter en cualquier campo de «Nueva tarea» la crea.
- Círculos con las iniciales de quién ha hecho algo en el tablero en los últimos 5 minutos, junto a «Informe PDF».
- Borrar usuarios: si tienen proyectos privados se avisa y se pide confirmación, y se borran con ellos.

### Mejoras

- Las tareas de «Siempre en la release» se pueden arrastrar a cualquier columna y posición (dejan de ser fijas).
- Logs: por defecto solo cambios; «Incluir consultas» muestra también páginas vistas, tareas abiertas, informes y descargas.
- Los proyectos privados de un dueño desactivado quedan bloqueados hasta que vuelva; ya no se borran solos a los 30 días.

### Correcciones

- Móvil: sin scroll vertical; las columnas acaban justo encima de la barra de gestos o navegación del sistema.

### Cambios técnicos / DB

- Presencia en memoria alimentada por los logs (GET /api/projects/[id]/presence, sin registro). Pila de modales con Escape y fondo para el de más arriba. purgeProject compartido entre borrar proyecto y borrar usuario.

## v1.9.0 — 2026-10-19 19:55

Arrastrar tareas a la sección de fijas, logs con acciones legibles y privacidad de los proyectos privados, búsqueda en todo el histórico de releases, bloqueo y borrado de privados huérfanos y columnas hasta abajo en móvil.

### Nuevas funcionalidades

- Arrastrar una tarea sobre «Siempre en la release» la convierte en fija; si la sección está cerrada, se abre al pasar por encima.
- Logs con acciones legibles: crear, modificar (qué campos), mover, reordenar, archivar, recuperar, borrar, comentar, desplegar releases, columnas y proyectos.
- Proyectos privados huérfanos: si su dueño se desactiva o deja de ser admin, se bloquean (nadie los ve) y a los 30 días se borran solos.

### Mejoras

- En Logs, la actividad de los proyectos privados ajenos aparece solo con hora y usuario (también en el CSV y en los filtros).
- La búsqueda del histórico de releases cubre todas las releases, sin distinguir mayúsculas ni tildes; sin buscar, se cargan de 50 en 50.
- Las tareas fijas solo se añaden al generar la release desde su columna, no con «Release con selección».
- Las copias de archivos que no son imagen guardadas al desplegar se borran a los 7 días.

### Correcciones

- Móvil: las columnas llegan hasta abajo y la barra de tareas fijas no queda tapada por los botones flotantes.
- Texto de la sección de tipos de tarea de los ajustes del proyecto.

### Cambios técnicos / DB

- Migración v1_9: Project.privateBlockedAt, ReleaseAttachment.isImage y AppLog.privateOwnerId. Tarea de mantenimiento horaria (instrumentation register). Contexto por acción (AsyncLocalStorage) para el texto y el proyecto de cada log.

## v1.8.0 — 2026-10-19 18:25

Proyectos privados, tipos generales por proyecto, plantillas de proyecto, tareas fijas en la release, adjuntos de cualquier tipo con arrastrar y soltar, buscadores, automatización de tipos y cambio de columna deslizando en móvil.

### Nuevas funcionalidades

- Proyectos privados: solo los ve su dueño, ni siquiera el resto de administradores (Ajustes del proyecto → Visibilidad o al crearlo).
- Cada proyecto elige qué tipos generales usa; los desmarcados no aparecen en él (al desmarcar uno con tareas se elige a qué tipo pasan).
- Plantillas de proyecto (Administración → Plantillas): columnas y roles, tipos propios, tipos generales ocultos y etiquetas; se eligen al crear un proyecto.
- Tareas fijas en la columna de release («Siempre en la release»): entran en cada release y no salen de la columna al desplegar.
- Adjuntos de cualquier tipo hasta 10 MB y arrastrar archivos a la tarea abierta (también desde las descargas del navegador).
- Buscadores en el histórico de releases y en el historial de versiones.
- Automatización por tipo de tarea: título y texto inicial de la descripción, con su explicación en la lista de tipos.
- Móvil: deslizar a los lados cambia de columna.

### Mejoras

- «Respuesta» es un tipo del sistema: viene de serie, explica lo que hace y no se puede borrar.
- Los modales tienen un borde claro que los separa del fondo (sobre todo en tema oscuro).

### Correcciones

- Los errores del navegador (pantalla «Algo ha fallado» y excepciones no capturadas) ahora quedan en Administración → Logs.

### Cambios técnicos / DB

- Migración v1_8: Project.privateOwnerId, ProjectHiddenKind, ProjectTemplate, Task.evergreen, TaskKind (titleTemplate, descriptionTemplate, system) y TaskAttachment (mimeType, isImage, medidas opcionales). Los ficheros que no son imagen se guardan tal cual (<id>.bin) y se sirven siempre como descarga con tipo restringido.

## v1.7.0 — 2026-10-19 00:38

Logs de administración, archivadas en un modal con recuperación a su columna, borrado de releases y adjuntos del histórico, tipo «Respuesta» y columnas que llenan la pantalla.

### Nuevas funcionalidades

- Administración → Logs: registro detallado de los últimos 7 días (visitas, inicios de sesión, cada acción con su duración y datos, adjuntos, informes, Google, emails, WhatsApp y errores), con filtros y descarga CSV.
- Tareas archivadas en un modal («Archivadas» en el tablero y en el menú lateral) con filtro, columna de origen y releases por las que pasaron; «Recuperar» las devuelve a su columna o a la primera si ya no existe.
- Archivar varias tareas desde la barra de selección.
- Histórico de releases: «Borrar release» y «Borrar adjuntos», con confirmación.
- Tipo especial «Respuesta»: al elegirlo, el título pasa a «Respuesta» y la descripción empieza por «Respondo a las preguntas y lo que necesitas de mi:».

### Mejoras

- Escritorio: con más de tres columnas, se reparten el ancho de la ventana.
- Cada página tiene su propio indicador de carga (antes Ajustes o Releases mostraban el esqueleto del tablero).
- Con tareas seleccionadas, las columnas dejan hueco para que la barra no tape las últimas tarjetas.

### Correcciones

- Cargas lentas ocasionales: las conexiones a la base de datos ya no se cierran tras 10 s sin uso (se mantienen 10 min).
- El círculo «sin color» ya no se corta en el detalle de la tarea.

### Cambios técnicos / DB

- Migración v1_7: tabla AppLog y Task.archivedFromColumnId. Registro en lote (sin coste por petición) y purga automática (LOG_RETENTION_DAYS).

## v1.6.0 — 2026-10-19 00:08

Tema claro u oscuro por usuario, sección de Administración, marcar una columna entera, releases numeradas por día con adjuntos en el histórico y modal de tarea compacto.

### Nuevas funcionalidades

- Tema por usuario en Mi perfil → Apariencia: Sistema, Claro u Oscuro.
- Marcar o desmarcar todas las tareas de una columna con la casilla junto a su nombre.
- Histórico de releases con adjuntos: al desplegar se guarda una copia reducida (960 px, WebP 55) con los nombres de la release, descargable en ZIP desde Releases.

### Mejoras

- Sección única de Administración (Usuarios y Tipos de tarea) y nuevo orden del menú lateral: Avisos, Mis tareas asignadas, Mi perfil y plantillas, Administración, Historial de versiones, Instalar app.
- Detalle de tarea en escritorio: se ve entero sin scroll, con la columna lateral más ancha y compacta y los botones Archivar y Borrar siempre visibles.
- Releases del mismo día numeradas tras la fecha: «Release 2026-10-18 (2) · Proyecto».
- Barras de scroll con los colores de Pizarro en ambos temas.

### Correcciones

- Barra de selección en escritorio en una sola línea; dice «1 seleccionada» / «N seleccionadas».
- El título de la release ya no aparece en el texto para copiar; se guarda solo en el histórico.

### Cambios técnicos / DB

- Migración v1_6: User.theme (enum Theme) y tabla ReleaseAttachment (copias en UPLOAD_DIR/releases); al borrar un proyecto se borran también esos ficheros.
- Variante dark de Tailwind por atributo data-theme con respaldo prefers-color-scheme.

## v1.5.0 — 2026-10-18 22:47

Pizarro (nuevo nombre), releases con códigos, descripciones y adjuntos en ZIP, visor de imágenes, borrado en grupo, botón atrás y mejoras en móvil.

### Nuevas funcionalidades

- Releases: cada punto lleva un código por tipo (F1, C2…), su descripción y sus adjuntos renombrados `código_nombre.webp`; botón «Descargar adjuntos» con un ZIP de todos ellos.
- Visor de imágenes: al tocar un adjunto se ve a pantalla completa; se cierra con la X, tocando fuera, con Escape o con atrás.
- Borrar en grupo las tareas seleccionadas.
- Botón atrás: cierra el modal abierto y, en móvil, vuelve a la columna anterior (hasta 5 pasos).
- Reordenar tareas arrastrando dentro de su columna también en móvil, con un asa en cada tarjeta.

### Mejoras

- La aplicación pasa a llamarse Pizarro.
- Nueva tarea: Título, Tipo y Descripción primero; en móvil el modal se abre arriba y sigue visible con el teclado.
- El detalle de la tarea cabe entero en pantallas de escritorio.
- Barra de selección en móvil: «Mover a Siguiente salto» y «Mover a…» en la misma línea.

### Correcciones

- Móvil: el scroll vertical de una columna con muchas tareas no funcionaba (el gesto iniciaba un arrastre). Se quita el arrastre entre columnas en móvil.
- Release: el título va antes de la cabecera.
- Release: se incluye la descripción de cada tarea.

### Cambios técnicos / DB

- Ruta POST /api/projects/[id]/release-attachments que genera el ZIP en el servidor (sin dependencias nuevas) y acciones getReleaseTaskDetails y deleteTasks.
- Se mantienen los identificadores técnicos con el nombre anterior (cookies, base de datos y clave de cifrado) para no cerrar sesiones ni invalidar tokens guardados.

## v1.4.0 — 2026-10-18 18:14

Tipos de tarea exclusivos de cada proyecto.

### Nuevas funcionalidades

- Tipos de tarea exclusivos de un proyecto: se gestionan en Ajustes del proyecto (cualquiera con acceso) y se suman a los generales en los selectores, las releases y el informe PDF.

### Mejoras

- La página de admin pasa a llamarse «Tipos de tarea generales»; crear y editar tipos se hace en un modal.

### Cambios técnicos / DB

- Migración v1_4: TaskKind.projectId (opcional, se borra con el proyecto); el nombre deja de ser único global y pasa a serlo entre los generales y dentro de cada proyecto (índices parciales sin distinguir mayúsculas).

## v1.3.1 — 2026-10-18 17:56

Ver la contraseña al escribirla y corrección en «Crear varias tareas».

### Mejoras

- Icono de ojo en los campos de contraseña (inicio de sesión, cambio de contraseña y administración de usuarios) para ver lo que se escribe.

### Correcciones

- Crear varias tareas: «Tipo para todas» cambia ahora todas las líneas, también las que se habían cambiado a mano.

## v1.3.0 — 2026-10-18 17:45

Crear varias tareas pegando una lista, formularios más compactos en móvil y entregables en un modal.

### Nuevas funcionalidades

- Crear varias tareas a la vez: pega una lista (una tarea por línea), elige el tipo para todas o línea a línea y, si quieres, asigna responsable, fecha límite, entregable y etiquetas comunes. Botón «Varias tareas» en escritorio y botón flotante pequeño sobre el «+» en móvil.

### Mejoras

- Nueva tarea: el botón «Crear tarea» queda fijo abajo y siempre visible; «Asignada a» y «Fecha límite» en la misma fila y descripción más baja.
- «Asignada a» se indica como campo opcional.
- Detalle de tarea: textos de ayuda acortados a una línea (y ocultos en móvil cuando hablan de atajos de teclado).
- Entregables: el formulario se abre en un modal al pulsar «Añadir entregable» (y al editar uno).
- En móvil, las pestañas de columnas ya no muestran barra de scroll horizontal.

### Cambios técnicos / DB

- Acción createTasks: alta en bloque en una transacción (createManyAndReturn), máximo 100 tareas.

## v1.2.0 — 2026-10-18 17:11

Tipos de tarea configurables, varias plantillas de release, app instalable en el móvil y mejoras de uso en móvil y escritorio.

### Nuevas funcionalidades

- Tipos de tarea configurables por los administradores (nombre, color y orden); cada tipo es una sección de la release.
- Varias cabeceras y pies de release por usuario, con nombre; se eligen en el diálogo de «Generar release» y se sustituyen en el texto ya editado.
- Instalar Pizarro como app en Android, iPhone y escritorio (pantalla de inicio, pantalla completa).
- Preferencia de apariencia: tarjetas con franja de color o teñidas enteras de su color.
- En móvil, arrastrar una tarjeta sobre la pestaña de otra columna (manteniéndola medio segundo) muestra esa columna para soltarla en su sitio; soltarla sobre la pestaña la deja al final.

### Mejoras

- Cambio rápido de proyecto desde el título del proyecto (desplegable en móvil y escritorio).
- Botón «Cámara» también en el detalle de tareas existentes (móvil).
- Añadir columna: barra vertical estrecha al final del tablero (escritorio) y botón redondo tras las pestañas (móvil).

### Correcciones

- Se añade favicon.ico (evitaba un 404 en cada carga).

### Cambios técnicos / DB

- Migración v1_2: tabla TaskKind (Feature/Chore/Refactor → Funcionalidad; Fix/Hotfix → Corrección), tabla ReleaseTemplate (migra las plantillas existentes) y User.cardStyle.
- Manifiesto web, iconos PNG (incl. maskable y apple-touch-icon) y service worker mínimo sin caché; la imagen Docker incluye public/.

## v1.1.2 — 2026-10-18 14:19

Mensaje claro en los logs si faltan variables de entorno al arrancar.

### Mejoras

- Al arrancar se comprueban DATABASE_URL y SESSION_SECRET: si faltan, los logs indican cuál y cómo configurarla, en lugar de reiniciarse en bucle con un error de Prisma.

## v1.1.1 — 2026-10-18 14:11

Compatibilidad del build Docker con Railway.

### Cambios técnicos / DB

- Dockerfile sin cachés de BuildKit (--mount=type=cache), que el builder de Railway rechaza si no llevan su identificador de servicio.

## v1.1.0 — 2026-10-18 13:56

Informe PDF del proyecto, plazos y entregables, Google Docs/Sheets desde las tarjetas y menciones con avisos.

### Nuevas funcionalidades

- Informe PDF del proyecto: resumen y avance, estado por columna, entregables, plazos vencidos y próximos, carga por persona, tipos, últimas releases y detalle de cada columna.
- Fecha límite en las tarjetas, con aviso visual de plazo vencido, de hoy o próximo en el tablero y en «Mis tareas».
- Entregables (hitos con fecha objetivo) que agrupan tarjetas, gestionables desde «Ajustes del proyecto».
- Google Docs y Sheets: @docs o @sheets en una tarjeta crea el archivo en tu Drive, lo abre en otra pestaña y lo deja enlazado.
- Comentarios en las tarjetas con menciones @persona y autocompletado.
- Avisos de menciones en la app (campana con contador), por email y por WhatsApp.

### Mejoras

- Las columnas pueden marcarse como «terminadas» para calcular el avance y no avisar de plazos ya cumplidos.
- Preferencias de aviso y conexión con Google en «Mi perfil y plantillas».

### Cambios técnicos / DB

- Migración v1_1: Task.dueDate y deliverableId, Column.isDone y tablas Deliverable, TaskLink, GoogleAccount, TaskComment y Notification.
- OAuth de Google con permiso mínimo drive.file y tokens cifrados con AES-256-GCM.
- Envío de avisos tras responder (after) para no añadir espera; SMTP con nodemailer y WhatsApp Cloud API con plantilla.
- Nuevas variables opcionales: GOOGLE_*, SMTP_*, WHATSAPP_* y APP_TIMEZONE.

## v1.0.0 — 2026-10-18 13:25

Primera versión de Pizarro: kanban multiproyecto y generador de release notes.

### Nuevas funcionalidades

- Tablero Kanban multiproyecto con arrastrar y soltar entre columnas y dentro de cada columna.
- Columnas configurables por proyecto: crear, renombrar, reordenar, asignar rol y borrar cuando están vacías.
- Tarjetas con tipo (Feature, Fix, Chore, Refactor, Hotfix), color, responsable, etiquetas, enlace externo, checklist y descripción en Markdown.
- Capturas pegadas desde el portapapeles o subidas desde archivo/cámara, optimizadas a WebP.
- Selección múltiple y movimiento en lote a «Siguiente salto a producción».
- Generador de release notes con cabecera y pie personales, editor con vista previa, copiar, descargar .md/.txt y «Marcar como desplegado».
- Histórico de releases por proyecto.
- Vista «Mis tareas asignadas».
- Visibilidad de proyectos restringible por usuario.
- Gestión de usuarios (máx. 5) con roles Admin y Miembro.
- Historial de versiones de la aplicación.

### Mejoras

- Interfaz adaptada a móvil con pestañas de columnas y botón flotante para crear tareas o subir capturas.

### Cambios técnicos / DB

- Next.js (App Router) + PostgreSQL con Prisma; migración inicial y seed.
- Sesiones en base de datos con cookie HttpOnly, SameSite=Lax y limitación de intentos de login.
- Despliegue en un único contenedor Docker con volumen persistente para adjuntos (Railway).
