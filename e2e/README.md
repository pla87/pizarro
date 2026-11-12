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

## Comentarios a la vez, red lenta, dos pestañas y release renombrada (caza de bugs 48c, ~45 comprobaciones)

Tres personas comentan a la vez la misma tarea en varias rondas (todas ven todos los comentarios, en orden y sin «Ver
anteriores»), el editor de la descripción con red lenta (CDP, y el trozo del editor retrasado 6 s: lo tecleado antes y
durante su llegada no se pierde), dos pestañas de la misma persona guardando la descripción (la segunda recibe el aviso;
una sola pestaña guardando seguido no) y una release cuyo texto se generó antes de renombrar una tarea. Misma base y
servidor:

```sh
cd e2e && BASE=http://localhost:3231 DATABASE_URL=$DBURL node bh48c-e2e.mjs   # PART=comments,desc,tabs,rel
```

Capturas en `SHOTS_DIR` (por defecto la carpeta temporal del sistema). Al terminar, borra la base `pz_qa`.
