# Pruebas en navegador (end-to-end)

Suite de QA con Playwright (`playwright-core`, ya en las dependencias) contra una build de producción y una base de
datos propia. No forma parte de `npm test`: se lanza a mano antes de publicar una versión.

## Requisitos

- PostgreSQL accesible con el `DATABASE_URL` del `.env` (el usuario debe poder crear bases).
- Chromium: por defecto `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; otra ruta con `CHROME=/ruta/chrome`.
- Una build: `npx next build --webpack && node scripts/postbuild.mjs && npm run build:boot`.

## Suite completa (9 escenarios, ~350 comprobaciones, ~5 min)

```sh
DBURL=$(grep ^DATABASE_URL .env | cut -d'"' -f2 | sed 's#/[^/]*$#/pz_qa#')
cd e2e/qa && BASE=http://localhost:3231 DATABASE_URL=$DBURL APP_DIR=$PWD/../.. node run-all.mjs
# solo algunos escenarios: --only=1,4,7   ·   sin reiniciar la base: --no-reset
```

`run-all.mjs` crea (o vacía) la base `pz_qa`, aplica migraciones y arranca su propio servidor en el puerto de `BASE`:
no debe haber otro servidor escuchando ahí.

## Tablero (~145 comprobaciones)

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

Capturas en `SHOTS_DIR` (por defecto la carpeta temporal del sistema). Al terminar, borra la base `pz_qa`.
