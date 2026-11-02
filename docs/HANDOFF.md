# Traspaso para una sesión nueva

Documento para retomar el desarrollo de Pizarro en una sesión nueva sin perder el método de trabajo. Léelo entero
antes de empezar. No contiene datos personales: el repositorio es público y debe seguir sin ellos.

## 1. Qué es Pizarro

Kanban ligero con generador de release notes, documentación del proyecto, calendario, columnas especiales,
exportar/importar proyectos y copias de seguridad cifradas. Se instala en un servidor propio (Docker Compose) o en
Railway. Se está preparando para venderse como producto.

- **Stack:** Next.js 16 (App Router, acciones de servidor con `runAction` en `src/lib/action.ts`), Prisma 7 con
  adapter-pg, PostgreSQL 16, Tailwind 4, TipTap 3, @dnd-kit.
- **Repositorio:** `github.com/pla87/pizarro` (antes se llamaba `tablon`; algunas herramientas siguen usando ese
  nombre). Rama principal `main`.
- **Producción:** Railway despliega `main` automáticamente (si un despliegue no llega, en Railway ⌘K →
  «Deploy Latest Commit»). Dominio propio configurado en `APP_URL`.
- **Versión actual:** la de `package.json` y el primer bloque de `changelog.json`.
- **Cómo funciona todo:** `docs/MANUAL.md` (y `MANUAL.pdf`, generado). Instalación: `docs/INSTALL.md`. Prueba en un
  VPS: `docs/PRUEBA-VPS.md`.

## 2. Cómo trabaja el propietario (protocolo de cada ronda)

El propietario envía rondas de tareas en español con códigos (`RxxF1` funcionalidad, `RxxC1` corrección, `RxxM1`
mejora, `RxxR1` respuestas a preguntas anteriores), a veces con un ZIP de capturas. Las capturas pueden contener
datos personales: **nunca se suben al repositorio**. Extrae cada ZIP en una carpeta nueva y temporal.

Cada ronda empieza con «Revisa todo antes de empezar y organiza el orden idóneo. Usa agentes con modelos más
sencillos cuando sea posible y siempre revisa con el modelo principal lo que han hecho» y termina con «merge a main y
commit, actualiza el pdf de cómo funciona todo, prepara un resumen de los cambios y después un listado de lo que
necesitas que decida junto con próximos pasos sugeridos». Suele incluir «Revisa el código» (arreglar lo evidente y
preguntar lo opcional) y «Bug hunt».

Método que ha funcionado:

1. Rama de trabajo: la que indique la sesión. Al empezar, ponla igual que `main`
   (`git fetch origin main && git checkout -B <rama> origin/main`).
2. Reparte el trabajo en agentes en paralelo (aislados en worktrees), uno por bloque que no toque los mismos
   ficheros. Dales un brief común (sección 3) y una tarea concreta con los ficheros a mirar.
3. Para «Revisa el código» y «Bug hunt»: dos agentes de **solo lectura** sobre el diff de la ronda; luego un agente
   que arregla lo verificado. Lo opcional se le pregunta al propietario en lenguaje sencillo.
4. Revisa tú cada entrega antes de fusionarla (diff, riesgos, trailers de commit), fusiona en la rama, resuelve
   conflictos y pasa todas las comprobaciones (sección 4).
5. Cierra la versión (sección 5), abre la PR, fusiónala en `main` y entrega el informe final en español:
   resumen de cambios, decisiones que necesitas y próximos pasos.

Preferencias del propietario: respuestas en español, claras y sin tecnicismos innecesarios; le gusta que se le
expliquen las opciones con su coste y beneficio y una recomendación.

## 3. Brief común para los agentes

- Trabajan en su propio worktree. Dependencias: **solo dentro de su worktree** (comprobar `pwd`):
  `[ -e node_modules ] || ln -s <repo>/node_modules node_modules`. Nunca tocar el `node_modules` del repositorio
  principal (un agente lo sustituyó una vez por un enlace a sí mismo).
- Copian el `.env` y apuntan `DATABASE_URL` a una base propia (`pz_<agente>`), puerto propio. Si PostgreSQL no
  arranca: `pg_ctlcluster 16 main start`. Solo borran las bases que crearon.
- i18n: el texto en español es la clave (`t("...")`); cada texto nuevo necesita su entrada en `src/i18n/en/*.ts`.
  `npm run i18n:check` debe pasar.
- Migraciones nuevas: carpeta `prisma/migrations/<timestamp>_<nombre>` con un timestamp posterior al último.
- No tocan `changelog.json`, `CHANGELOG.md`, la versión de `package.json`, `docs/MANUAL.md` ni `MANUAL.pdf`: los
  actualiza la sesión principal al cerrar la versión. Terminan su informe con lo que debería decir el manual.
