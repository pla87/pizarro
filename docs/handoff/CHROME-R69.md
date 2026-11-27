# Informes de Claude in Chrome antes de la ronda 69 (v1.72.0)

Anexo de `docs/HANDOFF.md`. Sesión local del 25–26 nov 2026 en el PC del propietario, con Claude in Chrome sobre la
instalación de PRUEBA de Railway. Se pasaron los prompts 1 (pruebas en real), 2 (auditoría como usuario) y 3 (DMARC)
de `docs/PRUEBAS-CHROME.md`; el 4 (WhatsApp real), no. Sin datos personales ni direcciones de «Compartir fuera».

**Para la sesión siguiente (nube):** lee el núcleo de HANDOFF y este anexo. La ronda 69 parte de lo que hay aquí
(resumen, propuesta y detalle) más lo que mande el propietario. Lo marcado «PENDIENTE (propietario)» lo hace él a mano.


Detalle de cada paso: secciones «Prompt 1», «Prompt 2» y «Prompt 3» más abajo.

## Resumen

### Funciona bien
- Railway desplegó la v1.72.0 desde stable; Historial dice v1.72.0.
- «Compartir fuera» de punta a punta: activar, rol, pie, caducidad, «Generar web», la página sin cuenta (marcar hecha, fecha, comentar, descargar), el tablero en vivo, avisos firmados «Proveedor (fuera)», Ctrl+Z de Persona Prueba, «Actualizar web» con la misma dirección, revocar, apagar con confirmación, PDF del proyecto y Logs con «/x/…».
- Deshacer de la descripción, «Solo se puede deshacer el último cambio…», ↶; cambio de tipo con plantilla y su «Deshacer» sin prefijo; «Deshacer todo».
- Columnas con Alt+flechas (un aviso que se actualiza), roles de Casa y familia en orden, «Organizar por personas» (antes de «Hecho», Ctrl+Z/Ctrl+Y), «Descargar plan (PDF)», plan para IA (prioridad y etiquetas comunes en el contexto, «Depende de: la tarea 1», «Adjuntos:» al final), Copias (notas sin variables), Logs («Descargar CSV», «Limpiar» apagado, sin descargas por abrir imágenes), /admin/types «No encontrado».
- Varias tareas con tipo por línea, bloqueos con «Bloquea a» y «← Volver», orden de proyectos, Calendario, Mis tareas, Historial (buscador y #vX.Y.Z).

### Falla
1. Imagen pegada dentro del párrafo (causa común): en la web de «Compartir fuera» sale en línea con el texto (lo que viste), en el plan para IA queda «…la tabla.imagen `adjuntos/…`» y en la release «…la tabla.![…](/api/attachments/…)» (enlace interno que fuera no funciona).
2. Mi perfil → Plantillas: «Descartar cambios» del aviso «Cambios sin guardar» no hace nada (ni descarta ni cambia de pestaña); después el navegador sigue avisando al salir.
3. Conflicto de descripción con la misma persona en dos pestañas: no sale el aviso ámbar previo; solo al guardar sale el rojo «Has cambiado el texto… en otra pestaña…».
4. Ajustes del proyecto → Miembros: tras «Quitar» a Invitado Prueba sigue el recuadro de su invitación caducada.
5. «Nueva tarea» (cabecera o «+» de una columna sin tipo por defecto) pone el tipo y el prefijo solos: «Comprar Arreglar la persiana», «Obra: …» (pregunta abierta 4).
6. «Generar web» con la columna vacía publica «0 tareas».
7. Errata de serie: «lo que necesitas de mi» → «de mí» (tipo Respuesta).

### Confunde
- Web de «Compartir fuera»: no dice quién la comparte; fotos adjuntas solo como enlace (sin miniatura); muestra los encabezados vacíos de la plantilla; el mensaje de confirmación sale arriba y la página salta a la tarea; «ha caducado» también cuando se revoca.
- Tras añadir tareas a la columna, la web no se actualiza y el tablero no avisa de que hay cambios sin publicar.
- Un miembro que no es administrador puede revocar el enlace (lo hizo Persona Prueba) y el admin no se entera.
- El aviso «Solo se puede deshacer el último cambio…» sale en rojo como si fuera un error.
- Lo que pidió el propietario: diálogo «Web de «…»» feo y sin botón «Abrir»; pie con texto largo; botón «Link» del color de «Actualizar web» y con texto.
- Avisos de mover sin «Deshacer» (el prompt 12 esperaba lo contrario: es por diseño; solo la asignación lo lleva).
- «Nueva tarea» manda la imagen pegada a adjuntos; el detalle la mete en el texto.
- Texto en negrita al escribir detrás de un encabezado de plantilla.
- «(admin, no miembro; lo tiene en su lista)» en Administración → Proyectos.
- Leyenda del Calendario abajo y sin explicar el rojo; en Mis tareas la columna parece una persona.
- «Añadir columna» la pone detrás de «Hecho».
- «Release con selección» en proyectos de casa (pregunta 6).

### Pendiente para el propietario (Claude in Chrome no puede)
- Prompt 1 paso 6 (ventana privada y móvil): usar la web de la columna «Fontanero» del proyecto «Casa R69» (activa).
- Paso 9 (Ctrl+V real de una captura en la descripción, pegar con el foco en el título y arrastrar un archivo).
- Paso 12-bis (dos avisos de asignación seguidos: el primero se apaga, ratón encima, Tab+Intro).
- Paso 16 (menú «PDF de la semana» en una pantalla muy ancha).
- Paso 21 (cerrar sesión y entrar con la verificación en dos pasos).
- Prompt 3: volver a mirar DMARC dentro de unos días.

### Lo creado en la instalación de prueba (no se ha borrado nada; preguntar antes)
Proyecto «Casa R69» (con columnas de personas, «Fontanero» con web activa y varias tareas); en «Proyecto de prueba»: columna «Proveedor» con 3 tareas, Persona Prueba como miembro, «Prioridad» activada, etiqueta «informes», prioridad/etiqueta/bloqueo en las dos tareas de «Para la IA», «Compartir fuera» APAGADO al final.

## Propuesta para la ronda 69 (la que se le dio al propietario)

1. Lo que pidió del diálogo y del pie de «Compartir fuera»: diálogo más cuidado con botón «Abrir» (la web en otra
   pestaña), aviso del pie más corto, botón del enlace del mismo color que «Actualizar web», con el texto «Link» además
   del icono, y «Actualizar web» algo más estrecho para que quepan los dos.
2. Imagen pegada o soltada como bloque propio (partir el párrafo) en el editor; de paso, en `src/lib/ai-plan.ts`
   (≈ línea 308) y en el .md/.txt de la release, la imagen en su propia línea y como ruta del ZIP; en la web de
   «Compartir fuera», img como bloque y miniaturas de las imágenes adjuntas.
3. «Compartir fuera»: no generar con la columna vacía (botón apagado con motivo, como «PDF de la semana»), aviso de
   «cambios sin publicar» en el pie, una línea arriba en la web con quién la comparte, sin los encabezados vacíos de la
   plantilla (como `withoutEmptyFormSections` del plan) y decidir si un miembro no administrador puede revocar
   (pregunta para el propietario).
4. Fallos: «Descartar cambios» de Mi perfil → Plantillas (`src/components/ReleaseTemplateList.tsx`,
   `src/components/useUnsavedChangesGuard.ts`), aviso ámbar de conflicto con la misma persona en dos pestañas
   (`src/components/board/TaskDialog.tsx` ≈ 1975–1998), recuadro de invitación que queda tras «Quitar», errata «de mí»
   (`src/lib/kinds-localize.ts:26`; cuidado con el reconocimiento del texto de serie en instalaciones existentes).
5. Preguntas abiertas recomendadas de HANDOFF §6: 2g, 3, 4 (el prefijo solo en «Nueva tarea») y 8.
6. `docs/PRUEBAS-CHROME.md`: reescribir el paso 12 (los avisos de mover no llevan «Deshacer» por diseño; solo los de
   asignación) y el paso 13 (en Casa y familia todos los tipos tienen plantilla: usar un proyecto con un tipo sin
   plantilla); actualizar «Estado» con lo de este anexo.

## Prompt 1 — pruebas en real (detalle)


0. BIEN. Railway (proyecto de prueba): v1.72.0 activa, «Deployment successful». Historial: «Versión actual: v1.72.0».
1. (en curso) Ajustes → Tablero → «Permitir columnas «Compartir fuera»»: aviso ««Compartir fuera» activado». OBS: el aviso sale arriba, tapando a medias el botón «Nuevo tipo».
   Preparación: columna «Proveedor» con 3 tareas (caldera: imagen en la descripción por pegado simulado + subtarea + fecha; grifo: adjunto .txt + comentario; radiadores: asignada a Persona Prueba). Persona Prueba no era miembro: añadida en Ajustes → General (aviso «Miembro añadido» + recuadro «Enlace al tablero para pasárselo a Persona Prueba»).
   BIEN. Rol de la columna ›: «Compartir fuera» es el último; title = «Sus tareas se publican en una web sin cuenta para alguien de fuera: botón «Generar web» al pie.». Al elegirlo sale el icono de globo junto al contador.
   OBS: en «Añadir columna» de este proyecto no sale «Organizar por personas» (proyecto sin miembros entonces).
2. BIEN. Pie: «Generar web» + «Se publican la descripción, las subtareas, los comentarios y los adjuntos de estas tareas; los adjuntos se podrán descargar.» + selector. Ciclo: «Caduca tras 3 meses sin uso: pulsa para cambiarlo» → «7 días» → «1 mes». Diálogo «Web de «Proveedor»»: «Se han publicado 3 tareas.», «Cualquiera con esta dirección puede ver estas tareas, marcarlas como hechas, cambiar su fecha, comentar y descargar sus adjuntos, sin cuenta.», dirección, «Copiar», «Enviar por email», «Vale hasta el 25 dic 2026 si nadie la usa (abrirla o actualizarla cuenta como uso).», «Revocar enlace». Globo: «Compartir fuera: Enlace activo hasta el 25 dic 2026». Tras generar, el botón pasa a «Actualizar web».
   OBS: el selector de caducidad es una pastilla diminuta pegada al texto del aviso; cuesta verla y no parece un botón.
3. BIEN con detalle. Página «Proveedor · 3 tareas»: descripción, imagen, subtareas, adjuntos, comentarios («Admin · 25 nov, 22:43»), responsable «Persona» (solo nombre de pila), pie «Este enlace deja de funcionar si nadie lo usa hasta el 25 de diciembre de 2026.». No se ve nada más del proyecto (ni su nombre).
   FALLO VISUAL: la imagen de la descripción sale en línea con el texto: el párrafo queda abajo a la izquierda, alineado con el pie de la imagen, y un hueco blanco encima (en la app sale debajo, como bloque).
   OBS: la imagen de la descripción se llama «panel-caldera.png» (alt/enlace) y en ADJUNTOS sale «panel-caldera.webp»: parecen dos ficheros.
   CONFUSO: la página no dice qué es ni quién la comparte (solo «Proveedor»); alguien de fuera no sabe de quién es.
4. BIEN. «Marcar como hecha» → «Tarea marcada como hecha.» y etiqueta «Hecha»; «Cambiar fecha» → «Fecha cambiada.»; comentario con @Admin → «Comentario publicado.». Adjunto: responde 200, «attachment», nombre «grifo-modelo.txt», text/plain (comprobado con fetch; no descargué al disco).
   OBS: tras cada acción la página salta al ancla de la tarea; el mensaje de confirmación sale arriba del todo y, si la tarea está abajo, no se ve.
   Tablero SIN recargar: «Purgar los radiadores» arriba de «En producción» (la columna terminada); grifo con «10 dic». Detalle: comentario firmado «Proveedor (fuera)», historial «Proveedor (fuera) Comentó en «Revisar la caldera»»; la mención sale como texto plano.
   Avisos del admin: «Proveedor (fuera) ha comentado en…» y «Proveedor (fuera) ha cambiado la fecha límite de… Sin fecha → 10 dic 2026». PREGUNTA: el «marcar como hecha» no le llega al admin (que creó y sigue las tres tareas); ¿solo al responsable?
5. BIEN (lo hizo el propietario como Persona Prueba): campana con «Proveedor (fuera) ha marcado como hecha «Purgar los radiadores»» (sin avatar, solo icono); Ctrl+Z devuelve la tarea; ve la misma dirección.
   PROPIETARIO pide (ronda 69):
   - Diálogo «Web de «…»»: «es feo, hay que mejorarlo» y falta un botón para ABRIR la web en otra pestaña.
   - Página pública: la foto debe ir DEBAJO del texto (coincide con mi fallo visual del paso 3).
   - Pie de la columna: el texto del aviso es demasiado largo; el botón del enlace (icono de cadena) debe ser del mismo color que «Actualizar web» y decir «Link» además del icono; estrechar «Actualizar web» y ensanchar el de enlace para que quepa.
6. PENDIENTE (propietario: ventana privada y móvil). Se hace antes del 7 porque el 7 revoca el enlace.
8. BIEN. PDF del proyecto (se abre en pestaña): cabecera «Compartidas fuera: «Proveedor» (enlace activo, caduca el 25 dic)»; en Pendiente «Proveedor · 3 · compartida fuera». Sin dirección.
11. BIEN con detalle. Ventana 1920 px: pie «Deshacer todo». Borrar descripción → «Descripción borrada» + «Deshacer» → «Deshecho el cambio de descripción en «…»». Borrar otra vez + cambiar color + «Deshacer» del aviso → «Solo se puede deshacer el último cambio: usa la flecha ↶ de arriba.». Con ↶ dos veces: «Deshecho el cambio de color…», «Deshecho el cambio de descripción…».
   CONFUSO: ese «Solo se puede deshacer el último cambio…» sale como aviso ROJO de error; no es un error, es una indicación (mejor el estilo normal o ámbar).
   OBS: el botón «Deshacer» del aviso de la descripción seguía activo tras cambiar el color (el cambio de color no da aviso propio).
12. DIFERENTE de lo que dice el prompt. Mover con «Columna» en el detalle: solo «Guardando…/Guardado», sin aviso de mover. «Mover a…» de 1 tarjeta: «1 tarea movida a «En progreso»» SIN «Deshacer»; el segundo aviso sustituye al primero. Alt+→: «Movida a «Siguiente salto a producción»» sin «Deshacer». «Mover a…» de 2: «2 tareas movidas a «Para la IA»». Ctrl+Z: «Deshecho: 2 tareas vuelven a su columna»; Ctrl+Y: «Rehecho: 2 tareas movidas a «Para la IA»». Según el código (Board.tsx:1147/1274, cardActions.ts:144) los avisos de mover NO llevan «Deshacer»; solo los de asignación (assignNotice). El prompt 12 está mal planteado: se reescribe para la columna «Asignación a persona».
13. BIEN en lo que se pudo. Proyecto nuevo «Casa R69» (plantilla Casa y familia). Todos sus tipos (Compras, Casa, Papeleo, Cita, Reforma u obra, Mudanza) tienen plantilla, así que el caso «plantilla de la descripción quitada» NO SE PUDO probar aquí. Reforma u obra → Casa: «Tipo cambiado: 4 subtareas quitadas y plantilla de la descripción aplicada» + «Deshacer» → «Deshecho el cambio de tipo de «Arreglar la persiana»» (sin prefijo «Obra:»). Igual con Compras.
   FALLO (pregunta abierta 4): en un proyecto recién creado, «Nueva tarea» de la cabecera elige solo el tipo «Compras» y el título queda «Comprar Arreglar la persiana» sin que lo pidas.
15. BIEN. Rol de la columna ›: «Sin rol | Planificación semanal | Asignación a persona | Lista consolidada | Esperando (avisa si tarda) | Rutinas | Presupuesto (suma el coste)». «Organizar por personas»: «Se crearán 2 columnas «Asignación a persona», una por persona (Admin Prueba, Persona Prueba): lo que entre en cada una será de esa persona.» + «Las tareas que pongas en estas columnas salen de su columna actual.»; aviso «2 columnas creadas: Admin Prueba y Persona Prueba»; quedan justo antes de «Hecho». Ctrl+Z: «Deshecho: Creó 2 columnas «Asignación a persona»» (desaparecen); Ctrl+Y: «Rehecho: …».
   OBS: en la lista de roles de un proyecto Casa y familia no sale «Compartir fuera» hasta activarlo en Ajustes → Tablero; nada en el menú dice que existe.
16. (parte) BIEN. «Esta semana» vacía: botón apagado con «No hay tarjetas en «Esta semana»» debajo; pulsarlo no da aviso ni abre menú. Ventana muy ancha: PENDIENTE (propietario).
22. BIEN con fallos menores. En «Casa R69» (proyecto recién creado, el creador NO queda como miembro: «Sin miembros. Los administradores lo ven sin ser miembros.»). Añadirme: sin recuadro de enlace (el aviso se fue antes de leerlo; el código dice «Te has añadido al proyecto»). Persona Prueba: «Miembro añadido». Invitado Prueba (invitación pendiente y CADUCADA): sale «La invitación de Invitado Prueba ha caducado: genera un enlace de invitación nuevo para pasárselo.» + «Generar enlace de invitación nuevo» (no el texto «vale 72 horas»). Nota sin email: «Pizarro no puede enviar emails desde aquí. Para que entre, pulsa el botón del enlace junto a su nombre y mándale tú el enlace nuevo (por WhatsApp, por ejemplo). Al generarlo, el anterior deja de funcionar.»
   CONFUSO: la nota dice «el botón del enlace junto a su nombre», pero junto al nombre solo está «Quitar»; el botón está abajo, en el recuadro.
   FALLO: tras «Quitar a Invitado Prueba» («Miembro quitado») sigue el recuadro «La invitación de Invitado Prueba ha caducado…» con su botón.
23. BIEN. /admin/types → «No encontrado · La página no existe o no tienes acceso.»
12-bis (avisos con «Deshacer» de verdad: columna «Asignación a persona»): «Mover a…» → columna Persona Prueba: «Asignada a Persona Prueba · DESHACER». El caso «dos avisos seguidos, el primero se apaga, hover, Tab+Intro» NO SE PUDO con fiabilidad desde la extensión (el aviso dura pocos segundos y cada paso mío tarda más): PENDIENTE para el propietario.
   OBS (pregunta abierta 6): en «Casa R69» la barra de selección ofrece «Release con selección» aunque el proyecto no tiene releases.
   FALLO (pregunta 4, otra vez): el «+» de «Por hacer» (sin tipo por defecto) abre con el último tipo usado («Reforma u obra») y el título ya escrito «Obra: ».
14. BIEN. Foco en «Esperando», Alt+→ ×3: «Esperando» va ahora después de «Lista de la compra» → «…de «Citas»» → «…de «Rutinas»» (un solo aviso que cambia). Alt+← hasta el principio: ««Esperando» va ahora la primera». La devolví a su sitio.
17. BIEN. Botón «Descargar plan (PDF)» (title «PDF con las tareas de la persona en esta columna, por vencimiento»); aviso «Plan de Persona Prueba descargado»; fichero «plan-persona-prueba-2026-11-25.pdf» (3 KB, 1 página). Texto del PDF: «PLAN DE TAREAS / Plan de Persona Prueba / Persona Prueba · Casa R69 · 25 nov 2026 · 2 tareas / Sin fecha (2) / Obra: Arreglar la persiana (con sus 4 subtareas) / Cambiar bombilla del pasillo». «Generando PDF…» no lo llegué a ver (fue muy rápido).
   Truco para PDF: envolver URL.createObjectURL y HTMLAnchorElement.click, y descomprimir el stream FlateDecode con DecompressionStream('deflate'); las fuentes son Helvetica sin incrustar y el texto sale en hex dentro de TJ.
18. BIEN con un FALLO. Preparación: «Prioridad» activada en Ajustes (aviso «Proyecto actualizado»), etiqueta «informes»; tarea 1 con imagen pegada (pegado simulado) + adjunto .txt + Alta + informes; tarea 2 «Bloqueada por» la 1 + Alta + informes. Paso 2 (Markdown copiado con «Copiar todo»): contexto con «Prioridad de todas las tareas: Alta» y «Etiquetas de todas las tareas: informes» (no se repiten en cada tarea); «Adjuntos: 2 archivo(s) en el ZIP «adjuntos/…»…»; tarea 1: imagen como «imagen `adjuntos/01-…/boceto-csv.webp`», «**Adjuntos:**» al final tras el checklist; tarea 2: «- **Depende de:** la tarea 1» sin título. Cerrado sin guardar.
   FALLO: la imagen pegada con el cursor al final del párrafo queda DENTRO del párrafo y el plan la escribe pegada al texto: «…con las mismas columnas que la tabla.imagen `adjuntos/…/boceto-csv.webp`» (sin espacio ni salto). Misma causa que la foto «en línea» de la web de «Compartir fuera» (paso 3) y lo que pidió el propietario: el pegado inserta la imagen en línea dentro del párrafo. Arreglo: al pegar o soltar una imagen, insertarla como bloque propio (partir el párrafo) y, por si acaso, en ai-plan.ts:308 separar con salto de línea cuando la imagen va tras texto; en la página pública, img como bloque.
   OBS: en la vista previa del paso 2, el checklist sale como «Tarea: Botón Descargar CSV / Botón Descargar CSV» en el texto accesible (la etiqueta de la casilla repite el texto).
13 (Logs). BIEN: «Cambió el tipo de «Arreglar la persiana» a «Casa»» y «Deshizo: Cambió el tipo de…», sin el prefijo «Obra:».
19. BIEN. «i» de «Descargar»: «Baja solo la base de datos, cifrada: para abrirla hace falta la clave de las copias. Restaurar una copia completa lo hace quien instaló Pizarro, con los pasos de «Restaurar» de la guía de instalación.» (sin variables). «Para quien instala»: «Carpeta UPLOAD_DIR/backups. Para restaurar una copia: pasos de «Restaurar» de la guía de instalación (variable BACKUP_KEY y node dist/restore.mjs).» (difiere un poco del prompt; bien).
20. BIEN. «Descargar CSV» con descripción «Con el periodo y los filtros de la lista»; «Limpiar» apagado (aria-disabled) con «No hay filtros aplicados». «Descarga» de hoy: solo las 2 de «grifo-modelo.txt» desde la web de «Compartir fuera»; ninguna a mi nombre por abrir tareas con imagen.
   Logs «shareOut»: generate («Generó la web de «Proveedor» (3 tareas)», «Actualizó…», «Creó un enlace nuevo…»), setExpiry («Cambió la caducidad de la web de «Proveedor» a 30 días / 7 días / … sin uso»), getLink («Abrió el enlace de la web de «Proveedor»» = abrir el diálogo), revoke («Revocó el enlace…»), done/due/comment («Proveedor (fuera): marcó «Purgar los radiadores» como hecha», «…cambió la fecha de…», «…comentó en…»), download («Descarga de «grifo-modelo.txt» desde la web de «Compartir fuera»»). Las rutas públicas salen «/x/…» (nunca la dirección completa). BIEN.
   OBS: las líneas de descarga no dicen quién (las demás de fuera llevan «· Proveedor (fuera)»). No hay línea cuando alguien abre la web pública (si se quiere saber si el proveedor la ha visto, faltaría).
   HALLAZGO: Persona Prueba (miembro, no administradora) pudo REVOCAR el enlace (22:56, shareOut.revoke · Persona Prueba) y después, con «Actualizar web», el admin creó uno nuevo. ¿Debe un miembro poder revocar? (activar la función solo pueden los admins). Además, la dirección que tenía abierta en mi pestaña dejó de valer sin que yo lo supiera: el diálogo del admin no avisa de que otra persona lo revocó.
10. FALLO a medias. Misma persona (Admin Prueba) en dos pestañas, tarea «Cambiar bombilla del pasillo» (tipo Casa, con plantilla). A: «Editar» y escribe sin guardar. B: escribe y guarda. A: tipo → «Reforma u obra». Resultado en A: lo escrito sigue (mezclado con la plantilla nueva) y sale en ámbar «Tipo cambiado y plantilla aplicada; falta guardar la descripción», pero NO sale «La descripción guardada ha cambiado mientras escribías…» (el canal en vivo estaba abierto; B sí recibió el cambio de título de A). Al pulsar «Guardar descripción» en A, el servidor sí lo detecta: aviso rojo «Has cambiado el texto de esta tarea en otra pestaña u otro dispositivo mientras la editabas aquí. Se ha recargado con ese texto: vuelve a aplicar tus cambios.» + «Copiar tu texto»; queda lo de B (no se pierde nada guardado, pero lo escrito en A se va del editor).
   Sospecha: el cambio de descripción de B no llega a la pestaña A cuando es la MISMA persona (el aviso previo depende de `remote` en TaskDialog.tsx:1985-1998). Repro para la ronda 69 con una e2e de dos pestañas del mismo usuario.
7. BIEN. La dirección vieja (revocada por Persona Prueba) da «Enlace caducado / Esta lista de tareas ha caducado. Contacta con la persona que te ha dado el enlace.». Con la dirección vigente: saco «Cambiar el grifo» (Alt+←) y creo «Revisar el termo» en «Proveedor»; al recargar la web sigue el grifo y no sale el termo. «Actualizar web» (misma dirección, «Se han publicado 3 tareas.») y al recargar: sale el termo y no el grifo. «Revocar enlace» → diálogo propio «Revocar enlace / La web dejará de funcionar al momento para quien tenga el enlace. Podrás generar otro después. ¿Revocarlo?»; globo «Compartir fuera: Enlace revocado» (el prompt decía «Enlace caducado»: el texto real es mejor); la web: «Esta lista de tareas ha caducado…». «Generar web» otra vez (sin pedir confirmación). Ajustes: desmarcar → «Apagar «Compartir fuera» / Hay 1 enlace activo: dejará de funcionar al momento. ¿Apagarlo?» → «Apagar» → aviso ««Compartir fuera» apagado: 1 enlace ha dejado de funcionar». Logs: «shareOut.setProject · Apagó «Compartir fuera» en el proyecto «Proyecto de prueba»».
   OBS: la web revocada dice «ha caducado», aunque no haya caducado sino que la han revocado (para el proveedor da igual; quizá «ya no está disponible»).
   NOTA: «Compartir fuera» queda APAGADO en «Proyecto de prueba». Para el paso 6 de mañana hay que volver a activarlo y generar la web.

## Prompt 2 — auditoría como usuario (detalle)


0. v1.72.0 (comprobado en el prompt 1).

### 1. Compartir fuera: familia y fontanero (proyecto «Casa R69», plantilla Casa y familia)
Hecho: activar en Ajustes → Tablero; «Añadir columna» «Fontanero»; rol «Compartir fuera»; «Generar web» con la columna aún vacía; tres tareas (una con foto pegada en la descripción de «Nueva tarea» y nota; otra con foto adjunta y fecha; otra sin nada); abrir la web como fontanero; «Actualizar web»; marcar una como hecha.
- CONFUSO (grave para este uso): generé la web con la columna vacía («Se han publicado 0 tareas.») y luego añadí las tareas. El fontanero ve «No hay tareas en esta lista.» y el tablero no avisa de que la web está desfasada. Hay que acordarse de «Actualizar web». Propuesta: no dejar generar con la columna vacía (como «PDF de la semana», botón apagado con «No hay tarjetas en «…»») y avisar en el pie cuando hay cambios sin publicar («2 cambios sin publicar · Actualizar web»), o publicar solo al añadir/quitar tarjetas.
- CONFUSO: las fotos salen solo como enlaces en ADJUNTOS («fregadero.webp (1 KB)»): el fontanero tiene que descargarlas para verlas. Propuesta: miniaturas de las imágenes adjuntas en la página.
- CONFUSO: la plantilla del tipo «Casa» deja en la web los encabezados vacíos («Qué hay que hacer:» sin nada debajo). El plan para IA ya los quita (withoutEmptyFormSections); la web debería hacer lo mismo.
- CONFUSO: al escribir detrás de un encabezado de la plantilla (en negrita), el texto sale también en negrita («Material necesario: Junta o sifón…» todo en negrita).
- CONFUSO: en «Nueva tarea», pegar una imagen con el foco en la descripción la manda a «Capturas y adjuntos» (no al texto); en el detalle de una tarea ya creada sí entra en el texto. Dos comportamientos distintos para el mismo gesto.
- CONFUSO: la página no dice quién la comparte ni para qué («Fontanero · 3 tareas»). Propuesta: una línea arriba, p. ej. «Lista de tareas que te han compartido desde Pizarro (Casa R69)» o el nombre de quien la generó, configurable.
- CONFUSO: la columna nueva queda detrás de «Hecho» (al final); «Organizar por personas» sí las pone antes de la terminada. Mejor que «Añadir columna» la ponga también antes de la columna terminada.
- BIEN: lo que se publica está claro en el pie y en el diálogo; la caducidad («Vale hasta el 25 dic 2026 si nadie la usa (abrirla o actualizarla cuenta como uso).») se entiende; «Marcar como hecha» lleva la tarea a «Hecho» en el tablero al momento, con su aviso.

### 2. Tipos, Varias tareas, Deshacer todo, bloqueos
- BIEN: «Varias tareas»: tras escribir las líneas, «3 tareas detectadas», «Tipo para todas» o un tipo por línea (el botón dice «Elige el tipo» hasta elegirlos y luego «Crear 3 tareas»). Se crean con su tipo, plantilla y SIN prefijo («Comprar pilas», no «Comprar Comprar pilas»).
- BIEN: cambio de tipo con la descripción a medias (Papeleo → Cita): lo escrito («Plazo: Caduca en enero.») se conserva junto a la plantilla nueva; avisos «Tipo guardado; la descripción, sin guardar» y, junto a los botones, «Tipo cambiado y plantilla aplicada; falta guardar la descripción». El título pasa a «Cita: Renovar el DNI».
- BIEN: «Deshacer todo» → diálogo «¿Deshacer todos los cambios? Se desharán los cambios que has hecho en esta tarea desde que la abriste, también lo escrito sin guardar, y se cerrará. Los comentarios y lo que hayan cambiado otras personas se quedan como están.» («Seguir editando» / «Deshacer todo»). Vuelve a Papeleo, sin prefijo.
- CONFUSO (menor): el cambio de tipo AÑADE subtareas del tipo nuevo y deja las que no tocaste; con varios cambios seguidos se mezclan subtareas de tipos distintos («Preparar documentación» de Papeleo junto a las de Cita).
- CONFUSO (menor): «Varias tareas» crea sin prefijo, pero «Nueva tarea» y el cambio de tipo sí lo ponen («Cita: …», «Comprar …»). Conviene una sola regla.
- BIEN: «Bloqueada por» con buscador; «Bloqueada por Renovar el DNI»; al pulsar el enlace abre «Renovar el DNI» con «← Volver a «Pedir cita al dentista»» y «Bloquea a Pedir cita al dentista»; «Volver» regresa.
- PENDIENTE (propietario): pegar una imagen de verdad con Ctrl+V (paso 9 del prompt 1).

### 3. Mi perfil
- BIEN: «Preferencias → Orden de los proyectos» («Usados recientemente: Arriba el último que has abierto.» / «Alfabético: Por nombre, de la A a la Z.») cambia el selector al momento. Lo dejé en «Usados recientemente».
- FALLO: «Plantillas»: edito «Contexto para IA» sin guardar y pulso la pestaña «Avisos» → «Cambios sin guardar / «Contexto para IA» tiene cambios sin guardar. ¿Descartarlos?» (bien), pero «Descartar cambios» NO hace nada: el aviso se cierra, el editor sigue abierto con lo escrito y no cambia de pestaña (probado dos veces, también con clic de ratón real). Al intentar salir de la página después, el navegador aún avisa de cambios sin guardar. Sospecha: useUnsavedChangesGuard repite el clic (`a.click()`) mientras el diálogo aún deja el resto de la página inerte, y el clic se pierde; o la pestaña no es un enlace normal. Hay que mirar también Ajustes del proyecto (usa el mismo guardián).
- OBS: el tema de color «Eva» no dice qué es (los demás son colores: Azul, Verde bosque, Siena, Mostaza, Blanco y negro).

### 4. Calendario, Mis tareas y Avisos
- BIEN: el Calendario muestra las tareas de todos los proyectos con siglas, «(Plazo vencido)» y barras de entregable («Beta cerrada 0/3 · En riesgo», «Lugar reservado 0/1 · En plazo»). Leyenda al pie: «AB Siglas del proyecto» y «Entregable: tareas hechas de su total; el color indica si va en plazo».
- CONFUSO: la leyenda está abajo del todo (hay que bajar) y no explica los colores de las tarjetas (rojo de vencida frente a los demás colores). Propuesta: leyenda arriba, junto a los filtros, con «rojo = vencida».
- BIEN: «Mis tareas asignadas»: «7 tareas en todos tus proyectos.» y la línea «Vencidas 2 · Próximos 7 días 4 · Sin fecha 1» con enlaces; cada tarea con proyecto, tipo, fecha, subtareas y columna.
- CONFUSO (menor): la columna sale sola al final de cada fila («Mamá», «Persona 1», «Admin Prueba»): parecen personas y son columnas. Mejor «en «Mamá»» o un icono de columna.
- BIEN: Avisos con «N sin leer», «Marcar todo como leído», avisos de la web de fuera firmados «Proveedor (fuera)».

### 5. Releases y plan para IA (Proyecto de prueba, con imagen y adjunto)
- BIEN: «Generar release» paso 1 («Notas de versión por tipo. Al desplegarla, va al histórico y cada tarea (salvo las fijas) pasa a empezar por su código: «R4F1: …».»), paso 2 con la imagen en el editor, «Adjuntos: R4F1_boceto-csv.webp, R4F1_grifo-modelo.txt», «Descargar adjuntos (2)», «.md», «.txt». Cerrada sin desplegar; la tarjeta vuelve a «Para la IA».
- FALLO (misma causa que el paso 3 y el 18 del prompt 1): el Markdown copiado tiene la imagen pegada al texto: «…que la tabla.![boceto-csv.png](/api/attachments/…)». Además el enlace es interno de Pizarro (/api/attachments/…): fuera de Pizarro no se ve; la lista de adjuntos sí dice «R4F1_boceto-csv.webp» (que va en el ZIP). Propuesta: en el .md/.txt de la release, la imagen como «imagen `R4F1_boceto-csv.webp`» (igual que en el plan para IA) y en su propia línea.
- CONFUSO (menor): la imagen se llama «boceto-csv.png» en la descripción y «boceto-csv.webp» en adjuntos.
- Plan para IA: ver prompt 1, paso 18.

### 6. Administración
- Usuarios: «2 activos · 1 invitación pendiente», nota de que sin email ni Google hay que forzar el cambio de contraseña. BIEN.
- Proyectos: «Proyectos de equipo y sus miembros. Los privados no salen aquí.» Cada proyecto: «0 miembros · 1 admin sin ser miembro» y «Admin Prueba (admin, no miembro; lo tiene en su lista)». CONFUSO: «lo tiene en su lista» no se entiende (¿qué lista?). Propuesta: «lo ve por ser administrador» y, si está en su selector, «sale en su selector de proyectos». Relacionado con la pregunta abierta 1.
- Tipos y plantillas: plantillas «De serie» con su descripción y «N columnas · N tipos propios · N etiquetas · todos los generales ocultos»; «Tipos de tarea»: generales con su número de tareas. ERRATA: el tipo «Respuesta» dice «Respondo a las preguntas y lo que necesitas de mi:» → «de mí» (src/lib/kinds-localize.ts:26 y migración de la v1.8; ojo: cambiarlo en kinds-localize puede afectar a cómo se reconoce el texto de serie en instalaciones existentes).
- Copias de seguridad: se entiende sin saber de servidores («Copias automáticas activas, pero solo en el disco de este servidor.», «Destino externo: Ninguno. Para tener las copias también fuera…»); las notas «i» de quien instala sí nombran variables (BACKUP_S3_*, BACKUP_EXTERNAL_DIR, UPLOAD_DIR/backups), pero van bajo «Para quien instala»: BIEN.
- Logs: periodo «Última hora / Últimas 24 h / 7 días / Personalizado…» (Desde/Hasta por días); contadores «Info / Avisos / Error»; «Descargar CSV»; líneas de «Compartir fuera» con «/x/…». BIEN. Los avisos de hoy son los esperables (conflicto de descripción, «Solo se puede deshacer el último cambio…», inicios de sesión fallidos).
- OBS: en «Inicio de sesión fallido» el email desconocido sale enmascarado («a***@…») y el de una cuenta existente sale completo; es coherente (es de la instalación), pero conviene que el CSV haga lo mismo.

### 7. Historial de versiones
- BIEN: buscador «WhatsApp» → «12 de 81 versiones», con el término resaltado; «/changelog#v1.60.0» abre esa versión aunque no esté entre las 10 últimas.

## Prompt 3 — DMARC (detalle)


1. Cloudflare → getpizarro.com → Email → DMARC Management, periodo «Last 7 days»: SIN DATOS. «No data available — We're waiting for the first DMARC report. It normally takes 24 hours for the first results to come in.»; «DMARC reports: No data available». Según el prompt, me paro aquí.
Resumen del registro que muestra Cloudflare: DMARC policy «None» (Warning), SPF policy «Soft fail» (Warning), DKIM in use «Yes», BIMI in use «No».
No he cambiado nada. Propuesta: volver a mirar dentro de unos días; si sigue sin llegar ninguno, comprobar que el `rua` del registro `_dmarc` es el de Cloudflare (DNS → Records, solo mirar) y que de verdad sale correo con el dominio (si getpizarro.com aún no envía correo, no habrá informes).
