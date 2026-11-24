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
- Los PDF de Pizarro se descargan (desde la v1.68) o se abren en una pestaña; su texto va con fuentes incrustadas y se
  lee por captura, no con read_page.
- Los tooltips nativos (atributo `title`, al pasar el ratón) no salen en las capturas: se leen con read_page.
- Para ver en *Logs* el apagado en inglés hace falta un apagado nuevo: reiniciar el servicio de Pizarro de la
  instalación de prueba (Railway, *Restart*); los apagados de versiones anteriores siguen en español.

Estado tras la ronda 64 (v1.68.0):

- Hecho: revisión de Cloudflare y R2 (ronda 60), instalación desde cero en Railway con la web (ronda 60), copias en R2 y
  primera regla de bloqueo (ronda 61), pruebas en real de la v1.64/v1.65 y auditoría como usuario (ronda 62),
  `feedback@getpizarro.com`, regla `adjuntos-pizarro`, comprobación de salud y pruebas de la v1.66.0 (ronda 63) y, en la
  ronda 64: pruebas en real de la v1.67.0 (todo bien salvo las plantillas propias y el plan para IA, que no se pudieron,
  y el apagado en inglés, sin comprobar; pasan al prompt 1), auditoría como usuario de la v1.67.0 (sus fallos se
  arreglaron en la v1.68.0) y registro DMARC `_dmarc` con `p=none` en getpizarro.com (antiguo prompt 2).
- Pendientes, en este orden: 1 (pruebas en real de la v1.68.0), 3 (auditoría como usuario de la v1.68.0, cuando el
  propietario lo diga) y, opcional, 2 (informes DMARC, solo si el propietario lo aprueba).

## 1. Pruebas en real de la versión 1.68.0 (instalación de prueba)

```text
Quiero que compruebes en real las novedades de Pizarro v1.68.0 y me des un informe. Usa la instalación de PRUEBA (proyecto `pizarro-prueba-instalacion` de Railway, administrador `admin-prueba@example.com`); no toques la real. Si no recuerdas la contraseña, para y pídeme que entre yo. Si algo no coincide con lo que te describo, para y pregúntame. Antes de cualquier paso que cueste dinero, para y pregúntame. No copies claves ni datos personales. Los PDF se descargan: ábrelos desde las descargas del navegador y léelos por captura. Los textos que salen al pasar el ratón léelos con read_page.

0. «Historial de versiones» debe decir v1.68.0. Si no: en Railway, servicio de Pizarro, comprueba que la rama sea `stable` y pulsa «Deploy»; espera a que termine.
1. Roles retirados: en el menú «⋯» de una columna → Rol de la columna, no deben salir «Agenda» ni «Entrega al cliente». Si algún proyecto tenía una columna con uno de esos roles (por ejemplo «Citas» en un proyecto «Casa y familia»), debe seguir con su nombre y sus tarjetas y con «Sin rol».
2. Tipo por defecto: en un proyecto «Casa y familia», menú «⋯» de una columna → «Tipo por defecto…» → «Compras» → Guardar. El menú debe decir «Tipo por defecto: Compras…». Pulsa el «+» de esa columna: «Nueva tarea» empieza con el tipo «Compras» y el título «Comprar ». Cierra sin crear. Vuelve a «Tipo por defecto…» y elige «Ninguno».
3. Columna «Asignación a persona» (usa la de la ronda anterior o crea una con el administrador y «Vence en 3 días»):
   a. «Nueva tarea» desde su «+»: debajo de Responsable debe decir «Esta columna asigna sus tarjetas a … y, sin fecha, vencen en 3 días».
   b. Abre la cabecera para cambiar la persona: si el proyecto tiene pocas personas, debe salir el enlace «Añadir personas al proyecto»; púlsalo: lleva a Ajustes del proyecto, a la lista «Miembros». Vuelve al tablero sin cambiar nada.
   c. «Generar plan» debe estar bajo la cabecera (no al pie). Púlsalo dos veces seguidas: el botón queda ocupado, el segundo clic no hace nada y se descarga UN PDF, sin abrir pestaña. En el PDF, cada tarea con descripción lleva un resumen de varias líneas (no solo la primera) sin apartados vacíos como «**Material necesario:**», y sus etiquetas.
4. PDF de la semana: en una columna «Planificación semanal» («Esta semana»), «PDF de la semana (por día)» y «(por persona)»: se descargan igual, con el botón ocupado mientras tanto.
5. Prefijos de tipo: crea en «Casa y familia» una tarea «Prueba prefijos» de tipo «Papeleo» (título «Gestionar Prueba prefijos»). Ábrela y cambia el tipo, en este orden: Compras → Casa → Papeleo → Casa. Apunta el título tras cada cambio: debe llevar solo el prefijo del tipo actual («Comprar », ninguno con Casa, «Gestionar ») y nunca dos. Después crea una tarea de tipo «Casa» titulada «Comprar regalo de Ana» y cámbiala a «Cita»: debe quedar «Cita: Comprar regalo de Ana».
6. Detalle de una tarea con descripción: haz doble clic en la descripción; el botón del editor debe decir «Guardar descripción» y el del pie «Guardar». Cambia una palabra, cambia el tipo de la tarea sin guardar: el tipo se guarda, y junto a los botones sale un aviso en ámbar de que falta guardar la descripción; las subtareas no cambian. Pulsa «Guardar descripción».
7. Menciones: en un comentario escribe «@» y elige a una persona: se añade un espacio detrás. Escribe un espacio más: no deben quedar dos.
8. Botones flotantes (escritorio): con una tarea abierta y una descripción cambiada, ciérrala para que salga «Cambios sin guardar»: mientras está la confirmación, los botones «+», «Varias tareas» y Deshacer no deben verse encima. Cancela.
9. Apariencia: Mi perfil → tema «Mostaza»: las muestras de «Tarjetas» deben salir en tonos mostaza. Vuelve al tema que tenías.
10. Releases: en «Proyecto de prueba», «Generar release»: el paso 1 debe explicar en una línea qué hace, y el título propuesto llevar la fecha como el resto de la app (por ejemplo «Release 24 nov 2026 · …», con la fecha de hoy, no «2026-11-24»). Cierra sin desplegar.
11. Calendario: elige una persona en el filtro de personas: solo deben verse los entregables que tienen alguna tarea suya. Sin filtro, los desplegables dicen «Todos los proyectos» y «Cualquier persona».
12. Administración → Usuarios: si hay alguien con la invitación pendiente, la cabecera dice «N activos · 1 invitación pendiente» y su fila no ofrece «Forzar cambio de contraseña». Lee con read_page la descripción de los botones de icono de una fila.
13. Ajustes del proyecto → General, en un proyecto de equipo: la lista se llama «Miembros» (o «Sin miembros.»).
14. Logs en inglés: Mi perfil → English. Cambia el tema y vuelve a ponerlo; cambia el rol de una columna de prueba de «Sin rol» a «Rutinas» y otra vez a «Sin rol». En Administration → Logs, las filas deben decir qué cambió («Changed the theme to …», «Changed the role of the column … from … to …»). Después pídeme que reinicie el servicio de prueba en Railway (o hazlo tú en Railway → servicio de Pizarro → Restart, solo en `pizarro-prueba-instalacion`), espera a que arranque y busca el apagado nuevo: debe salir en inglés. Vuelve a español.
15. Pendientes de la v1.67: (a) si te doy la contraseña de «Persona Prueba», crea antes como administrador una plantilla propia en Administración → Tipos y plantillas → Plantillas, entra como «Persona Prueba» y comprueba que la puede elegir en «Nuevo proyecto»; si no, sáltalo. (b) En «Proyecto de prueba», pon una columna con rol «Plan de trabajo para IA» con dos tareas y pulsa «Generar plan de trabajo»: el texto no debe llevar «Descripción:», ni «Tarea fija…», ni apartados del formulario sin rellenar; el pie del paso 1 debe explicar de dónde salen la cabecera y el pie.

Informe en español: para cada punto, «bien», «mal» o «no se pudo», con el texto exacto de los avisos y, si algo falla, una captura descrita. Al final, lo que te haya parecido confuso. No borres nada de lo creado: pregúntame.
```

