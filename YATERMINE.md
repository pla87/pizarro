# Ya terminé: ronda 66 → Pizarro v1.70.0

Resumen para el propietario al cerrar la ronda 66 (sesión local en su PC con Claude Code y Claude in Chrome) y para
seguir en una sesión nueva de Claude Code web. El detalle técnico está en `docs/HANDOFF.md` (§0b trampas de Windows,
§6 estado y preguntas abiertas), `docs/handoff/HISTORIA.md` y `CHANGELOG.md`.

## Qué se ha hecho

**Tus encargos de la ronda (R66R1, R66M1, R66M2, R66M3):**

- **Decisiones aprobadas, hechas:**
  - Arrastrar las cabeceras de columna para reordenarlas (o Alt+← / Alt+→ sobre su nombre).
  - El menú «Rol de la columna» enseña primero los roles de la plantilla del proyecto y el resto tras «Más roles…».
  - «Organizar por personas» en los proyectos de Casa y familia.
  - Aviso antes de perder una plantilla a medio editar.
  - Línea en el historial de la tarea con las subtareas que cambia el tipo.
  - Pruebas con base de datos en cada PR de GitHub, en orden al azar.
- **Railway, margen de apagado:** por defecto Railway da 0 s al apagar y corta lo que está a medias.
  - En la instalación de prueba se ha puesto *Teardown* con 15 s y se ha comprobado el apagado ordenado.
  - La guía de instalación pide ahora la variable `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=15`.
- **Orden de los proyectos (R66M1):** se elige en Mi perfil → Preferencias, entre «Usados recientemente» (la opción de serie) y «Alfabético».
- **«Descartar cambios» → «Deshacer todo»** en el pie del detalle de la tarea, como decidiste.
- **Arreglos de los informes de Claude in Chrome (v1.68, v1.69 y auditoría):**
  - Una tarjeta arrastrada deprisa ya no cae en una columna intermedia.
  - Al entrar en una columna de persona sale el aviso «Asignada a X · vence el …» con Deshacer.
  - Historial de versiones: el enlace a una versión antigua baja hasta ella, el buscador resalta lo encontrado y los cambios técnicos solo los ven los administradores.
  - Logs: un solo «Periodo», y los emails de quien no es usuario se guardan enmascarados.
  - Copias de seguridad sin jerga.
  - Plantillas de serie con tipo por defecto y la etiqueta «De serie».
  - Calendario con leyenda.
  - Avisos ya no dice «Estás al día» si hay tareas vencidas.
  - Detalle: «Bloquea a», «← Volver», el color tras «Bloqueada por», el foco al guardar la descripción, y avisos del cambio de tipo que cuentan bien.
  - «Varias tareas» pone la plantilla de descripción de cada tipo.
  - Los PDF llevan el modo en el nombre del fichero.
  - Y más: la lista completa está en `CHANGELOG.md`.
- **Revisión del código y caza de bugs (5 vueltas):**
  - **Vuelta 1:** servidor y seguridad.
  - **Vuelta 2:** tablero y ficheros.
  - **Vuelta 3:** páginas, e2e, traducciones y accesibilidad.
  - **Vuelta 4:** avisos, administración y cuenta.
  - **Vuelta 5:** convergencia; la última solo halló casos límite.
  - **Arreglos de seguridad:**
    - El email propio de un administrador ya no se cambia sin contraseña.
    - «Cerrar las demás sesiones» quita también «Recordar este dispositivo».
    - Tope diario a la prueba de WhatsApp, que cuesta dinero.
    - Un `.pizarro.zip` manipulado ya no rompe un tablero.
  - **Fiabilidad:** los avisos y el informe semanal no se pierden por un reinicio.
- **Entorno del PC:** las comprobaciones, las pruebas con base de datos y las e2e funcionan ya en Windows. Las trampas están en `docs/HANDOFF.md` §0b.
- **Privacidad:** los commits de esta ronda llevan la dirección anónima de GitHub, no tu email. Se ha puesto en la configuración local del repositorio.
- **Comprobado:**
  - En GitHub (Linux): tipos, lint, pruebas unitarias, traducciones y las pruebas con base de datos, todo en verde.
  - En local: todas las e2e, 3398 de 3431 comprobaciones. Lo que falla se ha contrastado con la v1.69.0 en el mismo PC y es del entorno Windows (portapapeles con `\r\n`, zona horaria, PDF), salvo un detalle estético que queda como primer pendiente (abajo).

