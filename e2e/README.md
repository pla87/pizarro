# Pruebas en navegador (end-to-end)

Suites con Playwright (`playwright-core`, ya en las dependencias) contra una build de producción y una base de datos
propia. No forman parte de `npm test`: se lanzan a mano antes de publicar una versión.

## Requisitos

- PostgreSQL accesible con el `DATABASE_URL` del `.env` (el usuario debe poder crear bases).
- Chromium: el de `CHROME=/ruta/chrome` si se indica. Si no, se busca el más reciente instalado por Playwright en
  `PLAYWRIGHT_BROWSERS_PATH` (por defecto `/opt/pw-browsers`): `chromium-<revisión>/chrome-linux*/chrome`. Si no hay
  ninguno, se usa el de `playwright-core` (instálalo con `npx playwright-core install chromium`).
- Una build: `npx next build --webpack && node scripts/postbuild.mjs && npm run build:boot`.
- Sin `DATABASE_URL`, las suites usan `postgresql://postgres:postgres@localhost:5432/pz_qa`. Por seguridad, la suite QA
  solo vacía bases cuyo nombre empieza por `pz_`.

## Suites

| Suite | Script | Comprobaciones | Tiempo |
|---|---|---|---|
| QA (9 escenarios) | `e2e/qa/run-all.mjs` | 386 | ~5 min |
| Tablero | `e2e/board-e2e.mjs` | 360 | ~4 min |
| Pegar | `e2e/paste-e2e.mjs` | 72 | ~1 min |
| Cabecera y atajos (caza de bugs 48a) | `e2e/bh48a-e2e.mjs` | 42 | ~1 min |
| Sin conexión y pestañas (caza de bugs 48b) | `e2e/bh48b-e2e.mjs` | 120 | ~3 min |
| Comentarios a la vez y red lenta (caza de bugs 48c) | `e2e/bh48c-e2e.mjs` | 44 | ~1 min |
| Copia con imagen en la descripción, sin red en calendario, borradores y releases (caza de bugs 49) | `e2e/bh49-e2e.mjs` | 27 | ~1 min |
| Aplicar plantilla: paso 2 y archivadas de columnas unidas (caza de bugs 50a) | `e2e/bh50a-e2e.mjs` | 22 | ~20 s |
| Borrar mi cuenta (escritorio, móvil, Google y Administración) | `e2e/r49-account-e2e.mjs` | 61 | ~1 min |
| Formularios sin red, IP del cliente y páginas legales (ronda 49) | `e2e/r49-infra-e2e.mjs` | 26 | ~1 min |
| Copias con adjuntos y release con barra de formato | `e2e/r49-copy-e2e.mjs` | 87 | ~2 min |
| Formatos del material: cerrar la release, párrafos vacíos, Google Slides y HTML aislado (ronda 50) | `e2e/r50-formatos-e2e.mjs` | 107 | ~1 min |
| Tareas que se repiten (calendario, .ics y «Nueva tarea») | `e2e/r49-repeat-e2e.mjs` | 44 | ~1 min |
| Carga de proyecto y «Adjuntos y límites» (ronda 49) | `e2e/r49-ui-e2e.mjs` | 34 | ~1 min |
| Textos breves, notas «i» y botones sin efecto (ronda 49) | `e2e/r49-textos-e2e.mjs` | 29 | ~1 min |
| Aplicar plantilla a un proyecto existente (ronda 50) | `e2e/r50-plantilla-e2e.mjs` | 39 | ~1 min |
| Plantilla «Curso o máster» y «Publicar programa (PDF)» | `e2e/r50-curso-e2e.mjs` | 57 | ~40 s |
| Arrastrar una selección (montón, teclado, dedo, tiempo real) | `e2e/r50-seleccion-e2e.mjs` | 76 | ~1 min |
| Instalación desde cero con `npm start` | `e2e/install-e2e.mjs` | 49 | ~1 min |

