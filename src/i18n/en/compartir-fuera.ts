// Traducciones al inglés: columna «Compartir fuera» (página sin cuenta /x/<token>, su pie en el tablero, Ajustes del
// proyecto, avisos, registro e informe PDF). Clave: texto exacto en español.
export const compartirFuera: Record<string, string> = {
  // Rol de la columna y Ajustes del proyecto
  "Compartir fuera": "Share outside",
  "Sus tareas se publican en una web sin cuenta para alguien de fuera: botón «Generar web» al pie.": "Its tasks are published on a page for someone outside, no account needed: “Generate page” button at the bottom.",
  "Columnas cuyas tareas se publican en una web sin cuenta. Solo lo activan los administradores.": "Columns whose tasks are published on a page that needs no account. Only admins can turn it on.",
  "Permitir columnas «Compartir fuera»": "Allow “Share outside” columns",
  "Una columna con el rol «Compartir fuera» publica sus tareas en una web sin cuenta para alguien de fuera (un proveedor, un cliente), que puede verlas, marcarlas como hechas, cambiar su fecha, comentar y descargar sus adjuntos.":
    "A column with the “Share outside” role publishes its tasks on a page for someone outside (a supplier, a client) who needs no account: they can see them, mark them as done, change their date, comment and download their attachments.",
  "Al apagarlo, todos los enlaces del proyecto dejan de funcionar al momento.": "Turning it off stops all of the project's links from working at once.",
  "Apagar «Compartir fuera»": "Turn off “Share outside”",
  "Hay 1 enlace activo: dejará de funcionar al momento. ¿Apagarlo?": "There is 1 active link: it will stop working at once. Turn it off?",
  "Hay {n} enlaces activos: dejarán de funcionar al momento. ¿Apagarlo?": "There are {n} active links: they will stop working at once. Turn it off?",
  "Apagar": "Turn off",
  "«Compartir fuera» activado": "“Share outside” turned on",
  "«Compartir fuera» apagado": "“Share outside” turned off",
  "«Compartir fuera» no está activado en este proyecto.": "“Share outside” is not turned on in this project.",
  "Esta columna no es una columna «Compartir fuera».": "This column is not a “Share outside” column.",
  "Caducidad no válida.": "Invalid expiry.",

  // Pie de la columna, marca de la cabecera y diálogo
  "Compartir fuera: {state}": "Share outside: {state}",
  "Enlace activo hasta el {date}": "Link active until {date}",
  "Enlace caducado": "Link expired",
  "Web sin generar": "Page not generated yet",
  "Generar web": "Generate page",
  "Actualizar web": "Update page",
  "Enlace de la web": "Page link",
  "Caduca tras {label} sin uso: pulsa para cambiarlo": "Expires after {label} without use: click to change",
  "1 mes": "1 month",
  "3 meses": "3 months",
  "Dejar de compartir": "Stop sharing",
  "La web de «{name}» dejará de funcionar al momento y no se puede deshacer. ¿Seguir?": "The page of “{name}” will stop working at once and this can't be undone. Continue?",
  "Web de «{name}»": "Page of “{name}”",
  "Se ha publicado 1 tarea.": "1 task has been published.",
  "Se han publicado {n} tareas.": "{n} tasks have been published.",
  "{n} no caben y no salen en la web.": "{n} don't fit and are not on the page.",
  "Cualquiera con esta dirección puede ver estas tareas, marcarlas como hechas, cambiar su fecha, comentar y descargar sus adjuntos, sin cuenta.":
    "Anyone with this address can see these tasks, mark them as done, change their date, comment and download their attachments, with no account.",
  "Pulsa para copiar": "Click to copy",
  "Tareas de «{name}»": "Tasks of “{name}”",
  "Hola:\n\nEn esta página puedes ver las tareas de «{name}», marcarlas como hechas, cambiar su fecha, comentar y descargar sus archivos adjuntos, sin necesidad de cuenta:\n\n{url}\n\nEl enlace deja de funcionar si nadie lo usa hasta el {date}.":
    "Hello,\n\nOn this page you can see the tasks of “{name}”, mark them as done, change their date, comment and download their attachments, with no account needed:\n\n{url}\n\nThe link stops working if nobody uses it until {date}.",
  "Crear un enlace nuevo": "Create a new link",
  "Vale hasta el {date} si nadie la usa (abrirla o actualizarla cuenta como uso).": "Valid until {date} if nobody uses it (opening or updating it counts as use).",
  "Revocar enlace": "Revoke link",
  "La web dejará de funcionar al momento para quien tenga el enlace. Podrás generar otro después. ¿Revocarlo?": "The page will stop working at once for anyone with the link. You can generate another one later. Revoke it?",
  "Enlace revocado": "Link revoked",

  // Página pública (/x/<token>)
  "Tarea marcada como hecha.": "Task marked as done.",
  "Fecha cambiada.": "Date changed.",
  "Comentario publicado.": "Comment posted.",
  "Demasiados cambios seguidos. Espera un rato y vuelve a intentarlo.": "Too many changes in a row. Wait a while and try again.",
  "Esta tarea ya no admite más comentarios.": "This task doesn't accept more comments.",
  "Esa tarea ya no está en esta lista.": "That task is no longer on this list.",
  "No se ha podido guardar: revisa los datos.": "Couldn't save: check the details.",
  "Fecha: {date}": "Date: {date}",
  "Marcar como hecha": "Mark as done",
  "Cambiar fecha": "Change date",
  "Aún no hay comentarios.": "No comments yet.",
  "Comentario": "Comment",
  "Escribe un comentario…": "Write a comment…",
  "No hay tareas en esta lista.": "There are no tasks on this list.",
  "Este enlace deja de funcionar si nadie lo usa hasta el {date}.": "This link stops working if nobody uses it until {date}.",
  "Esta lista de tareas ha caducado. Contacta con la persona que te ha dado el enlace.": "This task list has expired. Contact the person who gave you the link.",
  "Demasiados intentos": "Too many attempts",

  // Quién lo hizo (historial, comentarios, deshacer y avisos)
  "{name} (fuera)": "{name} (outside)",
  "{actor} ha marcado como hecha {task}": "{actor} marked {task} as done",
  "{who}: marcó «{title}» como hecha": "{who}: marked “{title}” as done",
  "{who}: cambió la fecha de «{title}»": "{who}: changed the date of “{title}”",
  "{who}: comentó en «{title}»": "{who}: commented on “{title}”",

  // Registro (Logs)
  "Abrieron la web de «Compartir fuera» de la columna «{col}»": "The “Share outside” page of column “{col}” was opened",
  "Descarga de «{name}» desde la web de «Compartir fuera»": "Download of “{name}” from the “Share outside” page",
  "Fallo de una acción de «Compartir fuera»: {error}": "A “Share outside” action failed: {error}",
  "Generó la web de «{col}» ({n} tareas)": "Generated the page of “{col}” ({n} tasks)",
  "Creó un enlace nuevo para la web de «{col}» ({n} tareas)": "Created a new link for the page of “{col}” ({n} tasks)",
  "Actualizó la web de «{col}» ({n} tareas)": "Updated the page of “{col}” ({n} tasks)",
  "Generó la web de «{col}» (1 tarea)": "Generated the page of “{col}” (1 task)",
  "Creó un enlace nuevo para la web de «{col}» (1 tarea)": "Created a new link for the page of “{col}” (1 task)",
  "Actualizó la web de «{col}» (1 tarea)": "Updated the page of “{col}” (1 task)",
  "Cambió la caducidad de la web de «{col}» a {n} días sin uso": "Changed the expiry of the page of “{col}” to {n} days without use",
  "Revocó el enlace de la web de «{col}»": "Revoked the link of the page of “{col}”",
  "Activó «Compartir fuera» en el proyecto «{name}»": "Turned on “Share outside” in project “{name}”",
  "Apagó «Compartir fuera» en el proyecto «{name}»": "Turned off “Share outside” in project “{name}”",

  // Informe PDF
  "Compartidas fuera: {list}": "Shared outside: {list}",
  "compartida fuera": "shared outside",
  "enlace activo, caduca el {date}": "link active, expires on {date}",
  "enlace caducado": "link expired",
  "web sin generar": "page not generated yet",

  // Ronda 68, arreglos: la dirección se vuelve a ver, lo que se publica, enlace nuevo con confirmación, comentarios
  // anteriores en la página y el registro de abrir el enlace.
  "Se publican la descripción, las subtareas, los comentarios y los adjuntos de estas tareas; los adjuntos se podrán descargar.":
    "The description, subtasks, comments and attachments of these tasks are published; the attachments can be downloaded.",
  "El enlace actual dejará de funcionar al momento para quien lo tenga y habrá que enviarle el nuevo. ¿Crear uno nuevo?":
    "The current link will stop working at once for anyone who has it, and you'll have to send them the new one. Create a new one?",
  "El enlace sigue funcionando, pero Pizarro no puede volver a enseñar su dirección: se creó con una versión anterior o ha cambiado la clave de cifrado de la instalación. Quien ya la tiene puede seguir usándola. Si necesitas la dirección, crea un enlace nuevo (el actual dejará de funcionar).":
    "The link still works, but Pizarro can't show its address again: it was created with an earlier version or the installation's encryption key has changed. Whoever already has it can keep using it. If you need the address, create a new link (the current one will stop working).",
  "Hay 1 comentario anterior que no se muestra.": "There is 1 earlier comment that isn't shown.",
  "Hay {n} comentarios anteriores que no se muestran.": "There are {n} earlier comments that aren't shown.",
  "Abrió el enlace de la web de «{col}»": "Opened the link of the page of “{col}”",
  // Ronda 68, segunda vuelta (cliente): apagar con el recuento del servidor, borrar una columna compartida.
  "Los enlaces activos del proyecto dejarán de funcionar al momento. ¿Apagarlo?": "The project's active links will stop working at once. Turn it off?",
  "«Compartir fuera» apagado: 1 enlace ha dejado de funcionar": "“Share outside” turned off: 1 link has stopped working",
  "«Compartir fuera» apagado: {n} enlaces han dejado de funcionar": "“Share outside” turned off: {n} links have stopped working",
  "La web compartida dejará de funcionar y no vuelve al deshacer.": "The shared page will stop working and won't come back if you undo.",
  // Ronda 68, segunda vuelta (servidor): el informe distingue revocado de caducado.
  "enlace revocado": "link revoked",
  // Ronda 69: «Compartir fuera» (diálogo y pie más claros, sin tareas no se genera, cambios sin publicar, web pública).
  "No hay tareas en «{name}»": "There are no tasks in “{name}”",
  "Link": "Link",
  "Dirección de la web": "Page address",
  "Caduca tras {label} sin uso": "Expires after {label} without use",
  "Se publica todo el contenido de las tareas.": "All the content of the tasks is published.",
  "Hay cambios sin publicar: pulsa «Actualizar web»": "There are unpublished changes: click “Update page”",
  "No hay tareas en esta columna: añade alguna antes de generar la web.": "There are no tasks in this column: add some before generating the page.",
  "Enlace revocado por {name} el {date}": "Link revoked by {name} on {date}",
  "Compartida por {name} desde Pizarro": "Shared by {name} from Pizarro",
  "Compartida desde Pizarro": "Shared from Pizarro",
  "Enlace no disponible": "Link not available",
  "Esta lista de tareas ya no está disponible. Contacta con la persona que te ha dado el enlace.": "This task list is no longer available. Contact the person who gave you the link.",
  "Link: enlace de la web": "Link: page link",
  // Ronda 71: aviso de enlace revocado (v1.75 lo escribirá) y mejoras de la web pública
  "La fecha no puede ser anterior al {date}.": "The date can't be earlier than {date}.",
  "La fecha no ha cambiado.": "The date hasn't changed.",
  "Copia tu texto antes de volver a intentarlo.": "Copy your text before trying again.",
  "Vista de «{name}» desde la web de «Compartir fuera»": "View of “{name}” from the “Share outside” page",
  "{actor} ha revocado el enlace de la web de «{column}»": "{actor} revoked the link to the web page of «{column}»",
  "Esa web ya no está disponible. Puedes generar otra desde la columna.": "That web page is no longer available. You can generate another one from the column.",
  // Ronda 72: aviso de enlace revocado (registro)
  "Aviso a quien generó la web: otra persona ha revocado su enlace": "Notice to whoever generated the web page: someone else revoked its link",
  "Aviso a quien generó la web: otra persona ha revocado su enlace (con envío externo)": "Notice to whoever generated the web page: someone else revoked its link (with external delivery)",
};
