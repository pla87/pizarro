# Historia de decisiones (anexo del traspaso)

Anexo de `docs/HANDOFF.md` §6: decisiones de cada ronda ya aplicadas (de la más reciente a la más antigua), lo hecho de la
paquetización, ideas pospuestas, límites conocidos y menores sin numerar. Se consulta antes de proponer algo que pudo
decidirse ya y cuando el propietario pregunte por una decisión pasada. Al cerrar una ronda, sus decisiones se añaden
arriba de «Decisiones por ronda».

## Índice

1. [Decisiones por ronda](#decisiones-por-ronda)
2. [Paquetización: lo hecho](#paquetización-lo-hecho)
3. [Ideas pospuestas](#ideas-pospuestas)
4. [Límites conocidos y menores sin numerar](#límites-conocidos-y-menores-sin-numerar)

## Decisiones por ronda

**Decisiones de la ronda 70 (ya aplicadas, v1.73.1):** encargo del propietario: mejoras operativas (experiencia de uso sin complicar la web, eficiencia, velocidad, seguridad, abaratar servidor sin bajar la calidad) y caza de bugs como cliente, editor, programador y atacante, hasta 10 vueltas o hasta que no saliera nada; lo evidente se arregla, lo opcional se pregunta y lo que se retira se pregunta antes de borrar. Criterio de parada: una vuelta sin hallazgos verificados de gravedad media o alta (se paró en la 5.ª, una pasada en Claude in Chrome en local sin hallazgos nuevos, para no gastar IA de más). Seguridad: nada explotable de gravedad alta. Hecho: «Varias tareas» pregunta al cerrar con texto; la web de fuera no publica el comentario repetido en 30 s (con el reloj de la app); caducidad de «Compartir fuera» sin clics repetidos; «Nueva tarea» respeta el prefijo escrito a mano; «Columna:» en Mis tareas; radios de visibilidad con grupo; imagen pegada sin espacios en el borde; Dockerfile sin copiar `static`/`public` dos veces; exportar/importar con las imágenes de las releases y tipos repetidos como «Nombre (2)»; tareas diarias que fallan se reintentan y Administración dice cuándo fallaron; restauración documentada con el rol de la app; Ctrl+Z con una sola recarga y avisos de deshacer con lo hecho desde fuera (cambios y comentarios); «Mover a…» sin las archivadas; etiquetas del detalle por cambio; «Aplicar plantilla» sin interbloqueo; móvil sin zoom de iOS (16 px) y web de fuera sin desbordes; baja de emails en el idioma de la persona; textos en inglés. **Descartado:** usar la caché de acceso en el canal en vivo (una vía que no la vaciase dejaría ver cambios hasta 5 min; se queda la consulta directa al abrir el canal). **Límite conocido:** la ventana de 30 s del comentario repetido usa el reloj de la app porque Prisma pone `createdAt` en la app; dos personas distintas que escriban lo mismo en 30 s cuentan como una. Opcionales y retiradas pendientes del «sí» del propietario: `docs/HANDOFF.md` §6.

**Decisiones de la ronda 69 (ya aplicadas):** el propietario dijo «adelante» a la propuesta de `docs/handoff/CHROME-R69.md`
(diálogo y pie de «Compartir fuera» más claros, imagen pegada como bloque propio, columna vacía sin generar web, aviso de
cambios sin publicar, «Compartida por <nombre>» en la web, sin apartados vacíos, los fallos de los informes y las preguntas
2g, 3, 4 y 8 de la ronda 68). Cualquier miembro del proyecto puede revocar el enlace (no solo administradores ni quien lo
generó), y el globo, el pie y el diálogo dicen quién y cuándo (`ColumnShare.revokedById`). Pregunta 2g: el «Deshacer» de un
aviso propio ignora las entradas de fuera. Pregunta 3: el botón del pie del detalle es «Guardar y cerrar». Pregunta 4:
«Nueva tarea» no prefija el título con un tipo que solo viene de «el último usado». Pregunta 8: `npm start` lanza las tareas de
arranque en un proceso hijo. Decisión 2h aplicada: `generatedByName` ya no se escribe ni se lee (la columna se quita en la
v1.74). Los avisos de mover no llevan «Deshacer» por diseño (la flecha ↶ ya lo hace) y «Casa y familia» ofrece todos los
tipos con plantilla: no son fallos. No se hizo el aviso en la campana a quien generó la web cuando otra persona la revoca:
necesita un valor nuevo de enum (se añade en una versión y se escribe en la siguiente). «Cambios sin publicar» no detecta
ediciones de una tarea ya publicada (la web ya lee el contenido en vivo). Trabajo: modelo de los agentes a elección,
revisando con Opus, y Claude in Chrome todo lo posible. La Release de la v1.73.0 quedó pendiente de lanzar por el
propietario (no estaba delante).

**Decisiones de la ronda 68 (ya aplicadas):** columna «Compartir fuera» en vez de una página por contacto: una web por
columna (rol NONE + `ColumnShare`), activable solo por administradores y proyecto a proyecto, caducidad 7 días / 1 mes /
3 meses sin uso (1 mes por defecto), 30 días de «ha caducado», sin indexar, desde fuera marcar hecha, cambiar la fecha,
comentar y descargar adjuntos, diálogo con la dirección (copiar y `mailto:`; Pizarro no envía), dirección guardada cifrada
para volver a verla; plan para IA más corto; sin reducir las consultas en reposo (NO por ahora); topes de emails como
estaban (SÍ); leer menos al arrancar (§0b a `docs/handoff/LOCAL.md`, PRUEBAS-CHROME solo cuando toca); migrador propio
más adelante; `npm test` sin la trampa de `NODE_OPTIONS`; `dist/` con trozos compartidos y caché de `npm ci`; e2e con
esperas a una condición al tocar cada suite; una sola guía de Railway con texto para una IA del navegador; retirados
`MovedSectionRedirect`, `/admin/types`, `public/icons/*.png`, `SERIAL` y la historia de `railway.json`; `legacyLogLabel`
hasta marzo de 2027; Dependabot (marked 18.2.1) aceptado con el arreglo del editor. Revisión: imágenes de la descripción
que no cuentan como descarga, subidas que no guardan con el editor cerrado, avisos con «Deshacer» anulado y pausa,
resumen diario con los lotes completos, sin aviso de fecha de tareas terminadas.

**Decisiones de la ronda 67 (ya aplicadas):** esqueleto de Releases con el puntero sobre el enlace (precarga al cambiar
`href`, `HoverPrefetchLink`); arranque sin la CLI de Prisma si la base está al día; la Release pasa también `test:db`;
«Organizar por personas» en equipo, solo miembros y admins con el proyecto en su lista; WhatsApp real con Claude in Chrome
y el propietario delante (prompt 4 de `docs/PRUEBAS-CHROME.md`); «Varias tareas» sin el prefijo de título (NO); sin
«Orden manual» de proyectos (usados recientemente o alfabético, en el perfil); la cabecera de columna sigue siendo una
parada de Tab; «Agenda» de Eventos y viajes no se renombra; una URL por tarea, SÍ, en una ronda propia. Revisión: hilos de
bcrypt que se cierran a los 90 s, topes de mensajes a terceros en el mapa de seguridad, topes de emails que no bloquean a
nadie, Alt+flechas que solo toca las columnas que cambian, plan para IA con ZIP sin adjuntos repetidos, aviso de Railway sin
margen de apagado, `e2e-all.sh` que no se cuelga. Propuesta del enlace externo para proveedores (R67F1), pendiente.

**Decisiones de la ronda 66 (ya aplicadas):** ideas de la auditoría en esta ronda (arrastrar cabeceras de columna, roles
según la plantilla con «Más roles…», «Organizar por personas» en Casa y familia); avisar antes de perder una plantilla a
medio editar; línea en el historial con las subtareas que cambia el tipo; pruebas con base de datos en cada PR y en orden
al azar (`--shuffle`); orden de los proyectos a elegir en el perfil («Usados recientemente» de serie, o «Alfabético»; sin
«Orden manual»); «Descartar cambios» del pie del detalle pasa a «Deshacer todo» («Guardar» se queda); Railway con
*Teardown* de 15 s (prueba y real); no se guarda aparte el inglés de las páginas vistas, no se rellenan los Logs anteriores
a la v1.69 y la vista previa de «Importar tareas» no dice el tipo (las tres, NO); el email propio de un admin solo se cambia
en Mi perfil; «Cerrar las demás sesiones» quita también «Recordar este dispositivo»; Logs enmascara los emails que no son
de ninguna cuenta (también con Google) y enseña entero el de una cuenta atacada; tope diario a la prueba de WhatsApp de
Integraciones; plantillas de serie «De serie» y con tipo por defecto; «Cambios técnicos» del Historial solo para admins.

**Decisiones de la ronda 65 (ya aplicadas):** Historial de versiones con 10 versiones y «Ver más»; Mis tareas con línea de
resumen; Logs también en inglés (`messageEn`); errores de extensiones fuera también en `client.window`; aviso por email del
informe semanal rechazado; cambiar de tipo en el detalle sustituye las subtareas sin tocar, con Deshacer; tipo por defecto
en plantillas, «Varias tareas» e importar tareas; plan para IA con el tipo una vez; «miembros» en Administración →
Proyectos; «Reenviar invitación» desde Ajustes del proyecto; retirados `reencryptIfStale`, `parseTaskLines` y el texto
de abrir tarea; CI solo en las PR (la Release pasa antes `checks`); `test:db` en 3 bases; HANDOFF en núcleo + anexos;
roles Agenda y Entrega fuera del enum. No: atenuar los botones laterales del diálogo; recalcular la fecha entre columnas
de persona; «Ver más» de Avisos por páginas. Botón de informar y copia de «Nueva tarea» siempre enteros sobre el fondo.

**Decisiones de la ronda 64 (ya aplicadas):** retirados de la oferta los roles *Agenda* y *Entrega al cliente* (fase 1;
sus columnas a «Sin rol»); «Tipo por defecto…» por columna (`Column.defaultKindId`); suite e2e de «Asignación a persona»;
subtareas de *Vibecoding* como criterios; margen de 100 MB de la copia diaria; errores de copias traducibles; retirada
`listTemplates`; PDF de columna descargados con el botón ocupado; DMARC `p=none` hecho. Respuesta a la pregunta 2 de la
ronda 63: el «PDF de plan» común compartiría motor y aspecto, pero cada rol agrupa distinto (por día o por vencimiento).

**Decisiones de la ronda 63 (ya aplicadas):** columna «Asignación a persona» con dos campos en `Column` (`assigneeId`,
`assignDueDays`, rol `NONE`; sin valor nuevo de enum para poder volver a la v1.66) y «Generar plan» en PDF; plantillas
propias usables por cualquiera (crear y editar, solo administradores); comprobación de espacio de la copia diaria (solo el
volcado y solo con copia anterior o un intento fallido por disco lleno); importar `.pizarro.zip` espera turno en la cola de
imágenes; Compose sin `NODE_OPTIONS` (`APP_HEAP_MB` en desuso, avisos en el diagnóstico); todos los `logEvent` con
plantilla traducible (prueba guardiana `tests/log-message.test.ts`); mostaza legible; avisos de actualización y de copias
por plataforma (`setupCodeSource`); códigos de release explicados; plan para IA un 23 % más corto; guardado automático del
detalle, no (ya avisa al cerrar con cambios y guarda borradores); negrita tras la etiqueta de plantilla, no; destino de
copia válido + otro mal configurado sigue «Correcta».

**Decisiones de la ronda 62 (ya aplicadas):** `FEEDBACK_EMAIL` = feedback@getpizarro.com con «Enviar por email» (mailto)
cuando la instalación no envía emails y GitHub como alternativa; guías de Render y Fly.io (`render.yaml`, `deploy/fly.toml`);
retirado `railway.json`; fechas con puntos siempre día/mes; *Curso o charla* en inglés americano; `MAX_USERS` mal escrito sin
tope (como estaba); no dejar a quien no es administrador usar plantillas propias con ejemplos; recordar todas las bajas del
informe y el interruptor del informe de errores, solo si se pide; rol «Presupuesto» como está; alta sin email solo con
enlace de invitación; «Cita» en índigo; copia externa mal configurada como error; retirado `dateNumeric`.

**Decisiones de la ronda 61 (ya aplicadas):** 6 plantillas de serie (*Vibecoding*, *Trabajo y clientes*, *Casa y
familia*, *Eventos y viajes*, *Estudios y aprendizaje*, *Curso o charla* con «Publicado») con «Con tarjetas de ejemplo» en
vez de la lista de ejemplos; no ocultar Documentación por plantilla; no estrechar columnas; fechas y «Esperando» de serie;
baja del informe recordada y avisada; una sola tarjeta de email; «Generar enlace de invitación nuevo» sin email; contador
de avisos exacto; «Responsable» en todas partes y sin «(opcional)»; Lista con pintado diferido; sesión en una consulta;
fechas día/mes por fichero; imágenes sin tipo; `MAX_USERS` opcional (sin tope por defecto; recomendación: 1 GB hasta ~25
personas activas, 2 GB hasta ~50); bloqueo de R2 en vez de segundo proveedor; retirados `db:generate`, la nota de
`JWT_SECRET`, `docs/IDEAS.md` (en el historial) y tres `export` de pruebas; suites de «Aplicar plantilla» unidas y
`tablero-e2e`/`pegar-e2e`; «check» en las guías inglesas; botón de informar de un error o enviar una sugerencia junto a
«Cerrar sesión», con captura y envío privado por email (desactivado si no es la última versión); «Descartar cambios» a la
altura del resto.

**Decisiones de la ronda 60 (ya aplicadas):** las 19 primeras preguntas de la ronda 59 (tablero en vivo por tarjeta, datos
sin campos por defecto, 50 tarjetas por columna desde el servidor, índice trigram de releases ya, plan para IA sin enlaces
y sin interruptor, cookie de dispositivo por cuenta, invitación en el idioma de quien invita, «Invitación pendiente»,
reintento de P3009, aviso de otra copia, «Esperando» con la casilla de fechas, citas «ha escrito:» y nombres reservados,
baja en un clic ya, informe semanal corto, fechas en-US, CSV de logs para Excel, aviso de cambio simultáneo, vuelta a Logs,
portada del administrador); `APP_URL` desde `RAILWAY_PUBLIC_DOMAIN`; `no-transform` contra la ofuscación de Cloudflare;
copias que toleran el bloqueo de R2; resaltado de la búsqueda de releases; cambiar de tipo sin perder lo escrito; crear
un proyecto abre su tablero; Dependabot de noviembre (Next 16.4.6…) incluido en la versión. Pizarro es el producto: la
instalación del propietario es solo una más, y lo que se revisa en ella (Cloudflare, Railway) se convierte en mejoras del
producto y de la guía.

**Decisiones de la ronda 59 (ya aplicadas):** administradores asignables a proyectos de equipo, aviso «te han añadido»,
invitar por email desde el proyecto y «Copiar enlace»; margen de intentos para dispositivos conocidos; «Forzar cambio de
contraseña» corta calendario, canales y Drive; privado sin miembros activos → de equipo; TLS obligatorio con `SMTP_*`
(`SMTP_ALLOW_PLAINTEXT`); calendario vacío para enlaces no válidos y «Último uso»; releases que cargan su texto al
desplegar; comentarios en vivo solo la primera página; limpiezas diarias; SMTP con `pool`; miniaturas 2 min; disco en
subidas; Compartir con tope por archivo; importar con los topes de la app; `/api/health` 200 con aviso de disco; fotos
grandes en Documentación; confirmaciones del calendario; «Nuevo proyecto» para miembros; «Próximos 7 días»; avance de
entregables único; repeticiones sin entregable vencido; Caddy sin URI; imagen sin sharp musl; `get.sh` desde `stable`;
imágenes por digest; migraciones entre `BEGIN`/`COMMIT`; PDF como adjuntos de la release; retiradas (páginas de admin,
`redoLast`, `capTitle`, `generateProjectReportPdf` como envoltorio, `passwordChangeRequired`, huellas `v2:` sin `b:`,
tabla «Nombres antiguos», suites solapadas, ZIP del histórico sin `?part`, una versión de `marked`); inglés americano;
no subir `PDF_WORKER_MAX_MB`.

**Decisiones de la ronda 58 (ya aplicadas):** borrar en un menú «⋯» en Releases y Documentación; informe semanal con
margen de 3 días; `MALLOC_ARENA_MAX=2`; workflow «Comprobaciones» en cada PR; sin precargas con Ahorro de datos; retirados
el ZIP por POST sin vale y `/viewers` sin `?open=`; no unificar «Nueva tarea» con el detalle; en inglés, «organisation»
(británico, como «licence»).

**Decisiones de la ronda 57 (ya aplicadas):** un solo selector de proyecto en escritorio (el de la barra lateral) y sin
«Informe PDF» en la cabecera; roles de columna en un submenú; recordar el último tipo usado; tareas fijas fuera del
avance del informe PDF; *Administración* en dos pestañas (*Ajustes* e *Integraciones*); no juntar «Varias tareas» e
«Importar» en «Nueva tarea»; no ampliar el deshacer fuera del tablero; en el móvil, avisos abajo, «Editar» comentarios
a la vista, archivadas en lectura, «Descartar cambios» con confirmación y «Compartir → Pizarro»; sondeo de presencia de
respaldo a 60 s; plantillas de serie mejoradas sin tocar *Vibecoding* ni *Curso o máster* (de esas se encarga el
propietario).

**Decisiones de la ronda 56 (ya aplicadas):** recarga de respaldo a 15 min con el canal sano; presencia por el canal en
vivo; ZIP de release en flujo; tareas de fondo a 60 s; destinatario del informe por nombre y emails ajenos ocultos;
duplicar una repetitiva no copia la repetición pero lo avisa; calendario del móvil en hoy; retiradas aprobadas (hecho);
e2e solo de las suites afectadas en cada ronda y todas al publicar; imagen arm64 en máquinas ARM nativas.

**Decisiones de la ronda 55 (ya aplicadas):** exportar sin transacción abierta mientras se leen los ficheros; una
subida a la vez por persona solo si hay más de una persona activa en los últimos 5 minutos (`user-activity.ts`; cualquier
petición con sesión cuenta como actividad); la zona horaria no se fija en la conexión (un parámetro `options` lo rechazan
poolers como PgBouncer): los `NOW()` propios se pasan desde la app y el disparador convierte a UTC.

**Decisiones de la ronda 54 (ya aplicadas):** importar no avisa a las personas mencionadas, sí al responsable; emails
ajenos al exportar un proyecto solo para administradores; caché de 60 s del calendario suscrito y de 3 s de
`/api/health`; «Nueva tarea» con etiquetas (solo existentes), color y enlace; el cursor de «Nueva tarea» sigue empezando
en el título.

## Paquetización: lo hecho

- Hecho: instalación en un paso (`deploy/get.sh`), actualizaciones con versiones e imagen publicada, aviso de
  versión nueva, proyectos de ejemplo al crear un proyecto (`src/lib/project-examples.ts`), página de presentación
  `/presentacion` simplificada (sin demo; la administración no enlaza a ella por decisión del propietario) y licencia
  (`LICENSE.md` + `/licencia`; `npm run license:sync` tras cambiarla).
- Hecho: web estática del producto en `site/` (plantillas y estáticos), generada con `scripts/build-site.mjs` y
  publicada con GitHub Pages por `.github/workflows/site.yml` (workflow «Web») en getpizarro.com. En
  *Settings → Pages → Build and deployment*, **Source debe ser «GitHub Actions»**: con «Deploy from a branch»
  GitHub publica el README del repositorio con Jekyll en lugar de la web. Las capturas de `site/static/img/` y las
  imágenes `og.png`/`og-en.png` se regeneran con `scripts/site-screenshots.mjs` (instrucciones en su cabecera;
  siempre contra una base de pruebas con datos de demostración) cuando cambie el aspecto de la app. Puesta en
  marcha (Pages, DNS, HTTPS, verificación del dominio): `docs/VENTA.md` §8.
- Hecho: guías de conexión en la web (`/guias/`, `/en/guides/`): una página por cada `docs/guias/<nombre>.md` con su
  `docs/guias/en/<nombre>.md` (Google, Google Docs, Sheets y Slides, Telegram, WhatsApp). La cabecera del fichero (`titulo`,
  `descripcion`, `orden`, `icono`) da la tarjeta del índice; `build-site.mjs` las añade solas al índice y al sitemap
  y falla si falta la versión en inglés, el título o la descripción. El workflow «Web» también se lanza al cambiar
  `docs/guias/`. La portada enlaza a cada guía desde «Se conecta con lo que ya usas». El pie lleva una línea de
  autoría: no escribas en ella ni en el manual dominios personales.
- Hecho: recordatorio de licencia para administradores (franja bajo la cabecera, como mucho cada 30 días, nunca en
  los 7 primeros días): lógica en `shouldShowLicenseNudge` (`src/lib/license-core.ts`), interfaz en
  `src/components/LicenseNudge.tsx`. Se oculta con licencia registrada o declarando uso personal o educativo.
- Modelo de venta decidido: gratis para uso personal y para uso educativo (centros de enseñanza públicos o
  privados, también academias, con su profesorado y alumnado; definición en `LICENSE.md` §2); empresas y profesionales, pago único por servidor con
  actualizaciones gratis para siempre y sin soporte. Precio: 100 € + IVA (pago con tarjeta y factura, NIF opcional); botón Comprar con `BUY_URL` en `src/lib/product.ts` (vacía hasta que el propietario cree el Payment Link de Stripe, ver `docs/VENTA.md`); *Administración → Licencia* solo informa. Todo uso que no sea personal ni educativo paga. La propuesta antigua de funciones para una licencia profesional e ideas de otros Kanban (ronda 38, estado de la v1.48) se retiró en la ronda 61: está en el historial de git (`git show v1.64.0:docs/IDEAS.md`).
- Hecho: las versiones se publican con *Actions → Release → Run workflow* sobre `main` (imagen en GHCR, GitHub Release
  y rama `stable`); el secreto `STABLE_PUSH_TOKEN` funciona y la instalación del propietario en Railway sigue `stable`.

## Ideas pospuestas

**Ideas pospuestas por decisión del propietario:**

- Limitar las tarjetas visibles en columnas terminadas («ver más») o archivarlas solas tras N días.
- Cargar las plantillas de release solo al abrir «Generar release».
- Guardar la fecha esperada al deshacer el movimiento de un entregable en el calendario.
- Ideas pospuestas (R36): tablero que recarga solo lo cambiado (a partir de ~10 personas a la vez).

## Límites conocidos y menores sin numerar

Límites conocidos (no se cambian): un administrador puede saber si existe un tipo con cierto nombre en otro proyecto (los
nombres de tipos son únicos entre generales y de proyecto); volver a la v1.64 con avisos `REPORT_UNSUBSCRIBED` ya creados
hace fallar la página de Avisos de quien los tenga (ver la regla de enums en `docs/handoff/GUARDAS.md`, «Migraciones y enums»).

Menores sin numerar de antes (recomendación NO salvo que se note): «Guardar de todos modos» en el aviso de cambio
simultáneo; `INSTANCE_LOCK=0`; quitar del plan para IA las URL sueltas a Pizarro; «Esta semana» de domingo a sábado en
inglés; búsquedas de releases de 1–2 caracteres sin índice; `socketTimeout` del SMTP; log de errores de Caddy; código
propio de «disco lleno» en Compartir; la importación de `.pizarro.zip` no asigna administradores.
