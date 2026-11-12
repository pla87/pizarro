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
  «Deploy Latest Commit»). Dominio propio configurado en `APP_URL`. Las instalaciones de los usuarios en Railway
  deben seguir la rama `stable` (solo versiones publicadas; la mueve el workflow Release). Si la producción propia
  también debe recibir solo versiones, cámbiala a `stable` (pasos en el README, «Guía de despliegue en Railway»).
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
  `[ -e node_modules ] || cp -al <repo>/node_modules node_modules`. Nunca tocar el `node_modules` del repositorio
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
npm run i18n:unused      # solo informa (ver abajo)
npm run test:db          # con base de datos (crea y borra pizarro_test_*)
npx next build --webpack && node scripts/postbuild.mjs && npm run build:boot
```

Pruebas en navegador (ver `e2e/README.md`): la suite QA (`e2e/qa/run-all.mjs`, ~378 comprobaciones), la del
tablero (`e2e/board-e2e.mjs`, unas 340) y la de pegado (`e2e/paste-e2e.mjs`, ~72: imágenes y tablas pegadas; misma
base `pz_qa` y servidor que la del tablero). Si cambias el rol o la etiqueta de un elemento que la suite usa,
actualiza el script correspondiente. Las suites declaran la instalación de uso personal en `prepareUsers`
(`e2e/qa/lib.mjs`) para que no salga el recordatorio de licencia. Chromium: `CHROME` o, si no, el más reciente de
`/opt/pw-browsers`.

Guardas que conviene conocer:

- `npm run i18n:unused` (solo informa): traducciones sin uso, repetidas o que solo usan las pruebas. Antes de
  borrar una, comprueba que no puede venir del historial de las tareas (un año), del deshacer (7 días) ni de los
  errores de exportar/importar, que se traducen al leerlos. Las que se conservan por eso van bajo el comentario
  «Textos guardados por versiones anteriores».
- `tests/db/undo-perf.test.ts` (dentro de `npm run test:db`): guarda de rendimiento del deshacer. Mide las
  consultas y los bytes leídos al deshacer y rehacer «Mover a…» de cientos de tarjetas; si falla, algo ha vuelto a
  leer las descripciones completas o a hacer consultas entrada a entrada.
- Apagado ordenado (`src/lib/shutdown.ts`): al recibir la señal, `/api/health` responde `503` (`shutting_down`),
  se cierran los canales en vivo y se espera hasta 5 s a las peticiones en curso (subidas incluidas) y a los
  emails. Una ruta nueva de larga duración debe contar como petición en curso; lo que no termine queda en
  `system.shutdown`. Con Telegram en modo sondeo, al apagarse confirma a Telegram los mensajes ya procesados.
- `npm start` fuera de Docker (`scripts/start-local.mjs`): carga el `.env` y `scripts/server.env`, convierte en
  absolutas las rutas de datos relativas (`UPLOAD_DIR`, `MAIL_OUTBOX_DIR`, `BACKUP_EXTERNAL_DIR`; lógica en
  `scripts/local-paths.mjs`, probada en `tests/local-paths.test.ts`) y después carga `.next/standalone/server.js`.
  Sin eso, una ruta relativa acababa dentro de `.next/standalone/` y cada compilación la borraba. `postbuild.mjs`
  quita del standalone las subidas, las copias y los `.env` que Next copiaba allí. El contenedor no usa este script
  (`scripts/start.sh`). El script `start` no lleva `exec` (cmd.exe no lo entiende y en Windows `npm start` no
  arrancaba): al parar npm, el `sh -c` de npm muere con el SIGTERM sin pasarlo a node, y `scripts/parent-watch.mjs`
  detecta que ha desaparecido el proceso padre (también si npm muere de golpe) y lanza el apagado ordenado en ~1 s
  (solo si lo arrancó npm). Pruebas: `tests/start-signals.test.ts` (arranca `npm start` de verdad con un servidor de
  prueba, lo para con SIGTERM al pid de npm y comprueba que no queda huérfano).

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
   sobre `main` (la publicación manual solo funciona desde `main`: lanzada desde otra rama no hace nada), o `npm run release:tag` y `git push origin vX.Y.Z` desde un equipo con permiso para subir
   etiquetas. Tras la primera publicación, el paquete `ghcr.io/pla87/pizarro` debe hacerse público. El mismo
   workflow mueve la rama `stable` al commit publicado (job «Rama stable», el único con permiso para escribir en el
   repositorio además de la release): de ella despliegan las instalaciones de Railway. Si se protege `stable` en
   GitHub, hay que permitir que la mueva GitHub Actions. La imagen se construye con `OFFICIAL_BUILD=1` y
   `RELEASE_VERSION`: así la app sabe que es una build oficial y ofrece «Informar de un error» (en Railway, también
   si el código viene del repositorio oficial y de la rama `stable`; lógica en `src/lib/bug-report-core.ts`). El
   botón abre el formulario `.github/ISSUE_TEMPLATE/bug_report.yml` con datos técnicos rellenos (versión, commit,
   tipo de instalación, navegador y sistema, idioma); nunca usuarios, proyectos, emails ni la dirección de la
   instalación. Los fallos de seguridad van en privado (`SECURITY.md`). *Copiar información técnica* (Ajustes) sale
   de `src/lib/tech-info.ts`. Si cambian esos campos, actualiza a la vez el formulario y `tests/bug-report.test.ts`.
   El job solo mueve `stable` a un commit que ya está en `main` (`git merge-base --is-ancestor`); una etiqueta puesta
   en otra rama publica la imagen y la release, pero deja `stable` donde estaba (con un aviso en el job).
6. **Secreto `STABLE_PUSH_TOKEN` (una vez).** GitHub no deja que `GITHUB_TOKEN` mueva una rama si entre su commit
   anterior y el nuevo cambia algún fichero de `.github/workflows/` (error «refusing to allow a GitHub App to create
   or update workflow … without `workflows` permission»; el bloque `permissions:` no tiene un permiso `workflows`).
   Para esas versiones el job usa el secreto `STABLE_PUSH_TOKEN` si existe (si no, `GITHUB_TOKEN`). Crearlo:
   1. GitHub → *Settings* (de tu cuenta) → *Developer settings* → *Personal access tokens* → *Fine-grained tokens* →
      *Generate new token*. Propietario: el del repositorio; *Repository access*: **Only select repositories** → solo
      este repositorio; caducidad: la que admita la organización (apunta cuándo renovarlo).
   2. *Repository permissions*: **Contents: Read and write** y **Workflows: Read and write** (nada más; *Metadata:
      Read* se añade solo).
   3. En el repositorio: *Settings → Secrets and variables → Actions → New repository secret*, nombre
      `STABLE_PUSH_TOKEN`, valor el token.
   Si falta (o le falta el permiso) y la versión cambia los workflows, el job «Rama stable» termina en rojo con un
   mensaje que dice qué secreto crear; la imagen y la release ya están publicadas y no se tocan. Tras crear el
   secreto, *Re-run failed jobs* en esa ejecución mueve `stable`. Si `stable` está protegida, la regla debe permitir
   el push del propietario del token (o de GitHub Actions si no hay token).

### Actualizaciones de dependencias (Dependabot)

`.github/dependabot.yml` abre PR contra `main`:

- **Acciones de GitHub**, un PR semanal con todas juntas. En los workflows cada acción va fijada a un commit exacto
  (`uses: owner/acción@<SHA de 40 caracteres> # vX.Y.Z`): nunca se vuelve a poner una etiqueta móvil como `@v4`.
  Para fijar una acción nueva a mano: `git ls-remote https://github.com/<owner>/<acción> refs/tags/<tag>` (si la
  etiqueta es anotada, el commit es el de la línea `^{}`).
