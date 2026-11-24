# Prompts para Claude in Chrome

Desde la ronda 66 los ejecuta Claude Code en el PC del propietario con Claude in Chrome (ver docs/HANDOFF.md §0b); antes,
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
- Los PDF de Pizarro se descargan (desde la v1.68) o se abren en una pestaña; su texto va con fuentes incrustadas y se
  lee por captura, no con read_page.
- Los tooltips nativos (atributo `title`, al pasar el ratón) no salen en las capturas: se leen con read_page.
- Para ver en *Logs* el apagado en inglés hace falta un apagado nuevo: reiniciar el servicio de Pizarro de la
  instalación de prueba (Railway, *Restart*); los apagados de versiones anteriores siguen en español.

Estado tras la ronda 65 (v1.69.0):

- Hecho: revisión de Cloudflare y R2 (ronda 60), instalación desde cero en Railway con la web (ronda 60), copias en R2 y
  primera regla de bloqueo (ronda 61), pruebas en real de la v1.64/v1.65 y auditoría como usuario (ronda 62),
  `feedback@getpizarro.com`, regla `adjuntos-pizarro`, comprobación de salud y pruebas de la v1.66.0 (ronda 63) y, en la
  ronda 64, pruebas en real y auditoría como usuario de la v1.67.0 y registro DMARC `_dmarc` con `p=none` en
  getpizarro.com.
- Los prompts de la v1.68.0 no se llegaron a pasar: sus puntos siguen en el prompt 1, junto a los de la v1.69.0 y los
  pendientes de la v1.67. El propietario los pasará en la próxima sesión.
- Pendientes, en este orden: 1 (pruebas en real de la v1.69.0), 2 (informes DMARC `rua`, aprobado por el propietario) y
  3 (auditoría como usuario de la v1.69.0).

## 1. Pruebas en real de la versión 1.69.0 (instalación de prueba)

