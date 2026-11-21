# Prompts para Claude in Chrome

Pruebas que hace Claude in Chrome en el navegador del propietario (Cloudflare, Railway, la web). Cada prompt va en su propia
conversación de Claude in Chrome. Orden recomendado: 1, 2 y 3 (el 3 usa la instalación de prueba que crea el 2). Cuando
el propietario pase los informes, se apunta aquí lo que ya está hecho y se actualizan los prompts que sigan pendientes.

Estado tras la ronda 59 (v1.63.0): los tres pendientes.

## 1. Cloudflare (ofuscación de emails) y revisión del bucket de R2

```text
Necesito que hagas dos cosas en mi cuenta de Cloudflare, que ya tengo abierta en este Chrome. Trabaja en una pestaña nueva, no cambies nada que no te pida y, si algo no coincide con lo que te describo, para y pregúntame antes de seguir.

Contexto: tengo una aplicación web (Pizarro) en Railway. Su dominio está en Cloudflare con el proxy activado (nube naranja). Pizarro guarda sus copias de seguridad cifradas en un bucket de Cloudflare R2.

PARTE 1 · Desactivar la ofuscación de emails (Email Address Obfuscation)
1. En el panel de Cloudflare, entra en la zona (el dominio) donde está Pizarro. Si tengo varias zonas y no sabes cuál es, enséñame la lista y pregúntame.
2. Busca el ajuste «Email Address Obfuscation». Antes estaba en Scrape Shield; en el panel nuevo puede estar en Security → Settings o en otro sitio, así que usa el buscador del panel si no lo ves.
3. Desactívalo solo en esa zona. No toques ningún otro ajuste: ni Scrape Shield, ni el WAF, ni la caché.
4. Compruébalo en una página donde salga un email: abre Pizarro en https://<mi dominio>/settings (ya tengo la sesión iniciada; si no, para y pídeme que entre yo) y recárgala. En el HTML de la página no debe aparecer `__cf_email__` ni un script `email-decode.min.js`. Puede tardar un par de minutos en notarse; si sigue apareciendo, espera y vuelve a mirar una vez. No copies en tu resumen ningún email de la página.

PARTE 2 · Revisar el bucket de R2 (solo mirar, sin cambiar nada)
Quería activar el versionado del bucket para que un borrado accidental o malicioso no se lleve las copias. Antes de tocar nada, necesito saber qué hay:
1. Ve a R2 Object Storage y dime qué buckets tengo, con su tamaño y número de objetos. El de Pizarro tiene ficheros terminados en `.pzbak` y `.pzbak.json` y una carpeta con muchos objetos de ficheros. Si no está claro cuál es, pregúntame.
2. En los ajustes de ese bucket, dime:
   a. Si existe alguna opción de «versionado» (Object versioning) y cómo se llama exactamente. No la actives.
   b. Si hay reglas de ciclo de vida (Object lifecycle rules) y qué hace cada una (prefijo, a los cuántos días, qué acción). Avísame si alguna borra objetos: podría romper las copias de Pizarro.
   c. Si hay reglas de bloqueo (Bucket locks) y cuáles.
   d. Si el bucket es público (dominio público o r2.dev activado). Debería ser privado.
3. En «Manage R2 API Tokens» dime qué tokens hay, con su nombre, sus permisos (Admin, Object Read & Write…) y a qué buckets afectan. No me enseñes ningún secreto ni crees ni borres tokens.

No cambies nada en R2. Termina con un resumen breve:
- Parte 1: hecho o no, y cómo lo has comprobado.
- Parte 2: lo que has visto en los puntos a, b, c y d y en los tokens, y cualquier cosa que te parezca un riesgo.
```

## 2. Instalar Pizarro desde cero solo con getpizarro.com (Railway, proyecto de prueba)