- **npm**, un PR mensual con todas las versiones menores y parches. Las versiones mayores no se proponen (se hacen a
  mano, leyendo sus notas de cambios). Las de seguridad llegan en cuanto hay aviso, en su propio PR (requiere
  *Settings → Code security → Dependabot security updates* activado).

Cómo se revisa cada PR:

1. Leer qué cambia: en las acciones, que el SHA nuevo corresponde a la etiqueta del comentario (enlace «Release
   notes» del PR) y que la acción sigue siendo del mismo propietario; en npm, las notas de los paquetes con cambios
   de comportamiento (Next, Prisma, TipTap, @dnd-kit, sharp…). Prisma: `prisma` y `@prisma/*` deben ir a la misma
   versión; Next y `@next/swc-*`, también.
2. Bajarse la rama y pasar **todas** las comprobaciones de la sección 4 (incluidas `npm run test:db` y el build de
   producción) y, si toca Next, TipTap o @dnd-kit, las suites e2e.
3. **Una actualización de dependencias se aprueba solo si pasan todas las pruebas.** Si algo falla, se cierra el PR
   (o se ignora esa versión con `@dependabot ignore this minor version`) y se anota en la sección 6. Nunca se
   «arregla» una prueba para que pase con la dependencia nueva sin entender por qué fallaba.
4. Se fusiona en `main` como cualquier otro cambio; llega a los usuarios con la siguiente versión publicada (nunca
   antes: las instalaciones siguen las releases o la rama `stable`).

## 6. Estado y pendientes

**Paquetización (paso a paso, a petición del propietario):**

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
  `docs/guias/en/<nombre>.md` (Google, Google Docs y Sheets, Telegram, WhatsApp). La cabecera del fichero (`titulo`,
  `descripcion`, `orden`, `icono`) da la tarjeta del índice; `build-site.mjs` las añade solas al índice y al sitemap
  y falla si falta la versión en inglés, el título o la descripción. El workflow «Web» también se lanza al cambiar
  `docs/guias/`. La portada enlaza a cada guía desde «Se conecta con lo que ya usas». El pie lleva una línea de
  autoría: no escribas en ella ni en el manual dominios personales.
