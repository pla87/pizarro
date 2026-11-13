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
| Copias con adjuntos y release con barra de formato | `e2e/r49-copy-e2e.mjs` | 87 | ~2 min |
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

## Comentarios a la vez, red lenta, dos pestañas y release renombrada (caza de bugs 48c)

Tres personas comentan a la vez la misma tarea en varias rondas (todas ven todos los comentarios, en orden y sin «Ver
anteriores»), el editor de la descripción con red lenta (CDP, y el trozo del editor retrasado 6 s: lo tecleado antes y
durante su llegada no se pierde), dos pestañas de la misma persona guardando la descripción (la segunda, que la escribía a
la vez, recibe el aviso; una sola pestaña guardando seguido no) y una release cuyo texto se generó antes de renombrar una tarea. Misma base y
servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh48c-e2e.mjs   # PART=comments,desc,tabs,rel
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