Las cifras son las de la última pasada completa; si añades comprobaciones, actualízalas aquí (es el único sitio donde
se apuntan). Todas, menos la QA y la de instalación, usan la base que deja preparada la QA y un servidor ya arrancado; se pueden lanzar en
cualquier orden. Cada una hace varios inicios de sesión: si una falla al entrar (tiempo agotado en el acceso) tras
otras suites, reinicia el servidor (salta el límite de intentos) y vuelve a lanzarla. La base no se borra al terminar:
la siguiente pasada de la QA la vacía; bórrala a mano cuando ya no la necesites. Capturas en `SHOTS_DIR` (por defecto
la carpeta temporal del sistema).

## QA (9 escenarios)

```sh
DBURL=$(grep ^DATABASE_URL .env | cut -d'"' -f2 | sed 's#/[^/]*$#/pz_qa#')
cd e2e/qa && BASE=http://localhost:3231 DATABASE_URL=$DBURL APP_DIR=$PWD/../.. node run-all.mjs
# solo algunos escenarios: --only=1,4,7   ·   sin reiniciar la base: --no-reset
```

`run-all.mjs` crea (o vacía) la base de `DATABASE_URL` (aquí `pz_qa`), aplica migraciones y arranca su propio servidor
en el puerto de `BASE`, que para al terminar: no debe haber otro servidor escuchando ahí.

## Instalación desde cero

Base vacía (la borra y la crea: solo nombres `pz_*`, distinta de la de la QA) y su propio `npm start` sin `SEED_ADMIN_*`,
con el buzón de pruebas, en el puerto de `BASE` (debe estar libre). Comprueba que `npm start` hace las tareas de arranque
(código de `/setup` en la terminal, `system.boot`, plantillas, historial de versiones), el asistente (cambiar de idioma
en el paso 2 no lo reinicia; el acceso sale en el idioma elegido), el segundo paso obligatorio del admin con un solo
«Atrás», *Administración → Ajustes → Instalación*, el email de prueba, invitar en otro idioma y «Reenviar invitación»,
el idioma al pasar de `/reset` al acceso, cambiar de idioma en «Mi perfil» sin desmontar la página y el detalle de una
tarea sin Google. Anota los avisos de Node del servidor con `e2e/warn-hook.mjs` y falla si aparece el de pg
«client is already executing a query».

```sh
cd e2e && BASE=http://localhost:3232 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pz_install APP_DIR=$PWD/.. node install-e2e.mjs
```

## Tablero

Con la base `pz_qa` preparada por la suite y un servidor arrancado (`DATABASE_URL=$DBURL PORT=3231 npm start`):

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node board-e2e.mjs
```

## Pegar

Imágenes pegadas en *Nueva tarea*, en el detalle y en el tablero (una sola vez, sin avisos, con el foco en cualquier
sitio), y tablas pegadas desde Word, Google Docs, una web o una hoja de cálculo. Misma base y servidor que el tablero:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node paste-e2e.mjs
```

## Cabecera y atajos (caza de bugs 48a)

La cabecera del tablero no se sale de la pantalla con nombres cortos y largos (1920 a 390 px), Alt+Mayús+N con un
diálogo abierto, Alt+N antes de hidratar, presencia al abrir el tablero, contador del título en caracteres visibles,
aviso 99+ en móvil, ayuda de atajos y borrar un proyecto con espacios dobles. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh48a-e2e.mjs
```

## Copia con imagen, sin red y «Repetir» en un borrador (caza de bugs 49)

La copia de una tarea (Ctrl al soltar en otra columna) con una imagen en la descripción (`![…](/api/attachments/…)`)
apunta a su propio adjunto y se sigue viendo tras borrar el de la original; mover una tarea en el calendario sin red
vuelve a su día con «Sin conexión: no se ha guardado» y con red se guarda; sin red, el interruptor «Borrar los borradores
al cerrar sesión» de *Mi perfil* vuelve a como estaba y «Borrar release» no se queda ocupado; en *Nueva tarea* recuperada
de un borrador, el día de «Repetir» sigue a la fecha límite si no se eligió a mano. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh49-e2e.mjs   # PART=dupimg,cal,drafts,reldel,repdraft
```

## Aplicar plantilla: paso 2 y archivadas de columnas unidas (caza de bugs 50a)

