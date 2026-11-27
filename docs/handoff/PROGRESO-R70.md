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
- Canal en vivo: una consulta de acceso por reconexión que puede ir a la caché de acceso.

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