## Decisiones que debes tomar (con mi recomendación)

0. **Pendiente técnico (no hace falta que decidas nada):** al ir del tablero a Releases con la red lenta, durante un instante sale el esqueleto de carga del tablero y no el de Releases. Lo provoca anotar la visita del proyecto (el orden «Usados recientemente»). Se arregla en la ronda siguiente.
1. **WhatsApp en tu instalación real:** dijiste «inténtalo, tenemos que ver que funciona».
   - Necesita tu cuenta de Meta (WhatsApp Business), el número y la plantilla aprobada, y cada aviso cuesta dinero.
   - Hay que hacerlo contigo delante, con `docs/guias/whatsapp.md`. *(SÍ, en la próxima sesión, juntos)*
2. **«Varias tareas»:** ¿debe aplicar también el prefijo de título del tipo, como «Nueva tarea»? *(Lo ibas a revisar más adelante)*
3. **«Orden manual» de los proyectos:** arrastrarlos en el selector. *(Lo ibas a revisar más adelante; mi recomendación: NO)*
4. **Cabecera de columna:** al recorrer el tablero con el tabulador, cada cabecera es una parada más (sirve para moverla con Alt+flechas). *(Que se quede: NO quitarla)*
5. **Arranque más rápido:** no lanzar Prisma al arrancar si la base ya está al día. Son unos segundos menos sin servicio en cada despliegue. *(SÍ, pequeño)*
6. **«Organizar por personas» en proyectos de equipo:** que cuente solo a los miembros y a los administradores que tienen el proyecto en su lista. Hoy cuenta a todos los administradores de la instalación. *(SÍ)*
7. **Publicar una versión:** pasar también las pruebas con base de datos antes, con unos 3 minutos más por versión. *(SÍ)*
8. **Una dirección propia para cada tarea** (`?tarea=…`), para enlazarla o abrir dos en pestañas. *(SÍ, en una ronda propia)*
9. **Renombrar la columna «Agenda» de la plantilla Eventos y viajes a «Programa».** Cambia también las instalaciones que no la han tocado. *(NO)*

## Prompt inicial para la sesión nueva (Claude Code web)

La versión con tus términos de privacidad está en tu repositorio privado `macobooks`, fichero `YATERMINEPIZARRO.md`. Esta
no los lleva porque este repositorio es público: añádelos tú al pegarlo.

```text
Vamos a seguir con Pizarro en la nube (Claude Code web). Antes de nada:
1. Lee entero el núcleo de docs/HANDOFF.md (§0 «Arranque», §6 «Estado y pendientes» con el estado de la ronda 66 y las preguntas abiertas), el índice del manual (grep -n '^#' docs/MANUAL.md), e2e/README.md, docs/PRUEBAS-CHROME.md y YATERMINE.md. Los anexos de docs/handoff/ léelos solo cuando toque su tema.
2. Prepara el entorno de la nube siguiendo la §0 (PostgreSQL 16, .env, npm ci, migraciones) y dime si falta algo.
3. Confírmame la versión actual (package.json y el primer bloque de changelog.json) y que tu rama está igual que origin/main.
4. Resúmeme en una lista corta lo que quedó pendiente de la ronda 66 y las decisiones que tengo que tomar, con tu recomendación en cada una.
5. Después espera a que te mande la siguiente ronda.

Reglas fijas: respóndeme siempre en español, claro y sin tecnicismos innecesarios. Commits con el mensaje terminado en la línea «Co-Authored-By: Claude <noreply@anthropic.com>» y con la dirección anónima de GitHub como autor, nunca mi email. Nada de datos personales míos (nombre, email, dominios) en ficheros, commits ni PR, y nada de enlaces de sesión ni nombres de modelos; antes de cada fusión, el grep de privacidad con los términos que te daré. Minutos de GitHub Actions solo al final (la PR y la Release): las comprobaciones se pasan en local.
```
