# Progreso de la ronda 70 (mejoras operativas y caza de bugs)

Anexo temporal de `docs/HANDOFF.md`: se va rellenando vuelta a vuelta para que el trabajo no se pierda si la sesión se
corta. Al cerrar la ronda, lo aplicado pasa a `HISTORIA.md`/`GUARDAS.md` y este fichero se quita.

Encargo del propietario (R70M1 + R70RE1): mejoras de experiencia de uso (sin complicar la web), eficiencia, velocidad y
seguridad; abaratar servidor e IA sin bajar la calidad; caza de bugs como cliente, editor, programador y atacante; qué se
puede retirar (siempre preguntando antes de borrar). Hasta 10 vueltas o hasta que no salgan mejoras evidentes. Criterio de
parada aplicado para no gastar IA de más: se para cuando una vuelta no da ningún hallazgo verificado de gravedad media o alta.

## Vuelta 1 (revisores: seguridad, coste/rendimiento, experiencia de uso; Chrome en local sobre la v1.73.0)

Seguridad: nada explotable de gravedad alta. Revisado y correcto: acceso e IDOR en acciones, rutas con token, `/x/`,
subidas y descargas, ZIP, sesión y 2FA, integraciones (sin SSRF), cabeceras y CSP.

Evidentes (en curso):
- «Varias tareas» pierde la lista sin preguntar al cerrar.
- Web de fuera: doble clic en «Comentar» publica dos veces.
- «Nueva tarea»: cambiar de tipo a mano quitaba un prefijo que escribió la persona (tras la regla del «último usado»).
- Pie de «Compartir fuera»: clics rápidos en la caducidad desordenan lo guardado.
- Mis tareas: la pastilla de la columna parecía una persona; Calendario: la raya roja de vencida sin explicar.
- Ajustes → Visibilidad: radios sin grupo (teclado y lector de pantalla).
- Imagen pegada en medio de un párrafo: espacios sobrantes en los bordes (se veían en la release .md).
- Imagen Docker: `static` y `public` copiados dos veces (~1,2 MB por imagen).
- (Descartado tras probarlo) Canal en vivo con la caché de acceso: una vía que no vaciase la caché dejaría ver cambios del
  proyecto hasta 5 min; se queda la comprobación directa (una consulta barata al abrir el canal).

Opcionales (para el propietario, en la lista de decisiones del cierre):
- Tope de bytes por enlace y hora en las descargas de «Compartir fuera» (hoy 300 descargas/h de hasta 20–100 MB: 6–30 GB/h
  de salida si se abusa de un enlace filtrado). Ya se contestó «no por ahora» (2b); se replantea por el coste.
- Caché corta (5–10 s) de la página pública de «Compartir fuera» o tope de visitas por enlace.
- CI: pruebas con base con `fsync=off` y 4 procesos (≈1 min menos por PR y Release; el repositorio es público, no cuesta dinero).
- Pregunta 6 (caché `gha` en la Release): pasa a NO (se quitó en la v1.68 por lenta; los minutos son gratis en repo público).
- El migrador con Prisma es ~18 % de la imagen (23,8 MB comprimidos): dato para el migrador propio.
- «Añadir columna» delante de la primera columna terminada en vez de al final.
- Web de fuera: fecha mínima en «Cambiar fecha» y aviso propio; no decir «Fecha cambiada» si no cambió; «copia tu texto»
  en el aviso de error de un comentario.
- Miniaturas e imágenes de la web de fuera: verlas sin descargar (`?inline=1`) y dejar el nombre como descarga.
- Avisos de una tarea borrada: decir «Esa tarea ya no existe» al pulsarlos.
- `/setup`: conservar el error al pulsar «Atrás».
- «Importar tareas»: preguntar antes de cerrar con texto pegado.
- Release .md: la imagen de la descripción aparece también en «Adjuntos:».