```text
Quiero que compruebes en real las novedades de Pizarro v1.69.0 (y las de la v1.68.0, que no se llegaron a probar) y me des un informe. Usa la instalación de PRUEBA (proyecto `pizarro-prueba-instalacion` de Railway, administrador `admin-prueba@example.com`); no toques la real. Si no recuerdas la contraseña, para y pídeme que entre yo. Si algo no coincide con lo que te describo, para y pregúntame. Antes de cualquier paso que cueste dinero, para y pregúntame. No copies claves ni datos personales. Los PDF se descargan: ábrelos desde las descargas del navegador y léelos por captura. Los textos que salen al pasar el ratón léelos con read_page.

0. «Historial de versiones» debe decir v1.69.0. Si no: en Railway, servicio de Pizarro, comprueba que la rama sea `stable` y pulsa «Deploy»; espera a que termine.
1. Roles retirados: en el menú «⋯» de una columna → Rol de la columna, no deben salir «Agenda» ni «Entrega al cliente». Si algún proyecto tenía una columna con uno de esos roles (por ejemplo «Citas» en un proyecto «Casa y familia»), debe seguir con su nombre y sus tarjetas y con «Sin rol».
2. Tipo por defecto: en un proyecto «Casa y familia», menú «⋯» de una columna → «Tipo por defecto…» → «Compras» → Guardar. El menú debe decir «Tipo por defecto: Compras…». Pulsa el «+» de esa columna: «Nueva tarea» empieza con el tipo «Compras» y el título «Comprar ». Cierra sin crear. Abre «Varias tareas» y elige esa columna: el tipo para todas debe empezar en «Compras». Cierra sin crear. Deja el tipo por defecto puesto para el punto 3.
3. Tipo por defecto en plantillas: Administración → Tipos y plantillas → Plantillas → «Crear desde un proyecto…» con ese proyecto: en el editor, la columna del punto 2 debe traer «Compras» en su selector de tipo por defecto. Renombra el tipo «Compras» en el editor a «Compras prueba»: la columna debe seguir con él. Guarda la plantilla como «Plantilla prueba tipos». Crea un proyecto «Prueba tipos» con ella: la columna debe decir «Tipo por defecto: Compras prueba…». Después vuelve a «Casa y familia» y pon «Tipo por defecto…» → «Ninguno».
4. Columna «Asignación a persona» (usa la de la ronda anterior o crea una con el administrador y «Vence en 3 días»):
   a. «Nueva tarea» desde su «+»: debajo de Responsable debe decir «Esta columna asigna sus tarjetas a … y, sin fecha, vencen en 3 días».
   b. Abre la cabecera para cambiar la persona: si el proyecto tiene pocas personas, debe salir el enlace «Añadir personas al proyecto»; púlsalo: lleva a Ajustes del proyecto, a la lista «Miembros». Vuelve al tablero sin cambiar nada.
   c. «Generar plan» debe estar bajo la cabecera (no al pie). Púlsalo dos veces seguidas: el botón queda ocupado, el segundo clic no hace nada y se descarga UN PDF, sin abrir pestaña. En el PDF, cada tarea con descripción lleva un resumen de varias líneas (no solo la primera) sin apartados vacíos como «**Material necesario:**», y sus etiquetas.
5. PDF de la semana: en una columna «Planificación semanal» («Esta semana»), «PDF de la semana (por día)» y «(por persona)»: se descargan igual, con el botón ocupado mientras tanto.
6. Prefijos de tipo: crea en «Casa y familia» una tarea «Prueba prefijos» de tipo «Papeleo» (título «Gestionar Prueba prefijos»). Ábrela y cambia el tipo, en este orden: Compras → Casa → Papeleo → Casa. Apunta el título tras cada cambio: debe llevar solo el prefijo del tipo actual («Comprar », ninguno con Casa, «Gestionar ») y nunca dos. Después crea una tarea de tipo «Casa» titulada «Comprar regalo de Ana» y cámbiala a «Cita»: debe quedar «Cita: Comprar regalo de Ana».
7. Cambiar de tipo con subtareas: crea una tarea de un tipo con subtareas predefinidas; marca una, cambia el texto de otra y añade una a mano. Cambia la tarea a otro tipo con subtareas: las tres que tocaste se quedan y las demás del tipo anterior se sustituyen por las del nuevo. Apunta el texto exacto del aviso («Añadidas…», «Quitadas…» o «Cambiadas… subtareas del tipo») y pulsa su «Deshacer»: deben volver el tipo, el título, la descripción y las subtareas de antes.
8. Detalle de una tarea con descripción: haz doble clic en la descripción; el botón del editor debe decir «Guardar descripción» y el del pie «Guardar». Cambia una palabra, cambia el tipo de la tarea sin guardar: el tipo se guarda, y junto a los botones sale un aviso en ámbar de que falta guardar la descripción. Pulsa «Guardar descripción».
9. Menciones: en un comentario escribe «@» y elige a una persona: se añade un espacio detrás. Escribe un espacio más: no deben quedar dos.
10. Botones encima del fondo (escritorio): con una tarea abierta, el botón de informar de un error (pie del menú, junto a «Cerrar sesión»; solo aparece en instalaciones oficiales: si no sale, apúntalo) debe verse entero por encima del fondo oscurecido; púlsalo: se abre su diálogo sin cerrar la tarea. Ciérralo. Pulsa el «+» flotante: se abre otra tarea al lado. Con las dos abiertas, el «+» sigue visible entero, no abre una tercera y su descripción (read_page) dice «Ya hay dos tareas abiertas». Cambia la descripción de una y ciérrala para que salga «Cambios sin guardar»: mientras está la confirmación, los botones «+», «Varias tareas», Deshacer y el de informar no deben verse encima. Cancela.
11. Apariencia: Mi perfil → tema «Mostaza»: las muestras de «Tarjetas» deben salir en tonos mostaza. Vuelve al tema que tenías.
12. Releases: en «Proyecto de prueba», «Generar release»: el paso 1 debe explicar en una línea qué hace, y el título propuesto llevar la fecha como el resto de la app (por ejemplo «Release 24 nov 2026 · …», con la fecha de hoy, no «2026-11-24»). Genera el texto, cambia en otra pestaña el tipo de una de las tareas incluidas, vuelve y pulsa «Marcar como desplegado» (elige archivar): debe rechazarlo y pedir volver a generar la release (apunta el texto). Cierra sin desplegar.
13. Calendario: elige una persona en el filtro de personas: solo deben verse los entregables que tienen alguna tarea suya. Sin filtro, los desplegables dicen «Todos los proyectos» y «Cualquier persona».
14. Historial de versiones: deben salir 10 versiones y «Ver más»; púlsalo y comprueba que carga más. Busca «Agenda»: la primera vez debe avisar «Buscando en todas las versiones…» y encontrar versiones antiguas. Abre `/changelog#v1.60.0` en la misma instalación: debe bajar a esa versión.
15. Mis tareas: no debe haber filtros. Si tienes tareas en más de un grupo, arriba sale una línea como «Vencidas 2 · Hoy 1 · …» con enlaces a cada grupo; pulsa uno. Abre `/my-tasks?filter=overdue`: debe llevar a `/my-tasks`.
16. Administración → Usuarios: si hay alguien con la invitación pendiente, la cabecera dice «N activos · 1 invitación pendiente» y su fila no ofrece «Forzar cambio de contraseña». Lee con read_page la descripción de los botones de icono de una fila.
17. Administración → Proyectos: debe hablar de «miembros» («1 miembro», «Sin miembros.») y el selector debe decir «Añadir miembro…» (no «Asignar usuario» ni «asignados»).
18. Ajustes del proyecto → General, en un proyecto de equipo: la lista se llama «Miembros» (o «Sin miembros.»). Si hay alguien con la invitación pendiente que no sea miembro, añádelo: en su fila debe salir «Generar enlace de invitación nuevo» (sin email) o «Reenviar invitación» (con email); apunta cuál y no lo pulses.
19. Logs en inglés: Mi perfil → English. Cambia el tema y vuelve a ponerlo; cambia el rol de una columna de prueba de «Sin rol» a «Rutinas» y otra vez a «Sin rol». En Administration → Logs, las filas deben decir qué cambió («Changed the theme to …», «Changed the role of the column … from … to …»). Busca «theme»: deben salir esas filas. Ya no debe estar la nota de que los mensajes se guardan en español. Después pídeme que reinicie el servicio de prueba en Railway (o hazlo tú en Railway → servicio de Pizarro → Restart, solo en `pizarro-prueba-instalacion`), espera a que arranque y busca el apagado nuevo: debe salir en inglés. Vuelve a español.
20. Documentación (en «Proyecto de prueba»): sube un fichero «notas.md», renómbralo a «v1.2 notas» (sin extensión) y descárgalo desde su menú «⋯»: el fichero descargado debe llamarse «v1.2 notas.md». Envíalo después a la papelera.
21. Integraciones → WhatsApp: si está configurado, apunta si muestra un último error y su texto (no cambies nada). Si no está configurado, sáltalo.
22. Pendientes de la v1.67: (a) si te doy la contraseña de «Persona Prueba», comprueba como administrador que hay una plantilla propia en Administración → Tipos y plantillas → Plantillas (vale «Plantilla prueba tipos»), entra como «Persona Prueba» y comprueba que la puede elegir en «Nuevo proyecto»; si no, sáltalo. (b) En «Proyecto de prueba», pon una columna con rol «Plan de trabajo para IA» con dos tareas del mismo tipo y pulsa «Generar plan de trabajo»: el texto no debe llevar «Descripción:», ni «Tarea fija…», ni apartados del formulario sin rellenar, y el tipo debe ir una sola vez en el contexto, no en cada tarea; el pie del paso 1 debe explicar de dónde salen la cabecera y el pie.