En el paso 2 de «Cambiar a esta plantilla», un tipo general sin tareas que la plantilla oculta dice «Ocultar (la
plantilla no lo usa)» y uno oculto con tareas, «Conservar (volverá a verse)», igual que el resumen del paso 3 (en español
y en inglés, a 390 px y en modo oscuro); y una tarea archivada de una columna que el cambio une a otra sale en
«Archivadas» como de esa columna y vuelve a ella al recuperarla. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh50a-e2e.mjs   # PART=paso2,en,archivada
```

## Arrastrar una selección

Con varias tarjetas seleccionadas, arrastrar una de ellas lleva todas: el montón con la insignia del número, las demás
atenuadas en su sitio, el hueco de destino «N tarjetas irán aquí» y los avisos del lector de pantalla («Has cogido 3
tarjetas…», «Has soltado 3 tarjetas en…»). Al soltar van seguidas y en orden de tablero, con un solo paso de deshacer, y
la selección se mantiene. Escape cancela; una sin seleccionar se mueve sola; Ctrl al soltar copia solo la cogida;
dentro de su columna y entre dos tarjetas de otra; Alt+flechas sobre una seleccionada mueve todas; la otra persona lo ve
por el canal en vivo; la columna de revisión pide confirmación; con el dedo (asa, 390 px) y en modo oscuro. Misma base y
servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r50-seleccion-e2e.mjs   # PART=drag,cancel,single,copy,same,keys,live,review,touch,dark
```

## Formularios sin red, IP del cliente y páginas legales (ronda 49)

Crear un usuario en *Administración → Usuarios* y guardar *Mi perfil* sin red (`context.setOffline`): sale «Sin conexión:
no se ha guardado» y el aviso fijo, nunca «Algo ha fallado», y lo escrito sigue en el formulario; al volver la red se
guarda. Deshacer «Enviar a la papelera» de un documento sin red. Con el servidor sin `TRUST_PROXY` (`npm start` o `next
start`), unas cabeceras `X-Real-IP` / `X-Forwarded-For` inventadas no llegan a la sesión ni al registro. Privacidad,
condiciones y licencia llegan pintadas sin JavaScript. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r49-infra-e2e.mjs   # PART=admin,profile,docs,ip,legal
```

## Tareas que se repiten

«Repetir» en *Nueva tarea* (junto a la fecha límite; el día sigue a la fecha mientras no se elija a mano; se guarda al
crear), las apariciones futuras previstas en el calendario (tenues, con borde discontinuo e icono de repetir, abren la
tarea original; ninguna hoy ni antes, ni de una tarea repetida sin fecha límite; un mes dos años después), la serie con
`RRULE` en la suscripción `.ics` y en el `.ics` de una columna Agenda, y lo mismo a 390 px. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r49-repeat-e2e.mjs   # PART=new,cal,ics,mobile
```

## Carga de proyecto y «Adjuntos y límites» (ronda 49)

El indicador de carga de las páginas de proyecto (respuestas lentas simuladas: el contorno del logo aparece pasados
~200 ms, la región viva dice «Cargando…», ocupa el hueco de la página sin mover la barra lateral, y con movimiento
reducido queda quieto y tenue) y los botones de limpieza de *Ajustes del proyecto → Adjuntos y límites*: desactivados y
con la tarjeta atenuada sin nada que borrar (también según el filtro de antigüedad), activos con ficheros, y la nota «i».
Crea y borra su propio proyecto privado. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r49-ui-e2e.mjs   # PART=load,storage
```

## Textos breves, notas «i» y botones sin efecto (ronda 49)

Fuera de *Ajustes del proyecto*: en *Administración → Usuarios* la descripción es de una línea y el «por qué» sale en la
nota «i» (se abre al pulsar y se cierra con Escape); una nota dentro de un diálogo (borrar un usuario) se cierra con Escape
sin cerrar el diálogo. Botones desactivados cuando no harían nada: «Limpiar» en *Logs* sin filtros, «Guardar» las cuotas
de *Ajustes → Almacenamiento*, «Guardar» el nombre y «Guardar avisos» de *Mi perfil* sin cambios, «Cambiar contraseña» sin
rellenar, «Partir del texto por defecto» con ese texto ya puesto y «Todas»/«Ninguna» al generar una release. La nota cabe
a 390 px. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r49-textos-e2e.mjs   # PART=admin,profile,release
```

