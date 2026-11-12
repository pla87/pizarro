# Pruebas en navegador (end-to-end)

Suite de QA con Playwright (`playwright-core`, ya en las dependencias) contra una build de producción y una base de
datos propia. No forma parte de `npm test`: se lanza a mano antes de publicar una versión.

## Requisitos

- PostgreSQL accesible con el `DATABASE_URL` del `.env` (el usuario debe poder crear bases).
- Chromium: el de `CHROME=/ruta/chrome` si se indica. Si no, se busca el más reciente instalado por Playwright en
  `PLAYWRIGHT_BROWSERS_PATH` (por defecto `/opt/pw-browsers`): `chromium-<revisión>/chrome-linux*/chrome`. Si no hay
  ninguno, se usa el de `playwright-core` (instálalo con `npx playwright-core install chromium`).
- Una build: `npx next build --webpack && node scripts/postbuild.mjs && npm run build:boot`.

## Suite completa (9 escenarios, ~350 comprobaciones, ~5 min)

```sh
DBURL=$(grep ^DATABASE_URL .env | cut -d'"' -f2 | sed 's#/[^/]*$#/pz_qa#')
cd e2e/qa && BASE=http://localhost:3231 DATABASE_URL=$DBURL APP_DIR=$PWD/../.. node run-all.mjs
# solo algunos escenarios: --only=1,4,7   ·   sin reiniciar la base: --no-reset
```

`run-all.mjs` crea (o vacía) la base `pz_qa`, aplica migraciones y arranca su propio servidor en el puerto de `BASE`:
no debe haber otro servidor escuchando ahí.

## Tablero (~270 comprobaciones)

Con la base `pz_qa` preparada por la suite y un servidor arrancado (`DATABASE_URL=$DBURL PORT=3231 npm start`):

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node board-e2e.mjs
```

## Pegar (~70 comprobaciones)

Imágenes pegadas en *Nueva tarea*, en el detalle y en el tablero (una sola vez, sin avisos, con el foco en cualquier
sitio), y tablas pegadas desde Word, Google Docs, una web o una hoja de cálculo. Misma base y servidor que el tablero:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node paste-e2e.mjs
```

## Cabecera y atajos (caza de bugs 48a, ~45 comprobaciones)

La cabecera del tablero no se sale de la pantalla con nombres cortos y largos (1920 a 390 px), Alt+Mayús+N con un
diálogo abierto, Alt+N antes de hidratar, presencia al abrir el tablero, contador del título en caracteres visibles,
aviso 99+ en móvil, ayuda de atajos y borrar un proyecto con espacios dobles. Misma base y servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh48a-e2e.mjs
```

Capturas en `SHOTS_DIR` (por defecto la carpeta temporal del sistema).

## Sin conexión, pestañas y tareas que desaparecen (caza de bugs 48b, ~65 comprobaciones)

Sin red y con el servidor caído la página no se cambia por la de error del navegador y lo escrito se conserva (avisos
«Sin conexión» y «Conexión recuperada»); 8 pestañas por HTTP/1.1 (se simula cuál está delante: las ocultas cierran su
canal en vivo); la tarea abierta que otra persona borra o archiva (aviso con su nombre, «Copiar tu texto», no se reabre
al deshacer); cerrar el detalle tras un guardado fallido del título; «Nueva tarea» con la columna borrada; `?task=` al
cerrar y enlaces a tareas que no están. Misma base y servidor (por HTTP, sin TLS). Hace muchos inicios de sesión: tras
las otras suites, reinicia el servidor si salta el límite de intentos.

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh48b-e2e.mjs
```

Al terminar, borra la base `pz_qa`.