```text
Quiero comprobar si alguien sin experiencia puede instalar Pizarro desde cero usando solo la web del producto. Haz de usuario nuevo: empieza en https://getpizarro.com y usa únicamente lo que cuenta esa web y las páginas a las que enlaza. No uses lo que sepas de antes sobre Pizarro, y no busques fuera ni leas el código, salvo que la web te mande allí. Trabaja en una pestaña nueva.

Como desde el navegador no puedes abrir una terminal ni entrar en un servidor, sigue el camino de Railway («sin servidor propio»). Ya tengo cuentas en Railway y en GitHub con la sesión iniciada en este Chrome.

Reglas de seguridad (muy importantes):
- En Railway crea un proyecto NUEVO llamado `pizarro-prueba-instalacion`. No abras, cambies ni borres ningún otro proyecto ni servicio que ya tenga: uno de ellos es mi instalación real.
- Antes de cualquier paso que cueste dinero más allá del uso normal (cambiar de plan, añadir tarjeta, comprar un dominio), para y pregúntame.
- Las claves que generes (SESSION_SECRET, TOKEN_SECRET, ENCRYPTION_KEY, BACKUP_KEY) son solo para esta prueba: no las pongas en tu resumen.
- Si la guía te pide abrir una terminal (por ejemplo para `openssl rand`), apúntalo como un obstáculo para quien solo tiene el navegador. Después busca la forma más sencilla de seguir, por ejemplo generando claves aleatorias con `crypto.getRandomValues` en la consola del navegador, y apunta qué has hecho.
- En el asistente `/setup`, como administrador usa el nombre «Admin Prueba» y el email `admin-prueba@example.com`, con una contraseña aleatoria que solo uses aquí.
- Cuando Pizarro pida activar la verificación en dos pasos, para y avísame: escanearé yo el código QR con el móvil y te diré cuándo seguir.
- Al terminar no borres el proyecto de prueba: pregúntame primero.

Qué hacer:
1. Desde la portada, encuentra la guía de instalación y síguela paso a paso, tal como está escrita.
2. Llega hasta tener Pizarro funcionando: asistente terminado, sesión iniciada como administrador y un proyecto creado con una tarea.
3. Mientras avanzas, apunta cada obstáculo: un paso confuso, un nombre de botón de Railway que no coincide con la guía, algo que falta, un error, una espera larga sin explicación, un enlace roto o algo que hayas tenido que deducir. Apunta también lo que haya ido especialmente bien.
4. Echa un vistazo, solo leyendo, al camino de «servidor propio» de la misma guía. Dime si crees que alguien sin experiencia lo entendería y dónde se atascaría.

Termina con un informe en español:
- Resultado: ¿se puede instalar solo con la web? Sí, sí con ayuda o no.
- Tiempo total aproximado y tiempo de espera de Railway.
- Lista de obstáculos, ordenada de más a menos grave. En cada uno: la página y la sección de la guía, lo que decía, lo que encontraste en realidad y una propuesta de texto o de cambio.
- Lo que ha ido bien.
- La dirección del proyecto de prueba en Railway (sin claves), para que decida si lo borro.
```

## 3. Pruebas en real de las versiones 1.62.0 y 1.63.0 (sobre la instalación de prueba)