## Aplicar plantilla a un proyecto existente (ronda 50)

En un proyecto privado propio (lo crea y lo borra la suite), *Ajustes del proyecto → Tablero → Aplicar plantilla*:
«Añadir lo que falte» enseña antes qué columnas, tipos y etiquetas se añadirán, no toca lo que hay y «Deshacer el cambio
de plantilla» lo quita; «Cambiar a esta plantilla» propone el emparejamiento (por nombre y rol; una columna con tareas
sin pareja se conserva, una vacía se propone quitar; una con tareas no tiene «Quitar»), el resumen cuenta las tareas que
se mueven y lo que se añade o se quita, al aplicar no se pierde ninguna tarea y otra persona con el tablero abierto ve
las columnas nuevas sin recargar (y el deshacer, igual); en un proyecto de equipo un miembro sin rol de admin no ve la
sección; a 390 px el asistente cabe. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r50-plantilla-e2e.mjs   # PART=add,replace,perm,mobile
```

## Plantilla «Curso o máster» y «Publicar programa (PDF)»

Crea un proyecto con la plantilla desde *Nuevo proyecto* (la sesión se abre como miembro y pasa a admin, como en el
tablero), comprueba sus columnas (con «Programa», rol *Programa del curso*), tipos y campo *Fecha de inicio*; crea dos
sesiones con el tipo «Sesión» (título y descripción automáticos, fecha y responsable) y otra de varios días con Markdown;
publica el programa con el responsable, lo descarga y comprueba su texto con `pdftotext` (orden, fechas, rango, Markdown
pintado, sin la archivada), la copia «Programa – fecha.pdf» en Documentación y «Abrir Documentación»; la vista previa no
guarda; el PDF en inglés sin guardar; con la Documentación llena (200 documentos) se descarga igual y avisa; y el rol en el
menú de la columna con su icono y su explicación (se puede repetir y quitar). Borra su proyecto al terminar. Necesita
`pdftotext` (poppler-utils). Genera cuatro PDF con la misma persona: el límite es de cinco por minuto, así que entre dos
pasadas seguidas espera un minuto. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r50-curso-e2e.mjs   # PART=tpl,pdf,en,full,role
```

## Comentarios a la vez, red lenta, dos pestañas y release renombrada (caza de bugs 48c)

Tres personas comentan a la vez la misma tarea en varias rondas (todas ven todos los comentarios, en orden y sin «Ver
anteriores»), el editor de la descripción con red lenta (CDP, y el trozo del editor retrasado 6 s: lo tecleado antes y
durante su llegada no se pierde), dos pestañas de la misma persona guardando la descripción (la segunda, que la escribía a
la vez, recibe el aviso; una sola pestaña guardando seguido no) y una release cuyo texto se generó antes de renombrar una tarea. Misma base y
servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh48c-e2e.mjs   # PART=comments,desc,tabs,rel
```


## Borrar mi cuenta

*Mi perfil → Cuenta → Borrar mi cuenta*: el único administrador ve el botón desactivado y el motivo; el diálogo pide
contraseña y la palabra BORRAR y avisa, con su lista, de que el proyecto privado propio pasa a ser de equipo (casilla
«Borrar también…» sin marcar); con la contraseña incorrecta no se borra; al borrar se va al acceso con el aviso, se
cierran sus dos sesiones, el proyecto queda de equipo y sin miembros (anotado en el registro) y lo que creó queda como
«Usuario eliminado». En móvil (390 px) activa la verificación en dos pasos desde el perfil y borra con el código de la
app (el diálogo cabe en la pantalla). Quien entra con Google sin contraseña conocida pulsa «Entro con Google y no conozco
mi contraseña», confirma solo con el código de su app y borra también sus dos proyectos privados. *Administración →
Usuarios → Borrar*: el aviso (sin el nombre del proyecto), sin marcar pasa a ser de equipo y marcando se borra. Crea sus
propias personas (`r49_*`). Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r49-account-e2e.mjs   # PART=block,desk,mobile,google,admin
```

## Copias con adjuntos y release con barra de formato