- Commits con el mensaje terminado en la línea de coautoría que haya fijado el propietario. Nada de enlaces de
  sesión ni nombres de modelos en commits, PR ni ficheros.
- Privacidad: el repositorio es público. Nada de nombres, emails, dominios ni capturas del propietario; en pruebas,
  direcciones `example.com`.

## 4. Comprobaciones antes de fusionar

```sh
npx prisma generate
npx tsc --noEmit
npm run lint
npm test                 # unitarias
npm run i18n:check
npm run test:db          # con base de datos (crea y borra pizarro_test_*)
npx next build --webpack && node scripts/postbuild.mjs && npm run build:boot
```

Pruebas en navegador (ver `e2e/README.md`): la suite QA (`e2e/qa/run-all.mjs`, ~350 comprobaciones) y la del
tablero (`e2e/board-e2e.mjs`, 44). Si cambias el rol o la etiqueta de un elemento que la suite usa, actualiza el
script correspondiente.

Antes de cada fusión en `main`, comprueba que no se cuela ningún dato personal del propietario en el diff ni en el
PDF del manual (busca su nombre, email y dominios; pídeselos si no los sabes) y que los mensajes de commit no
llevan enlaces de sesión ni nombres de modelos.

## 5. Cerrar una versión

1. `TZ=Europe/Madrid npm run version:bump -- minor --summary "…"` (o `patch`).
2. Rellenar en `changelog.json` el bloque nuevo: `changes` (`nuevas`, `mejoras`, `correcciones`, `tecnicos`) y
   `en: { summary, changes }`. Después `npm run version:bump -- --render`.
3. Actualizar `docs/MANUAL.md` (las dos líneas de versión, `version: "vX"` y «Versión de la aplicación») y las
   secciones afectadas. Generar el PDF: `node scripts/build-manual-pdf.mjs` (con `CHROME_PATH` si hace falta).
4. Commit «vX.Y.Z: …», PR a `main` y fusionar.
5. Publicar la versión (etiqueta, imagen Docker y GitHub Release): en GitHub, **Actions → Release → Run workflow**
   sobre `main`, o `npm run release:tag` y `git push origin vX.Y.Z` desde un equipo con permiso para subir
   etiquetas. Tras la primera publicación, el paquete `ghcr.io/pla87/pizarro` debe hacerse público.

## 6. Estado y pendientes

**Paquetización (paso a paso, a petición del propietario):**

- Hecho: instalación en un paso (`deploy/get.sh`), actualizaciones con versiones e imagen publicada, aviso de
  versión nueva, proyectos de ejemplo al crear un proyecto (`src/lib/project-examples.ts`), página de presentación
  `/presentacion` simplificada (sin demo; la administración no enlaza a ella por decisión del propietario) y licencia
  (`LICENSE.md` + `/licencia`; `npm run license:sync` tras cambiarla).
- Modelo de venta decidido: gratis para uso personal; empresas y profesionales, pago único por servidor con
  actualizaciones gratis para siempre y sin soporte. Precio aún sin fijar («consúltanos»).
- Pendiente de confirmar por el propietario: primera publicación con *Run workflow* y paquete GHCR público (el propietario prefiere seguir puliendo antes); prueba
  real en un VPS siguiendo `docs/PRUEBA-VPS.md`; plantilla de Railway (pasos en `docs/INSTALL.md`; la sintaxis de
  variables generadas debe verificarse en Railway).
- Siguientes pasos: fijar el precio, revisión de la licencia por un abogado, vídeo para la presentación (sustituye a
  la demo), capturas reales sin datos personales, y dominio/web propia del producto.

**Ideas pospuestas por decisión del propietario:**

- Limitar las tarjetas visibles en columnas terminadas («ver más») o archivarlas solas tras N días.
- Cargar las plantillas de release solo al abrir «Generar release».
- Guardar la fecha esperada al deshacer el movimiento de un entregable en el calendario.

**Otros:**

- WhatsApp: la integración con la API oficial de Meta ya existe (variables `WHATSAPP_*`); falta que el propietario
  decida si la activa (coste aproximado por aviso fuera de la ventana de 24 h; alternativa gratuita: un bot de
  Telegram, no implementado).
- Entorno de la nube: `npm ci` instala solo el binario SWC musl; para `next build` hace falta
  `@next/swc-linux-x64-gnu` (misma versión que `next`) extraído en `node_modules/@next/`. La suite QA necesita
  `SEED_ADMIN_PASSWORD="cambia-esta-clave"` en el `.env` local.
- Ideas pospuestas (R36): tablero que recarga solo lo cambiado (a partir de ~10 personas a la vez).
- Las copias de seguridad cifradas suben a un almacenamiento S3 compatible configurado por el propietario.