```text
Quiero que pruebes en real las novedades de la última versión de Pizarro, como lo haría una persona en el navegador, y me des un informe. Trabaja en una pestaña nueva y, si algo no coincide con lo que te describo, para y pregúntame.

Dónde probar (muy importante):
- Usa la instalación de PRUEBA en Railway, el proyecto `pizarro-prueba-instalacion`, que creaste tú al probar la instalación desde getpizarro.com. Si no existe, para y pregúntame: lo creamos primero con el otro prompt.
- No toques mi instalación real ni ningún otro proyecto de Railway. En mi instalación real solo puedes MIRAR (abrir páginas y menús y cerrarlos), nunca crear, borrar, reiniciar ni cambiar ajustes.
- Antes de cualquier paso que cueste dinero más allá del uso normal, para y pregúntame.
- Si tienes que iniciar sesión, usa el administrador de prueba (`admin-prueba@example.com`). Si no recuerdas su contraseña, para y pídeme que entre yo.

Primero, en la instalación de prueba:
0. Comprueba la versión en *Historial de versiones* (debe ser la última publicada, la v1.63.0). Si es más antigua, en Railway, en el servicio de Pizarro del proyecto de prueba, mira que la rama sea `stable` y pulsa «Deploy» o ⌘K → «Deploy Latest Commit». Espera a que termine.

Pruebas:
1. **Arranque con la base de datos parada (solo en el proyecto de prueba).** En Railway, en `pizarro-prueba-instalacion`, reinicia a la vez el servicio de PostgreSQL y el de Pizarro (o detén Postgres un minuto y reinicia Pizarro). Mira los logs del despliegue de Pizarro.
   Qué debe pasar: salen avisos «PostgreSQL aún no responde… Se reintenta cada 3 s» y, en cuanto la base responde, Pizarro arranca solo, sin quedarse en «Crashed». Apunta cuánto tarda.
2. **Releases y Documentación.** Crea un proyecto de prueba con 3 tareas en la columna «Siguiente salto a producción», genera una release y márcala como desplegada (confirma con «Marcar como desplegado»). En *Releases*, abre la release: *Borrar adjuntos* y *Borrar release* deben estar en el botón ⋯ al final de la fila Copiar/.md/.txt, no a la vista. En *Documentación*, sube un fichero de texto: cada fila tiene ⋯ con *Descargar* y *Enviar a la papelera*.
3. **PDF grande.** En ese proyecto, crea unas 60 tareas (puedes usar «Varias tareas» pegando 60 líneas) en una columna, ponle el rol «Lista consolidada» o «Entrega al cliente» desde el menú ⋯ de la columna, y genera su PDF. Debe salir en pocos segundos, con «N / M» en el pie de cada página. Cierra la pestaña del PDF a la mitad de otra generación y comprueba que la app sigue respondiendo.
4. **Modo oscuro.** En *Mi perfil*, elige el tema oscuro. Abre el menú ⋯ de una columna: «Borrar columna» en rojo debe leerse bien. Abre el selector de proyectos: «Nuevo proyecto» y «Ver proyectos existentes» deben leerse bien.
5. **Redirección tras iniciar sesión.** Cierra sesión y abre `<dirección de prueba>/login?next=/.//example.com`. Inicia sesión: debes quedarte en Pizarro, no ir a example.com.
6. **Sin email configurado.** Cierra sesión y pulsa «¿Olvidaste tu contraseña?»: si la instalación no tiene email, debe mostrar la orden `cd /opt/pizarro/deploy && docker compose exec app node dist/reset-link.mjs <email>` y un enlace a la guía. Comprueba que el enlace lleva al apartado «Nadie puede entrar como administrador» de getpizarro.com.
7. **Inglés.** En *Mi perfil*, cambia el idioma a inglés y recorre el tablero, el menú y *Administración*: botones «Sign in»/«Sign out», plurales bien escritos (nada de «card(s)»). Vuelve a español al terminar.
8. **Mirar sin tocar en mi instalación real (opcional, hazlo al final):** abre una release del histórico y el menú ⋯, y ciérralo sin pulsar nada. Comprueba en *Historial de versiones* que tiene la última versión.

9. **Miembros e invitaciones (v1.63.0).** En el proyecto de prueba, *Ajustes del proyecto → General*:
   - Añade como miembro al administrador de prueba: debe salir con la marca «admin».
   - Usa «Invitar por email» con `invitado-prueba@example.com`: aparece un recuadro con el enlace y «Copiar enlace». Abre ese enlace en una ventana de incógnito, elige una contraseña y comprueba que entras directamente en el tablero del proyecto. (Si la instalación no tiene email, es normal que solo salga el enlace.)
10. **Releases (v1.63.0).** En *Releases*, al desplegar una release se ve «Cargando…» un momento y después el texto; Copiar, .md y .txt funcionan.
11. **Calendario (v1.63.0).** En *Calendario → Suscribirse*, genera un enlace: debe decir «Aún no se ha usado». Pulsa «Regenerar enlace» y «Desactivar»: los dos piden confirmación y la confirmación se ve entera (no queda tapada).
12. **Mis tareas (v1.63.0).** El grupo y el filtro dicen «Próximos 7 días».
13. **Administración (v1.63.0).** En *Administración → Logs*, las categorías salen con nombre (Acceso, Acciones, Sistema…), «Cargar más» funciona y «Descargar CSV» baja un fichero. En *Integraciones → Email*, si la instalación de prueba no tiene `APP_URL`, debe salir un aviso.
14. **Inglés americano (v1.63.0).** Con el idioma en inglés, busca «licence», «organisation» o «programme»: no debe aparecer ninguno (debe decir license, organization, program).

Termina con un informe en español: para cada prueba, «bien», «mal» o «no se pudo», con lo que viste (texto exacto de los avisos y tiempos) y una captura descrita si algo falla. Al final, lista lo que te haya parecido confuso para alguien nuevo. No borres el proyecto de prueba de Railway: pregúntame.
```