Candidatos a retirar: ninguno nuevo en esta vuelta (`@tiptap/suggestion` no se importa pero es dependencia obligatoria de
`@tiptap/extension-mention`).

Hecho en la vuelta 1: todos los evidentes de arriba (fusionados en `ronda-70`).

## Vuelta 2 (revisores: administración/instalación/tareas de fondo; importar/exportar, releases, PDF, documentación y qué retirar)

Hecho (evidentes):
- Exportar/importar proyecto: las imágenes del histórico de releases quedaban rotas (no se reescribían sus referencias).
- Importar: un tipo propio con el nombre de un tipo general de la instalación se duplicaba; ahora entra como «Nombre (2)»
  con aviso, y las columnas y tareas que lo usaban siguen con él.
- Tareas diarias (limpiezas, papelera, avisos): si fallaban no se reintentaban hasta 23 h después; ahora en la pasada siguiente.
- `docs/INSTALL.md` §6.1 y §6.3: las órdenes de restaurar fallaban con el rol de aplicación `pizarro_app` que crea
  `install.sh`; ahora usan el rol que corresponde y `restore.mjs --force`.
- Manual §4.5: la comprobación de espacio antes de cada copia, como la hace el código.

Opcional:
- La prueba de restauración mensual duplica el tamaño de la base en el disco de PostgreSQL sin mirar si cabe: hacer la
  prueba en modo «verificar» si no hay sitio (en Compose y npm start se puede medir; en Railway, con un tope por variable).

Qué retirar: knip limpio, 0 traducciones sin uso, ningún fichero huérfano. Siguen sin uso (pendientes de tu «sí»):
`parseProfileTab`, `listProjectDocuments`/`listTrashedDocuments`, `htmlTableToMarkdown`, el `export` de `runBoot` y la
limpieza de `globalThis.prisma` en `scripts/boot.ts`, y la columna `ColumnShare.generatedByName` (v1.74).

## Vuelta 3 (revisores: concurrencia, tablero en vivo y deshacer; móvil, inglés, accesibilidad y textos)

Hecho (evidentes):
- Ctrl+Z / rehacer recargaba el tablero entero dos veces en la propia pestaña: ahora una.
- Deshacer no avisaba (y pisaba) lo cambiado desde la web de «Compartir fuera».
- «Mover a…» de varias tareas movía también una que otra persona acababa de archivar.
- Etiquetas desde el detalle: si dos personas las cambiaban casi a la vez, se perdía la de una; ahora se manda el cambio.
- «Aplicar plantilla» (sustituir) podía interbloquearse con un «Mover a…» a la vez.
- Móvil: iPhone ya no amplía la página al tocar un campo (16 px en móvil táctil); la web de fuera tampoco, y sus tablas,
  bloques de código y nombres largos ya no se salen de la pantalla.
- La página «Dejar de recibir estos emails» sale en el idioma de la persona.
- Textos: plural de «Se conserva 1 columna…», «Pinned» en el plan, comillas inglesas en inglés.

Opcional:
- Borrar tareas: leer la instantánea para deshacer dentro de la transacción del borrado (alarga el candado).
- Errores de importar en inglés con el detalle técnico en español; un error del proxy en español; página sin conexión
  para la app instalada.

## Vuelta 4 (revisión del diff de la propia ronda)

En curso: título del detalle que encogía al editar en móvil (por la regla de 16 px), la fecha que enseña Administración
cuando una tarea diaria falla, comentarios de fuera en el aviso de deshacer, tipos renombrados al importar que se fundían,
prefijo en «Nueva tarea» con título compartido o borrador, textos en plural de «Varias tareas», «Mover a…» que deja en su
sitio lo que no se movió, la hora de la base en la deduplicación de comentarios de fuera y un comentario obsoleto.

Opcional: 16 px también en tabletas y móviles en horizontal (hoy solo hasta 639 px); deduplicar comentarios de fuera solo
si además es el mismo visitante (hoy dos personas distintas que escriben lo mismo en 30 s cuentan como uno).
