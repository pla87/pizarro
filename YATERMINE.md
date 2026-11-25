# Ya terminé: ronda 67 → Pizarro v1.71.0

Resumen para el propietario al cerrar la ronda 67 (sesión en la nube con Claude Code web) y para seguir en una sesión
nueva. El detalle técnico está en `docs/HANDOFF.md` (§6 estado y preguntas abiertas), `docs/handoff/HISTORIA.md` y
`CHANGELOG.md`.

## Qué se ha hecho

**Tus respuestas de la ronda (R67R1), hechas:**

- El esqueleto de carga correcto al ir a Releases. No era el orden de los proyectos, sino el puntero del ratón: al elegir
  otro proyecto en el selector quedaba sobre el enlace «Releases», que cambiaba sin prepararse.
- Arranque más rápido: si la base ya tiene todas las migraciones, Pizarro arranca sin lanzar Prisma (de ~1 s a ~0,1 s en
  local; varios segundos menos sin servicio en cada despliegue de Railway). Ante cualquier duda hace lo de siempre.
- Publicar una versión pasa también las pruebas con base de datos; si fallan, no se publica.
- «Organizar por personas» en proyectos de equipo: solo los miembros y los administradores que lo tienen en su lista.
- WhatsApp: prompt para Claude in Chrome (n.º 4 de `docs/PRUEBAS-CHROME.md`) para hacerlo contigo delante, empezando por
  el número de prueba de Meta (gratis).
- «Varias tareas» sin prefijo, sin orden manual de proyectos, la cabecera de columna se queda como parada de Tab y
  «Agenda» no se renombra: como dijiste.

**Enlace externo para proveedores (R67F1):** propuesta en el informe final, con preguntas por letra.

**Revisión del código y caza de bugs (3 vueltas):**

- Vuelta 1 (servidor y coste; usuario): menos memoria (los hilos de las contraseñas se cierran sin uso), menos consultas en
  el tablero, plan para IA sin adjuntos repetidos, Alt+flechas que solo deshace lo suyo, el detalle que vuelve atrás si el
  cambio de tipo no se guarda, avisos de asignación que cuentan bien, «Más roles…» que se pliega, columnas que no saltan
  al arrastrar.
- Vuelta 2 (atacante; administración, instalación y coste): topes contra el envío masivo de emails de «¿Olvidaste tu
  contraseña?» y de códigos de verificación, topes de terceros protegidos, aviso de Railway sin margen de apagado, el
  script de las e2e que ya no se cuelga.
- Vuelta 3 (todo lo cambiado en la ronda): los topes nuevos podían usarse para bloquear a alguien; se rediseñaron (el
  primer email del día y los pedidos desde un dispositivo conocido siempre salen). Y dos arreglos más del detalle.

**Comprobado en local:** tipos, lint, traducciones, pruebas unitarias, pruebas con base de datos y las pruebas en
navegador (resultado en el informe final).

## Prompt inicial para la sesión nueva (Claude Code web)

La versión con tus términos de privacidad está en tu repositorio privado. Esta no los lleva porque este repositorio es
público: añádelos tú al pegarlo.

```text
Vamos a seguir con Pizarro en la nube (Claude Code web). Antes de nada:
1. Lee entero el núcleo de docs/HANDOFF.md (§0 «Arranque», §6 «Estado y pendientes» con el estado de la ronda 67 y las preguntas abiertas), el índice del manual (grep -n '^#' docs/MANUAL.md), e2e/README.md, docs/PRUEBAS-CHROME.md y YATERMINE.md. Los anexos de docs/handoff/ léelos solo cuando toque su tema.
2. Prepara el entorno de la nube siguiendo la §0 (PostgreSQL 16, .env, npm ci, migraciones) y dime si falta algo.
3. Confírmame la versión actual (package.json y el primer bloque de changelog.json) y que tu rama está igual que origin/main.
4. Resúmeme en una lista corta lo que quedó pendiente de la ronda 67 y las decisiones que tengo que tomar, con tu recomendación en cada una.
5. Después espera a que te mande la siguiente ronda.

Reglas fijas: respóndeme siempre en español, claro y sin tecnicismos innecesarios. Commits con el mensaje terminado en la línea «Co-Authored-By: Claude <noreply@anthropic.com>» y con la dirección anónima de GitHub como autor, nunca mi email. Nada de datos personales míos (nombre, email, dominios) en ficheros, commits ni PR, y nada de enlaces de sesión ni nombres de modelos; antes de cada fusión, el grep de privacidad con los términos que te daré. Minutos de GitHub Actions solo al final (la PR y la Release): las comprobaciones se pasan en local.
```