Duplicar una tarea con una imagen y un archivo (botón del detalle, Ctrl al soltar en otra columna, Alt+Mayús+D y en el
móvil a 390 px): la copia tiene sus propios adjuntos (ids nuevos, mismo contenido y miniatura), el documento de Google
enlazado y las subtareas sin marcar; borrar el adjunto de la original no toca el de la copia; deshacer y rehacer la
copia; con la cuota del proyecto justa se copian los que caben y se avisa del resto. Release con la preferencia «Con
barra de formato»: editor con barra sin Editar / Vista previa; sin tocar nada, Copiar todo, .md y .txt dan lo mismo que
con Markdown; al editar solo cambia lo editado; cambiar el pie o quitar la cabecera con el texto ya editado; negrita de
la barra; desplegar guarda lo editado; release de 300 tareas (tiempo de carga, por tecla frente a un campo de texto y
Copiar todo) y el móvil a 390 px. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r49-copy-e2e.mjs   # PART=dup,drag,keys,quota,mdup,rel,big,mrel
```

## Formatos del material de un curso (ronda 50)

«Generar release» con el texto del paso 2 cambiado pide confirmación al cerrar con Escape, la X o el clic fuera
(«Seguir editando» conserva lo escrito; varias pulsaciones no apilan preguntas; «Descartar cambios» cierra), en los dos
modos del editor; sin cambios, o tras cambiar solo el pie, cierra directo, igual que «Cancelar» en el paso 1. Con la
barra de formato, los párrafos vacíos salen como una línea en blanco (sin `&nbsp;` ni líneas en blanco repetidas) en
Copiar todo, .md, .txt y lo guardado al desplegar; lo no tocado, idéntico. El historial copia y descarga sin `&nbsp;`
una release antigua que lo traía, y «Copiar descripción» tampoco lo deja. Google Slides en la tarjeta (enlace con su
icono, «Nuevo Slides», aviso sin cuenta conectada, `@slides` y `@google` en los dos editores, móvil a 390 px y «Mi
perfil»). Documentación y adjuntos con `.md`, `.pdf`, `.html`, `.docx` y `.pptx`: el HTML se ve en un marco aislado
(sin scripts, origen opaco, sin red ni acceso a la página o al almacenamiento de la app), su dirección lo sirve como
texto plano y como adjunto al descargarlo; un `.html` con `<script>` (y `onerror`, `javascript:`, `<iframe>`, meta
refresh) no ejecuta nada en el origen de la app. La parte `slides` necesita el servidor con Google configurado (valores
de prueba, no llama a Google): arráncalo con `GOOGLE_CLIENT_ID=r50 GOOGLE_CLIENT_SECRET=r50`. Misma base:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node r50-formatos-e2e.mjs   # PART=relclose,nbsp,slides,html
```

## Sin conexión, pestañas y tareas que desaparecen (caza de bugs 48b)

Sin red y con el servidor caído la página no se cambia por la de error del navegador y lo escrito se conserva (avisos
«Sin conexión» y «Conexión recuperada»); 8 pestañas por HTTP/1.1 (se simula cuál está delante: las ocultas cierran su
canal en vivo); la tarea abierta que otra persona borra o archiva (aviso con su nombre, «Copiar tu texto», no se reabre
al deshacer); cerrar el detalle tras un guardado fallido del título; «Nueva tarea» con la columna borrada; `?task=` al
cerrar y enlaces a tareas que no están; sin red, los diálogos cargados aparte (Archivadas, Varias tareas, Generar
release) esperan a la red sin recargar la página y, ya precargados, se abren sin red; el detalle, su historial y
Archivadas abiertos sin red se cargan al volver; conflictos del texto campo a campo (otra persona cambia la descripción:
el título se guarda y el detalle muestra la descripción nueva; el mismo campo sí es un conflicto); el foco tras Escape
en la descripción y el nombre accesible de los campos del detalle. Partes sueltas con `PART=lazy,detail,…` (ver la
cabecera del script). Misma base y servidor (por HTTP, sin TLS). Es la que más inicios de sesión hace: lánzala con el
servidor recién arrancado.

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh48b-e2e.mjs
```