- Hecho: recordatorio de licencia para administradores (franja bajo la cabecera, como mucho cada 30 días, nunca en
  los 7 primeros días): lógica en `shouldShowLicenseNudge` (`src/lib/license-core.ts`), interfaz en
  `src/components/LicenseNudge.tsx`. Se oculta con licencia registrada o declarando uso personal o educativo.
- Modelo de venta decidido: gratis para uso personal y para uso educativo (centros de enseñanza públicos o
  privados, también academias, con su profesorado y alumnado; definición en `LICENSE.md` §2); empresas y profesionales, pago único por servidor con
  actualizaciones gratis para siempre y sin soporte. Precio: 100 € + IVA (pago con tarjeta y factura, NIF opcional); botón Comprar con `BUY_URL` en `src/lib/product.ts` (vacía hasta que el propietario cree el Payment Link de Stripe, ver `docs/VENTA.md`); *Administración → Licencia* solo informa. Todo uso que no sea personal ni educativo paga. Listas de funciones candidatas a licencia profesional y de ideas de otros Kanban: `docs/IDEAS.md`.
- Pendiente de confirmar por el propietario: primera publicación con *Run workflow* y paquete GHCR público (el propietario prefiere seguir puliendo antes); prueba
  real en un VPS siguiendo `docs/PRUEBA-VPS.md`; plantilla de Railway (pasos en `docs/INSTALL.md`; la sintaxis de
  variables generadas debe verificarse en Railway).
- Siguientes pasos: revisión de la licencia por un abogado (en especial las definiciones de «centro educativo» y
  «uso educativo» de §2: academias privadas, gestión del centro, administraciones educativas y formadores autónomos), vídeo para la presentación (sustituye a la demo),
  capturas reales sin datos personales, poner en marcha getpizarro.com (`docs/VENTA.md` §8) y el Payment Link.
- A partir del 17-nov-2026 se pueden quitar las huellas de deshacer antiguas (las de `fingerprintOps` sin el prefijo
  `v2:`, en `src/lib/undo.ts`): para entonces ya no quedarán entradas de deshacer guardadas con ellas.

**Ideas pospuestas por decisión del propietario:**

- Limitar las tarjetas visibles en columnas terminadas («ver más») o archivarlas solas tras N días.
- Cargar las plantillas de release solo al abrir «Generar release».
- Guardar la fecha esperada al deshacer el movimiento de un entregable en el calendario.

**Otros:**

- Telegram y WhatsApp: los dos están implementados y se configuran en *Administración → Ajustes → Avisos por
  Telegram y WhatsApp* (las variables `WHATSAPP_*` solo rellenan lo que no se guarde allí; guías en `docs/guias/`;
  manual §3.9, §3.16 y §4.7b). Telegram es gratis. La única decisión pendiente del propietario es de coste: si activa
  WhatsApp en su instalación (Meta cobra cada aviso entregado con plantilla, ver `docs/guias/whatsapp.md`).
  - Código: `src/lib/messaging-core.ts` (lógica pura: textos, topes de 30/h por Telegram y 10/h por WhatsApp por
    persona, clasificación de errores), `src/lib/messaging-config.ts` (Ajustes en `AppState`, tokens cifrados con
    `ENCRYPTION_KEY`; `rotate-keys` los cubre), `src/lib/telegram.ts`, `src/lib/whatsapp.ts`, `src/lib/notify.ts`
    (envío tras responder) y `src/actions/messaging.ts`. Datos: `UserChannel` (canal, dirección, código de WhatsApp,
    qué avisos) y `TelegramLinkCode`; las preferencias de WhatsApp ya no están en `User`.
  - Telegram: webhook `APP_URL/api/telegram/webhook` (fuera del proxy de sesión, con el secreto en
    `X-Telegram-Bot-Api-Secret-Token`) si `APP_URL` es https pública; si no, sondeo con `getUpdates`, que solo vale
    con una instancia. El arranque reintenta con espera creciente (hasta 5 min) si Telegram o la base no responden.
  - WhatsApp: plantilla de utilidad `aviso_pizarro` (3 variables); la antigua `mencion_pizarro` (4 variables) solo
    envía menciones. Guardar la configuración no activa el envío (hay que pulsar *Activar*). Un fallo que Meta pudo
    haber enviado (5xx, corte, tiempo agotado) no se reintenta, para no cobrar dos veces. Cada número se confirma con
    un código de 6 cifras (15 min, 5 intentos; 5 mensajes al día por persona y 3 por número).
  - Pruebas: `tests/messaging.test.ts`, `tests/db/messaging.test.ts` y `tests/db/messaging-migration.test.ts`.
- Entorno de la nube: `npm ci` instala solo el binario SWC musl; para `next build` hace falta
  `@next/swc-linux-x64-gnu` (misma versión que `next`) extraído en `node_modules/@next/`. La suite QA necesita
  `SEED_ADMIN_PASSWORD="cambia-esta-clave"` en el `.env` local.
- Ideas pospuestas (R36): tablero que recarga solo lo cambiado (a partir de ~10 personas a la vez).
- Las copias de seguridad cifradas suben a un almacenamiento S3 compatible configurado por el propietario.