Informe en español: para cada punto, «bien», «mal» o «no se pudo», con el texto exacto de los avisos y, si algo falla, una captura descrita. Al final, lo que te haya parecido confuso. No borres nada de lo creado: pregúntame.
```

## 2. Informes DMARC de getpizarro.com (aprobado por el propietario)

```text
El dominio getpizarro.com ya tiene en Cloudflare el registro TXT `_dmarc` con `v=DMARC1; p=none;`, pero sin `rua` no llega ningún informe. Quiero activar los informes con DMARC Management de Cloudflare (está aprobado). Trabaja en una pestaña nueva, no cambies nada más y, si algo no coincide o te pide pagar, para y pregúntame.

1. Panel de Cloudflare → getpizarro.com → Email → DMARC Management. Apunta cómo está el registro `_dmarc` antes de tocar nada.
2. Actívalo y comprueba en DNS → Records que el registro `_dmarc` sigue siendo uno solo, con `p=none` y una dirección `rua` de Cloudflare.
3. Comprueba que Email Routing sigue en «Enabled».

Informe en español: qué había antes y qué ha quedado.
```

## 3. Auditoría como usuario de la v1.69.0 (instalación de prueba)

```text
Quiero que uses Pizarro como lo haría una persona nueva en su trabajo y me des un informe de todo lo que confunda, falle o se pueda mejorar. Trabaja en una pestaña nueva y, si algo no coincide con lo que te describo, para y pregúntame.

Dónde: la instalación de PRUEBA en Railway (proyecto `pizarro-prueba-instalacion`, administrador `admin-prueba@example.com`). No toques la real. Antes de cualquier paso que cueste dinero, para y pregúntame. No pongas en tu informe claves, contraseñas ni datos personales.

0. En Historial de versiones, comprueba que es la v1.69.0 (si no: Railway, servicio de Pizarro, rama `stable`, «Deploy»).
1. Crea un proyecto «Eventos y viajes» con tarjetas de ejemplo y organiza con él un viaje de fin de semana de tres personas: una columna «Asignación a persona» por persona (con su plazo), un tipo por defecto en las columnas donde tenga sentido, mueve tareas entre ellas y descarga el plan de cada una. Las fechas se ven en el Calendario (ya no hay columnas «Agenda» ni «Entrega al cliente» con rol).
2. Crea tareas de varios tipos (también con «Varias tareas»), cambia de tipo en el detalle con subtareas tocadas y sin tocar y con la descripción a medias, usa «Deshacer», añade comentarios con «@» y adjuntos. Trabaja un rato con dos tareas abiertas a la vez.
3. Calendario (con y sin filtro de persona), Mis tareas (con su línea de resumen) y Avisos: ¿se entiende qué tienes pendiente y para cuándo?
4. Releases y plan de trabajo para IA en el proyecto «Proyecto de prueba».
5. Administración: Usuarios, Proyectos (miembros), Tipos y plantillas (tipo por defecto de las columnas), Ajustes, Copias de seguridad, Logs (en español y en inglés, buscando en los dos).
6. Historial de versiones: «Ver más», el buscador y el enlace de una versión.
7. Cuenta lo que no entiendas sin ayuda y lo que te sobre.

Informe en español, ordenado de más a menos grave: para cada punto, la pantalla, qué hiciste, qué esperabas, qué pasó (texto exacto) y una propuesta. Separa: fallos, cosas confusas, ideas para simplificar y lo que te ha gustado. No borres nada: pregúntame.
```