## 2. Informes DMARC de getpizarro.com (opcional, solo si el propietario lo aprueba)

```text
El dominio getpizarro.com ya tiene en Cloudflare el registro TXT `_dmarc` con `v=DMARC1; p=none;`, pero sin `rua` no llega ningún informe. Quiero activar los informes de Cloudflare. Trabaja en una pestaña nueva, no cambies nada más y, si algo no coincide o te pide pagar, para y pregúntame.

1. Panel de Cloudflare → getpizarro.com → Email → DMARC Management. Si pide activarlo, dime qué va a cambiar en el registro `_dmarc` antes de aceptar.
2. Actívalo y comprueba en DNS → Records que el registro `_dmarc` sigue siendo uno solo, con `p=none` y una dirección `rua` de Cloudflare.
3. Comprueba que Email Routing sigue en «Enabled».

Informe en español: qué había antes y qué ha quedado.
```

## 3. Auditoría como usuario (instalación de prueba, cuando el propietario lo diga)

```text
Quiero que uses Pizarro como lo haría una persona nueva en su trabajo y me des un informe de todo lo que confunda, falle o se pueda mejorar. Trabaja en una pestaña nueva y, si algo no coincide con lo que te describo, para y pregúntame.

Dónde: la instalación de PRUEBA en Railway (proyecto `pizarro-prueba-instalacion`, administrador `admin-prueba@example.com`). No toques la real. Antes de cualquier paso que cueste dinero, para y pregúntame. No pongas en tu informe claves, contraseñas ni datos personales.

0. En Historial de versiones, comprueba que es la v1.68.0 (si no: Railway, servicio de Pizarro, rama `stable`, «Deploy»).
1. Crea un proyecto «Eventos y viajes» con tarjetas de ejemplo y organiza con él un viaje de fin de semana de tres personas: una columna «Asignación a persona» por persona (con su plazo), un tipo por defecto en las columnas donde tenga sentido, mueve tareas entre ellas y descarga el plan de cada una. Las fechas se ven en el Calendario (ya no hay columnas «Agenda» ni «Entrega al cliente» con rol).
2. Crea tareas de varios tipos, cambia de tipo con la descripción a medias, añade subtareas, comentarios con «@» y adjuntos.
3. Calendario (con y sin filtro de persona), Mis tareas y Avisos: ¿se entiende qué tienes pendiente y para cuándo?
4. Releases y plan de trabajo para IA en el proyecto «Proyecto de prueba».
5. Administración: Usuarios, Ajustes, Copias de seguridad, Logs (en español y en inglés).
6. Cuenta lo que no entiendas sin ayuda y lo que te sobre.

Informe en español, ordenado de más a menos grave: para cada punto, la pantalla, qué hiciste, qué esperabas, qué pasó (texto exacto) y una propuesta. Separa: fallos, cosas confusas, ideas para simplificar y lo que te ha gustado. No borres nada: pregúntame.
```
