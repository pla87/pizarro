# Prompts para Claude in Chrome

Pruebas que hace Claude in Chrome en el navegador del propietario (Cloudflare, Railway, la web). Cada prompt va en su propia
conversación de Claude in Chrome. Cuando el propietario pasa los informes, se apunta aquí lo que ya está hecho y se
actualizan los prompts que sigan pendientes.

Estado tras la ronda 60 (v1.64.0):

- Hecho: revisión de Cloudflare y R2 (ronda 60: la ofuscación de emails ya no hace falta desactivarla, la app manda
  `no-transform`; R2 no tiene versionado, sí bloqueos de retención) e instalación desde cero en Railway con la web (ronda
  60: la guía y la app se han corregido con su informe).
- Pendientes, en este orden: 1 (copias en R2), 2 (auditoría como usuario sobre la instalación de prueba).

## 1. Copias de seguridad en R2: variables de Railway y bloqueo de retención

```text
Necesito revisar y proteger las copias de seguridad de mi aplicación Pizarro. Trabaja en una pestaña nueva, no cambies nada que no te pida y, si algo no coincide con lo que te describo, para y pregúntame antes de seguir. No copies en tu resumen ninguna clave, email ni dato personal.

Contexto: Pizarro está en Railway y sube sus copias cifradas a un bucket de Cloudflare R2 (el bucket «pizarro», con una carpeta «pizarro/» que contiene «files/» y ficheros «pizarro-backup-<fecha>.pzbak» y «.pzman»). La última copia del bucket parece ser del 18-11-2026.

PARTE 1 · ¿Por qué dejaron de llegar copias? (solo mirar)
1. Abre mi instalación de Pizarro (ya tengo la sesión iniciada; si no, para y pídeme que entre yo) y ve a Administración → Copias de seguridad. Dime qué pone en «Destino externo» y en «Tareas de mantenimiento» (por ejemplo «Omitida: sin destino externo», «Correcta», «Con error» y el mensaje).
2. En Railway, en mi proyecto real (solo MIRAR: no cambies, borres, reinicies ni despliegues nada), abre el servicio de Pizarro → Variables y dime si existen variables cuyo nombre empieza por BACKUP_S3_ (solo los NOMBRES, nunca los valores). Mira también en Settings → Deploy si «Healthcheck Path» es /api/health.
3. Para y enséñame lo que has visto. Si faltan las variables, yo las pondré.

PARTE 2 · Bloqueo de retención en el bucket (solo cuando yo te diga «sigue»)
1. En Cloudflare → R2 → bucket «pizarro» → Settings → Bucket Lock Rules, crea una regla:
   - Nombre: copias-pizarro
   - Prefijo: pizarro/pizarro-backup-
   - Retención: 31 días
2. Pregúntame antes de crear una segunda regla para «pizarro/files/» (indefinida o 180 días): ocupa más espacio porque no se podrá borrar nada de ahí mientras dure.
3. No toques las reglas de ciclo de vida ni los tokens.
4. Vuelve a Pizarro → Administración → Copias de seguridad y pulsa «Copiar ahora a destino externo». Espera unos minutos y recarga: debe salir «Correcta».

Termina con un resumen breve: qué ponía cada sección, qué variables existían (solo nombres), qué regla creaste y el resultado de «Copiar ahora».
```

## 2. Auditoría como usuario de la v1.64.0 (instalación de prueba)

```text
Quiero que uses Pizarro como lo haría una persona nueva en su trabajo y me des un informe de todo lo que confunda, falle o se pueda mejorar. Trabaja en una pestaña nueva y, si algo no coincide con lo que te describo, para y pregúntame.

Dónde probar (muy importante):
- Usa la instalación de PRUEBA en Railway, el proyecto `pizarro-prueba-instalacion`. Si no existe, para y pregúntame.
- No toques mi instalación real ni ningún otro proyecto de Railway.
- Antes de cualquier paso que cueste dinero más allá del uso normal, para y pregúntame.
- Entra con el administrador de prueba (`admin-prueba@example.com`). Si no recuerdas su contraseña, para y pídeme que entre yo.
- No pongas en tu informe claves, contraseñas ni datos personales.

Antes de empezar:
0. En Historial de versiones, comprueba que es la v1.64.0. Si es más antigua: en Railway, en el servicio de Pizarro del proyecto de prueba, mira que la rama sea `stable` y pulsa «Deploy» (o ⌘K → «Deploy Latest Commit»). Espera a que termine y vuelve a mirar.

Recorrido (haz de usuario, no de probador: fíjate en si entiendes cada pantalla sin ayuda):
1. Crea un proyecto desde la plantilla «Reformas y obras» (o la que más se parezca a un trabajo real). Debe abrirse su tablero directamente, con la descripción de la plantilla.
2. Crea 5 tareas con el «+» de varias columnas. Prueba a escribir un título y DESPUÉS elegir otro tipo: lo escrito no debe perderse (por ejemplo «Fontanería» → «Presupuesto: Fontanería»). Cambia de tipo dos veces seguidas: la descripción y las subtareas no deben mezclarse.
3. Abre una tarea, empieza a escribir en la descripción y, sin guardar, cambia el tipo: lo escrito debe seguir ahí.
4. Mueve tarjetas, añade un comentario con una mención, una subtarea y un adjunto. Abre el mismo tablero en una segunda pestaña e intenta ver si los cambios de una llegan a la otra sin recargar.
5. Crea 60 tareas con «Varias tareas» en una columna: el tablero debe seguir fluido, y la búsqueda debe encontrar la última.
6. Releases: en la columna «Siguiente salto», «Generar release», márcala como desplegada y, en Releases, busca una palabra: debe salir resaltada.
7. Calendario y Mis tareas: pon fechas límite y mira que todo se entiende.
8. Mi perfil: cambia el idioma a inglés y recorre las pantallas principales: fechas al estilo de EE. UU. («Nov 21, 2026»), calendario empezando en domingo, sin palabras británicas («licence», «organisation», «tick»). Vuelve a español.
9. Mi perfil → Avisos: revisa si se entiende qué email llega por cada casilla.
10. Administración: Usuarios (la nota «i» del máximo de usuarios), Ajustes (zona horaria con buscador, nombre bajo el icono, dirección pública), Copias de seguridad (debe decir «Omitida: sin destino externo» si no hay bucket), Logs (descarga el CSV y ábrelo en una hoja de cálculo si puedes).
11. Invita por email a `invitado-prueba@example.com` desde Ajustes del proyecto → General: debe salir «Invitación pendiente». Abre el enlace en una ventana de incógnito, elige contraseña y entra.
12. En el móvil (ventana estrecha de 390 px si no hay móvil): tablero, nueva tarea, detalle y menú.

Termina con un informe en español, ordenado de más a menos grave: para cada punto, la pantalla, qué hiciste, qué esperabas, qué pasó (texto exacto de los avisos) y una propuesta. Separa: fallos, cosas confusas, ideas para simplificar y lo que te ha gustado. No borres el proyecto de prueba de Railway: pregúntame.
```
